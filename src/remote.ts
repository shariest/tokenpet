import type { CollectorStatus, Configuration } from './types.js';

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Collector } from './collector.js';
import { request } from './client.js';

// An uploader refreshes its lock every 10 seconds; a lock left this long belongs to a stopped or hung process.
const lockTimeout = 60_000;

function isProcessAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function claimLock(path: string) {
  try { writeFileSync(path, String(process.pid), { mode: 0o600, flag: 'wx' }); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
}

function acquireLock(path: string) {
  if (claimLock(path)) return true;
  try {
    const holder = Number(readFileSync(path, 'utf8')), age = Date.now() - statSync(path).mtimeMs;
    // An empty lock is still being written by its new holder.
    if (age < lockTimeout && (!holder || isProcessAlive(holder))) return false;
  } catch { return false; }
  rmSync(path, { force: true });
  return claimLock(path);
}

function releaseLock(path: string) {
  // Leave a lock that another process took over after this one looked stale.
  try { if (readFileSync(path, 'utf8') === String(process.pid)) rmSync(path, { force: true }); } catch { /* already gone */ }
}

function loadCursors(path: string, scope: string): Collector['cursors'] {
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (saved.scope === scope) return new Map(Object.entries(saved.cursors));
  } catch { /* Missing or unreadable cursors only resend records; the server ignores duplicates. */ }
  return new Map();
}

function saveCursors(path: string, contents: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } catch { /* The next uploader resends from the last saved cursors. */ }
  finally { rmSync(temporary, { force: true }); }
}

// Every Claude/Codex session runs its own MCP process, and `tokenpet sync` may run beside them. Only one process on
// this computer uploads at a time, continuing from the cursors the previous uploader saved, so the history is sent once.
// Returns null when another process is uploading.
export async function uploadUsage(config: Configuration, collector: Collector, playerId: number, only?: string): Promise<CollectorStatus | null> {
  const lockPath = join(config.dataDir, 'usage-sync.lock'), cursorPath = join(config.dataDir, 'usage-sync.json');
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  if (!acquireLock(lockPath)) return null;
  const heartbeat = setInterval(() => {
    try { utimesSync(lockPath, new Date(), new Date()); } catch { /* lock removed; this upload still finishes */ }
  }, 10_000);
  heartbeat.unref();
  try {
    // Cursors describe what this server already has for this member.
    const scope = `${config.baseUrl} ${playerId}`;
    collector.cursors = loadCursors(cursorPath, scope);
    const snapshot = () => JSON.stringify({ scope, cursors: Object.fromEntries(collector.cursors) });
    const before = snapshot();
    const status = await collector.scan(only);
    const after = snapshot();
    if (after !== before) saveCursors(cursorPath, after);
    return status;
  } finally {
    clearInterval(heartbeat);
    releaseLock(lockPath);
  }
}

export function startRemoteSync(config: Configuration) {
  if (!config.remote) return null;
  let collector: Collector | undefined, stopped = false, running = false;
  const scan = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const state = await request('/api/state', undefined, { config });
      if (stopped || !config.watch) return;
      collector ||= new Collector({ roots: config.roots, since: state.player.created,
        send: records => request('/api/usage', { records }, { config }) });
      await uploadUsage(config, collector, state.player.id);
    } catch (error) { console.error(`TokenPet 사용량 연결: ${error instanceof Error ? error.message : String(error)}`); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void scan(); }, 10000); timer.unref();
  void scan();
  return { scan, get status() { return collector?.status; }, stop() { stopped = true; clearInterval(timer); } };
}
