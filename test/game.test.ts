import type { TestContext } from 'node:test';
import type { Cli, GachaResult, StateResult, TierId, UsageRecord } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Game } from '../dist/src/game.js';
import { CATALOG, TIERS, RULES } from '../dist/src/catalog.js';
import { petPixels, collectionHTML } from '../dist/public/pet-art.js';
import { terminalPet } from '../dist/src/terminal.js';

const key = (s: string) => createHash('sha256').update(s).digest('hex');
const usage = (source: Cli, id: string, input: number, extra: Partial<UsageRecord> = {}) => ({ source, key: key(id), input, output: 0, baseline: false, ...extra });
const change = <T extends StateResult>(g: Game, fn: () => T | Promise<T>) => g.once(randomUUID(), 'test', fn);
async function game(t: TestContext, options?: Parameters<typeof Game.open>[1]) { const g = await Game.open(':memory:', options); t.after(() => g.close()); return g; }

test('360 unique collectible IDs, names and rendered pixel characters; odds sum to 100', () => {
  assert.equal(CATALOG.length, 360);
  assert.equal(new Set(CATALOG.map(p => p.id)).size, 360);
  assert.equal(new Set(CATALOG.map(p => p.name)).size, 360);
  assert.equal(new Set(CATALOG.map(p => JSON.stringify(petPixels(p)))).size, 360);
  assert.equal(TIERS.reduce((n, t) => n + t.chance, 0), 100);
  assert.deepEqual(TIERS.map(t => CATALOG.filter(p => p.tier === t.id).length), [108, 108, 72, 36, 36]);
});
test('compact monochrome terminal sprites fit 12 rows and carry no ANSI color', () => {
  const art = terminalPet(CATALOG[0], { color: false, compact: true });
  assert.equal(art.split('\n').length, 12); assert.ok(!art.includes('\x1b'));
  assert.ok(terminalPet(CATALOG[0], { color: true }).includes('38;2;'));
});
test('Claude and Codex each pay 1 coin per 10k tokens and 1 XP per 20k, including identical IDs', async t => {
  const g = await game(t);
  const r = await g.ingest([usage('claude', 'same-id', 200_000_000), usage('codex', 'same-id', 200_000_000)]);
  assert.equal(r.creditedCoins, 40_000);
  assert.equal(r.creditedXp, 20_000);
  assert.equal((await g.player())!.coins, RULES.welcomeCoins + 40_000);
  assert.equal((await g.state()).active.xp, 20_000);
  assert.equal((await g.player())!.tokens, 400_000_000);
  assert.equal((await g.state()).connections.length, 2);
});
test('replays, lower counters, baseline, partial output, and fractional coins', async t => {
  const g = await game(t);
  const baseline = usage('codex', 'session', 10_000_000, { baseline: true });
  assert.equal((await g.ingest([baseline])).creditedCoins, 0);
  const next = usage('codex', 'session', 10_002_000, { output: 3000 });
  assert.equal((await g.ingest([next])).creditedCoins, 0);
  assert.equal((await g.ingest([next, baseline])).creditedTokens, 0);
  assert.deepEqual((await g.ingest([usage('claude', 'message', 4999)])), { creditedTokens: 4999, creditedCoins: 0, creditedXp: 0 });
  assert.equal((await g.ingest([usage('claude', 'message', 5000)])).creditedCoins, 1);
  assert.equal((await g.player())!.tokens, 10_000);
  assert.equal((await g.state()).active.xp, 0);
  assert.deepEqual((await g.ingest([usage('claude', 'message', 14_999)])), { creditedTokens: 9999, creditedCoins: 0, creditedXp: 0 });
  assert.deepEqual((await g.ingest([usage('claude', 'message', 15_000)])), { creditedTokens: 1, creditedCoins: 1, creditedXp: 1 });
});
test('invalid usage batch is atomic and never credits a valid prefix', async t => {
  const g = await game(t);
  await assert.rejects(() => g.ingest([usage('claude', 'ok', 1_000_000), usage('codex', 'bad', -1)]));
  assert.equal((await g.player())!.tokens, 0);
  await assert.rejects(() => g.ingest([usage('claude', 'nan', 1.5)]));
  await assert.rejects(() => g.ingest([usage('other' as Cli, 'provider', 500_000)])); // invalid on purpose
});
test('free first pets and paid gacha share the advertised weights and full species pools', async t => {
  for (const [ticket, expected] of [[0, 'common'], [7889, 'common'], [7890, 'rare'], [9389, 'rare'], [9390, 'epic'], [9889, 'epic'], [9890, 'unique'], [9989, 'unique'], [9990, 'legendary'], [9999, 'legendary']] as const) {
    for (const last of [false, true]) {
      const g = await game(t, { random: max => max === 10000 ? ticket : last ? max - 1 : 0 });
      const state = await g.state(), pool = CATALOG.filter(p => p.tier === expected);
      assert.equal(state.pets.length, 1);
      assert.equal(state.active.id, (last ? pool.at(-1)! : pool[0]).id);
      assert.equal(state.active.tier, expected);
      assert.equal(state.active.copies, 1); assert.equal(state.active.xp, 0);
      assert.equal(state.player.coins, 300); assert.equal(state.player.pulls, 0); assert.equal(state.player.pity, 0);
      assert.equal(state.player.unique_pity, 0);
      assert.equal(state.activity[0].kind, 'welcome'); assert.ok(state.activity[0].label.includes(state.active.id));
      assert.equal((await change(g, () => g.pull(1))).results[0].id, state.active.id);
    }
  }
});
test('all 10000 tickets match the fractional base odds exactly', async t => {
  const g = await game(t, { random: () => 0 });
  const counts = { common: 0, rare: 0, epic: 0, unique: 0, legendary: 0 };
  for (let ticket = 0; ticket < 10000; ticket++) {
    g.random = max => max === 10000 ? ticket : 0;
    counts[g.drawSpecies().tier]++;
  }
  assert.deepEqual(counts, { common: 7890, rare: 1500, epic: 500, unique: 100, legendary: 10 });
});
test('a saved first pet and existing workshop never reroll or receive an extra starter', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-starter-')), path = join(dir, 'game.sqlite');
  let g: Game | undefined;
  t.after(async () => { await g?.close(); rmSync(dir, { recursive: true, force: true }); });
  g = await Game.open(path, { now: () => 1_000_000, random: max => max === 10000 ? 7890 : 0 });
  const first = await g.state();
  assert.equal(first.active.id, 'cloud-sprout');
  await g.close();
  g = await Game.open(path, { now: () => 1_000_000, random: () => { throw new Error('must not reroll'); } });
  assert.deepEqual((await g.state()), first);
  // Existing workshops may have another selected pet and no welcome ledger entry.
  await g.db.prepare('INSERT INTO pets(species,xp,sleeping,updated) VALUES(?,100,1,?)').run('sprout', 1_000_000);
  await change(g, () => g!.equip('sprout'));
  await g.db.exec("UPDATE player SET coins=127,pulls=12,pity=9; DELETE FROM ledger WHERE kind='welcome'");
  const existing = await g.state();
  await g.close();
  g = await Game.open(path, { now: () => 1_000_000, random: () => { throw new Error('must not reroll'); } });
  assert.deepEqual((await g.state()), existing);
});
test('failed first-pet initialization rolls back the whole gift and can restart cleanly', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-starter-failure-')), path = join(dir, 'game.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(() => Game.open(path, { random: () => { throw new Error('RNG unavailable'); } }), /RNG unavailable/);
  const db = new DatabaseSync(path);
  try {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM player').get() as { n: number }).n, 0);
    db.exec("CREATE TRIGGER fail_pet BEFORE INSERT ON pets BEGIN SELECT RAISE(ABORT, 'pet insert failed'); END;");
    await assert.rejects(() => Game.open(path, { random: () => 0 }), /pet insert failed/);
    for (const table of ['player', 'pets', 'ledger', 'reward_progress'])
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, `${table} must roll back`);
    db.exec('DROP TRIGGER fail_pet');
  } finally { db.close(); }
  const recovered = await Game.open(path, { random: max => max === 10000 ? 9990 : 0 });
  try { assert.equal((await recovered.state()).active.id, 'celestial-sprout'); assert.equal((await recovered.player())!.coins, 300); }
  finally { await recovered.close(); }
});
test('duplicates increase copies and XP; idempotency charges only once', async t => {
  const g = await game(t, { random: () => 0 });
  const id = randomUUID();
  const a = await g.once(id, 'pull', () => g.pull(1));
  const b = await g.once(id, 'pull', () => g.pull(1));
  assert.deepEqual(a.results, b.results); assert.equal(a.state.player.coins, b.state.player.coins); assert.equal(a.results[0].isNew, false);
  assert.equal((await g.player())!.coins, 200); assert.equal((await g.state()).pets[0].copies, 2); assert.equal((await g.state()).pets[0].xp, 25);
  await assert.rejects(() => g.once(id, 'feed', () => g.care('feed')), { status: 409 });
});
test('affordable batches preserve both pity counters and award each due tier', async t => {
  const milestones: [number, TierId][] = [[50, 'unique'], [100, 'legendary'], [101, 'unique'], [151, 'unique'], [200, 'legendary'], [201, 'unique']];
  for (const count of [2, 3, 7, 25, 49, 50, 51, 99, 100, 101, 150, 151, 201]) {
    const g = await game(t, { random: () => 0 });
    await g.db.prepare('UPDATE player SET coins=? WHERE id=1').run(count * RULES.pullCost);
    const result = await change(g, () => g.pull(count));
    assert.equal(result.results.length, count);
    assert.equal((await g.player())!.coins, 0); assert.equal((await g.player())!.pulls, count);
    assert.equal((await g.player())!.pity, count % 100);
    const due = milestones.filter(([draw]) => draw <= count);
    assert.deepEqual(result.results.flatMap((p, i) => p.guaranteed ? [[i + 1, p.tier]] : []), due);
    const lastUnique = due.filter(([, tier]) => tier === 'unique').at(-1)?.[0] || 0;
    assert.equal((await g.player())!.unique_pity, count - lastUnique);
    assert.equal((await g.state()).pets.reduce((sum, p) => sum + p.copies, 0), count + 1);
  }
});
test('invalid or unaffordable batches never invoke randomness or alter game data', async t => {
  const g = await game(t, { random: () => 0 });
  g.random = () => { throw new Error('must not draw'); };
  const player = await g.player(), pets = await g.db.prepare('SELECT * FROM pets').all();
  for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3', null])
    await assert.rejects(() => change(g, () => g.pull(count as number)), { status: 400 }); // invalid on purpose
  for (const count of [4, 25, Number.MAX_SAFE_INTEGER])
    await assert.rejects(() => change(g, () => g.pull(count)), { status: 409 });
  assert.deepEqual((await g.player()), player);
  assert.deepEqual((await g.db.prepare('SELECT * FROM pets').all()), pets);
  assert.equal((await g.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind='gacha'").get() as { n: number }).n, 0);
  assert.equal((await g.db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number }).n, 0);
});
test('independent pity survives 10-pull batches and defers a colliding unique guarantee; no overdraft', async t => {
  const g = await game(t, { random: () => 0 });
  await g.ingest([usage('claude', 'funds', 100_000_000)]);
  for (let i = 0; i < 4; i++) await change(g, () => g.pull(10));
  const unique = await change(g, () => g.pull(10));
  assert.equal(unique.results[8].tier, 'common'); assert.equal(unique.results[9].tier, 'unique');
  assert.equal(unique.results[9].guaranteed, true); assert.equal((await g.player())!.pity, 50); assert.equal((await g.player())!.unique_pity, 0);
  for (let i = 0; i < 4; i++) await change(g, () => g.pull(10));
  const legendary = await change(g, () => g.pull(10));
  assert.equal(legendary.results[8].tier, 'common'); assert.equal(legendary.results[9].tier, 'legendary');
  assert.equal(legendary.results[9].guaranteed, true); assert.equal((await g.player())!.pity, 0); assert.equal((await g.player())!.unique_pity, 50);
  assert.equal((await change(g, () => g.pull(1))).results[0].tier, 'unique');
  assert.equal((await g.player())!.pity, 1); assert.equal((await g.player())!.unique_pity, 0);
  const before = await g.player(); await assert.rejects(() => change(g, () => g.pull(10)), { status: 409 });
  assert.deepEqual((await g.player()), before);
});
test('natural unique and legendary drops reset only their own pity counter', async t => {
  const g = await game(t, { random: () => 0 });
  await g.db.exec('UPDATE player SET pity=20,unique_pity=30');
  g.random = max => max === 10000 ? 9890 : 0;
  const unique = (await change(g, () => g.pull(1))).results[0];
  assert.equal(unique.tier, 'unique'); assert.equal(unique.guaranteed, false);
  assert.equal((await g.player())!.pity, 21); assert.equal((await g.player())!.unique_pity, 0);
  g.random = max => max === 10000 ? 9990 : 0;
  const legendary = (await change(g, () => g.pull(1))).results[0];
  assert.equal(legendary.tier, 'legendary'); assert.equal(legendary.guaranteed, false);
  assert.equal((await g.player())!.pity, 0); assert.equal((await g.player())!.unique_pity, 1);
});
test('both pity counters and a deferred guarantee survive restart and receipt replay', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-pity-')), path = join(dir, 'game.sqlite');
  let g = await Game.open(path, { random: () => 0 });
  t.after(async () => { await g.close(); rmSync(dir, { recursive: true, force: true }); });
  await g.db.exec('UPDATE player SET pity=99,unique_pity=49');
  await g.close(); g = await Game.open(path, { random: () => 0 });
  assert.equal((await g.player())!.pity, 99); assert.equal((await g.player())!.unique_pity, 49);
  const key = randomUUID(), legendary = await g.once(key, 'pull', () => g.pull(1));
  assert.equal(legendary.results[0].tier, 'legendary'); assert.equal(legendary.results[0].guaranteed, true);
  assert.equal((await g.player())!.pity, 0); assert.equal((await g.player())!.unique_pity, 50);
  await g.close(); g = await Game.open(path, { random: () => 0 });
  assert.deepEqual((await g.once<GachaResult>(key, 'pull', () => assert.fail('must replay'))).results, legendary.results);
  assert.equal((await g.player())!.coins, 200); assert.equal((await g.player())!.unique_pity, 50);
  const unique = (await change(g, () => g.pull(1))).results[0];
  assert.equal(unique.tier, 'unique'); assert.equal(unique.guaranteed, true);
  assert.equal((await g.player())!.pity, 1); assert.equal((await g.player())!.unique_pity, 0);
});
test('random failure rolls back entire draw and request, allowing a retry', async t => {
  let fail = false, rolls = 0;
  const g = await game(t, { random: () => { if (fail && ++rolls === 3) throw new Error('RNG unavailable'); return 0; } });
  await g.db.exec('UPDATE player SET pity=98,unique_pity=49');
  fail = true;
  const id = randomUUID();
  const before = await g.player();
  await assert.rejects(() => g.once(id, 'pull', () => g.pull(3)), /RNG unavailable/);
  assert.equal(rolls, 3, 'fail after unique and legendary guarantees inside the batch');
  assert.deepEqual((await g.player()), before);
  assert.equal((await g.state()).active.copies, 1); assert.equal((await g.state()).active.xp, 0);
  assert.equal((await g.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind='gacha'").get() as { n: number }).n, 0);
  assert.equal((await g.db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number }).n, 0);
  fail = false;
  assert.deepEqual((await g.once(id, 'pull', () => g.pull(3))).results.map(p => p.tier), ['unique', 'legendary', 'common']);
  assert.equal((await g.player())!.coins, 0); assert.equal((await g.state()).active.copies, 2);
  assert.equal((await g.player())!.pity, 1); assert.equal((await g.player())!.unique_pity, 2);
});
test('care cooldown, elapsed sleep recovery, validation and growth', async t => {
  let now = 1_000_000;
  const g = await game(t, { now: () => now });
  const play = await change(g, () => g.care('play'));
  assert.ok(play.message.includes('에너지 85→75 (-10)'));
  assert.ok(play.message.includes('경험치 +10 · 무료'));
  await assert.rejects(() => change(g, () => g.care('play')), { status: 429 });
  const sleep = await change(g, () => g.care('sleep'));
  assert.ok(sleep.message.includes('에너지 +20/시간'));
  assert.ok(!sleep.message.includes('경험치'));
  await assert.rejects(() => change(g, () => g.care('feed')), { status: 409 });
  now += 3_600_000; await change(g, () => g.care('wake'));
  assert.equal(Math.round((await g.state()).active.energy), 95);
  await g.ingest([usage('claude', 'xp', 10_000_000)]);
  assert.equal((await g.state()).active.stage, '청소년');
  await assert.rejects(() => change(g, () => g.equip('nonexistent')), { status: 404 });
  await assert.rejects(() => change(g, () => g.rename('')));
});
test('a sleeping reserve pet keeps its needs and recovers while another receives care and coding XP', async t => {
  let now = 1_000_000;
  const g = await game(t, { now: () => now, random: () => 0 });
  g.random = max => max === 10000 ? 0 : 1;
  const other = (await change(g, () => g.pull(1))).results[0].id;
  await change(g, () => g.care('play'));
  await change(g, () => g.care('sleep'));
  const coins = (await g.player())!.coins;
  await change(g, () => g.equip(other));
  assert.equal((await g.player())!.coins, coins, 'switching pets is free');
  await change(g, () => g.care('play'));
  await g.ingest([usage('claude', 'other-pet', RULES.tokensPerCoin * 2)]);
  now += 3_600_000;
  const state = await g.state(), sleeper = state.pets.find(p => p.id === 'sprout')!;
  assert.equal(sleeper.sleeping, true);
  assert.equal(sleeper.energy, 95);
  assert.deepEqual([sleeper.hunger, sleeper.happiness, sleeper.hygiene], [85, 100, 85]);
  assert.equal(sleeper.xp, 10, 'care and coding XP must stay with their respective pets');
  assert.equal(state.active.id, other);
  assert.equal(state.active.sleeping, false);
  assert.equal(state.active.energy, 73);
  assert.equal(state.active.xp, 11);
  await change(g, () => g.equip('sprout'));
  assert.equal((await g.state()).active.sleeping, true, 'selecting a sleeping pet must not wake it');
  await assert.rejects(() => change(g, () => g.care('feed')), { status: 409 });
  await change(g, () => g.care('wake'));
  assert.equal((await g.state()).active.energy, 95, 'waking must preserve recovered energy');
  assert.equal((await g.state()).pets.find(p => p.id === other)!.energy, 73);
});
test('only the selected pet decays and switches preserve separate active and reserve intervals', async t => {
  let now = 1_000_000;
  const g = await game(t, { now: () => now, random: () => 0 });
  g.random = max => max === 10000 ? 0 : 1;
  const other = (await change(g, () => g.pull(1))).results[0].id;
  const vitals = async (id: string) => { const p = (await g.state()).pets.find(p => p.id === id)!; return [p.hunger, p.happiness, p.hygiene, p.energy]; };
  now += 2 * 3_600_000;
  assert.deepEqual((await vitals('sprout')), [81, 83, 82, 81]);
  assert.deepEqual((await vitals(other)), [85, 85, 85, 89]);
  await change(g, () => g.equip(other));
  assert.deepEqual((await vitals('sprout')), [81, 83, 82, 81]);
  assert.deepEqual((await vitals(other)), [85, 85, 85, 89]);
  now += 3_600_000;
  assert.deepEqual((await vitals('sprout')), [81, 83, 82, 83]);
  assert.deepEqual((await vitals(other)), [83, 84, 83.5, 87]);
  const rows = await g.db.prepare('SELECT * FROM pets').all();
  await change(g, () => g.equip(other));
  assert.deepEqual((await g.db.prepare('SELECT * FROM pets').all()), rows, 'selecting the same pet must not reset its clock');
  await change(g, () => g.equip('sprout'));
  now += 3_600_000;
  assert.deepEqual((await vitals('sprout')), [79, 82, 80.5, 81]);
  assert.deepEqual((await vitals(other)), [83, 84, 83.5, 89]);
});
test('active decay and reserve recovery resume correctly after the CLI/server is offline', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-rest-')), path = join(dir, 'game.sqlite');
  let now = 1_000_000, g = await Game.open(path, { now: () => now, random: () => 0 });
  t.after(async () => { await g.close(); rmSync(dir, { recursive: true, force: true }); });
  g.random = max => max === 10000 ? 0 : 1;
  const other = (await change(g, () => g.pull(1))).results[0].id;
  now += 3_600_000; await change(g, () => g.equip(other));
  await g.close(); now += 5 * 3_600_000;
  g = await Game.open(path, { now: () => now, random: () => 0 });
  const s = await g.state(), reserve = s.pets.find(p => p.id === 'sprout')!;
  assert.deepEqual([reserve.hunger, reserve.happiness, reserve.hygiene, reserve.energy], [83, 84, 83.5, 93]);
  assert.deepEqual([s.active.hunger, s.active.happiness, s.active.hygiene, s.active.energy], [75, 80, 77.5, 77]);
  assert.deepEqual((await g.state()), s, 'reading state must not count offline time twice');
});
test('switching preserves energy limits instead of retroactively reusing uncapped elapsed time', async t => {
  let now = 1_000_000;
  const g = await game(t, { now: () => now, random: () => 0 });
  g.random = max => max === 10000 ? 0 : 1;
  const other = (await change(g, () => g.pull(1))).results[0].id;
  await g.db.exec("UPDATE pets SET energy=1 WHERE species='sprout'; UPDATE pets SET energy=99 WHERE species<>'sprout'");
  now += 2 * 3_600_000;
  assert.equal((await g.state()).active.energy, 0);
  assert.equal((await g.state()).pets.find(p => p.id === other)!.energy, 100);
  await change(g, () => g.equip(other)); now += 3 * 3_600_000;
  assert.equal((await g.state()).active.energy, 94);
  assert.equal((await g.state()).pets.find(p => p.id === 'sprout')!.energy, 6);
});
test('switch checkpoints and selection roll back together and a replay never checkpoints twice', async t => {
  let now = 1_000_000;
  const g = await game(t, { now: () => now, random: () => 0 });
  g.random = max => max === 10000 ? 0 : 1;
  const other = (await change(g, () => g.pull(1))).results[0].id;
  now += 3_600_000;
  const player = await g.player(), rows = await g.db.prepare('SELECT * FROM pets').all(), key = randomUUID();
  await g.db.exec("CREATE TRIGGER fail_switch BEFORE UPDATE OF equipped ON player BEGIN SELECT RAISE(ABORT, 'switch failed'); END;");
  await assert.rejects(() => g.once(key, 'equip', () => g.equip(other)), /switch failed/);
  assert.deepEqual((await g.player()), player); assert.deepEqual((await g.db.prepare('SELECT * FROM pets').all()), rows);
  await g.db.exec('DROP TRIGGER fail_switch');
  await g.once(key, 'equip', () => g.equip(other));
  const saved = await g.db.prepare('SELECT * FROM pets').all();
  now += 3_600_000;
  assert.equal((await g.once<StateResult>(key, 'equip', () => assert.fail('must replay'))).state.active.id, other);
  assert.deepEqual((await g.db.prepare('SELECT * FROM pets').all()), saved);
  assert.equal((await g.state()).active.energy, 85);
});
test('public collection is opt-in, revocable and excludes coins, usage, care logs', async t => {
  const g = await game(t);
  await assert.rejects(() => g.collection('x'), { status: 404 });
  const { path } = await change(g, () => g.share(true));
  const collection = await g.collection(path!.split('/').at(-1)!);
  assert.deepEqual(Object.keys(collection).sort(), ['catalog', 'equipped', 'name', 'pets', 'tiers']);
  assert.deepEqual(Object.keys(collection.pets[0]).sort(), ['copies', 'id', 'level', 'stage']);
  const html = collectionHTML({ ...collection, name: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  await change(g, () => g.share(false)); await assert.rejects(() => g.collection(path!.split('/').at(-1)!), { status: 404 });
});
test('ledger and token high-water marks survive server restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-db-')), path = join(dir, 'game.sqlite');
  const record = usage('claude', 'persist', 800_000);
  const first = await Game.open(path); await first.ingest([record]); await first.close();
  const second = await Game.open(path);
  try { assert.equal((await second.ingest([record])).creditedCoins, 0); assert.equal((await second.player())!.coins, 380); }
  finally { await second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unpaid token remainders survive restarts and settle at the current rate', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-economy-')), path = join(dir, 'game.sqlite');
  let g: Game | undefined;
  t.after(async () => { await g?.close(); rmSync(dir, { recursive: true, force: true }); });
  g = await Game.open(path);
  const record = usage('codex', 'remainder', 1_234_567);
  await g.ingest([record]);
  await g.db.exec(`UPDATE player SET coins=1534; UPDATE pets SET xp=617;
    UPDATE reward_progress SET coin_tokens=567,xp_tokens=567;`);
  await g.close(); g = await Game.open(path);
  assert.equal((await g.player())!.coins, 1534); assert.equal((await g.state()).active.xp, 617);
  assert.deepEqual((await g.ingest([record])), { creditedTokens: 0, creditedCoins: 0, creditedXp: 0 });
  const next = { ...record, input: 1_244_000 };
  assert.deepEqual((await g.ingest([next])), { creditedTokens: 9433, creditedCoins: 1, creditedXp: 0 });
  assert.equal((await g.player())!.coins, 1535); assert.equal((await g.state()).active.xp, 617);
  await g.close(); g = await Game.open(path);
  assert.deepEqual((await g.ingest([next])), { creditedTokens: 0, creditedCoins: 0, creditedXp: 0 });
  assert.deepEqual((await g.ingest([{ ...record, input: 1_254_000 }])), { creditedTokens: 10_000, creditedCoins: 1, creditedXp: 1 });
  assert.equal((await g.player())!.coins, 1536); assert.equal((await g.state()).active.xp, 618);
});

