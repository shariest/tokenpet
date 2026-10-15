import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { databaseConfiguration } from '../dist/src/config.js';
import { Game } from '../dist/src/game.js';

test('external databases have bounded pool defaults and validate configuration without exposing credentials', () => {
  assert.equal(databaseConfiguration({}), undefined);
  for (const [protocol, driver] of [['postgres', 'postgres'], ['postgresql', 'postgres'], ['mariadb', 'mariadb']]) {
    const url = `${protocol}://user:private-password@db.example.test/pets`;
    assert.deepEqual(databaseConfiguration({ TOKENPET_DATABASE_URL: url }), { driver, url, namespace: 'tokenpet',
      max: 30, min: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    assert.equal(databaseConfiguration({ TOKENPET_DATABASE_URL: url, TOKENPET_DB_POOL_MAX: '2' })!.min, 2);
    const env = { TOKENPET_DATABASE_URL: url, TOKENPET_DB_POOL_MIN: '0', TOKENPET_DB_POOL_MAX: '50', TOKENPET_DB_NAMESPACE: 'my_pets',
      TOKENPET_DB_CONNECT_TIMEOUT_MS: '2000', TOKENPET_DB_IDLE_TIMEOUT_MS: '60000' };
    assert.equal(databaseConfiguration(env)!.max, 50);
    assert.equal(databaseConfiguration(env)!.min, 0);
    for (const extra of [{ TOKENPET_DB_POOL_MAX: '0' }, { TOKENPET_DB_POOL_MAX: '1.5' }, { TOKENPET_DB_POOL_MAX: 'Infinity' },
      { TOKENPET_DB_POOL_MAX: '1001' }, { TOKENPET_DB_POOL_MIN: '51' }, { TOKENPET_DB_CONNECT_TIMEOUT_MS: '-1' },
      { TOKENPET_DB_IDLE_TIMEOUT_MS: '0' }, { TOKENPET_DB_NAMESPACE: 'public' }, { TOKENPET_DB_NAMESPACE: 'pg_catalog' },
      { TOKENPET_DB_NAMESPACE: 'x;DROP SCHEMA public' }, { TOKENPET_DATABASE_URL_FILE: '/unused' }]) {
      assert.throws(() => databaseConfiguration({ ...env, ...extra }), (error: Error) => !error.message.includes('private-password'));
    }
  }
  for (const url of ['not a database private-password', 'mysql://user:private-password@host/db', 'postgres://host/',
    'mariadb://user:private-password@host/db?debug=true', 'mariadb://host/db?ssl=invalid']) {
    assert.throws(() => databaseConfiguration({ TOKENPET_DATABASE_URL: url }), (error: Error) => !error.message.includes('private-password'));
  }
});

test('database URL files support Docker secrets and reject empty or unreadable secrets', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-db-secret-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'database-url'), url = 'postgres://user:private-password@host/pets?sslmode=verify-full';
  writeFileSync(path, `${url}\n`, { mode: 0o600 });
  assert.equal(databaseConfiguration({ TOKENPET_DATABASE_URL_FILE: path })!.url, url);
  writeFileSync(path, '\n');
  assert.throws(() => databaseConfiguration({ TOKENPET_DATABASE_URL_FILE: path }), /empty/);
  assert.throws(() => databaseConfiguration({ TOKENPET_DATABASE_URL_FILE: join(dir, 'missing') }), /Cannot read/);
});

test('async SQLite transactions serialize replays, roll back failures, and hide uncommitted data', async t => {
  const game = await Game.open(':memory:', { random: () => 0 });
  t.after(() => game.close());
  const key = randomUUID();
  const pulls = await Promise.all(Array.from({ length: 12 }, () => game.once(key, 'pull', () => game.pull(1))));
  assert.ok(pulls.every(p => p.state.player.coins === 200));
  assert.equal((await game.state()).active.copies, 2);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const before = await game.player();
  const failed = game.transaction(async () => {
    await game.db.prepare('UPDATE player SET name=? WHERE id=1').run('not committed');
    started(); await gate; throw new Error('rollback test');
  });
  const rejected = assert.rejects(failed, /rollback test/);
  await ready;
  const read = game.state();
  release(); await rejected;
  assert.deepEqual((await read).player, before);
  const draws = await Promise.allSettled(Array.from({ length: 4 }, () => game.once(randomUUID(), 'pull', () => game.pull(1))));
  assert.equal(draws.filter(r => r.status === 'fulfilled').length, 2);
  assert.ok(draws.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
  assert.equal((await game.player())!.coins, 0);
});
