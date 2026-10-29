import type { AddressInfo } from 'node:net';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { configuration, databaseConfiguration } from '../../dist/src/config.js';
import { Game } from '../../dist/src/game.js';
import { startServer } from '../../dist/src/server.js';
import { CATALOG } from '../../dist/src/catalog.js';

type Application = Awaited<ReturnType<typeof startServer>>;

function call(app: Application, path: string, { data, cookie, token, key = randomUUID(), method = data === undefined ? 'GET' : 'POST' }: { data?: unknown; cookie?: string; token?: string; key?: string; method?: string } = {}) {
  return new Promise<{ status?: number; data: any; cookie?: string }>((resolve, reject) => {
    const req = request(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}${path}`, { method, headers: {
      Host: 'members.example.test', 'Content-Type': 'application/json', 'Idempotency-Key': key,
      ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-API-Key': token } : {}),
    } }, response => {
      let content = ''; response.setEncoding('utf8'); response.on('data', chunk => content += chunk);
      response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(content), cookie: response.headers['set-cookie']?.[0].split(';')[0] }));
    });
    req.on('error', reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
}

for (const driver of ['postgres', 'mariadb']) {
  const url = process.env[`TOKENPET_TEST_${driver.toUpperCase()}_URL`];
  assert.ok(url && new URL(url).hostname === '127.0.0.1' && new URL(url).pathname === '/tokenpet_test', 'Use npm run test:database to create isolated databases');

  test(`${driver}: real pooled HTTP servers preserve accounts, economy, isolation and restart data`, { timeout: 60000 }, async t => {
    const namespace = `test_${randomBytes(6).toString('hex')}`;
    const dir = mkdtempSync(join(tmpdir(), 'tokenpet-external-db-'));
    const configs = [0, 1].map(i => configuration({ TOKENPET_DATABASE_URL: url, TOKENPET_DB_NAMESPACE: namespace,
      TOKENPET_DB_POOL_MAX: '3', TOKENPET_DB_POOL_MIN: '1', TOKENPET_DATA_DIR: join(dir, String(i)), TOKENPET_WATCH: '0',
      TOKENPET_PUBLIC_URL: 'https://members.example.test', CODEX_HOME: join(dir, 'codex'), CLAUDE_CONFIG_DIR: join(dir, 'claude') }));
    const apps: Application[] = [];
    t.after(async () => { for (const app of apps) await app.close(); rmSync(dir, { recursive: true, force: true }); });

    const raw: { query(sql: string): Promise<unknown>; end(): Promise<void> } = driver === 'postgres' ? new (await import('pg')).Pool({ connectionString: url }) : (await import('mariadb')).createPool(url);
    t.after(() => raw.end());
    await raw.query('CREATE TABLE IF NOT EXISTS player (note VARCHAR(255))');
    await raw.query("INSERT INTO player VALUES ('existing application data')");

    const starts = await Promise.allSettled(configs.map(async config => {
      const app = await startServer(config, { port: 0 }); apps.push(app); app.game.random = () => 0; return app;
    }));
    for (const result of starts) assert.equal(result.status, 'fulfilled', (result as PromiseRejectedResult).reason?.message);
    const [a, b] = starts.map(result => (result as PromiseFulfilledResult<Application>).value);
    assert.equal((await a.game.db.prepare('SELECT COUNT(*) AS n FROM player').get() as { n: number }).n, 1, 'concurrent startup creates one local owner');
    const untouched = await raw.query('SELECT * FROM player');
    assert.deepEqual((driver === 'postgres' ? (untouched as { rows: { note: string }[] }).rows : (untouched as { note: string }[])).map(row => row.note), ['existing application data']);
    for (const config of configs) assert.equal(existsSync(join(config.dataDir, 'game.sqlite')), false);
    assert.equal((await call(a, '/api/health')).status, 200);

    const password = 'database integration passphrase';
    const signup = (app: Application, username: string) => call(app, '/api/signup', { data: { username, nickname: username, password } });
    const alice = await signup(a, 'alice'), bob = await signup(b, 'bob');
    assert.equal(alice.status, 201); assert.equal(bob.status, 201);
    assert.equal(typeof alice.data.user.id, 'number'); assert.notEqual(alice.data.user.id, bob.data.user.id);
    assert.equal((await signup(b, 'alice')).status, 409);
    assert.equal((await a.game.db.prepare('SELECT COUNT(*) AS n FROM player').get() as { n: number }).n, 3);
    assert.equal((await call(a, '/api/login', { data: { username: 'alice', password: 'wrong long password' } })).status, 401);
    const minted = await call(a, '/api/tokens', { cookie: alice.cookie, data: {} });
    assert.equal(minted.status, 201);
    const issued = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i % 2 ? a : b, '/api/tokens', { cookie: alice.cookie, data: {} })));
    assert.ok(issued.every(r => r.status === 201));
    assert.equal((await call(a, '/api/state', { token: minted.data.token })).status, 401);
    const valid: string[] = [];
    for (const token of issued.map(r => r.data.token)) if ((await call(b, '/api/state', { token })).status === 200) valid.push(token);
    assert.equal(valid.length, 1, 'parallel rotation leaves exactly one live token');
    const token = valid[0], playerId: number = alice.data.user.id;
    const member = a.game.forPlayer(playerId);
    assert.notEqual((await a.game.db.prepare('SELECT password FROM accounts WHERE player_id=?').get(playerId) as { password: string }).password, password);
    assert.notEqual((await a.game.db.prepare('SELECT hash FROM api_tokens WHERE player_id=?').get(playerId) as { hash: string }).hash, token);

    const records = [{ source: 'codex', key: 'b'.repeat(64), input: 20000, output: 0, baseline: false }];
    const usage = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 ? a : b, '/api/usage', { token, data: { records } })));
    assert.ok(usage.every(r => r.status === 200));
    assert.equal(usage.reduce((sum, r) => sum + r.data.creditedCoins, 0), 2);
    assert.equal((await member.state()).active.xp, 1);
    const key = randomUUID();
    const draws = await Promise.all(Array.from({ length: 8 }, (_, i) => call(i % 2 ? a : b, '/api/gacha', { token, key, data: { count: 1 } })));
    assert.ok(draws.every(r => r.status === 200 && r.data.state.player.coins === 202));
    assert.equal((await member.state()).active.copies, 2);
    assert.equal((await call(b, '/api/care', { token, key, data: { action: 'feed' } })).status, 409);
    const checkins = await Promise.all(Array.from({ length: 8 }, (_, i) => call(i % 2 ? a : b, '/api/checkin', { token, data: {} })));
    assert.ok(checkins.every(r => r.status === 200));
    assert.equal(checkins.reduce((sum, r) => sum + r.data.creditedCoins, 0), 100);
    const care = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i % 2 ? a : b, '/api/care', { token, data: { action: 'feed' } })));
    assert.equal(care.filter(r => r.status === 200).length, 1);
    assert.equal(care.filter(r => r.status === 429).length, 5);
    assert.equal((await member.player())!.coins, 297);

    const name = "pets? 'player' 한글🐾";
    assert.equal((await call(a, '/api/profile', { token, data: { name } })).data.state.player.name, name);
    await a.game.db.prepare('INSERT INTO pets(species,updated,player_id) VALUES(?,?,?)').run(CATALOG[1].id, Date.now(), playerId);
    assert.equal((await call(b, '/api/equip', { cookie: bob.cookie, data: { id: CATALOG[1].id } })).status, 404);
    assert.equal((await call(a, '/api/equip', { token, data: { id: CATALOG[1].id } })).status, 200);
    assert.equal((await call(a, '/api/catalog?owned=true', { token })).data.catalog.length, 2);
    const ranked = await call(b, '/api/rankings?type=collection', { cookie: bob.cookie });
    assert.equal(ranked.status, 200); assert.equal(ranked.data.total, 2); assert.equal(ranked.data.entries[0].speciesCount, 2);
    assert.equal(ranked.data.me.rank, 2); assert.equal(typeof ranked.data.entries[0].copies, 'number');
    const credited = await call(b, '/api/rankings?type=tokens&from=2000-01-01&to=2999-12-31', { cookie: bob.cookie });
    assert.equal(credited.status, 200); assert.equal(credited.data.entries[0].tokens, (await member.player())!.tokens);
    assert.equal(typeof credited.data.entries[0].tokens, 'number'); assert.equal(credited.data.me.tokens, 0);
    const shared = await call(a, '/api/share', { token, data: { enabled: true } });
    assert.equal((await call(b, `/api${shared.data.path}`)).data.name, name);
    await call(b, '/api/share', { token, data: { enabled: false } });
    assert.equal((await call(a, `/api${shared.data.path}`)).status, 404);
    assert.equal((await b.game.forPlayer(bob.data.user.id).player())!.coins, 300);

    const snapshot = async () => ({ player: await member.player(), pets: await a.game.db.prepare('SELECT * FROM pets WHERE player_id=? ORDER BY species').all(playerId),
      ledger: await a.game.db.prepare('SELECT * FROM ledger WHERE player_id=? ORDER BY id').all(playerId) });
    const before = await snapshot(), failedKey = randomUUID();
    let rolls = 0;
    member.random = () => { if (++rolls === 3) throw new Error('late RNG failure'); return 0; };
    await assert.rejects(member.once(failedKey, 'draw', () => member.pull(2)), /late RNG failure/);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await a.game.db.prepare('SELECT * FROM requests WHERE player_id=? AND key=?').get(playerId, failedKey), undefined);
    member.random = () => 0;
    assert.equal((await member.once(failedKey, 'draw', () => member.pull(2))).state.player.coins, 97);

    await a.game.db.exec("ALTER TABLE api_tokens ADD CONSTRAINT test_token_failure CHECK(label <> 'fail')");
    await assert.rejects(a.accounts.createToken(playerId, { label: 'fail' }));
    assert.equal((await call(b, '/api/state', { token })).status, 200, 'failed issuance restores the old token');
    await a.game.db.exec('ALTER TABLE api_tokens DROP CONSTRAINT test_token_failure');
    await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 2 ? a : b).accounts.newSession(playerId)));
    assert.equal((await a.game.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE player_id=?').get(playerId) as { n: number }).n, 10);

    const login = await call(b, '/api/login', { data: { username: 'alice', password } });
    assert.equal(login.status, 200);
    const saved = (await call(a, '/api/state', { token })).data.player;
    for (const app of apps.splice(0)) await app.close();
    const restarted = await startServer(configs[0], { port: 0 }); apps.push(restarted);
    assert.deepEqual((await call(restarted, '/api/state', { token })).data.player, saved);
    assert.equal((await call(restarted, '/api/me', { cookie: login.cookie })).data.user.id, playerId);
    assert.equal((await call(restarted, '/api/session', { cookie: login.cookie, method: 'DELETE' })).status, 200);
    assert.equal((await call(restarted, '/api/me', { cookie: login.cookie })).data.authenticated, false);
  });

  if (driver === 'postgres') test('postgres: a pre-created schema works without database-wide CREATE permission', async t => {
    const { Pool } = await import('pg');
    const raw = new Pool({ connectionString: url });
    const role = `limited_${randomBytes(6).toString('hex')}`, password = randomBytes(24).toString('hex');
    let game: Game | undefined;
    t.after(async () => {
      try {
        await game?.close();
        await raw.query(`DROP SCHEMA IF EXISTS "${role}" CASCADE`);
        await raw.query(`DROP OWNED BY "${role}"`);
        await raw.query(`DROP ROLE "${role}"`);
      } finally { await raw.end(); }
    });
    await raw.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
    await raw.query(`CREATE SCHEMA "${role}" AUTHORIZATION "${role}"`);
    assert.equal((await raw.query("SELECT has_database_privilege($1,current_database(),'CREATE') AS allowed", [role])).rows[0].allowed, false);
    const limited = new URL(url); limited.username = role; limited.password = password;
    const database = databaseConfiguration({ TOKENPET_DATABASE_URL: limited.href, TOKENPET_DB_NAMESPACE: role, TOKENPET_DB_POOL_MIN: '0' });
    game = await Game.open(':memory:', { database });
    const member = await game.transaction(() => game!.createPlayer('limited role'));
    const id = member.playerId;
    await game.close(); game = undefined;
    game = await Game.open(':memory:', { database });
    assert.equal((await game.forPlayer(id).player())!.coins, 300);
  });

  test(`${driver}: a full pool times out and recovers, and a failed connection never creates SQLite`, { timeout: 15000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'tokenpet-pool-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const database = databaseConfiguration({ TOKENPET_DATABASE_URL: url, TOKENPET_DB_NAMESPACE: `pool_${randomBytes(6).toString('hex')}`,
      TOKENPET_DB_POOL_MAX: '1', TOKENPET_DB_POOL_MIN: '0', TOKENPET_DB_CONNECT_TIMEOUT_MS: '200' });
    const game = await Game.open(join(dir, 'game.sqlite'), { database });
    t.after(() => game.close());
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    const held = game.transaction(async () => { started(); await gate; });
    await ready;
    try { await assert.rejects(game.db.prepare('SELECT 1').get()); } finally { release(); await held; }
    assert.equal((await game.player())!.coins, 300);
    assert.equal(existsSync(join(dir, 'game.sqlite')), false);
    const invalid = new URL(url); invalid.password = 'not-the-password';
    await assert.rejects(Game.open(join(dir, 'fallback.sqlite'), { database: { ...database!, url: invalid.href } }), (error: Error) => {
      assert.match(error.message, /connection or initialization failed/);
      assert.doesNotMatch(error.message, /not-the-password|postgres:\/\/|mariadb:\/\//);
      return true;
    });
    assert.equal(existsSync(join(dir, 'fallback.sqlite')), false);
  });
}
