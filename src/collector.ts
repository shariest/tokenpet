import type { Cli, UsageRecord, CollectorStatus } from './types.js';

interface TranscriptUsage { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown }
interface Transcript { timestamp?: string; type?: unknown; payload?: { id?: unknown; session_id?: unknown; type?: unknown; info?: { total_token_usage?: TranscriptUsage } }; message?: { id?: unknown; usage?: TranscriptUsage } }
interface Context { session?: unknown }
interface Cursor { offset: number; context: Context; skipping: boolean; size?: number; mtime?: number; ino?: number }

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const tokens = (n: unknown): n is number => Number.isSafeInteger(n) && typeof n === 'number' && n >= 0 && n <= 1e12;

// ponytail: CLI transcript formats are internal; keep these adapters covered when upgrading either CLI.
export function usageRecord(source: Cli, value: unknown, context: Context, since: number): UsageRecord | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Transcript;
  const timestamp = Date.parse(row.timestamp || '');
  const baseline = !Number.isFinite(timestamp) || timestamp < since;
  if (source === 'codex') {
    if (row.type === 'session_meta') context.session = row.payload?.id || row.payload?.session_id;
    const usage = row.type === 'event_msg' && row.payload?.type === 'token_count' && row.payload.info?.total_token_usage;
    if (!usage || typeof context.session !== 'string') return null;
    if (!tokens(usage.input_tokens) || !tokens(usage.output_tokens)) return null;
    // Codex input includes cached input; output includes reasoning output.
    return { source, key: hash(`codex:${context.session}`), input: usage.input_tokens, output: usage.output_tokens, baseline };
  }
  if (source === 'claude' && row.type === 'assistant') {
    const { id, usage } = row.message || {};
    if (typeof id !== 'string' || !id || !usage) return null;
    const values = [usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0];
    if (!values.every(tokens)) return null;
    // The server rejects a whole request over one invalid total, so drop it here.
    const input = values[0] + values[2] + values[3];
    if (!tokens(input)) return null;
    return { source, key: hash(`claude:${id}`), input, output: values[1], baseline };
  }
  return null;
}

async function* files(root: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
  }
}

// Game.ingest accepts at most 500 records per request.
const batchLimit = 500;

export class Collector {
  roots: Partial<Record<Cli, string[]>>; since: number; send: (records: UsageRecord[]) => unknown;
  cursors: Map<string, Cursor>; running: boolean; status: CollectorStatus;
  constructor({ roots, since, send }: { roots: Partial<Record<Cli, string[]>>; since: number; send: (records: UsageRecord[]) => unknown }) {
    this.roots = roots; this.since = since; this.send = send;
    this.cursors = new Map(); this.running = false;
    this.status = { scanning: false, files: 0, errors: 0, lastScan: null };
  }
  // Reads the complete lines added since the saved cursor. The caller saves the returned cursor once the records are delivered.
  async read(path: string, source: Cli) {
    const info = await stat(path);
    const old = this.cursors.get(path);
    if (old && old.size === info.size && old.mtime === info.mtimeMs) return;
    const cursor = old && info.ino === old.ino && info.size >= old.size! && !(info.size === old.size && info.mtimeMs !== old.mtime)
      ? { ...old, context: { ...old.context } } : { offset: 0, context: {}, skipping: false };
    const records: UsageRecord[] = [];
    let pending = Buffer.alloc(0);
    if (info.size > cursor.offset) {
      const stream = createReadStream(path, { start: cursor.offset, end: info.size - 1, highWaterMark: 64 * 1024 });
      for await (const chunk of stream) {
        pending = Buffer.concat([pending, chunk]);
        let end;
        while ((end = pending.indexOf(10)) !== -1) {
          const line = pending.subarray(0, end);
          pending = pending.subarray(end + 1); cursor.offset += end + 1;
          if (!cursor.skipping) {
            let row;
            try { row = JSON.parse(line.toString('utf8')); } catch { continue; }
            const record = usageRecord(source, row, cursor.context, this.since);
            if (record) records.push(record);
          }
          cursor.skipping = false;
        }
        if (pending.length > 8 * 1024 * 1024 || cursor.skipping) {
          cursor.skipping = true; cursor.offset += pending.length; pending = Buffer.alloc(0);
        }
      }
    }
    // A partial final JSON line is reread next time.
    return { records, cursor: { ...cursor, size: info.size, mtime: info.mtimeMs, ino: info.ino } };
  }
  async scan(only?: string) {
    if (this.running) return this.status;
    this.running = true; this.status.scanning = true;
    let count = 0, errors = 0;
    const paths: [Cli, string][] = [];
    // One request carries up to 500 records from many files; a file's cursor advances only after its records are delivered.
    let batch: UsageRecord[] = [], indexes = new Map<string, number>(), finished = new Map<string, Cursor>();
    const deliver = async () => {
      if (batch.length) await this.send(batch);
      for (const [path, cursor] of finished) this.cursors.set(path, cursor);
      batch = []; indexes = new Map(); finished = new Map();
    };
    try {
      for (const [source, roots] of Object.entries(this.roots)) {
        if (only && only !== source) continue;
        for (const root of roots) {
          try { for await (const path of files(root)) paths.push([source as Cli, path]); } catch { errors++; }
        }
      }
      for (const [source, path] of paths) {
        let read;
        try { read = await this.read(path, source); count++; } catch { errors++; continue; }
        if (!read) continue;
        for (const record of read.records) {
          const id = `${record.source}:${record.key}`, index = indexes.get(id);
          // The server keeps each key's largest totals, so records of one key on the same side of the baseline
          // merge into one with the same credit. Codex repeats its cumulative session total in every event.
          if (index !== undefined && batch[index].baseline === record.baseline) {
            batch[index].input = Math.max(batch[index].input, record.input);
            batch[index].output = Math.max(batch[index].output, record.output);
            continue;
          }
          if (batch.length >= batchLimit) await deliver();
          indexes.set(id, batch.push(record) - 1);
        }
        if (read.records.length) finished.set(path, read.cursor); else this.cursors.set(path, read.cursor);
      }
      await deliver();
      // Forget deleted transcripts so saved cursors do not grow forever.
      if (!only && !errors) {
        const listed = new Set(paths.map(([, path]) => path));
        for (const path of this.cursors.keys()) if (!listed.has(path)) this.cursors.delete(path);
      }
    } catch {
      // A failed delivery (rate limit, offline, revoked key) ends the scan; undelivered files are read again next time.
      errors++;
    } finally {
      this.running = false;
      this.status = { scanning: false, files: count, errors, lastScan: Date.now() };
    }
    return this.status;
  }
}
