import type { AddressInfo } from 'node:net';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readlinkSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configuration, credential } from '../dist/src/config.js';
import { startServer } from '../dist/src/server.js';
import { shellQuote } from '../dist/src/shell-install.js';

const run = promisify(execFile);

test('clone-free installer handles spaces, updates, endpoint selection, and failed downloads without damaging the install', async t => {
  const dir = mkdtempSync(join(tmpdir(), "tokenpet bootstrap's-"));
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  t.after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });
  const commands = join(dir, 'commands'), installed = join(dir, 'installed-bin'), user = join(dir, 'user');
  mkdirSync(commands); mkdirSync(installed); mkdirSync(user);
  const archive = join(dir, 'source.tar.gz');
  const prefix = process.platform === 'darwin' ? ['-s', ',^,tokenpet/,'] : ['--transform=s,^,tokenpet/,'];
  await run('tar', ['-czf', archive, ...prefix, 'bin', 'src', 'public', 'integrations', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json']);
  symlinkSync(process.execPath, join(commands, 'node'));
  writeFileSync(join(commands, 'npm'), `#!/bin/sh
case "$1" in
  ci) ln -s ${shellQuote(resolve('node_modules'))} node_modules ;;
  run) [ -z "$FAIL_BUILD" ] || exit 42; exec ${shellQuote(process.execPath)} --run build ;;
  prune) exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
  writeFileSync(join(commands, 'git'), '#!/bin/sh\necho "git must not be used" >&2\nexit 90\n', { mode: 0o700 });
  writeFileSync(join(commands, 'curl'), `#!${process.execPath}\nimport { copyFileSync } from 'node:fs';\nif (process.env.FAIL_DOWNLOAD) process.exit(22);\nconst args = process.argv.slice(2);\ncopyFileSync(process.env.TEST_ARCHIVE, args[args.indexOf('-o') + 1]);\n`, { mode: 0o700 });
  const env: NodeJS.ProcessEnv & { TOKENPET_INSTALL_DIR: string } = { ...process.env, HOME: user, ZDOTDIR: user, SHELL: '/bin/bash', PATH: `${commands}:${installed}:/usr/bin:/bin`,
    TOKENPET_INSTALL_DIR: join(dir, 'installation'), TOKENPET_BIN_DIR: installed, TEST_ARCHIVE: archive,
    TOKENPET_DATA_DIR: join(user, 'game'), CODEX_HOME: join(user, 'codex'), CLAUDE_CONFIG_DIR: join(user, 'claude'), TOKENPET_WATCH: '0' };
  for (const key of ['TOKENPET_SERVER', 'TOKENPET_API_KEY', 'TOKENPET_API_KEY_FILE', 'TOKENPET_PUBLIC_URL', 'TOKENPET_HOST']) delete env[key];
  const config = configuration(env);
  app = await startServer(config, { port: 0 });
  env.TOKENPET_PORT = String((app.server.address() as AddressInfo).port);
  const execute = (args: string[], values = env) => run('/bin/bash', [resolve('install.sh'), ...args], { env: values, timeout: 20000 });
  const local = await execute([]);
  assert.match(local.stdout, /설치 완료/);
  assert.ok(existsSync(join(installed, 'tokenpet')));
  assert.equal(configuration(env).remote, false, 'a fresh default install uses the personal workspace without prompting');
  const status = await run(join(installed, 'tokenpet'), ['status'], { env });
  assert.match(status.stdout, /300 C/);
  assert.ok(existsSync(join(env.TOKENPET_INSTALL_DIR, 'current/dist/public/app.js')), 'source installs compile browser TypeScript');
  const current = join(env.TOKENPET_INSTALL_DIR, 'current'), before = readlinkSync(current);
  const keyFile = join(dir, 'game-key'); writeFileSync(keyFile, credential(config), { mode: 0o600 });
  const remote = await execute(['--endpoint', `${app.url}/api`], { ...env, TOKENPET_API_KEY_FILE: keyFile });
  assert.match(remote.stdout, /서버 연결 완료/);
  assert.ok(!remote.stdout.includes(credential(config)), 'installer must never print the key');
  assert.notEqual(readlinkSync(current), before);
  assert.equal(configuration(env).baseUrl, app.url);
  assert.ok(!readFileSync(join(installed, 'tokenpet'), 'utf8').includes(credential(config)));
  const saved = readFileSync(join(config.dataDir, 'connection.json'));
  await execute([]);
  assert.deepEqual(readFileSync(join(config.dataDir, 'connection.json')), saved, 'default updates preserve the existing server and key');
  const active = readlinkSync(current), releases = readdirSync(join(env.TOKENPET_INSTALL_DIR, 'releases'));
  await assert.rejects(execute(['--local'], { ...env, FAIL_DOWNLOAD: '1' }));
  await assert.rejects(execute(['--local'], { ...env, FAIL_BUILD: '1' }));
  assert.equal(readlinkSync(current), active);
  assert.deepEqual(readdirSync(join(env.TOKENPET_INSTALL_DIR, 'releases')), releases);
  assert.equal((await run(join(installed, 'tokenpet'), ['doctor'], { env })).stderr, '');

  const runtime = join(dir, 'runtime'); mkdirSync(join(runtime, 'bin'), { recursive: true });
  writeFileSync(join(runtime, 'bin/node'), `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`, { mode: 0o700 });
  copyFileSync(join(commands, 'npm'), join(runtime, 'bin/npm'));
  const nodeArchive = join(dir, 'node.tar.gz');
  await run('tar', ['-czf', nodeArchive, ...prefix, '-C', runtime, 'bin']);
  rmSync(join(commands, 'node'));
  writeFileSync(join(commands, 'node'), `#!/bin/sh\nif [ "$1" = "-e" ]; then exit 1; fi\nexec ${shellQuote(process.execPath)} "$@"\n`, { mode: 0o700 });
  writeFileSync(join(commands, 'curl'), `#!${process.execPath}
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2), output=args[args.indexOf('-o')+1];
if (args.some(a => a.endsWith('/SHASUMS256.txt'))) {
  const digest=process.env.BAD_CHECKSUM ? '0'.repeat(64) : createHash('sha256').update(readFileSync(process.env.TEST_NODE_ARCHIVE)).digest('hex');
  const filename=process.env.BAD_METADATA ? 'not-node.txt' : process.env.TEST_NODE_NAME;
  writeFileSync(output, digest+'  '+filename+'\\n'+'0'.repeat(64)+'  '+'x'.repeat(filename.slice(filename.indexOf('-',6)).length-1)+'\\n');
} else copyFileSync(args.some(a => a.startsWith('https://nodejs.org/')) ? process.env.TEST_NODE_ARCHIVE : process.env.TEST_ARCHIVE, output);
`, { mode: 0o700 });
  writeFileSync(join(user, '.profile'), '# existing login settings\n');
  const bootstrapEnv = { ...env, TOKENPET_INSTALL_DIR: join(dir, 'with-runtime'), TOKENPET_BIN_DIR: join(user, '.local/bin'),
    TEST_NODE_ARCHIVE: nodeArchive, TEST_NODE_NAME: `node-v24.0.0-${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch}.tar.gz` };
  assert.match((await execute(['--local'], bootstrapEnv)).stdout, /Node.js 24/);
  assert.equal(configuration(bootstrapEnv).remote, false, 'explicit --local returns to the preserved personal workspace');
  const bootstrapCurrent = join(bootstrapEnv.TOKENPET_INSTALL_DIR, 'current');
  const bootstrapBefore = readlinkSync(bootstrapCurrent);
  assert.ok(existsSync(join(bootstrapEnv.TOKENPET_INSTALL_DIR, 'v24.0.0/bin/node')));
  assert.match(readFileSync(join(user, '.profile'), 'utf8'), /^# existing login settings\n/);
  assert.match(readFileSync(join(user, '.profile'), 'utf8'), /# TokenPet/);
  assert.match(readFileSync(join(user, '.bashrc'), 'utf8'), /# TokenPet/);
  assert.ok(!existsSync(join(user, '.bash_profile')), 'keep the existing login profile active');
  for (const failure of ['BAD_CHECKSUM', 'BAD_METADATA']) {
    await assert.rejects(execute(['--local'], { ...bootstrapEnv, [failure]: '1' }));
    assert.equal(readlinkSync(bootstrapCurrent), bootstrapBefore, 'a failed download must not replace the working install');
    assert.equal(readdirSync(join(bootstrapEnv.TOKENPET_INSTALL_DIR, 'releases')).length, 1, 'failed bootstrap releases must be removed');
  }

  // Uninstall the latest installation: its folder and launcher go, game data stays until --purge.
  const removed = await run(join(bootstrapEnv.TOKENPET_BIN_DIR, 'tokenpet'), ['uninstall'], { env: bootstrapEnv, timeout: 20000 });
  assert.match(removed.stdout, /프로그램을 삭제했습니다/);
  assert.ok(!existsSync(bootstrapEnv.TOKENPET_INSTALL_DIR), 'the install folder is removed');
  assert.ok(!existsSync(join(bootstrapEnv.TOKENPET_BIN_DIR, 'tokenpet')), 'the launcher command is removed');
  assert.ok(existsSync(join(config.dataDir, 'game.sqlite')), 'game data stays without --purge');
  const purged = await run(process.execPath, [resolve('bin/tokenpet.mjs'), 'uninstall', '--purge'], { env: bootstrapEnv, timeout: 20000 });
  assert.match(purged.stdout, /npm이나 소스 폴더에서 실행 중이라/, 'a source checkout is never deleted');
  assert.ok(!existsSync(config.dataDir), '--purge removes game data');
});
