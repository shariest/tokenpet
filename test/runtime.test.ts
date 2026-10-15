import type { AddressInfo } from 'node:net';
import type { Configuration } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureServer } from '../dist/src/runtime.js';
import { startServer } from '../dist/src/server.js';
import { request } from '../dist/src/client.js';

async function stop(pids: Set<number>) {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  for (let i = 0; i < 100; i++) {
    const alive = [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!alive.length) return;
    await delay(50);
  }
  throw new Error('Test server did not stop');
}

test('simultaneous CLI startups share one server and reuse its database after restart', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tokenpet-autostart-'));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(dataDir, 'codex');
  t.after(() => { if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome; });
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise(resolve => reservation.close(resolve));
  const config = { dataDir, port, host: '127.0.0.1', baseUrl: `http://127.0.0.1:${port}`, watch: false, roots: {}, publicUrl: null } as Configuration;
  const pids = new Set<number>();
  t.after(async () => { await stop(pids); rmSync(dataDir, { recursive: true, force: true }); });
  const start = async () => { const pid = await ensureServer(config); if (pid) pids.add(pid); };
  await Promise.all([start(), start(), start()]);
  const before = await request('/api/state', undefined, { config });
  assert.equal(before.player.coins, 300); assert.equal(before.pets.length, 1);
  assert.equal(await ensureServer(config), undefined);
  const drawn = (await request('/api/gacha', { count: 1 }, { config })).state;
  await stop(pids); pids.clear();
  await start();
  const after = await request('/api/state', undefined, { config });
  assert.equal(after.player.coins, 200); assert.equal(after.player.pulls, 1);
  assert.equal(after.player.created, before.player.created);
  assert.equal(after.player.equipped, before.player.equipped, 'server restarts must preserve the random first pet');
  assert.deepEqual(after.pets.map(p => [p.id, p.copies, p.xp]), drawn.pets.map(p => [p.id, p.copies, p.xp]));
  assert.equal(after.activity.filter(a => a.kind === 'welcome').length, 1, 'concurrent startups must grant only one welcome gift');
});

test('a busy port cannot initialize another game or credential', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tokenpet-bind-'));
  const existing = createServer((req, res) => { res.writeHead(503); res.end(); });
  await new Promise<void>(resolve => existing.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => existing.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const config = { dataDir, host: '127.0.0.1', port: (existing.address() as AddressInfo).port, watch: false, roots: {} } as Configuration;
  await assert.rejects(startServer(config), { code: 'EADDRINUSE' });
  assert.ok(!existsSync(join(dataDir, 'api-key')));
  assert.ok(!existsSync(join(dataDir, 'game.sqlite')));
  await assert.rejects(ensureServer({ ...config, baseUrl: `http://127.0.0.1:${config.port}`, publicUrl: 'https://example.test' }), /연결/);
  assert.ok(!existsSync(join(dataDir, 'server.log')));
});
