import type { Configuration, UsageRecord } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { usageRecord, Collector } from '../dist/src/collector.js';
import { uploadUsage } from '../dist/src/remote.js';
import { Game } from '../dist/src/game.js';

const since = Date.parse('2026-10-08T00:00:00Z');
const timestamp = '2026-10-08T03:00:00Z';
const claude = (output = 100) => ({ type: 'assistant', timestamp, message: { id: 'message-1', content: [{ type: 'text', text: 'private code must not leave the machine' }], usage: { input_tokens: 100, output_tokens: output, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens_details: { thinking_tokens: 90 }, iterations: [{ input_tokens: 999999 }] } } });
const meta = { type: 'session_meta', payload: { id: 'codex-session' } };
const codex = { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 900, cache_write_input_tokens: 50, output_tokens: 100, reasoning_output_tokens: 80, total_tokens: 1100 } } } };

test('Claude counts cache input once, dedupes by message ID and excludes content', () => {
  const r = usageRecord('claude', claude(), {}, since)!;
  assert.equal(r.input, 600); assert.equal(r.output, 100); assert.equal(r.baseline, false);
  assert.equal(r.key, usageRecord('claude', { ...claude(), uuid: 'other-block' }, {}, since)!.key);
  assert.ok(!JSON.stringify(r).includes('private code'));
  assert.equal(usageRecord('claude', { ...claude(), timestamp: 'bad' }, {}, since)!.baseline, true);
  assert.equal(usageRecord('claude', { ...claude(), message: { id: 'huge', usage: { input_tokens: 1e12, output_tokens: 0, cache_read_input_tokens: 1 } } }, {}, since), null,
    'a total the server would reject never blocks a batch');
});
test('Codex cumulative totals already include cache and reasoning tokens', () => {
  const context = {}; assert.equal(usageRecord('codex', codex, context, since), null);
  usageRecord('codex', meta, context, since);
  const r = usageRecord('codex', codex, context, since)!;
  assert.equal(r.input, 1000); assert.equal(r.output, 100);
  assert.equal(usageRecord('codex', { type: 'event_msg', payload: { type: 'token_count', info: null } }, context, since), null);
});
test('streaming partial lines, retries, restarts, copied transcripts and truncation never double reward', async t => {
  const root = mkdtempSync(join(tmpdir(), 'tokenpet-collector-')); const g = await Game.open(':memory:');
  t.after(async () => { await g.close(); rmSync(root, { recursive: true, force: true }); });
  const file = join(root, 'session.jsonl');
  const full = JSON.stringify(claude(400000));
  writeFileSync(file, full.slice(0, 70));
  let reject = false;
  const options = { roots: { claude: [root] }, since, send: async (rows: UsageRecord[]) => { if (reject) throw new Error('offline'); return await g.ingest(rows); } };
  const c = new Collector(options);
  await c.scan(); assert.equal((await g.player())!.tokens, 0);
  appendFileSync(file, full.slice(70) + '\n');
  reject = true; assert.equal((await c.scan()).errors, 1); assert.equal((await g.player())!.tokens, 0);
  reject = false; await c.scan(); assert.equal((await g.player())!.tokens, 400600);
  await c.scan(); assert.equal((await g.player())!.tokens, 400600);
  mkdirSync(join(root, 'subagents')); writeFileSync(join(root, 'subagents', 'copy.jsonl'), full + '\n');
  await new Collector(options).scan(); assert.equal((await g.player())!.tokens, 400600);
  writeFileSync(file, JSON.stringify(claude(800000)) + '\n');
  await c.scan(); assert.equal((await g.player())!.tokens, 800600);
});
test('one request carries many files and merged records credit the same tokens; a failed delivery ends the scan', async t => {
  const root = mkdtempSync(join(tmpdir(), 'tokenpet-batch-')); const g = await Game.open(':memory:');
  t.after(async () => { await g.close(); rmSync(root, { recursive: true, force: true }); });
  const claudeRoot = join(root, 'claude'), codexRoot = join(root, 'codex'), early = '2026-10-07T00:00:00Z';
  mkdirSync(claudeRoot); mkdirSync(codexRoot);
  for (let file = 0; file < 3; file++) {
    // Claude writes a line per content block, so every message appears twice.
    const lines = Array.from({ length: 300 }, (_, index) => JSON.stringify({ type: 'assistant', timestamp, message: { id: `message-${file}-${index}`, usage: { input_tokens: 10, output_tokens: 5 } } }));
    writeFileSync(join(claudeRoot, `session-${file}.jsonl`), lines.flatMap(line => [line, line]).join('\n') + '\n');
  }
  for (let file = 0; file < 30; file++) {
    // Codex repeats the cumulative session total; the first half predates the account and only sets the baseline.
    const events = Array.from({ length: 40 }, (_, index) => JSON.stringify({ type: 'event_msg', timestamp: index < 20 ? early : timestamp,
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: (index + 1) * 1000, output_tokens: (index + 1) * 100 } } } }));
    writeFileSync(join(codexRoot, `rollout-${file}.jsonl`), [JSON.stringify({ type: 'session_meta', payload: { id: `session-${file}` } }), ...events].join('\n') + '\n');
  }
  const sizes: number[] = []; let failures = 1;
  const c = new Collector({ roots: { claude: [claudeRoot], codex: [codexRoot] }, since, send: async (rows: UsageRecord[]) => {
    sizes.push(rows.length); if (failures-- > 0) throw new Error('rate limited'); return await g.ingest(rows);
  } });
  assert.equal((await c.scan()).errors, 1); assert.deepEqual(sizes, [500], 'a failed delivery stops the scan');
  assert.equal(c.cursors.size, 0, 'undelivered files are read again'); assert.equal((await g.player())!.tokens, 0);
  // 1,800 Claude lines → 900 messages; 1,200 Codex events → one baseline and one counted record per session.
  await c.scan(); assert.deepEqual(sizes, [500, 500, 460]);
  assert.equal((await g.player())!.tokens, 900 * 15 + 30 * (44_000 - 22_000));
  await c.scan(); assert.equal(sizes.length, 3, 'unchanged files are not sent again');
  rmSync(join(codexRoot, 'rollout-0.jsonl')); await c.scan(); assert.equal(c.cursors.size, 32, 'deleted transcripts are forgotten');
});
test('one process per computer uploads and new sessions continue from the saved cursors', async t => {
  const root = mkdtempSync(join(tmpdir(), 'tokenpet-upload-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const transcripts = join(root, 'claude'); mkdirSync(transcripts);
  writeFileSync(join(transcripts, 'session.jsonl'), JSON.stringify(claude()) + '\n');
  const config = { dataDir: join(root, 'data'), baseUrl: 'https://pets.example.test' } as Configuration; // partial config on purpose
  const lock = join(config.dataDir, 'usage-sync.lock');
  let sent = 0;
  const session = () => new Collector({ roots: { claude: [transcripts] }, since, send: async () => { sent++; } });
  mkdirSync(config.dataDir); writeFileSync(lock, String(process.pid));
  assert.equal(await uploadUsage(config, session(), 7), null, 'another live process is uploading');
  writeFileSync(lock, String(spawnSync(process.execPath, ['-e', '']).pid));
  assert.equal((await uploadUsage(config, session(), 7))!.files, 1);
  assert.equal(sent, 1, 'a lock left by an exited process is taken over'); assert.ok(!existsSync(lock));
  await uploadUsage(config, session(), 7); assert.equal(sent, 1, 'a new session does not resend the history');
  await uploadUsage(config, session(), 8); assert.equal(sent, 2, 'cursors belong to one member on one server');
});
