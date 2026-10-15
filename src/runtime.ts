import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration } from './config.js';

export async function ensureServer(config = configuration()) {
  const ready = async () => {
    try {
      const r = await fetch(`${config.baseUrl}/api/health`, { signal: AbortSignal.timeout(config.remote ? 8000 : 500), redirect: 'error' });
      return r.ok && (await r.json()).ok === true;
    } catch { return false; }
  };
  if (await ready()) return;
  const url = new URL(config.baseUrl);
  if (config.remote || url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== config.port || config.publicUrl)
    throw new Error('설정한 게임 서버에 연결할 수 없어요.');
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const log = openSync(join(config.dataDir, 'server.log'), 'a', 0o600);
  let launchError: Error | undefined, pid: number | undefined;
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/tokenpet.mjs', import.meta.url)), 'server'], {
      detached: true, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...process.env, TOKENPET_DATA_DIR: config.dataDir, TOKENPET_PORT: String(config.port), TOKENPET_HOST: config.host, TOKENPET_WATCH: config.watch ? '1' : '0' },
    });
    child.on('error', error => { launchError = error; }); child.unref(); pid = child.pid;
  } finally { closeSync(log); }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await delay(100);
    if (launchError) throw launchError;
    if (await ready()) return pid;
  }
  throw new Error(`게임 서버를 시작하지 못했어요. ${join(config.dataDir, 'server.log')}를 확인해 주세요.`);
}
