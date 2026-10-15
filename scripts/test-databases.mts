import type { ExecFileException } from 'node:child_process';

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const docker = (...args: string[]) => execute('docker', args, { timeout: 180000, maxBuffer: 1024 * 1024 });
const id = randomBytes(6).toString('hex'), password = randomBytes(24).toString('hex');
const containers = [];
const network = `tokenpet-test-${id}`, image = `tokenpet-test:${id}`;
const databases = [];
const env = { ...process.env };
const temporary = mkdtempSync(join(tmpdir(), 'tokenpet-database-test-'));
const composeEnv = { ...process.env };
for (const key of Object.keys(composeEnv)) if (/^(TOKENPET_|COMPOSE_)/.test(key)) delete composeEnv[key];
writeFileSync(join(temporary, 'empty.env'), '');
writeFileSync(join(temporary, 'image.yaml'), `services:\n  tokenpet:\n    image: ${image}\n    ports: !reset []\n`);
const compose = (files: string[], args: string[], extraEnv: Record<string, string> = {}) => execute('docker', ['compose', '--env-file', join(temporary, 'empty.env'),
  '-p', `tokenpet-test-${id}`, '-f', 'compose.yaml', ...files.flatMap(file => ['-f', file]), ...args],
{ env: { ...composeEnv, ...extraEnv }, timeout: 180000, maxBuffer: 1024 * 1024 });
const probe = `
  import assert from 'node:assert/strict';
  import { existsSync } from 'node:fs';
  const base = 'http://localhost:4780';
  const health = await fetch(base + '/api/health');
  if (process.argv[1] === 'offline') { assert.equal(health.status, 503); process.exit(0); }
  assert.equal(health.status, 200);
  const credentials = { username: 'container_user', nickname: 'Docker 펫', password: 'isolated container test password' };
  const auth = await fetch(base + (process.argv[1] === 'restart' ? '/api/login' : '/api/signup'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials)
  });
  assert.ok(auth.ok, 'Docker authentication failed: ' + auth.status);
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const issued = await fetch(base + '/api/tokens', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(issued.status, 201);
  const { token } = await issued.json();
  for (const [path, data] of [
    ['usage', { records: [{ source: 'codex', key: 'd'.repeat(64), input: 20000, output: 0, baseline: false }] }],
    ['checkin', {}], ['gacha', { count: 1 }]
  ]) {
    const result = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': token,
      'Idempotency-Key': 'container-once-' + path }, body: JSON.stringify(data) });
    assert.equal(result.status, 200);
  }
  const state = await (await fetch(base + '/api/state', { headers: { 'X-API-Key': token } })).json();
  assert.equal(state.player.coins, 302); assert.equal(state.player.tokens, 20000); assert.equal(state.player.pulls, 1);
  assert.equal(existsSync('/data/game.sqlite'), !process.env.TOKENPET_DATABASE_URL && !process.env.TOKENPET_DATABASE_URL_FILE);
  assert.match(await (await fetch(base + '/')).text(), /<html/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
`;
async function readyApp(name: string) {
  for (let n = 0; n < 40; n++) {
    try {
      await docker('exec', name, 'node', '--input-type=module', '-e', "const r=await fetch('http://localhost:4780/api/health');if(!r.ok)process.exit(1)");
      return;
    } catch { await delay(500); }
  }
  throw new Error('Application did not become ready');
}
try {
  const basic = JSON.parse((await compose([], ['config', '--format', 'json'])).stdout);
  assert.deepEqual(Object.keys(basic.services), ['tokenpet']);
  assert.equal(basic.services.tokenpet.environment.TOKENPET_DATABASE_URL, '');
  assert.equal(basic.services.tokenpet.environment.TOKENPET_PUBLIC_URL, 'http://localhost:4780');
  assert.equal(basic.services.tokenpet.environment.TOKENPET_DB_NAMESPACE, 'tokenpet');
  assert.equal(basic.services.tokenpet.ports[0].host_ip, '127.0.0.1');
  const https = JSON.parse((await compose(['compose.https.yaml'], ['config', '--format', 'json'], { TOKENPET_ADDRESS: 'pets.example.test' })).stdout);
  assert.equal(https.services.tokenpet.ports?.length || 0, 0);
  assert.equal(https.services.tokenpet.environment.TOKENPET_PUBLIC_URL, 'https://pets.example.test');
  assert.equal(https.services.tokenpet.environment.TOKENPET_TRUST_PROXY, '1');
  assert.deepEqual(Object.keys(https.services).sort(), ['caddy', 'tokenpet']);
  console.log('Compose: zero-configuration SQLite and optional HTTPS configuration passed');
  await docker('network', 'create', network);
  for (const [driver, image, port, variables, ready] of [
    ['postgres', 'postgres:16-alpine', 5432, { POSTGRES_DB: 'tokenpet_test', POSTGRES_USER: 'tokenpet', POSTGRES_PASSWORD: password }, ['pg_isready', '-U', 'tokenpet', '-d', 'tokenpet_test']],
    ['mariadb', 'mariadb:10.11', 3306, { MARIADB_DATABASE: 'tokenpet_test', MARIADB_USER: 'tokenpet', MARIADB_PASSWORD: password, MARIADB_RANDOM_ROOT_PASSWORD: '1' }, ['healthcheck.sh', '--connect', '--innodb_initialized']],
  ] as const) {
    const name = `tokenpet-test-${driver}-${id}`;
    containers.push(name);
    console.log(`Starting isolated ${image} database…`);
    await execute('docker', ['run', '-d', '--name', name, '--network', network, '-p', `127.0.0.1::${port}`,
      ...Object.keys(variables).flatMap(key => ['-e', key]), image], { env: { ...process.env, ...variables }, timeout: 180000 });
    let available = false;
    for (let n = 0; n < 60; n++) {
      try { await docker('exec', name, ...ready); available = true; break; } catch { await delay(1000); }
    }
    if (!available) throw new Error(`${driver} did not become ready`);
    const mapping = (await docker('port', name, `${port}/tcp`)).stdout.trim();
    const localPort = mapping.split(':').at(-1);
    env[`TOKENPET_TEST_${driver.toUpperCase()}_URL`] = `${driver}://tokenpet:${password}@127.0.0.1:${localPort}/tokenpet_test`;
    databases.push({ driver, name, url: `${driver}://tokenpet:${password}@${name}:${port}/tokenpet_test` });
  }
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', 'test/integration/database.test.ts'], { env, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
  process.exitCode = code;
  if (code === 0) {
    console.log('Building the production Docker image…');
    await execute('docker', ['build', '-t', image, '.'], { timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
    const overrides = [join(temporary, 'image.yaml')];
    for (const phase of ['first', 'restart']) {
      await compose(overrides, ['up', '-d', '--no-build']);
      const name = (await compose(overrides, ['ps', '-q', 'tokenpet'])).stdout.trim();
      await readyApp(name);
      await docker('exec', name, 'node', '--input-type=module', '-e', probe, phase);
      await compose(overrides, ['down']);
    }
    console.log('SQLite: Compose without .env, signup, token, rewards, assets and container replacement passed');
    for (const database of databases) {
      const name = `tokenpet-test-app-${database.driver}-${id}`;
      containers.push(name);
      await execute('docker', ['run', '-d', '--name', name, '--network', network,
        '-e', 'TOKENPET_DATABASE_URL', '-e', `TOKENPET_DB_NAMESPACE=docker_${id}`, '-e', 'TOKENPET_DB_CONNECT_TIMEOUT_MS=1000', image],
      { env: { ...process.env, TOKENPET_DATABASE_URL: database.url }, timeout: 30000 });
      await readyApp(name);
      await docker('exec', name, 'node', '--input-type=module', '-e', probe, 'first');
      await docker('restart', name);
      await readyApp(name);
      await docker('exec', name, 'node', '--input-type=module', '-e', probe, 'restart');
      if (database.name) {
        await docker('stop', database.name);
        await docker('exec', name, 'node', '--input-type=module', '-e', probe, 'offline');
        await docker('start', database.name);
        await readyApp(name);
      }
      console.log(`${database.driver}: Docker signup, token, rewards, assets, restart and database health passed`);
    }
  }
} catch (error) {
  console.error(`Database tests failed: ${String((error as ExecFileException).stderr || (error as ExecFileException).message).replaceAll(password, '[redacted]')}`);
  process.exitCode = 1;
} finally {
  await compose([join(temporary, 'image.yaml')], ['down', '--volumes', '--remove-orphans']).catch(() => {});
  for (const name of containers.reverse()) await docker('rm', '-f', '-v', name).catch(() => {});
  await docker('image', 'rm', image).catch(() => {});
  await docker('network', 'rm', network).catch(() => {});
  rmSync(temporary, { recursive: true, force: true });
}
