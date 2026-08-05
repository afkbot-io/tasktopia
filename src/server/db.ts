import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";

export type Row = Record<string, unknown>;
export type RunResult = { changes: number; rows: Row[] };

export type Statement = {
  all<T extends Row = Row>(...parameters: unknown[]): Promise<T[]>;
  get<T extends Row = Row>(...parameters: unknown[]): Promise<T | undefined>;
  run(...parameters: unknown[]): Promise<RunResult>;
};

export type Db = {
  prepare(query: string): Statement;
  exec(query: string): Promise<void>;
  close(): Promise<void>;
  transaction<T>(callback: () => Promise<T> | T): Promise<T>;
};

type DbOptions = {
  maxConnections?: number;
  schema?: string;
  migrate?: boolean;
  onClose?: () => Promise<void>;
};

type QueryExecutor = Sql | TransactionSql;
type TransactionContext = { executor: QueryExecutor; afterCommit: Array<() => void>; afterRollback: Array<() => void> };
const transactionContext = new AsyncLocalStorage<TransactionContext>();

export function onTransactionCommit(callback: () => void): void {
  const context = transactionContext.getStore();
  if (context) context.afterCommit.push(callback);
  else callback();
}

export function onTransactionRollback(callback: () => void): void {
  transactionContext.getStore()?.afterRollback.push(callback);
}

function positionalQuery(query: string): string {
  let index = 0;
  return query.replace(/\?(\d+)?/g, (_match, explicit: string | undefined) => `$${explicit ?? ++index}`);
}

function jsonParameter(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
    try { return JSON.parse(value) as unknown; }
    catch { return value; }
  }
  return value;
}

class PostgresDb implements Db {
  constructor(private readonly pool: Sql, private readonly onClose?: () => Promise<void>) {}

  private executor(): QueryExecutor {
    return transactionContext.getStore()?.executor ?? this.pool;
  }

  prepare(query: string): Statement {
    const sqlText = positionalQuery(query);
    const execute = async (parameters: unknown[]) => {
      return this.executor().unsafe(sqlText, parameters.map(jsonParameter) as never[]);
    };
    return {
      all: async <T extends Row>(...parameters: unknown[]) => [...await execute(parameters)] as unknown as T[],
      get: async <T extends Row>(...parameters: unknown[]) => (await execute(parameters))[0] as unknown as T | undefined,
      run: async (...parameters: unknown[]) => {
        const result = await execute(parameters);
        return { changes: result.count, rows: [...result] as Row[] };
      },
    };
  }

  async exec(query: string): Promise<void> {
    await this.executor().unsafe(query, [], { prepare: false });
  }

  async transaction<T>(callback: () => Promise<T> | T): Promise<T> {
    // Domain services compose transactional operations (for example account +
    // country + first city onboarding). Reuse the active connection instead of
    // opening an unrelated nested transaction that could commit partially.
    if (transactionContext.getStore()) return await callback();
    const context: TransactionContext = { executor: this.pool, afterCommit: [], afterRollback: [] };
    let result: T;
    try {
      result = await this.pool.begin(async (sql) => {
        context.executor = sql;
        return transactionContext.run(context, callback);
      }) as T;
    } catch (error) {
      for (const afterRollback of context.afterRollback) afterRollback();
      throw error;
    }
    for (const afterCommit of context.afterCommit) afterCommit();
    return result;
  }

  async close(): Promise<void> {
    await this.pool.end({ timeout: 5 });
    await this.onClose?.();
  }
}

async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await transaction(db, async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get("tasktopia-schema-migrations");
    const directory = join(process.cwd(), "migrations/postgres");
    const names = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of names) {
      const source = await readFile(join(directory, name), "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const applied = await db.prepare("SELECT checksum FROM schema_migrations WHERE name = ?").get<{ checksum: string }>(name);
      if (applied) {
        if (applied.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      await db.exec(source);
      await db.prepare("INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)").run(name, checksum);
    }
  });
}

export async function createDb(databaseUrl: string, options: DbOptions = {}): Promise<Db> {
  const url = new URL(databaseUrl);
  if (options.schema) url.searchParams.set("options", `-csearch_path=${options.schema}`);
  const pool = postgres(url.toString(), {
    max: options.maxConnections ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    prepare: true,
    onnotice: () => undefined,
    transform: { value: { from: (value) => value instanceof Date ? value.toISOString() : value } },
  });
  const db = new PostgresDb(pool, options.onClose);
  try {
    await db.prepare("SELECT 1").get();
    if (options.migrate !== false) await migrate(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function createTestDb(databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test"): Promise<Db> {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  await admin.end();
  return createDb(databaseUrl, {
    schema,
    maxConnections: 2,
    onClose: async () => {
      const cleanup = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
      try { await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await cleanup.end(); }
    },
  });
}

export function transaction<T>(db: Db, callback: () => Promise<T> | T): Promise<T> {
  return db.transaction(callback);
}

export function now(): string {
  return new Date().toISOString();
}
