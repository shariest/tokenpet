import type { Configuration, GameState, CareAction, UsageRecord, StateResult } from './types.js';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Game, GameError } from './game.js';
import { Accounts } from './accounts.js';
import { catalog, rankings } from './community.js';
import { credential, configuration } from './config.js';
import { Collector } from './collector.js';
import { repairLaunchers } from './cli-install.js';
import { installCodexPet } from './codex-pet.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const safeEqual = (a: string | undefined, b: string) => timingSafeEqual(createHash('sha256').update(a || '').digest(), createHash('sha256').update(b).digest());
const staticFiles: Partial<Record<string, [string, string]>> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'], '/pet-art.js': ['pet-art.js', 'text/javascript'] };

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new GameError('JSON 요청이 필요해요.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new GameError('요청이 너무 커요.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new GameError('올바른 JSON 객체를 보내 주세요.'); }
}

export async function startServer(config: Configuration, { game: suppliedGame, port = config.port, onShutdown }: { game?: Game; port?: number; onShutdown?: () => void } = {}) {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  let token!: string, game!: Game, accounts!: Accounts, collector!: Collector;
  const local = ['127.0.0.1', '::1', 'localhost'].includes(config.host) && !config.publicUrl;
  let origins: string[] = [], timer: ReturnType<typeof setInterval> | undefined, launcherTimer: ReturnType<typeof setInterval> | undefined;
  const refreshPet = async (state?: GameState) => {
    if (!local || !config.codexPetDir) return;
    try {
      if (configuration({ TOKENPET_DATA_DIR: config.dataDir }).remote) return;
      const manifest = JSON.parse(readFileSync(join(config.codexPetDir, 'pet.json'), 'utf8'));
      if (manifest.id === 'tokenpet') installCodexPet(state || await game.state(), config.codexPetDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`TokenPet 펫 이미지 갱신: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const setCookie = (value: string, age = 2592000) => res.setHeader('Set-Cookie', `tokenpet_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.publicUrl?.startsWith('https:') ? '; Secure' : ''}`);
    try {
      const host = req.headers.host, method = req.method || 'GET';
      if (!origins.some(origin => new URL(origin).host === host)) throw new GameError('허용되지 않은 호스트예요.', 403);
      const url = new URL(req.url || '/', origins[0]), path = url.pathname;
      // Only opt in when one trusted proxy is the backend's sole public entry point.
      const forwardedHeader = req.headers['x-forwarded-for'];
      const forwarded = config.trustProxy && typeof forwardedHeader === 'string' ? forwardedHeader.split(',').at(-1)?.trim() : null;
      const address = forwarded && isIP(forwarded) ? forwarded : req.socket.remoteAddress || 'unknown';
      const session = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('tokenpet_session='))?.slice('tokenpet_session='.length);
      const mutation = !['GET', 'HEAD'].includes(method);
      if (mutation && ((req.headers.origin && !origins.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site')) throw new GameError('다른 사이트의 요청은 허용하지 않아요.', 403);
      if (path === '/api/health' && method === 'GET') {
        try { await game.db.prepare('SELECT 1').get(); return json(200, { ok: true }); }
        catch { return json(503, { ok: false }); }
      }
      if (local && (['/api/signup', '/api/login', '/api/rankings', '/api/tokens'].includes(path) || path.startsWith('/api/tokens/')))
        throw new GameError('회원 기능은 서버 모드에서만 사용할 수 있어요.', 404);
      if (['/api/signup', '/api/login'].includes(path) && method === 'POST') {
        const data = await body(req);
        const result = await accounts[path === '/api/signup' ? 'signup' : 'login'](data, address);
        await accounts.logout(session); setCookie(result.session);
        return json(path === '/api/signup' ? 201 : 200, { user: result.user });
      }
      if (path === '/api/session' && method === 'POST') {
        const data = await body(req);
        if (!local) {
          accounts.throttle(`legacy:${address}`, 10, 60_000);
          if (!safeEqual(typeof data.key === 'string' ? data.key : '', token)) {
            throw new GameError('게임 서버 접근 키가 필요해요.', 401);
          }
        }
        await accounts.logout(session); setCookie((await accounts.newSession(1))); return json(200, { ok: true });
      }
      if (path === '/api/session' && method === 'DELETE') {
        await accounts.logout(session); setCookie('', 0); return json(200, { ok: true });
      }
      const shared = /^\/api\/share\/([a-f0-9-]{36})$/.exec(path);
      if (shared && method === 'GET') {
        const owner = await game.db.prepare('SELECT id FROM player WHERE share=?').get(shared[1]) as { id: number } | undefined;
        if (!owner) throw new GameError('공유 중인 도감이 없어요.', 404);
        return json(200, (await game.forPlayer(owner.id).collection(shared[1])));
      }
      if (path.startsWith('/api/')) {
        const key = req.headers['x-api-key'];
        if (key && typeof key !== 'string') throw new GameError('인증 방법은 하나만 사용해 주세요.');
        if (key && session) throw new GameError('인증 방법은 하나만 사용해 주세요.', 400);
        const auth = key ? (safeEqual(key, token) ? { playerId: 1, browser: false, user: null } : await accounts.token(key)) : await accounts.session(session);
        if (key && !auth) throw new GameError('접근 키가 만료되었거나 올바르지 않아요.', 401);
        const memberGame = auth ? game.forPlayer(auth.playerId) : null;
        if (path === '/api/me' && method === 'GET') return json(200, { user: auth?.user || null, authenticated: !!auth, local });
        if (path === '/api/catalog' && method === 'GET') return json(200, (await catalog(memberGame, url.searchParams)));
        if (path === '/api/rankings' && method === 'GET') return json(200, (await rankings(game, url.searchParams, auth?.playerId)));
        if (!auth || !memberGame) throw new GameError('로그인하거나 CLI 접근 키를 확인해 주세요.', 401);
        // Background usage sync has its own budget, so uploads never use up a member's own actions.
        if (auth.user && mutation) accounts.throttle(`${path === '/api/usage' ? 'usage' : 'mutation'}:${auth.playerId}`, 120, 60_000);
        if (path === '/api/tokens' || path.startsWith('/api/tokens/')) {
          if (!auth.browser || !auth.user) throw new GameError('회원으로 웹에 로그인한 뒤 토큰을 관리해 주세요.', 403);
          if (path === '/api/tokens' && method === 'GET') return json(200, { tokens: await accounts.listTokens(auth.playerId) });
          if (path === '/api/tokens' && method === 'POST') return json(201, (await accounts.createToken(auth.playerId, await body(req))));
          const match = /^\/api\/tokens\/([a-f0-9-]{36})$/.exec(path);
          if (match && method === 'DELETE') { await accounts.revokeToken(auth.playerId, match[1]); return json(200, { ok: true }); }
          throw new GameError('경로를 찾을 수 없어요.', 404);
        }
        if (path === '/api/state' && method === 'GET') {
          const state = await memberGame.state(); if (auth.playerId === 1) await refreshPet(state);
          return json(200, { ...state, collector: auth.playerId === 1 ? { ...collector.status, enabled: config.watch } : { enabled: false, files: 0, errors: 0, scanning: false } });
        }
        if (path === '/api/shutdown' && method === 'POST') {
          // Lets `tokenpet uninstall` stop a personal server; browser sessions and member servers cannot.
          if (!local || auth.browser) throw new GameError('경로를 찾을 수 없어요.', 404);
          // A standalone server reports its process so the CLI can wait until every file is released.
          json(202, { ok: true, ...(onShutdown ? { pid: process.pid } : {}) });
          setImmediate(() => void close().finally(onShutdown)); if (onShutdown) setTimeout(onShutdown, 5000).unref();
          return;
        }
        if (method !== 'POST') throw new GameError('경로를 찾을 수 없어요.', 404);
        const data = await body(req);
        if (path === '/api/gacha' && auth.user && typeof data.count === 'number' && data.count > 1000)
          throw new GameError('회원 서버에서는 한 번에 1,000회까지 뽑을 수 있어요. 한 번도 뽑지 않았어요.');
        if (path === '/api/usage') return json(200, (await memberGame.ingest(data.records as UsageRecord[])));
        const actions: Record<string, () => Promise<StateResult>> = {
          '/api/checkin': () => memberGame.checkin(),
          '/api/care': () => memberGame.care(data.action as CareAction), '/api/gacha': () => memberGame.pull(data.count as number),
          '/api/equip': () => memberGame.equip(data.id as string), '/api/profile': () => memberGame.rename(data.name as string),
          '/api/share': () => memberGame.share(data.enabled as boolean),
        };
        if (!Object.hasOwn(actions, path)) throw new GameError('경로를 찾을 수 없어요.', 404);
        const fingerprint = createHash('sha256').update(path + JSON.stringify(data)).digest('hex');
        const result = await memberGame.once(req.headers['idempotency-key'], fingerprint, actions[path]);
        if (auth.playerId === 1) await refreshPet(result.state);
        return json(200, result);
      }
      if (!['GET', 'HEAD'].includes(method)) throw new GameError('지원하지 않는 메서드예요.', 405);
      const asset = /^\/share\/[a-f0-9-]{36}$/.test(path) ? staticFiles['/'] : staticFiles[path];
      if (!asset) throw new GameError('페이지를 찾을 수 없어요.', 404);
      const content = await readFile(join(publicDir, asset[0]));
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(error instanceof GameError ? error.status : 500, { error: error instanceof GameError ? error.message : '서버에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
      else res.end();
      if (!(error instanceof GameError)) console.error('TokenPet request failed:', error instanceof Error ? (error as NodeJS.ErrnoException).code || error.name : 'UnknownError');
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, config.host, resolve); });
  // Bind first: concurrent CLI startups must not initialize the same database twice.
  try {
    token = credential(config, true);
    game = suppliedGame || await Game.open(join(config.dataDir, 'game.sqlite'), { database: config.database });
    if (!suppliedGame && !config.database) chmodSync(join(config.dataDir, 'game.sqlite'), 0o600);
    accounts = new Accounts(game);
    collector = new Collector({ roots: config.roots, since: (await game.player())!.created, send: records => game.ingest(records) });
  } catch (error) { server.close(); if (!suppliedGame) await game?.close(); throw error; }
  const actualPort = (server.address() as AddressInfo).port;
  origins = config.publicUrl ? [config.publicUrl] : [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`, `http://[::1]:${actualPort}`];
  if (config.watch) {
    void collector.scan();
    timer = setInterval(() => { void collector.scan(); }, 10_000); timer.unref();
  }
  const repair = async () => {
    try { repairLaunchers(config); } catch (error) { console.error(`TokenPet 자동 연결 복구: ${error instanceof Error ? error.message : String(error)}`); }
    await refreshPet();
  };
  let repairing = Promise.resolve();
  if (local) { await repair(); launcherTimer = setInterval(() => { repairing = repairing.then(repair); }, 10_000); launcherTimer.unref(); }
  let closing: Promise<void> | undefined;
  // Idempotent: a shutdown request and the caller may both close the server.
  const close = () => closing ??= (async () => {
    clearInterval(timer); clearInterval(launcherTimer);
    await repairing;
    await new Promise<void>(resolve => server.close(() => resolve()));
    while (collector.running) await new Promise(resolve => setTimeout(resolve, 10));
    if (!suppliedGame) await game.close();
  })();
  return { server, game, accounts, collector, url: origins[0], close };
}
