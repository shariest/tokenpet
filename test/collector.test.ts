import type { UsageRecord } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { usageRecord, Collector } from '../dist/src/collector.js';
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
