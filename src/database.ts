import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import type { Pool as PgPool, PoolClient } from 'pg';
import type { Pool as MariaPool, PoolConnection } from 'mariadb';
import type { DatabaseConfiguration } from './types.js';
import { initializeDatabase, initializeExternalDatabase, tables } from './schema.js';

type Row = Record<string, SQLOutputValue>;
type Connection = DatabaseSync | PoolClient | PoolConnection;
const errorCode = (error: unknown) => error instanceof Error ? (error as NodeJS.ErrnoException).code || error.name : 'UnknownError';

export class Database {
  readonly driver: 'sqlite' | 'postgres' | 'mariadb';
  private sqlite?: DatabaseSync;
  private postgres?: PgPool;
  private maria?: MariaPool;
  private context = new AsyncLocalStorage<Connection>();
  private queue = Promise.resolve();
  private constructor(private config?: DatabaseConfiguration) { this.driver = config?.driver || 'sqlite'; }

  static async open(path: string, config?: DatabaseConfiguration) {
    const db = new Database(config);
    try {
      if (!config) {
        db.sqlite = new DatabaseSync(path);
        initializeDatabase(db.sqlite);
      } else if (config.driver === 'postgres') {
        const { Pool, types } = await import('pg');
        db.postgres = new Pool({ connectionString: config.url, max: config.max, min: config.min,
          connectionTimeoutMillis: config.connectionTimeoutMillis, idleTimeoutMillis: config.idleTimeoutMillis,
          types: { getTypeParser: oid => [20, 1700].includes(oid) ? (value: string) => {
            const n = Number(value);
            if (!Number.isSafeInteger(n)) throw new RangeError('Database integer exceeds the safe number range');
            return n;
          } : types.getTypeParser(oid) } });
        db.postgres.on('error', error => console.error('TokenPet database pool:', errorCode(error)));
      } else {
        const { createPool } = await import('mariadb');
        const url = new URL(config.url);
        db.maria = createPool({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 3306),
          user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
          ssl: url.searchParams.get('ssl') === 'true', connectionLimit: config.max, minimumIdle: config.min,
          acquireTimeout: config.connectionTimeoutMillis, connectTimeout: config.connectionTimeoutMillis,
          idleTimeout: Math.ceil(config.idleTimeoutMillis / 1000),
          bigIntAsNumber: true, insertIdAsNumber: true, decimalAsNumber: true, checkNumberRange: true,
          initSql: 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED' });
        (db.maria as unknown as EventEmitter).on('error', error => console.error('TokenPet database pool:', errorCode(error)));
      }
      if (config) await db.initialize();
      return db;
    } catch (error) {
      await db.close();
      if (config) throw new Error(`${config.driver} database connection or initialization failed (${errorCode(error)}). Check TOKENPET_DATABASE_URL and database permissions.`);
      throw error;
    }
  }

  // Only internal SQL is translated; quoted values and bound parameters stay untouched.
  private sql(sql: string) {
    let parameter = 0;
    return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\b[a-zA-Z_][a-zA-Z_0-9]*\b|\?/g, token => {
      if (token.startsWith("'")) return token;
      if (token === '?') return this.driver === 'postgres' ? `$${++parameter}` : token;
      if (token === 'key' || token.startsWith('"')) return this.driver === 'mariadb' ? `\`${token.replaceAll('"', '')}\`` : token === 'key' ? '"key"' : token;
      if (this.config && Object.hasOwn(tables, token)) return this.driver === 'postgres'
        ? `"${this.config.namespace}"."${token}"` : `\`${this.config.namespace}_${token}\``;
      return token;
    });
  }

  private async exclusive<T>(fn: () => Promise<T>) {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }

