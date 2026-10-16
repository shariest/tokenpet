import type { TestContext } from 'node:test';
import type { IncomingMessage } from 'node:http';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, credential, endpoint, saveConnection } from '../dist/src/config.js';
import { connect } from '../dist/src/connect.js';
import { request } from '../dist/src/client.js';
import { startServer } from '../dist/src/server.js';
import { ensureServer } from '../dist/src/runtime.js';
import { startRemoteSync } from '../dist/src/remote.js';
import { installCodexPet } from '../dist/src/codex-pet.js';
import { installLaunchers } from '../dist/src/cli-install.js';

function fixture(t: TestContext) {
  const dataDir = mkdtempSync(join(tmpdir(), 'tokenpet-connect-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { TOKENPET_DATA_DIR: dataDir, CODEX_HOME: join(dataDir, 'codex'), CLAUDE_CONFIG_DIR: join(dataDir, 'claude') };
}

test('bare domains and IPv4/IPv6 gain HTTPS; API paths are added once', () => {
  for (const [input, expected] of [
    [' pets.example.com ', 'https://pets.example.com'], ['192.0.2.10', 'https://192.0.2.10'],
    ['192.0.2.10:8443', 'https://192.0.2.10:8443'], ['2001:db8::1', 'https://[2001:db8::1]'],
    ['[2001:db8::1]:8443', 'https://[2001:db8::1]:8443'], ['https://pets.example.com/api/', 'https://pets.example.com'],
    ['http://localhost:4780', 'http://localhost:4780'],
  ]) assert.equal(endpoint(input), expected);
  for (const value of ['', 'http://192.0.2.10', 'ftp://pets.example.com', 'https://user:key@pets.example.com',
    'pets.example.com/private', 'pets.example.com?key=secret', 'pets.example.com#secret', 'pets.example.com\\api', 'two hosts']) {
    assert.throws(() => endpoint(value));
  }
});

test('saved remote secrets are private, scoped to their origin, and independent of local games', t => {
  const env = fixture(t), local = configuration(env), localKey = credential(local, true);
  const remoteKey = 'test-remote-key-'.repeat(3);
  saveConnection(local.dataDir, { server: 'https://pets.example.test', key: remoteKey });
  const remote = configuration(env);
  assert.equal(remote.remote, true); assert.equal(remote.baseUrl, 'https://pets.example.test');
  assert.equal(credential(remote), remoteKey);
  assert.equal(statSync(join(local.dataDir, 'connection.json')).mode & 0o777, 0o600);
  assert.equal(credential(configuration(env, { server: true })), localKey);
  const override = configuration({ ...env, TOKENPET_SERVER: 'other.example.test' });
  assert.throws(() => credential(override), /접근 키/);
  const secretFile = join(local.dataDir, 'docker-secret'); writeFileSync(secretFile, `${remoteKey}\n`);
  assert.equal(credential(configuration({ ...env, TOKENPET_API_KEY_FILE: secretFile }, { server: true })), remoteKey);
  saveConnection(local.dataDir, {});
  assert.equal(configuration(env).remote, false); assert.equal(credential(configuration(env)), localKey);
});

test('connect probes authenticated state before saving and preserves the previous connection on failure', async t => {
  const env = fixture(t), serverEnv = fixture(t);
  const serverConfig = { ...configuration(serverEnv), watch: false };
  const app = await startServer(serverConfig, { port: 0 });
  t.after(() => app.close());
  const key = credential(serverConfig), localKey = credential(configuration(env), true);
  const input = { ...env, TOKENPET_API_KEY: key };
  await connect(`${app.url}/api`, { env: input });
  assert.equal(input.TOKENPET_API_KEY, undefined);
  assert.equal(configuration(env).baseUrl, app.url);
  const before = readFileSync(join(env.TOKENPET_DATA_DIR, 'connection.json'));
  await assert.rejects(connect(app.url, { env: { ...env, TOKENPET_API_KEY: 'wrong-key-'.repeat(5) } }), /키|인증/);
  assert.deepEqual(readFileSync(join(env.TOKENPET_DATA_DIR, 'connection.json')), before);
  assert.equal((await request('/api/state', undefined, { config: configuration(env) })).player.coins, 300);
  assert.ok(!existsSync(join(env.TOKENPET_DATA_DIR, 'game.sqlite')));
  await connect('local', { env });
  assert.equal(credential(configuration(env)), localKey);
});

test('an explicitly configured offline endpoint never starts a local backend', async t => {
  const env = fixture(t);
  saveConnection(env.TOKENPET_DATA_DIR, { server: 'http://127.0.0.1:1', key: 'test-key-'.repeat(5) });
  await assert.rejects(ensureServer(configuration(env)), /연결/);
  assert.ok(!existsSync(join(env.TOKENPET_DATA_DIR, 'server.log')));
  assert.ok(!existsSync(join(env.TOKENPET_DATA_DIR, 'game.sqlite')));
});

test('remote sync sends local usage automatically and refreshes the client pet after care', async t => {
  const env = fixture(t), serverEnv = fixture(t);
  const serverConfig = { ...configuration(serverEnv), watch: false };
  const app = await startServer(serverConfig, { port: 0 });
  t.after(() => app.close());
  saveConnection(env.TOKENPET_DATA_DIR, { server: app.url, key: credential(serverConfig) });
  const config = configuration(env);
  mkdirSync(config.roots.claude[0], { recursive: true });
  mkdirSync(config.roots.codex[0], { recursive: true }); mkdirSync(config.roots.codex[1], { recursive: true });
  writeFileSync(join(config.roots.claude[0], 'session.jsonl'), JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
    message: { id: 'remote-sync-test', content: [{ text: 'private prompt' }], usage: { input_tokens: 400000, output_tokens: 0 } } }) + '\n');
  installCodexPet((await app.game.state()), config.codexPetDir);
  const sync = startRemoteSync(config)!; t.after(() => sync.stop());
  for (let i = 0; i < 100 && !sync.status?.lastScan; i++) await delay(20);
  assert.equal(sync.status!.errors, 0); assert.equal(sync.status!.files, 1);
  assert.equal((await app.game.player())!.coins, 340);
  await sync.scan(); assert.equal((await app.game.player())!.coins, 340);
  const manifest = join(config.codexPetDir, 'pet.json');
  const before = JSON.parse(readFileSync(manifest, 'utf8'));
  const result = await request('/api/care', { action: 'feed' }, { config });
  assert.equal(result.state.player.coins, 335);
  const after = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.notEqual(before.spritesheetPath, after.spritesheetPath); assert.match(after.description, /포만감 100\/100/);
  writeFileSync(manifest, '{"id":"unrelated-pet"}');
  await request('/api/state', undefined, { config });
  assert.equal(readFileSync(manifest, 'utf8'), '{"id":"unrelated-pet"}');
  sync.stop(); assert.equal(startRemoteSync({ ...config, remote: false }), null);
});

