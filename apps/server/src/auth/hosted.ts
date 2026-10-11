import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { PgDb } from '../db/pg.js';
import { costLedger, credentials, oauthStates, sessions, users } from '../db/schema.pg.js';
import { SecretBox } from '../secrets/box.js';

/** `kind` for `sessions` rows (ADR 0032). */
export type SessionKind = 'browser' | 'device' | 'mcp';

export interface HostedUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  emailVerified: boolean;
  disabled: boolean;
}

export interface HostedSession {
  id: string;
  userId: string;
  kind: SessionKind;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  kind: SessionKind;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_SWEEP_MS = 60 * 60_000;

/** postgres unique-violation (23505), thrown on the registerEmail race path. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

/**
 * Hosted multi-tenant accounts + sessions + BYOK vault (ADR 0032). Mirrors the self-hosted
 * `Auth` (tokens are random, stored sha256-hashed, sent as `Authorization: Bearer`), but every
 * row is scoped to a `users` row and lives in Postgres. Only enabled when `DOUBLETAKE_HOSTED=1`;
 * the SQLite path never touches any of this.
 */
/** What the run loop needs from a credential — never the plaintext key itself. */
export interface RunCredential {
  id: string;
  monthlyCapUsd: number | null;
  perRunCapUsd: number | null;
  /** SecretBox envelope; open only via HostedAuth.openKey straight into the adapter env. */
  sealedKey: string;
  /** Adapter env for an opened key (kind-appropriate variable names, base_url for harness). */
  envFor(plaintextKey: string): Record<string, string>;
}

function credentialEnv(kind: string, key: string, meta: string | null): Record<string, string> {
  let baseUrl: string | null = null;
  if (meta) {
    try {
      baseUrl = (JSON.parse(meta) as { base_url?: string }).base_url ?? null;
    } catch {
      baseUrl = null;
    }
  }
  if (kind === 'openrouter') return { OPENROUTER_API_KEY: key };
  if (kind === 'harness')
    return {
      ANTHROPIC_API_KEY: key,
      ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
    };
  return { ANTHROPIC_API_KEY: key };
}

export class HostedAuth {
  constructor(
    private readonly db: PgDb,
    /** Injected so tests can pass an in-memory box; prod builds it from DOUBLETAKE_MASTER_KEY_FILE. */
    private readonly box: SecretBox,
  ) {}

  // ---- accounts ----

  async registerEmail(email: string, password: string): Promise<HostedUser> {
    const norm = normalizeEmail(email);
    if (!EMAIL_RE.test(norm)) throw new HostedAuthError('invalid email address');
    if (password.length < 8) throw new HostedAuthError('password must be at least 8 characters');
    const existing = await this.findUserByEmail(norm);
    if (existing) throw new HostedAuthError('email already registered');
    const row = {
      id: ulid(),
      email: norm,
      passwordHash: await argonHash(password),
      createdAt: new Date().toISOString(),
    };
    try {
      await this.db.insert(users).values(row);
    } catch (e) {
      // Two concurrent registers race past the check above; the unique constraint is the arbiter.
      if (isUniqueViolation(e)) throw new HostedAuthError('email already registered');
      throw e;
    }
    return toUser({
      id: row.id,
      email: row.email,
      displayName: null,
      createdAt: row.createdAt,
      emailVerifiedAt: null,
      disabledAt: null,
    });
  }

  async loginEmail(email: string, password: string): Promise<HostedUser | null> {
    const norm = normalizeEmail(email);
    const row = await this.db.query.users.findFirst({ where: (t, { eq }) => eq(t.email, norm) });
    if (!row?.passwordHash || row.disabledAt) return null;
    let ok = false;
    try {
      ok = await argonVerify(row.passwordHash, password);
    } catch {
      ok = false;
    }
    return ok ? toUser(row) : null;
  }

  // ---- sessions ----

  /** The raw token is returned once and never stored; only its sha256 is. */
  async createSession(
    userId: string,
    kind: SessionKind = 'browser',
    label?: string,
  ): Promise<{ token: string; sessionId: string }> {
    const token = `dth_${randomBytes(32).toString('base64url')}`;
    const id = ulid();
    await this.db.insert(sessions).values({
      id,
      userId,
      tokenHash: hashToken(token),
      kind,
      label: label ?? null,
      createdAt: new Date().toISOString(),
    });
    return { token, sessionId: id };
  }

