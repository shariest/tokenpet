import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { GameError } from '../dist/src/game.js';
import type { Activity, Configuration } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { Game } from '../dist/src/game.js';
import { Accounts } from '../dist/src/accounts.js';
import { startServer } from '../dist/src/server.js';
import { CATALOG } from '../dist/src/catalog.js';

type CallResult = { status: number; data: any; cookie?: string; headers: Headers };

async function fixture(t: TestContext, trustProxy = false) {
  const dataDir = mkdtempSync(join(tmpdir(), 'tokenpet-members-'));
  const game = await Game.open(join(dataDir, 'game.sqlite'), { random: () => 0 });
  const app = await startServer({ dataDir, host: '127.0.0.1', port: 0, publicUrl: 'https://members.example.test', watch: false, roots: {}, trustProxy } as Configuration, { game }); // partial config on purpose
  const call = (path: string, data?: unknown, cookie?: string | null, method = data === undefined ? 'GET' : 'POST', headers: Record<string, string> = {}) => new Promise<CallResult>((resolve, reject) => {
    const req = request(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}${path}`, { method,
      headers: { Host: 'members.example.test', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    }, response => {
      let content = ''; response.setEncoding('utf8'); response.on('data', chunk => content += chunk);
      response.on('end', () => resolve({ status: response.statusCode!, data: JSON.parse(content),
        cookie: response.headers['set-cookie']?.[0].split(';')[0], headers: new Headers(response.headers as Record<string, string>) }));
    });
    req.on('error', reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  const signup = (username: string, nickname = username) => call('/api/signup', { username, nickname, password: 'a test passphrase 123!' });
  t.after(async () => { await app.close(); await game.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { game, app, call, signup };
}

test('signup, login, opaque sessions, expiry and logout protect member credentials', async t => {
  const { game, call, signup } = await fixture(t);
  assert.equal((await call('/api/me')).data.authenticated, false);
  assert.equal((await call('/api/session', {})).status, 401, 'public hosting never auto-logs into the local owner');
  assert.equal((await call('/api/signup', { username: 'ab', nickname: 'a', password: 'too short' })).status, 400);
  assert.equal((await call('/api/signup', { username: 'alice', nickname: 'a', password: 'valid passphrase' }, null, 'POST', { Origin: 'https://evil.example' })).status, 403);
  const alice = await signup('Alice', '<친구 & 앨리스>');
  assert.equal(alice.status, 201); assert.equal(alice.data.user.username, 'alice');
  assert.match(alice.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  assert.match(alice.headers.get('set-cookie')!, /Secure/);
  assert.equal((await signup('ALICE')).status, 409);
  assert.equal((await game.db.prepare('SELECT COUNT(*) AS n FROM player').get() as { n: number } | undefined)!.n, 2, 'duplicate signup leaves no extra game');
  const stored = await game.db.prepare('SELECT * FROM accounts').get() as { password: string } | undefined;
  assert.match(stored!.password, /^scrypt-32768-8-3\$/);
  assert.ok(!JSON.stringify(alice.data).includes('password'));
  assert.notEqual((await game.db.prepare('SELECT hash FROM sessions').get() as { hash: string } | undefined)!.hash, alice.cookie!.split('=')[1]);
  for (const username of ['alice', 'missing']) {
    const wrong = await call('/api/login', { username, password: 'incorrect password!' });
    assert.equal(wrong.status, 401); assert.equal(wrong.data.error, '아이디 또는 비밀번호를 확인해 주세요.');
  }
  const loggedIn = await call('/api/login', { username: 'ALICE', password: 'a test passphrase 123!' });
  assert.equal(loggedIn.status, 200); assert.notEqual(loggedIn.cookie, alice.cookie);
  assert.equal((await call('/api/me', undefined, loggedIn.cookie)).data.user.nickname, '<친구 & 앨리스>');
  assert.equal((await call('/api/session', undefined, loggedIn.cookie, 'DELETE')).status, 200);
  assert.equal((await call('/api/state', undefined, loggedIn.cookie)).status, 401);
  await game.db.exec('UPDATE sessions SET expires=0');
  assert.equal((await call('/api/state', undefined, alice.cookie)).status, 401);
  for (let i = 0; i < 31; i++) await call('/api/login', { username: '', password: '' });
  assert.equal((await call('/api/login', { username: 'alice', password: 'a test passphrase 123!' })).status, 429);
});

test('member tokens are shown once, scoped, expiring, revocable, and cannot mint credentials', async t => {
  const { game, call, signup } = await fixture(t);
  const alice = await signup('alice'), bob = await signup('bob');
  const minted = await call('/api/tokens', { label: 'MacBook', days: 30 }, alice.cookie);
  assert.equal(minted.status, 201); assert.match(minted.data.token, /^sk_[A-Za-z0-9_-]{43}$/); assert.equal(minted.data.prefix, minted.data.token.slice(0, 9));
  const headers = { 'X-API-Key': minted.data.token };
  const tokenCall = (path: string, data?: unknown) => call(path, data, null, data === undefined ? 'GET' : 'POST', headers);
  assert.equal((await tokenCall('/api/shutdown', {})).status, 404, 'member servers cannot be stopped through the API');
  assert.equal((await tokenCall('/api/state')).data.player.id, alice.data.user.id);
  const listing = await call('/api/tokens', undefined, alice.cookie);
  assert.equal(listing.data.tokens.length, 1);
  assert.equal(listing.data.tokens[0].token, undefined); assert.equal(listing.data.tokens[0].hash, undefined);
  assert.ok(listing.data.tokens[0].last_used);
  assert.notEqual((await game.db.prepare('SELECT hash FROM api_tokens').get() as { hash: string } | undefined)!.hash, minted.data.token);
  assert.equal((await tokenCall('/api/tokens', { label: 'unauthorized' })).status, 403);
  assert.equal((await call('/api/tokens', undefined, bob.cookie)).data.tokens.length, 0);
  assert.equal((await call(`/api/tokens/${minted.data.id}`, undefined, bob.cookie, 'DELETE')).status, 404);
  assert.equal((await call('/api/state', undefined, bob.cookie, 'GET', headers)).status, 400);
  assert.equal((await call(`/api/tokens/${minted.data.id}`, undefined, alice.cookie, 'DELETE')).status, 200);
  assert.equal((await tokenCall('/api/state')).status, 401);
  const expired = await call('/api/tokens', { label: 'expired' }, alice.cookie);
  await game.db.exec('UPDATE api_tokens SET expires=0');
  assert.equal((await call('/api/state', undefined, null, 'GET', { 'X-API-Key': expired.data.token })).status, 401);
  assert.equal((await call('/api/tokens', { label: '', days: 90 }, alice.cookie)).status, 400);
  const first = await call('/api/tokens', {}, alice.cookie);
  const bobToken = await call('/api/tokens', {}, bob.cookie);
  const replacement = await call('/api/tokens', { days: 365 }, alice.cookie);
  assert.equal(replacement.status, 201);
  assert.equal((await call('/api/tokens', undefined, alice.cookie)).data.tokens.length, 1);
  assert.equal((await call('/api/state', undefined, null, 'GET', { 'X-API-Key': first.data.token })).status, 401);
  assert.equal((await call('/api/state', undefined, null, 'GET', { 'X-API-Key': replacement.data.token })).status, 200);
  assert.equal((await call('/api/state', undefined, null, 'GET', { 'X-API-Key': bobToken.data.token })).status, 200);
  assert.equal((await call('/api/tokens', { days: 0 }, alice.cookie)).status, 400);
  assert.equal((await call('/api/state', undefined, null, 'GET', { 'X-API-Key': replacement.data.token })).status, 200, 'invalid reissue preserves the current token');
  await game.db.exec(`CREATE TRIGGER fail_token BEFORE INSERT ON api_tokens BEGIN SELECT RAISE(ABORT,'test failure'); END`);
  const logged: unknown[][] = []; t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
  assert.equal((await call('/api/tokens', {}, alice.cookie)).status, 500);
  assert.deepEqual(logged, [['TokenPet request failed:', 'ERR_SQLITE_ERROR']]);
  assert.equal((await call('/api/state', undefined, null, 'GET', { 'X-API-Key': replacement.data.token })).status, 200, 'failed replacement rolls back revocation');
  // A token stored with the old agt_ prefix no longer authenticates.
  const legacy = `agt_${replacement.data.token.slice(3)}`;
  await game.db.prepare('UPDATE api_tokens SET hash=? WHERE id=?').run(createHash('sha256').update(legacy).digest('hex'), replacement.data.id);
  assert.equal((await call('/api/state', undefined, null, 'GET', { 'X-API-Key': legacy })).status, 401);
});

test('forwarded addresses affect rate limits only behind an explicitly trusted single proxy', async t => {
  for (const trustProxy of [false, true]) {
    const { call } = await fixture(t, trustProxy);
    const attempt = (address: string) => call('/api/login', {}, null, 'POST', { 'X-Forwarded-For': address });
    for (let i = 0; i < 30; i++) assert.equal((await attempt(`203.0.113.${i}, 192.0.2.1`)).status, 401);
    assert.equal((await attempt('203.0.113.100, 192.0.2.1')).status, 429, 'spoofed earlier hops never bypass the limit');
    assert.equal((await attempt('192.0.2.2')).status, trustProxy ? 401 : 429);
  }
});

test('member write limits leave reads and other members available', async t => {
  const { call, signup } = await fixture(t);
  const alice = await signup('alice'), bob = await signup('bob');
  for (let i = 0; i < 120; i++) assert.equal((await call('/api/usage', { records: [] }, alice.cookie)).status, 400);
  assert.equal((await call('/api/checkin', {}, alice.cookie)).status, 429);
  assert.equal((await call('/api/state', undefined, alice.cookie)).status, 200);
  assert.equal((await call('/api/checkin', {}, bob.cookie)).status, 200);
});

test('usage, wallets, pets, idempotency, checkins, care, profiles and shares are isolated', async t => {
  const { game, call, signup } = await fixture(t);
  const alice = await signup('alice'), bob = await signup('bob');
  const a = alice.cookie, b = bob.cookie;
  await game.db.prepare('UPDATE player SET coins=200000 WHERE id=?').run(alice.data.user.id);
  assert.equal((await call('/api/gacha', { count: 1001 }, a)).status, 400);
  assert.equal((await game.forPlayer(alice.data.user.id).player())!.coins, 200000, 'oversized public batches never enter the draw loop');
  await game.db.prepare('UPDATE player SET coins=300 WHERE id=?').run(alice.data.user.id);
  const records = [{ source: 'codex', key: 'a'.repeat(64), input: 20000, output: 0, baseline: false }];
  for (const cookie of [a, b]) assert.equal((await call('/api/usage', { records }, cookie)).data.creditedCoins, 2);
  const key = { 'Idempotency-Key': 'shared-request-123456' };
  for (const cookie of [a, b]) {
    assert.equal((await call('/api/gacha', { count: 1 }, cookie, 'POST', key)).status, 200);
    assert.equal((await call('/api/gacha', { count: 1 }, cookie, 'POST', key)).data.state.player.coins, 202);
    assert.equal((await call('/api/checkin', {}, cookie)).data.creditedCoins, 100);
    assert.equal((await call('/api/checkin', {}, cookie)).data.creditedCoins, 0);
  }
  await call('/api/care', { action: 'sleep', playerId: bob.data.user.id }, a);
  await call('/api/profile', { name: 'Alice only', playerId: bob.data.user.id }, a);
  const aState = (await call('/api/state', undefined, a)).data, bState = (await call('/api/state', undefined, b)).data;
  assert.equal(aState.active.sleeping, true); assert.equal(bState.active.sleeping, false);
  assert.equal(aState.player.name, 'Alice only'); assert.equal(bState.player.name, 'bob의 작업실');
  assert.equal(aState.player.tokens, 20000); assert.equal(bState.connections[0].tokens, 20000);
  assert.ok(bState.activity.every((row: Activity) => !row.label.includes('Alice')));
  await game.db.prepare('INSERT INTO pets(species,updated,player_id) VALUES(?,?,?)').run(CATALOG[1].id, Date.now(), alice.data.user.id);
  assert.equal((await call('/api/equip', { id: CATALOG[1].id }, b)).status, 404);
  const share = await call('/api/share', { enabled: true }, a);
  const view = await call(`/api${share.data.path}`);
  assert.equal(view.status, 200); assert.equal(view.data.name, 'Alice only');
  assert.equal(view.data.pets.length, 2); assert.equal(view.data.player, undefined);
  await call('/api/share', { enabled: false }, a);
  assert.equal((await call(`/api${share.data.path}`)).status, 404);
  assert.equal((await game.player())!.coins, 300); assert.equal((await game.state()).active.xp, 0, 'the local workspace save is untouched');
});

test('public catalog and rankings count distinct species, hide private data and locate the current member', async t => {
  const { game, app, call, signup } = await fixture(t);
  assert.equal((await call('/api/catalog')).data.catalog.length, 360);
  assert.equal((await call('/api/catalog?owned=true')).status, 401);
  assert.equal((await call('/api/catalog?tier=unknown')).status, 400);
  assert.equal((await call('/api/rankings')).data.total, 0, 'local owner is not a registered competitor');
  const alice = await signup('private_alice', 'Alice'), bob = await signup('private_bob', 'Bob');
  await game.db.prepare('UPDATE pets SET copies=100,xp=100 WHERE player_id=?').run(alice.data.user.id);
  await game.db.prepare('INSERT INTO pets(species,updated,player_id) VALUES(?,?,?)').run(CATALOG[1].id, Date.now(), bob.data.user.id);
  const owned = await call('/api/catalog?owned=true', undefined, bob.cookie);
  assert.equal(owned.data.catalog.length, 2);
  assert.equal((await call('/api/catalog?owned=true&q=nonexistent', undefined, bob.cookie)).data.catalog.length, 0);
  const levels = await call('/api/rankings?type=level', undefined, bob.cookie);
  assert.equal(levels.data.entries[0].nickname, 'Alice'); assert.equal(levels.data.entries[0].pet.level, 3);
  assert.equal(levels.data.me.rank, 2); assert.equal(levels.data.me.mine, true);
  const collection = await call('/api/rankings?type=collection');
  assert.equal(collection.data.entries[0].nickname, 'Bob'); assert.equal(collection.data.entries[0].speciesCount, 2);
  assert.equal(collection.data.entries[1].speciesCount, 1); assert.equal(collection.data.entries[1].copies, 100);
  const exposed = JSON.stringify(collection.data);
  for (const privateField of ['private_alice', 'password', 'coins', 'tokens', 'created', 'player_id']) assert.ok(!exposed.includes(privateField));
  assert.equal((await call('/api/rankings?page=0')).status, 400);
  assert.equal((await call('/api/rankings?page=2')).data.entries.length, 0);
  assert.equal((await call('/api/rankings?type=invalid')).status, 400);
  let last: Game | undefined;
  await game.transaction(async () => {
    for (let i = 0; i < 20; i++) {
      last = await game.createPlayer(`reader${i}`);
      await game.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(last.playerId, `reader${i}`, `독자 ${i}`, 'unused fixture hash', Date.now());
    }
  });
  const lastCookie = `tokenpet_session=${await app.accounts.newSession(last!.playerId)}`;
  const firstPage = await call('/api/rankings', undefined, lastCookie);
  const secondPage = await call('/api/rankings?page=2', undefined, lastCookie);
  assert.equal(firstPage.data.entries.length, 20); assert.equal(secondPage.data.entries.length, 2);
  assert.equal(firstPage.data.me.rank, 22); assert.equal(secondPage.data.entries[1].mine, true);
  assert.equal(new Set([...firstPage.data.entries, ...secondPage.data.entries].map(row => row.rank)).size, 22);
});

test('sessions and API tokens survive restart without storing their raw secrets', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-auth-')), path = join(dir, 'game.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let game = await Game.open(path), accounts = new Accounts(game);
  const member = await accounts.signup({ username: 'alice', nickname: '앨리스', password: 'one long passphrase' }, 'local');
  const token = await accounts.createToken(member.user!.id, { label: 'CLI' });
  accounts.hashing = 2;
  await assert.rejects(accounts.passwordHash('one long passphrase'), (error: GameError) => error.status === 429);
  await game.close(); game = await Game.open(path); accounts = new Accounts(game);
  assert.equal((await accounts.session(member.session))!.playerId, member.user!.id);
  assert.equal((await accounts.token(token.token))!.playerId, member.user!.id);
  await game.close();
});

