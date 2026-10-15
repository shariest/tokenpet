import type { Game } from './game.js';
import type { User, ApiToken } from './types.js';

interface AccountRow { player_id: number; username: string; nickname: string; password: string; created: number }
interface TokenRow extends ApiToken { player_id: number; hash: string }

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { GameError } from './game.js';

const derive = promisify(scrypt) as (password: string, salt: string, length: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const day = 86_400_000;
const tokenPrefix = 'sk_';
const validToken = new RegExp(`^${tokenPrefix}[A-Za-z0-9_-]{43}$`);
const validName = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_]{3,32}$/.test(value);
const validPassword = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const publicUser = (row: AccountRow | undefined): User | null => row ? { id: row.player_id, username: row.username, nickname: row.nickname, created: row.created } : null;

export class Accounts {
  game: Game; db: Game['db']; now: () => number;
  attempts: Map<string, { count: number; until: number }>; hashing: number;
  constructor(game: Game) {
    this.game = game; this.db = game.db; this.now = game.now;
    this.attempts = new Map(); this.hashing = 0;
  }
  throttle(key: string, limit: number, window: number) {
    const now = this.now();
    if (this.attempts.size >= 1000) for (const [k, value] of this.attempts) if (value.until <= now) this.attempts.delete(k);
    const previous = this.attempts.get(key);
    if ((previous && previous.until > now && previous.count >= limit) || this.attempts.size >= 10_000)
      throw new GameError('시도가 너무 많아요. 잠시 후 다시 시도해 주세요.', 429);
    this.attempts.set(key, previous && previous.until > now ? { ...previous, count: previous.count + 1 } : { count: 1, until: now + window });
  }
  async passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
    // Bound memory and work even when many distinct accounts attempt to log in.
    if (this.hashing >= 2) throw new GameError('로그인 요청이 많아요. 잠시 후 다시 시도해 주세요.', 429);
    this.hashing++;
    try {
      const result = await derive(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
      return `scrypt-32768-8-3$${salt}$${result.toString('hex')}`;
    } finally { this.hashing--; }
  }
  async user(playerId: number) { return publicUser(await this.db.prepare('SELECT * FROM accounts WHERE player_id=?').get(playerId) as unknown as AccountRow | undefined); }
  async signup(data: Record<string, unknown>, address: string) {
    this.throttle(`signup:${address}`, 10, 60 * 60_000);
    if (!validName(data.username)) throw new GameError('아이디는 영문·숫자·밑줄 3~32자로 입력해 주세요.');
    if (!validPassword(data.password)) throw new GameError('비밀번호는 12~128자로 입력해 주세요.');
    if (typeof data.nickname !== 'string' || !data.nickname.trim() || data.nickname.trim().length > 20 || /[\x00-\x1f\x7f]/.test(data.nickname))
      throw new GameError('닉네임은 1~20자로 입력해 주세요.');
    const username = data.username.toLowerCase(), nickname = data.nickname.trim();
    const password = await this.passwordHash(data.password);
    return await this.game.transaction(async () => {
      if (await this.db.prepare('SELECT 1 FROM accounts WHERE username=?').get(username)) throw new GameError('이미 사용 중인 아이디예요.', 409);
      const game = await this.game.createPlayer(`${nickname}의 작업실`);
      await this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(game.playerId, username, nickname, password, this.now());
      return { user: await this.user(game.playerId), session: await this.newSession(game.playerId) };
    });
  }
  async login(data: Record<string, unknown>, address: string) {
    this.throttle(`login:${address}`, 30, 5 * 60_000);
    if (!validName(data.username) || !validPassword(data.password)) throw new GameError('아이디 또는 비밀번호를 확인해 주세요.', 401);
    const username = data.username.toLowerCase();
    this.throttle(`user:${username}`, 10, 5 * 60_000);
    const account = await this.db.prepare('SELECT * FROM accounts WHERE username=?').get(username) as unknown as AccountRow | undefined;
    const salt = account?.password.split('$')[1] || '00000000000000000000000000000000';
    const candidate = await this.passwordHash(data.password, salt);
    if (!account || !timingSafeEqual(Buffer.from(hash(candidate)), Buffer.from(hash(account.password))))
      throw new GameError('아이디 또는 비밀번호를 확인해 주세요.', 401);
    this.attempts.delete(`user:${username}`);
    return { user: publicUser(account), session: await this.newSession(account.player_id) };
  }
  async newSession(playerId: number) {
    return this.game.forPlayer(playerId).transaction(async () => {
      const value = randomBytes(32).toString('hex'), now = this.now();
      await this.db.prepare('DELETE FROM sessions WHERE player_id=? AND expires<=?').run(playerId, now);
      await this.db.prepare(`DELETE FROM sessions WHERE player_id=? AND hash NOT IN
        (SELECT hash FROM (SELECT hash FROM sessions WHERE player_id=? ORDER BY created DESC,hash DESC LIMIT 9) recent)`).run(playerId, playerId);
      await this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(value), playerId, now, now + 30 * day);
      return value;
    });
  }
  async session(value: unknown) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return null;
    const row = await this.db.prepare('SELECT player_id FROM sessions WHERE hash=? AND expires>?').get(hash(value), this.now()) as { player_id: number } | undefined;
    return row ? { playerId: row.player_id, browser: true, user: await this.user(row.player_id) } : null;
  }
  async logout(value: unknown) { if (typeof value === 'string') await this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(value)); }
  async token(value: unknown) {
    if (typeof value !== 'string' || !validToken.test(value)) return null;
    const row = await this.db.prepare('SELECT * FROM api_tokens WHERE hash=? AND expires>?').get(hash(value), this.now()) as unknown as TokenRow | undefined;
    if (!row) return null;
    if (!row.last_used || this.now() - row.last_used > 60_000)
      await this.db.prepare('UPDATE api_tokens SET last_used=? WHERE id=?').run(this.now(), row.id);
    return { playerId: row.player_id, browser: false, user: await this.user(row.player_id) };
  }
  async listTokens(playerId: number): Promise<ApiToken[]> {
    return await this.db.prepare('SELECT id,label,prefix,created,expires,last_used FROM api_tokens WHERE player_id=? ORDER BY created DESC,id DESC').all(playerId) as unknown as ApiToken[];
  }
  createToken(playerId: number, { label = 'CLI 연결', days = 90 }: { label?: unknown; days?: unknown }) {
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 40 || /[\x00-\x1f\x7f]/.test(label))
      throw new GameError('토큰 이름은 1~40자로 입력해 주세요.');
    if (typeof days !== 'number' || ![30, 90, 365].includes(days)) throw new GameError('유효 기간은 30일, 90일 또는 365일로 선택해 주세요.');
    const token = `${tokenPrefix}${randomBytes(32).toString('base64url')}`, id = randomUUID();
    return this.game.forPlayer(playerId).transaction(async () => {
      await this.db.prepare('DELETE FROM api_tokens WHERE player_id=?').run(playerId);
      await this.db.prepare('INSERT INTO api_tokens VALUES(?,?,?,?,?,?,?,NULL)')
        .run(id, playerId, label.trim(), token.slice(0, tokenPrefix.length + 6), hash(token), this.now(), this.now() + days * day);
      return { token, ...(await this.listTokens(playerId))[0] };
    });
  }
  async revokeToken(playerId: number, id: string) {
    if (!(await this.db.prepare('DELETE FROM api_tokens WHERE player_id=? AND id=?').run(playerId, id)).changes)
      throw new GameError('토큰을 찾을 수 없어요.', 404);
  }
}