  private async connection<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
    const current = this.context.getStore();
    if (current) return fn(current);
    if (this.sqlite) return this.exclusive(() => fn(this.sqlite!));
    const client = this.postgres ? await this.postgres.connect() : await this.maria!.getConnection();
    try { return await fn(client); } finally { await client.release(); }
  }

  private async query(sql: string, values: SQLInputValue[] = [], mode: 'all' | 'run' | 'exec' = 'all') {
    return this.connection(async client => {
      const query = this.sql(sql);
      if (client instanceof DatabaseSync) {
        if (mode === 'exec') { client.exec(query); return { rows: [] as Row[], changes: 0 }; }
        if (mode === 'run') return { rows: [] as Row[], changes: Number(client.prepare(query).run(...values).changes) };
        return { rows: client.prepare(query).all(...values), changes: 0 };
      }
      if (this.driver === 'postgres') {
        const result = await (client as PoolClient).query(query, values);
        return { rows: result.rows as Row[], changes: result.rowCount || 0 };
      }
      const result = await (client as PoolConnection).query(query, values);
      return { rows: (Array.isArray(result) ? result : []) as Row[], changes: Number(result.affectedRows || 0) };
    });
  }

  prepare(sql: string) {
    return {
      get: async (...values: SQLInputValue[]) => (await this.query(sql, values)).rows[0] as Row | undefined,
      all: async (...values: SQLInputValue[]) => (await this.query(sql, values)).rows,
      run: async (...values: SQLInputValue[]) => ({ changes: (await this.query(sql, values, 'run')).changes }),
    };
  }
  async exec(sql: string) { await this.query(sql, [], 'exec'); }
  upsert(columns: string, assignments: string) {
    return this.driver === 'mariadb'
      ? `ON DUPLICATE KEY UPDATE ${assignments.replace(/excluded\.(\w+)/g, 'VALUES($1)')}`
      : `ON CONFLICT(${columns}) DO UPDATE SET ${assignments}`;
  }
  private lockName() { return createHash('sha256').update(new URL(this.config!.url).pathname + ':' + this.config!.namespace).digest('hex'); }
  private async initializationLock() {
    if (this.driver === 'postgres') await this.prepare('SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext(?))').get(this.config!.namespace);
    if (this.driver === 'mariadb') {
      const result = await this.prepare('SELECT GET_LOCK(?,?) AS acquired').get(this.lockName(), this.config!.connectionTimeoutMillis / 1000);
      if (result?.acquired !== 1) throw new Error('Database initialization lock timed out');
    }
  }
  private async unlockInitialization() {
    if (this.driver === 'mariadb') await this.prepare('SELECT RELEASE_LOCK(?)').get(this.lockName());
  }

  private async initialize() {
    if (this.driver === 'postgres') {
      await this.transaction(async () => {
        // A pre-created schema lets operators withhold database-wide CREATE permission.
        if (!await this.prepare('SELECT 1 FROM pg_namespace WHERE nspname=?').get(this.config!.namespace))
          await this.exec(`CREATE SCHEMA "${this.config!.namespace}"`);
        await initializeExternalDatabase(this);
      });
    } else {
      // MariaDB DDL commits implicitly; serialize its restart-safe CREATE statements separately.
      await this.connection(client => this.context.run(client, async () => {
        await this.initializationLock();
        try { await initializeExternalDatabase(this); } finally { await this.unlockInitialization(); }
      }));
    }
  }

  async transaction<T>(fn: () => T | Promise<T>, playerId?: number): Promise<T> {
    if (this.context.getStore()) return fn();
    return this.connection(client => this.context.run(client, async () => {
      await this.exec(this.driver === 'sqlite' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        if (playerId === undefined) await this.initializationLock();
        else if (this.driver !== 'sqlite') await this.prepare('SELECT id FROM player WHERE id=? FOR UPDATE').get(playerId);
        const result = await fn();
        await this.exec('COMMIT');
        return result;
      } catch (error) {
        try { await this.exec('ROLLBACK'); } catch { /* Preserve the original transaction failure. */ }
        throw error;
      } finally { if (playerId === undefined) await this.unlockInitialization(); }
    }));
  }

  async close() {
    await this.queue;
    this.sqlite?.close();
    await this.postgres?.end();
    await this.maria?.end();
  }
}
