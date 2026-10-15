import type { Configuration, SavedConnection, DatabaseConfiguration } from './types.js';

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { privateWindowsDirectory } from './windows.js';

function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') privateWindowsDirectory(path);
  else chmodSync(path, 0o700);
}

export function endpoint(value: unknown) {
  let text = String(value).trim();
  if (!text || /[\s\\]/.test(text)) throw new Error('서버 도메인 또는 IP 주소를 입력해 주세요.');
  if (isIP(text) === 6) text = `[${text}]`;
  if (!text.includes('://')) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch { throw new Error('올바른 서버 주소가 아니에요. 예: pets.example.com 또는 192.0.2.10:443'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['/', '/api', '/api/'].includes(url.pathname))
    throw new Error('서버 주소에는 도메인/IP와 포트만 입력해 주세요. API 경로는 자동으로 붙습니다.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote TOKENPET_SERVER requires HTTPS');
  return url.origin;
}

function connection(dataDir: string): SavedConnection {
  try { return JSON.parse(readFileSync(join(dataDir, 'connection.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('연결 설정을 읽지 못했어요. tokenpet connect로 다시 설정해 주세요.'); }
}

export function saveConnection(dataDir: string, value: SavedConnection) {
  privateDirectory(dataDir);
  const path = join(dataDir, 'connection.json'), temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export function databaseConfiguration(env = process.env): DatabaseConfiguration | undefined {
  if (env.TOKENPET_DATABASE_URL && env.TOKENPET_DATABASE_URL_FILE) throw new Error('Set only one of TOKENPET_DATABASE_URL and TOKENPET_DATABASE_URL_FILE');
  let value = env.TOKENPET_DATABASE_URL;
  if (env.TOKENPET_DATABASE_URL_FILE) {
    try { value = readFileSync(env.TOKENPET_DATABASE_URL_FILE, 'utf8').trim(); }
    catch { throw new Error('Cannot read TOKENPET_DATABASE_URL_FILE'); }
    if (!value) throw new Error('TOKENPET_DATABASE_URL_FILE is empty');
  }
  if (!value) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('TOKENPET_DATABASE_URL must be a PostgreSQL or MariaDB connection URL'); }
  if (!['postgres:', 'postgresql:', 'mariadb:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash)
    throw new Error('TOKENPET_DATABASE_URL must be postgres://user:password@host:5432/database or mariadb://user:password@host:3306/database');
  if (url.protocol === 'mariadb:' && [...url.searchParams].some(([key, value]) => key !== 'ssl' || !['true', 'false'].includes(value)))
    throw new Error('MariaDB URL supports only ?ssl=true or ?ssl=false; use TOKENPET_DB_* for pool settings');
  const namespace = env.TOKENPET_DB_NAMESPACE || 'tokenpet';
  if (!/^[a-z_][a-z0-9_]{0,31}$/.test(namespace) || namespace.startsWith('pg_') || ['public', 'information_schema'].includes(namespace))
    throw new Error('TOKENPET_DB_NAMESPACE must be a dedicated namespace (lowercase letters, digits, underscores; max 32 characters)');
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name] || String(fallback);
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be ${min}–${max}`);
    return n;
  };
  const max = integer('TOKENPET_DB_POOL_MAX', 30, 1, 1000);
  return { driver: url.protocol === 'mariadb:' ? 'mariadb' : 'postgres', url: value, namespace, max, min: integer('TOKENPET_DB_POOL_MIN', Math.min(5, max), 0, max),
    connectionTimeoutMillis: integer('TOKENPET_DB_CONNECT_TIMEOUT_MS', 10000, 1, 300000),
    idleTimeoutMillis: integer('TOKENPET_DB_IDLE_TIMEOUT_MS', 30000, 1000, 3600000) };
}

export function configuration(env = process.env, { server = false } = {}): Configuration {
  const dataDir = resolve(env.TOKENPET_DATA_DIR || join(homedir(), '.tokenpet'));
  const saved = server ? {} : connection(dataDir);
  const port = Number(env.TOKENPET_PORT || 4780);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TOKENPET_PORT must be 1–65535');
  const host = env.TOKENPET_HOST || '127.0.0.1';
  const remote = !server && Boolean(env.TOKENPET_SERVER || saved.server);
  const baseUrl = endpoint((!server && env.TOKENPET_SERVER) || saved.server || `http://127.0.0.1:${port}`);
  const publicUrl = env.TOKENPET_PUBLIC_URL ? endpoint(env.TOKENPET_PUBLIC_URL) : null;
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !publicUrl) throw new Error('Remote hosting requires HTTPS TOKENPET_PUBLIC_URL and a reverse proxy');
  if (env.TOKENPET_TRUST_PROXY && !['0', '1'].includes(env.TOKENPET_TRUST_PROXY)) throw new Error('TOKENPET_TRUST_PROXY must be 0 or 1');
  const token = env.TOKENPET_API_KEY || (env.TOKENPET_API_KEY_FILE ? readFileSync(env.TOKENPET_API_KEY_FILE, 'utf8').trim() : undefined) ||
    (remote && saved.server && endpoint(saved.server) === baseUrl ? saved.key : undefined);
  return { dataDir, port, host, baseUrl, publicUrl, remote, token, database: databaseConfiguration(env), trustProxy: env.TOKENPET_TRUST_PROXY === '1',
    codexPetDir: join(env.CODEX_HOME || join(homedir(), '.codex'), 'pets', 'tokenpet'),
    watch: env.TOKENPET_WATCH !== '0',
    roots: { claude: [join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')],
      codex: [join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'), join(env.CODEX_HOME || join(homedir(), '.codex'), 'archived_sessions')] } };
}
export function credential(config: Configuration, create = false) {
  if (config.token) {
    if (config.token.length < 32) throw new Error('TOKENPET_API_KEY must contain at least 32 characters');
    return config.token;
  }
  if (config.remote) throw new Error('서버 접근 키가 없어요. tokenpet connect로 연결해 주세요.');
  const path = join(config.dataDir, 'api-key');
  if (create) {
    privateDirectory(config.dataDir);
    try { writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const token = readFileSync(path, 'utf8').trim();
  if (token.length < 32) throw new Error('Invalid game credential');
  return token;
}
