export type TierId = 'common' | 'rare' | 'epic' | 'unique' | 'legendary';
export type CareAction = 'feed' | 'play' | 'clean' | 'sleep' | 'wake';
export type Cli = 'claude' | 'codex';
export type Vital = 'hunger' | 'happiness' | 'energy' | 'hygiene';

export interface Species {
  id: string; name: string; family: string; habitat: string; variant: number;
  tier: TierId; color: string; shape: string; number: number; description: string;
}
export interface Tier { id: TierId; name: string; chance: number; color: string }
export interface Player {
  id: number; name: string; coins: number; tokens: number; pity: number; unique_pity: number; pulls: number;
  equipped: string; share: string | null; created: number;
}
export interface PetRow {
  species: string; player_id: number; copies: number; xp: number; hunger: number;
  happiness: number; energy: number; hygiene: number; sleeping: number;
  updated: number; cooldowns: string;
}
export interface Pet extends Species, Omit<PetRow, 'sleeping' | 'cooldowns'> {
  sleeping: boolean; level: number; stage: string; nextLevelXp: number | null;
  cooldowns: Partial<Record<CareAction, number>>;
}
export type Portrait = Pick<Species, 'shape' | 'color'> & Partial<Pick<Species, 'variant' | 'name'>> & Partial<Pick<Pet, 'level' | 'sleeping' | Vital>>;
export type CollectionPet = Pick<Pet, 'id' | 'level' | 'stage' | 'copies'>;
export interface Collection { name: string; equipped?: string; catalog: Species[]; tiers: Tier[]; pets: CollectionPet[] }
export interface Connection { source: Cli; last_seen: number; tokens: number }
export interface Activity { id: number; kind: string; label: string; coins: number; created: number; player_id: number }
export interface Attendance { date: string; timeZone: string; claimed: boolean; streak: number; coins: number; nextCoins: number }
export interface CollectorStatus { scanning: boolean; files: number; errors: number; lastScan?: number | null; enabled?: boolean }
export interface GameState {
  player: Player; active: Pet; pets: Pet[]; catalog: Species[]; tiers: Tier[];
  rules: typeof import('./catalog.js').RULES; care: Record<CareAction, { label: string; cost: number }>;
  attendance: Attendance; connections: Connection[]; activity: Activity[]; serverTime: number; collector?: CollectorStatus;
}
export type ServerState = GameState & { collector: CollectorStatus & { enabled: boolean } };
export interface StateResult { state: GameState }
export interface CareResult extends StateResult { message: string }
export interface CheckinResult extends CareResult { awarded: boolean; creditedCoins: number }
export interface Draw extends Species { isNew: boolean; guaranteed: boolean; duplicateXp: number }
export interface GachaResult extends StateResult { results: Draw[] }
export interface ShareResult extends StateResult { path: string | null }
export interface UsageRecord { source: Cli; key: string; input: number; output: number; baseline: boolean }
export interface UsageResult { creditedTokens: number; creditedCoins: number; creditedXp: number }

export interface Configuration {
  dataDir: string; port: number; host: string; baseUrl: string; publicUrl: string | null;
  remote: boolean; token?: string; trustProxy: boolean; codexPetDir: string; watch: boolean; roots: Record<Cli, string[]>;
  database?: DatabaseConfiguration;
}
export interface DatabaseConfiguration {
  driver: 'postgres' | 'mariadb'; url: string; namespace: string;
  max: number; min: number; connectionTimeoutMillis: number; idleTimeoutMillis: number;
}
export interface SavedConnection { server?: string; key?: string }
export interface User { id: number; username: string; nickname: string; created: number }
export interface Identity { user: User | null; authenticated: boolean; local: boolean }
export interface ApiToken { id: string; label: string; prefix: string; created: number; expires: number; last_used: number | null }
export interface Directory { catalog: Species[]; tiers: Tier[]; rules: GameState['rules']; pets: CollectionPet[]; total: number }
export interface RankingEntry { rank: number; nickname: string; speciesCount: number; copies: number; tokens: number; mine: boolean; pet: Species & { xp: number; level: number } }
export interface Ranking { type: 'level' | 'collection' | 'tokens'; page: number; pageSize: number; total: number; pages: number; entries: RankingEntry[]; me: RankingEntry | null }

export interface ApiResponses {
  '/api/state': ServerState;
  '/api/care': CareResult;
  '/api/checkin': CheckinResult;
  '/api/gacha': GachaResult;
  '/api/equip': StateResult;
  '/api/profile': StateResult;
  '/api/share': ShareResult;
  '/api/usage': UsageResult;
  '/api/me': Identity;
  '/api/catalog': Directory;
  '/api/tokens': { tokens: ApiToken[] };
  '/api/session': { ok: boolean };
  '/api/shutdown': { ok: boolean; pid?: number };
  '/api/signup': { user: User };
  '/api/login': { user: User };
}