test('attendance follows Korean midnight, caps the bonus, survives retries, and resets after a missed day', async t => {
  let now = Date.parse('2026-12-31T14:59:59.999Z');
  const g = await game(t, { now: () => now });
  assert.equal((await g.state()).attendance.date, '2026-12-31');
  assert.equal((await g.state()).attendance.claimed, false);
  assert.equal((await g.player())!.coins, 300, 'state reads do not claim attendance');
  const id = randomUUID(), first = await g.once(id, 'checkin', () => g.checkin());
  assert.equal(first.creditedCoins, 100);
  assert.equal((await g.once(id, 'checkin', () => g.checkin())).creditedCoins, 100, 'a retry returns the same receipt');
  assert.equal((await change(g, () => g.checkin())).awarded, false);
  assert.equal((await g.player())!.coins, 400);
  now += 1;
  assert.equal((await g.state()).attendance.date, '2027-01-01');
  assert.equal((await g.state()).attendance.claimed, false);
  assert.equal((await change(g, () => g.checkin())).creditedCoins, 120);
  const expected = [140, 160, 180, 200, 220, 220, 220];
  for (const coins of expected) {
    now += 86_400_000;
    const result = await change(g, () => g.checkin());
    assert.equal(result.creditedCoins, coins);
    assert.equal((await change(g, () => g.checkin())).creditedCoins, 0);
  }
  assert.equal((await g.state()).attendance.streak, 9);
  assert.equal((await g.player())!.coins, 300 + 100 + 120 + expected.reduce((a, b) => a + b, 0));
  assert.equal((await g.state()).active.xp, 0, 'attendance grants coins only');
  now += 2 * 86_400_000;
  assert.equal((await g.state()).attendance.streak, 0);
  assert.equal((await change(g, () => g.checkin())).creditedCoins, 100);
  assert.equal((await g.state()).attendance.streak, 1);
  now -= 86_400_000;
  assert.equal((await change(g, () => g.checkin())).awarded, false, 'clock rollback cannot award a skipped date');
});

test('attendance and its wallet entry commit together and persist across restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-attendance-')), path = join(dir, 'game.sqlite');
  let g: Game | undefined;
  t.after(async () => { await g?.close(); rmSync(dir, { recursive: true, force: true }); });
  const now = () => Date.parse('2026-10-12T03:00:00Z');
  g = await Game.open(path, { now });
  await g.db.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  const id = randomUUID();
  await assert.rejects(() => g!.once(id, 'checkin', () => g!.checkin()), /test failure/);
  assert.equal((await g.player())!.coins, 300); assert.equal((await g.state()).attendance.claimed, false);
  await g.db.exec('DROP TRIGGER fail_ledger');
  await g.once(id, 'checkin', () => g!.checkin());
  await g.close(); g = await Game.open(path, { now });
  assert.equal((await change(g, () => g.checkin())).awarded, false);
  assert.equal((await g.player())!.coins, 400);
  assert.equal((await g.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind='checkin'").get() as { n: number }).n, 1);
});
