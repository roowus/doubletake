import { defineConfig } from 'drizzle-kit';

/** Postgres (hosted-mode) DDL generator: `pnpm --filter @doubletake/server exec drizzle-kit generate --config drizzle.config.pg.ts`. Output: ./drizzle-pg. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.pg.ts',
  out: './drizzle-pg',
});