test('a new session continues from the cursors the previous uploader saved', async t => {
  const env = fixture(t), serverConfig = { ...configuration(fixture(t)), watch: false };
  const app = await startServer(serverConfig, { port: 0 }); t.after(() => app.close());
  let uploads = 0; app.server.on('request', (req: IncomingMessage) => { if (req.url === '/api/usage') uploads++; });
  saveConnection(env.TOKENPET_DATA_DIR, { server: app.url, key: credential(serverConfig) });
  const config = configuration(env);
  mkdirSync(config.roots.claude[0], { recursive: true });
  writeFileSync(join(config.roots.claude[0], 'session.jsonl'), JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
    message: { id: 'saved-cursor-test', usage: { input_tokens: 400000, output_tokens: 0 } } }) + '\n');
  for (const session of [1, 2]) {
    const sync = startRemoteSync(config)!; t.after(() => sync.stop());
    for (let i = 0; i < 100 && !sync.status?.lastScan; i++) await delay(20);
    assert.equal(sync.status!.files, 1); assert.equal(uploads, 1, `session ${session} leaves the history sent once`);
  }
  assert.equal((await app.game.player())!.coins, 340); assert.ok(!existsSync(join(env.TOKENPET_DATA_DIR, 'usage-sync.lock')));
});

test('a member-server session restores the launcher that a CLI update replaced', { skip: process.platform === 'win32' }, async t => {
  const env = fixture(t), serverConfig = { ...configuration(fixture(t)), watch: false };
  const app = await startServer(serverConfig, { port: 0 }); t.after(() => app.close());
  saveConnection(env.TOKENPET_DATA_DIR, { server: app.url, key: credential(serverConfig) });
  const config = { ...configuration(env), watch: false };
  const native = join(env.TOKENPET_DATA_DIR, 'native'), entry = join(env.TOKENPET_DATA_DIR, 'package', 'codex.js');
  mkdirSync(native); mkdirSync(join(env.TOKENPET_DATA_DIR, 'package'));
  writeFileSync(entry, '#!/bin/sh\n', { mode: 0o700 }); symlinkSync(entry, join(native, 'codex'));
  installLaunchers({ config, bin: resolve('bin/tokenpet.mjs'), backupDir: env.TOKENPET_DATA_DIR, env: { PATH: native } });
  // npm replaces the whole package, launcher included, and links the command to the new entry point.
  rmSync(`${entry}.tokenpet-launcher`); rmSync(join(native, 'codex')); symlinkSync(entry, join(native, 'codex'));
  const sync = startRemoteSync(config)!; t.after(() => sync.stop());
  for (let i = 0; i < 100 && readlinkSync(join(native, 'codex')) === entry; i++) await delay(20);
  assert.equal(readlinkSync(join(native, 'codex')), `${entry}.tokenpet-launcher`);
  assert.match(readFileSync(join(native, 'codex'), 'utf8'), /# >>> tokenpet >>>/);
});

test('remote pet selection still refreshes when usage collection is disabled', async t => {
  const env = fixture(t), serverConfig = { ...configuration(fixture(t)), watch: false };
  const app = await startServer(serverConfig, { port: 0 }); t.after(() => app.close());
  saveConnection(env.TOKENPET_DATA_DIR, { server: app.url, key: credential(serverConfig) });
  const config = { ...configuration(env), watch: false };
  installCodexPet((await app.game.state()), config.codexPetDir);
  const state = await app.game.state();
  const other = state.catalog.find(p => p.id !== state.player.equipped)!;
  await app.game.db.prepare('INSERT INTO pets(species,updated) VALUES(?,?)').run(other.id, Date.now());
  await app.game.equip(other.id);
  const sync = startRemoteSync(config)!; t.after(() => sync.stop());
  const manifest = join(config.codexPetDir, 'pet.json');
  for (let i = 0; i < 100 && !readFileSync(manifest, 'utf8').includes(other.name); i++) await delay(20);
  assert.ok(readFileSync(manifest, 'utf8').includes(other.name));
  assert.equal(sync.status, undefined, 'image polling must not collect disabled usage logs');
  assert.equal((await app.game.player())!.coins, 300);
});
