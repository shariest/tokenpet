import type { Game } from './game.js';
import type { PetRow, Ranking, RankingEntry } from './types.js';

interface RankingRow { rank: number; nickname: string; species_count: number; copies: number; tokens: number; player_id: number; species: string; xp: number }

import { CATALOG, TIERS, RULES } from './catalog.js';
import { GameError } from './game.js';

export async function catalog(game: Game | null, params: URLSearchParams) {
  const owned = params.get('owned') || 'false', tier = params.get('tier'), query = params.get('q') || '';
  if (!['true', 'false'].includes(owned) || (tier && !TIERS.some(t => t.id === tier)) || query.length > 100)
    throw new GameError('도감 필터를 확인해 주세요.');
  if (owned === 'true' && !game) throw new GameError('보유 도감은 로그인 후 볼 수 있어요.', 401);
  const equipped = (await game?.player())?.equipped;
  const pets = game ? (await game.db.prepare('SELECT * FROM pets WHERE player_id=?').all(game.playerId)).map(row => {
    const p = game.pet(row as unknown as PetRow, equipped!); return { id: p.id, level: p.level, stage: p.stage, copies: p.copies };
  }) : [];
  const ids = new Set(pets.map(p => p.id));
  return { catalog: CATALOG.filter(p => (owned === 'false' || ids.has(p.id)) && (!tier || p.tier === tier) &&
    `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase())), tiers: TIERS, rules: RULES, pets, total: CATALOG.length };
}

// Date.parse rolls 2026-02-30 over to March, so a calendar day must survive the round trip.
function isDay(value: string | null): value is string {
  const time = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value!);
}

export async function rankings(game: Game, params: URLSearchParams, playerId?: number): Promise<Ranking> {
  const type = params.get('type') || 'level', pageText = params.get('page') || '1', from = params.get('from'), to = params.get('to');
  if (!['level', 'collection', 'tokens'].includes(type) || !/^[1-9]\d{0,5}$/.test(pageText)) throw new GameError('랭킹 종류와 페이지를 확인해 주세요.');
  if ((from !== null || to !== null) && !(isDay(from) && isDay(to) && from <= to)) throw new GameError('집계 기간은 YYYY-MM-DD 형식의 시작일과 종료일로 입력해 주세요.');
  const page = Number(pageText), pageSize = 20, period = from === null ? [] : [from, to!];
  const order = type === 'level' ? 'p.xp DESC,t.species_count DESC,a.player_id' : type === 'collection' ? 't.species_count DESC,p.xp DESC,a.player_id' : 'COALESCE(k.tokens,0) DESC,p.xp DESC,a.player_id';
  // A period sums the Korean calendar days credited inside it (start 00:00:00 to end 23:59:59.999); otherwise the lifetime total counts.
  const cte = `WITH pets_ranked AS (
    SELECT player_id,species,xp,ROW_NUMBER() OVER(PARTITION BY player_id ORDER BY xp DESC,species) AS n FROM pets
  ), totals AS (
    SELECT player_id,COUNT(*) AS species_count,SUM(copies) AS copies FROM pets GROUP BY player_id
  ), credits AS (
    ${period.length ? 'SELECT player_id,SUM(tokens) AS tokens FROM daily_tokens WHERE day BETWEEN ? AND ? GROUP BY player_id' : 'SELECT id AS player_id,tokens FROM player'}
  ), ranked AS (
    SELECT a.player_id,a.nickname,p.species,p.xp,t.species_count,t.copies,COALESCE(k.tokens,0) AS tokens,
      ROW_NUMBER() OVER(ORDER BY ${order}) AS rank
    FROM accounts a JOIN pets_ranked p ON p.player_id=a.player_id AND p.n=1 JOIN totals t ON t.player_id=a.player_id
      LEFT JOIN credits k ON k.player_id=a.player_id
  )`;
  const entry = (row: RankingRow | undefined): RankingEntry | null => row ? { rank: row.rank, nickname: row.nickname, speciesCount: row.species_count,
    copies: row.copies, tokens: row.tokens, mine: row.player_id === playerId, pet: { ...CATALOG.find(p => p.id === row.species)!, xp: row.xp,
      level: Math.min(50, 1 + Math.floor(Math.sqrt(row.xp / 25))) } } : null;
  const total = (await game.db.prepare('SELECT COUNT(*) AS n FROM accounts').get())!.n as number;
  return { type: type as Ranking['type'], page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)),
    entries: (await game.db.prepare(`${cte} SELECT * FROM ranked ORDER BY rank LIMIT ? OFFSET ?`).all(...period, pageSize, (page - 1) * pageSize)).map(row => entry(row as unknown as RankingRow)!),
    me: playerId ? entry(await game.db.prepare(`${cte} SELECT * FROM ranked WHERE player_id=?`).get(...period, playerId) as unknown as RankingRow | undefined) : null };
}