  async authenticate(bearer: string | undefined): Promise<AuthContext | null> {
    if (!bearer?.startsWith('dth_')) return null;
    const row = await this.db.query.sessions.findFirst({
      where: (t, { eq }) => eq(t.tokenHash, hashToken(bearer)),
    });
    if (!row || row.revokedAt) return null;
    const now = new Date().toISOString();
    await this.db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, row.id));
    return { userId: row.userId, sessionId: row.id, kind: row.kind as SessionKind };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async listSessions(userId: string): Promise<HostedSession[]> {
    const rows = await this.db.query.sessions.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      kind: r.kind as SessionKind,
      label: r.label,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      revokedAt: r.revokedAt,
    }));
  }

  // ---- BYOK vault ----

  /** Seal key material with the master-key box; the plaintext never leaves this call. */
  async sealCredential(plaintextKey: string): Promise<string> {
    return this.box.seal(plaintextKey);
  }

  async openCredential(sealedKey: string): Promise<string> {
    return this.box.open(sealedKey);
  }

  async insertCredential(input: {
    userId: string;
    kind: string;
    key: string;
    provider?: string | null;
    label?: string | null;
    baseUrl?: string | null;
    monthlyCapUsd?: number | null;
    perRunCapUsd?: number | null;
  }): Promise<string> {
    const id = ulid();
    await this.db.insert(credentials).values({
      id,
      userId: input.userId,
      kind: input.kind,
      provider: input.provider ?? null,
      label: input.label ?? null,
      sealedKey: await this.sealCredential(input.key),
      meta: input.baseUrl ? JSON.stringify({ base_url: input.baseUrl }) : null,
      monthlyCapUsd: input.monthlyCapUsd ?? null,
      perRunCapUsd: input.perRunCapUsd ?? null,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  /** Soft-revoke and wipe the sealed material (ADR 0032: no key material outlives a revocation). */
  async revokeCredential(userId: string, credentialId: string): Promise<boolean> {
    const res = await this.db
      .update(credentials)
      .set({ revokedAt: new Date().toISOString(), sealedKey: '' })
      .where(and(eq(credentials.id, credentialId), eq(credentials.userId, userId)))
      .returning({ id: credentials.id });
    return res.length > 0;
  }

  /** Credential rows safe to return over the API: never `sealed_key` or any key material. */
  async listCredentials(userId: string) {
    const rows = await this.db.query.credentials.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
    return rows.map((r) => {
      let baseUrl: string | null = null;
      if (r.meta) {
        try {
          baseUrl = (JSON.parse(r.meta) as { base_url?: string }).base_url ?? null;
        } catch {
          baseUrl = null;
        }
      }
      return {
        id: r.id,
        kind: r.kind,
        provider: r.provider,
        label: r.label,
        baseUrl,
        monthlyCapUsd: r.monthlyCapUsd,
        perRunCapUsd: r.perRunCapUsd,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * The credential a hosted run executes on (ADR 0032): the user's most recent active
   * credential, else null. (There is no default flag yet — "default" means the only active
   * credential; revisit when multi-credential selection lands.)
   */
  async resolveRunCredential(userId: string): Promise<RunCredential | null> {
    const row = await this.db.query.credentials.findFirst({
      where: (t, { and, eq, isNull, ne }) =>
        and(eq(t.userId, userId), isNull(t.revokedAt), ne(t.sealedKey, '')),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
    if (!row) return null;
    return {
      id: row.id,
      monthlyCapUsd: row.monthlyCapUsd,
      perRunCapUsd: row.perRunCapUsd,
      sealedKey: row.sealedKey,
      envFor: (plaintextKey: string) => credentialEnv(row.kind, plaintextKey, row.meta),
    };
  }

  /** Month-to-date spend for one user from cost_ledger (monthly cap enforcement). */
  async monthSpend(userId: string): Promise<number> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const rows = await this.db
      .select({ total: costLedger.costUsd })
      .from(costLedger)
      .where(
        and(eq(costLedger.userId, userId), gte(costLedger.createdAt, monthStart.toISOString())),
      );
    return rows.reduce((a, r) => a + r.total, 0);
  }

  /** Open sealed key material; the plaintext is meant only for the adapter env. */
  openKey(sealedKey: string): string {
    return this.box.open(sealedKey);
  }

  async getCredential(credentialId: string, userId: string) {
    return (
      (await this.db.query.credentials.findFirst({
        where: (t, { and, eq }) => and(eq(t.id, credentialId), eq(t.userId, userId)),
      })) ?? null
    );
  }

  // ---- oauth flow state (Google / OpenRouter PKCE; flows land in a follow-up) ----

  async createOauthState(
    purpose: string,
    opts?: { userId?: string; returnTo?: string; codeVerifier?: string },
  ) {
    const state = randomBytes(32).toString('base64url');
    await this.db.insert(oauthStates).values({
      state,
      purpose,
      userId: opts?.userId ?? null,
      returnTo: opts?.returnTo ?? null,
      codeVerifier: opts?.codeVerifier ?? null,
      createdAt: new Date().toISOString(),
    });
    return state;
  }

  async consumeOauthState(state: string) {
    const row = await this.db.query.oauthStates.findFirst({
      where: (t, { eq }) => eq(t.state, state),
    });
    if (!row) return null;
    await this.db.delete(oauthStates).where(eq(oauthStates.state, state));
    // Flow states are single-use and short-lived: a stale state is as good as no state.
    if (Date.now() - Date.parse(row.createdAt) > OAUTH_STATE_TTL_MS) return null;
    // Keep the table from accumulating abandoned flows.
    await this.db
      .delete(oauthStates)
      .where(lt(oauthStates.createdAt, new Date(Date.now() - OAUTH_STATE_SWEEP_MS).toISOString()));
    return row;
  }

  /**
   * Google sign-in upsert (ADR 0032): login an existing `google_sub`, else link the Google
   * identity onto an existing email account, else create the user. `email_verified_at` is set
   * from Google's `email_verified` claim; disabled accounts never sign in.
   */
  async resolveGoogleUser(claims: {
    sub: string;
    email: string;
    emailVerified: boolean;
  }): Promise<HostedUser> {
    const email = normalizeEmail(claims.email);
    const bySub = await this.db.query.users.findFirst({
      where: (t, { eq }) => eq(t.googleSub, claims.sub),
    });
    if (bySub) {
      if (bySub.disabledAt) throw new HostedAuthError('account disabled');
      return toUser(bySub);
    }
    const byEmail = await this.findUserByEmail(email);
    if (byEmail) {
      if (byEmail.disabledAt) throw new HostedAuthError('account disabled');
      const updated = await this.db
        .update(users)
        .set({
          googleSub: claims.sub,
          emailVerifiedAt:
            byEmail.emailVerifiedAt ?? (claims.emailVerified ? new Date().toISOString() : null),
        })
        .where(eq(users.id, byEmail.id))
        .returning();
      return toUser(updated[0] ?? byEmail);
    }
    const id = ulid();
    const created = {
      id,
      email,
      googleSub: claims.sub,
      emailVerifiedAt: claims.emailVerified ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.db.insert(users).values({
        ...created,
        passwordHash: null,
        displayName: null,
      });
    } catch (e) {
      // A concurrent Google sign-in or email register created the address first.
      if (isUniqueViolation(e)) throw new HostedAuthError('email already registered');
      throw e;
    }
    return toUser({ ...created, displayName: null, disabledAt: null });
  }

  private findUserByEmail(email: string) {
    return this.db.query.users.findFirst({ where: (t, { eq }) => eq(t.email, email) });
  }
}

export class HostedAuthError extends Error {}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toUser(row: {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
  disabledAt: string | null;
}): HostedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
    emailVerified: row.emailVerifiedAt !== null,
    disabled: row.disabledAt !== null,
  };
}

export function userDto(row: HostedUser) {
  return { id: row.id, email: row.email, displayName: row.displayName, createdAt: row.createdAt };
}

/**
 * Build the hosted stack from the environment: `DOUBLETAKE_HOSTED=1`, `DOUBLETAKE_DATABASE_URL`
 * and a 32-byte keyfile at `DOUBLETAKE_MASTER_KEY_FILE`. Returns null (and the API routes are
 * not registered) unless hosted mode is on and fully configured.
 */
export async function createHostedAuthFromEnv(
  openDb: (url: string) => Promise<{ db: PgDb; close: () => void }>,
): Promise<{ hosted: HostedAuth; close: () => void } | null> {
  if (process.env.DOUBLETAKE_HOSTED !== '1') return null;
  const url = process.env.DOUBLETAKE_DATABASE_URL;
  const keyFile = process.env.DOUBLETAKE_MASTER_KEY_FILE;
  if (!url || !keyFile)
    throw new HostedAuthError(
      'hosted mode requires DOUBLETAKE_DATABASE_URL and DOUBLETAKE_MASTER_KEY_FILE',
    );
  const box = SecretBox.fromKey(fs.readFileSync(keyFile));
  const opened = await openDb(url);
  return { hosted: new HostedAuth(opened.db, box), close: () => opened.close() };
}
