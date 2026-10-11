import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as pgSchema from './schema.pg.js';

export type PgDb = ReturnType<typeof drizzle<typeof pgSchema.pgSchema>>;

/** Same OpenedDb-ish shape as `openDb` in ./index.ts, minus the raw sqlite handle. */
export interface OpenedPgDb {
  db: PgDb;
  sql: postgres.Sql;
  close(): void;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, '../../drizzle-pg');

/**
 * Open a Postgres database for the future hosted multi-tenant mode. Not wired into the
 * server yet; the SQLite path in ./index.ts remains the default. Uses the postgres-js
 * driver and applies the generated DDL in `drizzle-pg/` via drizzle's pg migrator
 * (idempotent: applied migrations are tracked in the `drizzle.__drizzle_migrations`
 * table). Async (unlike the sync `openDb`) because the pg migrator is async.
 *
 * Postgres full-text search is out of scope — see the TODO in ./schema.pg.ts.
 */
export async function openPgDb(
  connectionString: string,
  options?: { max?: number },
): Promise<OpenedPgDb> {
  const sql = postgres(connectionString, {
    max: options?.max ?? 1,
    // Prepared-statement names can collide across pooled clients during migration; keep it simple.
    prepare: false,
  });
  const db = drizzle(sql, { schema: pgSchema.pgSchema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
