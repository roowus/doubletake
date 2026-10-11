import { ulid } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { items } from '../src/db/schema.pg.js';

// Minimal Postgres integration test for the hosted-mode pg path. Skipped unless
// DATABASE_URL_TEST points at a disposable Postgres database.
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('pg schema (hosted mode)', () => {
  let opened: OpenedPgDb;

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
  });

  afterAll(async () => {
    opened?.close();
  });

  it('creates the schema and round-trips an item row', async () => {
    const now = new Date().toISOString();
    const id = ulid();
    await opened.db.insert(items).values({
      id,
      platform: 'web',
      channel: 'web',
      focus: 'whole',
      modeRequested: 'auto',
      status: 'new',
      createdAt: now,
      updatedAt: now,
    });
    const row = await opened.db.query.items.findFirst({ where: (t, { eq }) => eq(t.id, id) });
    expect(row).toBeDefined();
    expect(row?.platform).toBe('web');
    expect(row?.status).toBe('new');
  });
});
