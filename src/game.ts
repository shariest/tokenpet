import type { Player, PetRow, Pet, GameState, CareAction, Vital, UsageRecord, StateResult, GachaResult, UsageResult, Connection, Activity, TierId, DatabaseConfiguration } from './types.js';

import { Database } from './database.js';
import { randomInt, randomUUID } from 'node:crypto';
import { CATALOG, TIERS, RULES, CARE } from './catalog.js';

export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function requireValue(ok: unknown, message: string, status = 400): asserts ok { if (!ok) throw new GameError(message, status); }
const clamp = (n: number) => Math.max(0, Math.min(100, n));

export class Game {
  private constructor(public db: Database, public now = Date.now, public random = randomInt, public playerId = 1, private ownsDatabase = false) {}
  static async open(path = ':memory:', { now = Date.now, random = randomInt, database }: { now?: () => number; random?: (max: number) => number; database?: DatabaseConfiguration } = {}) {
    const db = await Database.open(path, database);
    const game = new Game(db, now, random, 1, true);
    try {
      await db.transaction(async () => {
        if (!await game.player()) await game.createPlayer('나의 작은 작업실', 1);
      });
      return game;
    } catch (error) { await db.close(); throw error; }
  }
  async close() { if (this.ownsDatabase) await this.db.close(); }
  forPlayer(playerId: number) {
    requireValue(Number.isSafeInteger(playerId) && playerId > 0, '올바른 회원이 아니에요.');
    return new Game(this.db, this.now, this.random, playerId);
  }
  async createPlayer(name: string, id: number | null = null) {
    const pet = this.drawSpecies();
    const row = id === null
      ? await this.db.prepare('INSERT INTO player(name,coins,equipped,created) VALUES(?,?,?,?) RETURNING id').get(name, RULES.welcomeCoins, pet.id, this.now())
      : await this.db.prepare('INSERT INTO player(id,name,coins,equipped,created) VALUES(?,?,?,?,?) RETURNING id').get(id, name, RULES.welcomeCoins, pet.id, this.now());
    const game = this.forPlayer(Number(row!.id));
    await this.db.prepare('INSERT INTO pets(player_id,species,updated) VALUES(?,?,?)').run(game.playerId, pet.id, this.now());
    await this.db.prepare('INSERT INTO reward_progress VALUES(?,0,0)').run(game.playerId);
    await game.log('welcome', `첫 친구 · ${pet.name} [${pet.tier}] · ${pet.id}`, RULES.welcomeCoins);
    return game;
  }
  async player() { return await this.db.prepare('SELECT * FROM player WHERE id=?').get(this.playerId) as Player | undefined; }
  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.db.transaction(fn, this.playerId);
  }
  async once<T extends StateResult>(key: unknown, fingerprint: string, fn: () => T | Promise<T>): Promise<T> {
    requireValue(typeof key === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(key), '유효한 Idempotency-Key가 필요해요.');
    return await this.transaction(async () => {
      const previous = await this.db.prepare('SELECT * FROM requests WHERE player_id=? AND key=?').get(this.playerId, key) as { fingerprint: string; result: string } | undefined;
      if (previous) {
        requireValue(previous.fingerprint === fingerprint, '같은 요청 키를 다른 작업에 사용할 수 없어요.', 409);
        return { ...JSON.parse(previous.result), state: await this.state() };
      }
      const result = await fn();
      const { state, ...receipt } = result;
      await this.db.prepare('INSERT INTO requests(key,fingerprint,result,player_id) VALUES(?,?,?,?)').run(key, fingerprint, JSON.stringify(receipt), this.playerId);
      return result;
    });
  }
  async log(kind: string, label: string, coins = 0) {
    await this.db.prepare('INSERT INTO ledger(kind,label,coins,created,player_id) VALUES(?,?,?,?,?)').run(kind, label, coins, this.now(), this.playerId);
  }
  pet(row: PetRow, equipped: string, now = this.now()): Pet {
    const hours = Math.max(0, now - row.updated) / 3_600_000;
    const active = row.species === equipped, activeHours = active ? hours : 0;
    const level = Math.min(50, 1 + Math.floor(Math.sqrt(row.xp / 25)));
    return { ...row, ...CATALOG.find(p => p.id === row.species)!, sleeping: !!row.sleeping,
      hunger: clamp(row.hunger - activeHours * 2), happiness: clamp(row.happiness - activeHours),
      hygiene: clamp(row.hygiene - activeHours * 1.5), energy: clamp(row.energy + hours * (row.sleeping ? 20 : active ? -2 : 2)),
      level, stage: level >= 10 ? '성체' : level >= 5 ? '청소년' : '아기',
      nextLevelXp: level >= 50 ? null : level ** 2 * 25, cooldowns: JSON.parse(row.cooldowns),
    };
  }
  async state(): Promise<GameState> {
    return this.transaction(async () => {
      const player = (await this.player())!, now = this.now();
      const pets = (await this.db.prepare('SELECT * FROM pets WHERE player_id=?').all(this.playerId)).map(p => this.pet(p as unknown as PetRow, player.equipped, now));
      return { player, active: pets.find(p => p.id === player.equipped)!, pets, catalog: CATALOG, tiers: TIERS,
        rules: RULES, care: CARE, attendance: await this.attendance(), connections: await this.db.prepare('SELECT * FROM connections WHERE player_id=?').all(this.playerId) as unknown as Connection[],
        activity: await this.db.prepare('SELECT * FROM ledger WHERE player_id=? ORDER BY id DESC LIMIT 20').all(this.playerId) as unknown as Activity[], serverTime: now };
    });
  }
  async attendance() {
    const localTime = this.now() + 9 * 3_600_000;
    const day = new Date(localTime).toISOString().slice(0, 10);
    const yesterday = new Date(localTime - 86_400_000).toISOString().slice(0, 10);
    const last = await this.db.prepare('SELECT * FROM checkins WHERE player_id=? ORDER BY day DESC LIMIT 1').get(this.playerId) as { day: string; streak: number; coins: number } | undefined;
    // A server clock rollback must not make an earlier day claimable again.
    const claimed = !!last && last.day >= day;
    const streak = last && last.day >= yesterday ? last.streak : 0;
    const nextCoins = RULES.checkinBaseCoins + Math.min(streak, RULES.checkinMaxDays - 1) * RULES.checkinStepCoins;
    return { date: day, timeZone: 'Asia/Seoul', claimed, streak, coins: claimed ? last!.coins : nextCoins, nextCoins };
  }
  async checkin() {
    const attendance = await this.attendance();
    if (attendance.claimed) return { awarded: false, creditedCoins: 0, message: '오늘 출석 보상은 이미 받았어요.', state: await this.state() };
    const streak = attendance.streak + 1, coins = attendance.coins;
    await this.db.prepare('INSERT INTO checkins(day,streak,coins,created,player_id) VALUES(?,?,?,?,?)').run(attendance.date, streak, coins, this.now(), this.playerId);
    await this.db.prepare('UPDATE player SET coins=coins+? WHERE id=?').run(coins, this.playerId);
    await this.log('checkin', `연속 ${streak}일 출석`, coins);
    return { awarded: true, creditedCoins: coins, message: `연속 ${streak}일 출석 · +${coins} C`, state: await this.state() };
  }
  async ingest(records: UsageRecord[]): Promise<UsageResult> {
    requireValue(Array.isArray(records) && records.length > 0 && records.length <= 500, '사용량은 1~500개씩 전송해 주세요.');
    for (const r of records) {
      requireValue(r && ['claude', 'codex'].includes(r.source) && typeof r.key === 'string' && /^[a-f0-9]{64}$/.test(r.key), '사용량 식별자가 올바르지 않아요.');
      requireValue((['input', 'output'] as const).every(k => Number.isSafeInteger(r[k]) && r[k] >= 0 && r[k] <= 1e12), '토큰 수는 유효한 양의 정수여야 해요.');
      requireValue(typeof r.baseline === 'boolean', '사용량 기준점이 필요해요.');
    }
    return await this.transaction(async () => {
      const player = (await this.player())!; let delta = 0;
      const deltas = { claude: 0, codex: 0 };
      for (const r of records) {
        const old = await this.db.prepare('SELECT * FROM usage WHERE player_id=? AND source=? AND key=?').get(this.playerId, r.source, r.key) as { input: number; output: number } | undefined;
        const input = Math.max(old?.input ?? 0, r.input), output = Math.max(old?.output ?? 0, r.output);
        const change = r.baseline ? 0 : input + output - (old?.input ?? 0) - (old?.output ?? 0);
        delta += change; deltas[r.source] += change;
        await this.db.prepare(`INSERT INTO usage(source,key,input,output,player_id) VALUES(?,?,?,?,?)
          ${this.db.upsert('player_id,source,key', 'input=excluded.input,output=excluded.output')}`).run(r.source, r.key, input, output, this.playerId);
        if (!r.baseline) await this.db.prepare(`INSERT INTO connections(source,last_seen,tokens,player_id) VALUES(?,?,0,?)
          ${this.db.upsert('player_id,source', 'last_seen=excluded.last_seen')}`).run(r.source, this.now(), this.playerId);
      }
      requireValue(Number.isSafeInteger(player.tokens + delta), '누적 사용량 한도를 초과했어요.');
      if (!delta) return { creditedTokens: 0, creditedCoins: 0, creditedXp: 0 };
      const progress = await this.db.prepare('SELECT * FROM reward_progress WHERE id=?').get(this.playerId) as { coin_tokens: number; xp_tokens: number };
      const coinTokens = progress.coin_tokens + delta, xpTokens = progress.xp_tokens + delta;
      const coins = Math.floor(coinTokens / RULES.tokensPerCoin);
      await this.db.prepare('UPDATE player SET tokens=tokens+?,coins=coins+? WHERE id=?').run(delta, coins, this.playerId);
      const xp = Math.floor(xpTokens / (RULES.tokensPerCoin * 2));
      await this.db.prepare('UPDATE pets SET xp=xp+? WHERE player_id=? AND species=?').run(xp, this.playerId, player.equipped);
      await this.db.prepare('UPDATE reward_progress SET coin_tokens=?,xp_tokens=? WHERE id=?')
        .run(coinTokens % RULES.tokensPerCoin, xpTokens % (RULES.tokensPerCoin * 2), this.playerId);
      for (const [source, tokens] of Object.entries(deltas)) {
        if (tokens) await this.db.prepare('UPDATE connections SET tokens=tokens+? WHERE player_id=? AND source=?').run(tokens, this.playerId, source);
      }
      if (coins) await this.log('earn', `${delta.toLocaleString('en-US')} 토큰 수집 · 잔여분 합산 정산`, coins);
      return { creditedTokens: delta, creditedCoins: coins, creditedXp: xp };
    });
  }
  async care(action: CareAction) {
    requireValue(Object.hasOwn(CARE, action), '알 수 없는 돌봄 행동이에요.');
    const player = (await this.player())!;
    const pet = this.pet(await this.db.prepare('SELECT * FROM pets WHERE player_id=? AND species=?').get(this.playerId, player.equipped) as unknown as PetRow, player.equipped);
    requireValue(this.now() - (pet.cooldowns[action] ?? 0) >= RULES.careCooldownMs, '잠깐만요! 같은 돌봄은 30초마다 할 수 있어요.', 429);
    requireValue(player.coins >= CARE[action].cost, '코인이 부족해요.', 409);
    requireValue(action === 'wake' || !pet.sleeping, '지금은 자고 있어요. 먼저 깨워 주세요.', 409);
    if (action === 'wake') requireValue(pet.sleeping, '이미 깨어 있어요.', 409);
    if (action === 'play') requireValue(pet.energy >= 10, '조금 쉬고 나서 놀아 주세요.', 409);
    const before = { ...pet };
    if (action === 'feed') { pet.hunger = clamp(pet.hunger + 25); pet.happiness = clamp(pet.happiness + 5); }
    if (action === 'clean') pet.hygiene = clamp(pet.hygiene + 35);
    if (action === 'play') { pet.happiness = clamp(pet.happiness + 25); pet.energy -= 10; }
    if (action === 'sleep') pet.sleeping = true;
    if (action === 'wake') pet.sleeping = false;
    pet.cooldowns[action] = this.now();
    await this.db.prepare(`UPDATE pets SET hunger=?,happiness=?,energy=?,hygiene=?,sleeping=?,updated=?,cooldowns=?,xp=xp+?
      WHERE player_id=? AND species=?`).run(pet.hunger, pet.happiness, pet.energy, pet.hygiene, +pet.sleeping, this.now(),
      JSON.stringify(pet.cooldowns), ['sleep', 'wake'].includes(action) ? 0 : 10, this.playerId, pet.id);
    await this.db.prepare('UPDATE player SET coins=coins-? WHERE id=?').run(CARE[action].cost, this.playerId);
    await this.log('care', `${pet.name} · ${CARE[action].label}`, -CARE[action].cost);
    const vitals: [string, Vital][] = [['포만감', 'hunger'], ['기분', 'happiness'], ['에너지', 'energy'], ['청결', 'hygiene']];
    const effects = vitals
      .map(([label, key]) => {
        const delta = Number((pet[key] - before[key]).toFixed(1));
        return delta ? `${label} ${Math.round(before[key])}→${Math.round(pet[key])} (${delta > 0 ? '+' : ''}${delta})` : null;
      }).filter(Boolean);
    if (action === 'sleep') effects.push('자는 중 · 에너지 +20/시간');
    else if (action === 'wake') effects.push('깨어났어요');
    else effects.push('경험치 +10');
    effects.push(CARE[action].cost ? `${CARE[action].cost} C 사용` : '무료');
    return { message: `${pet.name} · ${CARE[action].label}: ${effects.join(' · ')}`, state: await this.state() };
  }
  drawSpecies(guaranteedTier?: TierId) {
    let tier: TierId = guaranteedTier || 'legendary';
    if (!guaranteedTier) {
      let ticket = this.random(10000);
      // Integer tickets avoid floating-point drift at fractional percentage boundaries.
      for (const t of TIERS) { ticket -= Math.round(t.chance * 100); if (ticket < 0) { tier = t.id; break; } }
    }
    const pool = CATALOG.filter(p => p.tier === tier);
    return pool[this.random(pool.length)];
  }
  async pull(count: number): Promise<GachaResult> {
    requireValue(Number.isSafeInteger(count) && count >= 1, '뽑기 횟수는 1 이상의 정수로 입력해 주세요.');
    const player = (await this.player())!;
    requireValue(count <= Math.floor(player.coins / RULES.pullCost),
      `${count.toLocaleString('ko-KR')}회를 모두 뽑기에는 코인이 부족해요. 현재 ${player.coins.toLocaleString('ko-KR')} C · 최대 ${Math.floor(player.coins / RULES.pullCost).toLocaleString('ko-KR')}회. 한 번도 뽑지 않았어요.`, 409);
    const results = []; let pity = player.pity, uniquePity = player.unique_pity;
    for (let i = 0; i < count; i++) {
      const guaranteedTier = pity + 1 >= RULES.pityAt ? 'legendary' : uniquePity + 1 >= RULES.uniquePityAt ? 'unique' : undefined;
      const species = this.drawSpecies(guaranteedTier);
      const existing = await this.db.prepare('SELECT copies FROM pets WHERE player_id=? AND species=?').get(this.playerId, species.id);
      await this.db.prepare(`INSERT INTO pets(species,updated,player_id) VALUES(?,?,?)
        ${this.db.upsert('player_id,species', 'copies=pets.copies+1,xp=pets.xp+25')}`).run(species.id, this.now(), this.playerId);
      pity = species.tier === 'legendary' ? 0 : pity + 1;
      uniquePity = species.tier === 'unique' ? 0 : uniquePity + 1;
      results.push({ ...species, isNew: !existing, guaranteed: !!guaranteedTier, duplicateXp: existing ? 25 : 0 });
    }
    await this.db.prepare('UPDATE player SET coins=coins-?,pity=?,unique_pity=?,pulls=pulls+? WHERE id=?').run(count * RULES.pullCost, pity, uniquePity, count, this.playerId);
    await this.log('gacha', results.map(p => `${p.name}${p.isNew ? ' NEW' : ' +25 XP'}`).join(' · '), -count * RULES.pullCost);
    return { results, state: await this.state() };
  }
  async equip(id: string) {
    requireValue(typeof id === 'string' && !!await this.db.prepare('SELECT species FROM pets WHERE player_id=? AND species=?').get(this.playerId, id), '아직 만나지 못한 친구예요.', 404);
    const player = (await this.player())!;
    if (id === player.equipped) return { state: await this.state() };
    const now = this.now();
    const rows = await this.db.prepare('SELECT * FROM pets WHERE player_id=? AND species IN (?,?)').all(this.playerId, player.equipped, id);
    const save = this.db.prepare('UPDATE pets SET hunger=?,happiness=?,energy=?,hygiene=?,updated=CASE WHEN updated>? THEN updated ELSE ? END WHERE player_id=? AND species=?');
    for (const row of rows) {
      const pet = this.pet(row as unknown as PetRow, player.equipped, now);
      await save.run(pet.hunger, pet.happiness, pet.energy, pet.hygiene, now, now, this.playerId, pet.id);
    }
    await this.db.prepare('UPDATE player SET equipped=? WHERE id=?').run(id, this.playerId);
    return { state: await this.state() };
  }
  async rename(name: string) {
    requireValue(typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 30 && !/[\x00-\x1f\x7f]/.test(name), '작업실 이름은 1~30자로 입력해 주세요.');
    await this.db.prepare('UPDATE player SET name=? WHERE id=?').run(name.trim(), this.playerId);
    return { state: await this.state() };
  }
  async share(enabled: boolean) {
    requireValue(typeof enabled === 'boolean', '공유 여부가 필요해요.');
    const slug = enabled ? (await this.player())!.share ?? randomUUID() : null;
    await this.db.prepare('UPDATE player SET share=? WHERE id=?').run(slug, this.playerId);
    return { path: slug ? `/share/${slug}` : null, state: await this.state() };
  }
  async collection(slug: string) {
    const player = (await this.player())!;
    requireValue(!!player.share && player.share === slug, '공유 중인 도감이 없어요.', 404);
    return { name: player.name, catalog: CATALOG, tiers: TIERS, equipped: player.equipped,
      pets: (await this.db.prepare('SELECT * FROM pets WHERE player_id=?').all(this.playerId)).map(row => {
        const p = this.pet(row as unknown as PetRow, player.equipped); return { id: p.id, level: p.level, stage: p.stage, copies: p.copies };
      }) };
  }
}
