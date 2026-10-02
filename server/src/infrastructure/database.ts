import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { runtimeConfig } from './runtimeConfig.js';
import { databasePoolWaitingClients } from './observability.js';

let pool: Pool | null = null;

export function databaseConfigured(): boolean {
  return Boolean(runtimeConfig.databaseUrl);
}

export function getDatabasePool(): Pool {
  if (!runtimeConfig.databaseUrl) throw new Error('DATABASE_URL is not configured');
  if (!pool) {
    pool = new Pool({
      connectionString: runtimeConfig.databaseUrl,
      max: Number(process.env.DB_POOL_MAX ?? 20),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
      ssl: process.env.DB_SSL === 'require' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== '0' } : undefined,
      application_name: process.env.DB_APPLICATION_NAME ?? 'wager-arena-api',
    });
    pool.on('error', (error) => console.error(JSON.stringify({ level: 'error', event: 'database.pool.error', message: error.message })));
  }
  return pool;
}

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    const database = getDatabasePool();
    await database.query('SELECT 1');
    databasePoolWaitingClients.set(database.waitingCount);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : 'database check failed' };
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
  return getDatabasePool().query<T>(text, values);
}

export async function withDatabaseTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDatabasePool().connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Runs versioned SQL migrations under a PostgreSQL advisory lock. A deploy can safely
 * run this command from more than one release/worker without applying a migration twice. */
export async function runMigrations(): Promise<void> {
  await withDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wager-arena-schema-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
    const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const version = file.split('_', 1)[0]!;
      const existing = await client.query<{ version: string }>('SELECT version FROM schema_migrations WHERE version = $1', [version]);
      if (existing.rowCount) continue;
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    }
  });
}

export async function closeDatabase(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
