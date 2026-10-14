/**
 * Instagram shadow-account channel (docs/channels/instagram-setup.md, ADR 0006, ADR 0018).
 *
 * Two ways in: a DM share (reel/post shared to the shadow account, optional text = note) and a
 * comment @mention (top-level ⇒ focus=comments, reply ⇒ focus=thread:<parent>). The bot never
 * posts publicly; receipt is acknowledged with a `love` reaction on the DM, the answer by push.
 */

import crypto from 'node:crypto';
import {
  type IngestRequest,
  type Mode,
  type Platform,
  resolveRequestedMode,
} from '@doubletake/shared';
import type { Config } from '../../config/index.js';
import type { ItemRow, Repo, TenantCtx } from '../../db/repo.js';
import { detectPlatform, firstUrlIn } from '../../extract/registry.js';
import {
  type AdapterPick,
  type IngestOutcome,
  ingestAsync,
  titleFromText,
  titleFromUrl,
} from '../../ingest/index.js';
import type { ExtractParams } from '../../media/protocol.js';
import { CHANNEL_TOOL } from '../../queue/worker.js';
import type { SecretBox } from '../../secrets/box.js';
import { type IgComment, type IgGraph, IgGraphError, type IgMedia } from './graph.js';

export const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];
export const IG_WEBHOOK_FIELDS = ['messages', 'mentions', 'comments'];
/** Refresh when the token is older than this (Meta allows any time after 24 h). */
const REFRESH_AFTER_MS = 30 * 24 * 3600_000;
const REFRESH_TICK_MS = 6 * 3600_000;
const POLL_TICK_MS = 2 * 60_000;
function isInstagramPage(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'instagram.com' || h.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

/** A text-only DM this soon after a share from the same sender is that share's note. */
export const LATE_NOTE_WINDOW_MS = 2 * 60_000;
/** Re-share window that re-runs on the existing chat instead of forking a new item. */
const DEDUPE_HOURS = 24;

export interface IgLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface IgChannelDeps {
  cfg: Config;
  repo: Repo;
  graph: IgGraph;
  box: SecretBox;
  /** Which adapter a new run is recorded with (`worker.brains.forMode`). */
  adapterFor: AdapterPick;
  log: IgLogger;
  /** Called when a DM changed a chat outside a run, so open pages refresh (worker `chat_updated`). */
  onChatUpdated?: (chatId: string) => void;
  /** Overridable for tests. */
  now?: () => number;
}

/**
 * Hosted-mode hooks (ADR 0032), attached by the server when DOUBLETAKE_HOSTED=1. The channel
 * itself stays single-owner: every hook is null/absent in self-hosted mode and none of the
 * pairing logic runs. `resolveLink` answers whether a DM sender is already paired and to whom;
 * `resolvePairing` consumes a pairing code typed into a DM. Ingest itself threads the user's
 * `TenantCtx` straight through the repo, which stamps it onto items/chats on the pg dialect.
 */
export interface IgHostedHooks {
  /** Active `ig_links` row for a sender (IGSID), or null when unknown/unlinked. */
  resolveLink(senderId: string): Promise<{ userId: string } | null>;
  /** Consume a valid unexpired pairing code for this sender; null when rejected. */
  resolvePairing(
    code: string,
    senderId: string,
    igUsername: string | null,
  ): Promise<{ userId: string } | null>;
}

/** At most one "please connect first" DM per unknown sender per hour (ADR 0032). */
const PROMPT_WINDOW_MS = 60 * 60_000;
/** The exact DM text Meta users expect for "stop messaging me" (case-insensitive). */
const STOP_KEYWORDS = new Set(['STOP', 'UNSUBSCRIBE']);
const PAIRING_ACK = 'Linked to your Doubletake account.';
/** Self-contained, stranger-friendly: says what the bot is, the price, and the exact steps. */
const PAIRING_PROMPT =
  'Save this: connect your account at doubletake.gg → Settings → Instagram, then DM me the code it shows.';
const STOP_REPLY = "Okay — I won't message you again. You can still pair later by DMing a code.";

export interface IgStatus {
  configured: boolean;
  connected: boolean;
  igUserId: string | null;
  username: string | null;
  expiresAt: string | null;
  refreshedAt: string | null;
  webhookPublicHost: string | null;
  mentionPolling: boolean;
  scopes: string[];
  recentEvents: {
    id: string;
    kind: string;
    itemId: string | null;
    receivedAt: string;
    error: string | null;
  }[];
}

/** Result of `verifyAccess()`: what Meta says it granted vs what the channel needs. */
export interface IgAccessReport {
  granted: string[];
  declined: string[];
  missingScopes: string[];
  subscribedFields: string[];
  missingFields: string[];
  resubscribed: boolean;
  /** `GET /<id>/tags` answered: the comments scope works even if the scope listing did not. */
  tagsReadable: boolean;
  /** True when comments and mentions can be read and the webhook covers them. */
  commentsOk: boolean;
  /** Per-probe Graph errors; an empty object means every probe answered. */
  errors: Record<string, string>;
}

export interface WebhookResult {
  /** Events that were new and handled (or failed) — redeliveries are counted in `duplicates`. */
  handled: { id: string; kind: string; itemId: string | null; error: string | null }[];
  duplicates: number;
  ignored: number;
}

/** Signature check over the raw body; constant-time compare. */
export function verifySignature(appSecret: string, rawBody: Buffer, header: string | undefined) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const got = header.slice('sha256='.length).trim().toLowerCase();
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

/** Strip the @handle(s) the user typed to summon the bot; what remains is the note. */
export function noteFromMention(text: string, username: string | null): string {
  let t = text;
  if (username) t = t.replace(new RegExp(`@${escapeRe(username)}\\b`, 'gi'), ' ');
  return t.replace(/\s+/g, ' ').trim();
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- webhook payload shapes (Meta; see the guide for the unverified parts) ----

interface DmAttachment {
  type?: string;
  payload?: { url?: string; title?: string; reel_video_id?: string };
}
interface Messaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: DmAttachment[];
  };
}
interface Change {
  field?: string;
  value?: {
    media_id?: string;
    comment_id?: string;
    id?: string;
    text?: string;
    from?: { id?: string };
  };
}
interface Entry {
  id?: string;
  time?: number;
  messaging?: Messaging[];
  changes?: Change[];
  /** Some deliveries flatten `changes[0]` onto the entry. */
  field?: string;
  value?: Change['value'];
}
export interface WebhookBody {
  object?: string;
  entry?: Entry[];
}

export class InstagramChannel {
  private timers: NodeJS.Timeout[] = [];
  private readonly now: () => number;
  /** Mention ids seen via polling within this process (the DB dedupes across restarts). */
  private polledMedia = new Set<string>();

  constructor(private readonly deps: IgChannelDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Hosted hooks (ADR 0032), attached by api/server.ts when hosted mode is on. Null self-hosted. */
  private hosted: IgHostedHooks | null = null;
  attachHosted(hooks: IgHostedHooks): void {
    this.hosted = hooks;
  }

  get configured(): boolean {
    const { appId, appSecret, verifyToken } = this.deps.cfg.ig;
    return Boolean(appId && appSecret && verifyToken);
  }

  // ---- account / token ----

  /**
   * The stored shadow account, if any. Async because `getIgAccount` is pg-lazy on the hosted
   * dialect (repo.ts dialect contract); on SQLite the value is plain and `await` is a no-op.
   */
  private async account() {
    return await this.deps.repo.getIgAccount();
  }

  /**
   * Decrypted account token. Async for the same reason as `account()`: the underlying repo read
   * is a Promise on pg, and the old sync accessor read `.igUserId`/`.accessTokenEnc` off that
   * Promise — the live "Cannot read properties of undefined (reading 'split')" inside the token
   * refresh path (`box.open(undefined)` blows up in the cipher).
   */
  private async token(): Promise<{ igUserId: string; token: string } | null> {
    const a = await this.account();
    if (!a) return null;
    return { igUserId: a.igUserId, token: this.deps.box.open(a.accessTokenEnc) };
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const u = new URL('https://www.instagram.com/oauth/authorize');
    u.searchParams.set('client_id', this.deps.cfg.ig.appId ?? '');
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', IG_SCOPES.join(','));
    u.searchParams.set('state', state);
    return u.toString();
  }

  /** OAuth callback: code → short token → long-lived token → stored (encrypted) + subscribed. */
  async connect(code: string, redirectUri: string): Promise<IgStatus> {
    const { graph, repo, box, log } = this.deps;
    const short = await graph.exchangeCode(code, redirectUri);
    const long = await graph.exchangeLongLived(short.access_token);
    const me = await graph.me(long.access_token);
    const now = new Date(this.now());
    repo.upsertIgAccount({
      igUserId: me.id,
      username: me.username ?? null,
      accessTokenEnc: box.seal(long.access_token),
      expiresAt: long.expires_in
        ? new Date(now.getTime() + long.expires_in * 1000).toISOString()
        : null,
      refreshedAt: now.toISOString(),
    });
    try {
      await graph.subscribeApp(long.access_token, me.id, IG_WEBHOOK_FIELDS);
    } catch (e) {
      log.warn(`instagram: subscribed_apps failed: ${(e as Error).message}`);
    }
    log.info(`instagram: connected @${me.username ?? me.id}`);
    return await this.status();
  }

  disconnect(): void {
    this.deps.repo.deleteIgAccount();
  }

  /**
   * Hosted boot (ADR 0032): the communal service account's long-lived token arrives from the
   * environment (`IG_ACCESS_TOKEN` + `IG_USER_ID`) instead of an interactive OAuth flow, so the
   * channel can start on an instance that has no `ig_accounts` row yet — Meta's webhook
   * verification must be answered before anyone has connected anything. Writes/refreshes the row
   * (token sealed with the master-key SecretBox) only when it is missing or the token changed, so
   * a restart never needlessly rewrites it. No-op (returns false) when either env var is unset.
   * Must be awaited: the repo's pg reads/writes are async on the hosted dialect.
   */
  async seedAccountFromEnv(): Promise<boolean> {
    const { cfg, repo, box, log } = this.deps;
    const igUserId = cfg.ig.accessTokenUserId;
    const token = cfg.ig.accessToken;
    if (!igUserId || !token) return false;
    const existing = await repo.getIgAccount();
    if (existing?.igUserId === igUserId) {
      // A row sealed under a different key (e.g. the self-hosted data-dir keyfile) must not throw
      // here: fall through and re-seal it with the current box instead.
      try {
        if (box.open(existing.accessTokenEnc) === token) return false;
      } catch {
        /* unreadable with this key — rewrite it below */
      }
    }
    const now = new Date(this.now());
    await repo.upsertIgAccount({
      igUserId,
      username: existing?.igUserId === igUserId ? existing.username : null,
      accessTokenEnc: box.seal(token),
      // The long-lived token's real expiry is unknown from env; the refresh job overwrites it.
      expiresAt: null,
      refreshedAt: now.toISOString(),
    });
    log.info(`instagram: seeded account ${igUserId} from env`);
    return true;
  }

  /**
   * Ask Graph what it actually granted and which webhook fields are live, and re-subscribe when
   * `comments` or `mentions` are missing. This is how the comment channel is checked without
   * waiting for someone to @mention the account.
   */
  async verifyAccess(): Promise<IgAccessReport> {
    const { graph, log } = this.deps;
    const t = await this.token();
    if (!t) throw new Error('Instagram is not connected');
    const { igUserId, token } = t;
    const errors: Record<string, string> = {};
    let granted: string[] = [];
    let declined: string[] = [];
    try {
      const perms = await graph.grantedPermissions(token);
      granted = perms.filter((p) => p.status === 'granted').map((p) => p.permission);
      declined = perms.filter((p) => p.status !== 'granted').map((p) => p.permission);
    } catch (e) {
      errors.permissions = (e as Error).message;
    }
    const missingScopes = errors.permissions ? [] : IG_SCOPES.filter((s) => !granted.includes(s));
    let subscribedFields: string[] = [];
    try {
      subscribedFields = await graph.subscribedFields(token, igUserId);
    } catch (e) {
      errors.subscribedFields = (e as Error).message;
    }
    let missingFields = IG_WEBHOOK_FIELDS.filter((f) => !subscribedFields.includes(f));
    let resubscribed = false;
    if (missingFields.length) {
      try {
        await graph.subscribeApp(token, igUserId, IG_WEBHOOK_FIELDS);
        resubscribed = true;
        subscribedFields = await graph.subscribedFields(token, igUserId);
        missingFields = IG_WEBHOOK_FIELDS.filter((f) => !subscribedFields.includes(f));
      } catch (e) {
        errors.subscribe = (e as Error).message;
        log.warn(`instagram: re-subscribe failed: ${(e as Error).message}`);
      }
    }
    // A comment-mention round trip is the ground truth; `GET /<id>/tags` needs the same scope.
    let tagsReadable = false;
    try {
      await graph.recentTags(token, igUserId);
      tagsReadable = true;
    } catch (e) {
      errors.tags = (e as Error).message;
    }
    const commentsOk =
      (errors.permissions
        ? tagsReadable
        : granted.includes('instagram_business_manage_comments')) &&
      subscribedFields.includes('comments') &&
      subscribedFields.includes('mentions');
    return {
      granted,
      declined,
      missingScopes,
      subscribedFields,
      missingFields,
      resubscribed,
      tagsReadable,
      commentsOk,
      errors,
    };
  }

  /** Refresh the long-lived token when it is ≥30 days old. Returns true when refreshed. */
  async refreshIfDue(): Promise<boolean> {
    const a = await this.account();
    if (!a) return false;
    const last = a.refreshedAt ? Date.parse(a.refreshedAt) : 0;
    if (this.now() - last < REFRESH_AFTER_MS) return false;
    const { graph, box, repo, log } = this.deps;
    try {
      const r = await graph.refresh(box.open(a.accessTokenEnc));
      const now = new Date(this.now());
      repo.updateIgAccount(a.igUserId, {
        accessTokenEnc: box.seal(r.access_token),
        refreshedAt: now.toISOString(),
        expiresAt: r.expires_in
          ? new Date(now.getTime() + r.expires_in * 1000).toISOString()
          : a.expiresAt,
      });
      log.info('instagram: token refreshed');
      return true;
    } catch (e) {
      log.error(`instagram: token refresh failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Channel status for the settings page and the boot log. Async because it reads the account
   * row (`getIgAccount`) and the recent event log (`listIgEvents`), both pg-lazy on the hosted
   * dialect (repo.ts dialect contract); on SQLite `await` is a no-op. The old sync version called
   * `.map` on the Promise `listIgEvents` returns — the live
   * "repo.listIgEvents(...).map is not a function".
   */
  async status(): Promise<IgStatus> {
    const a = await this.account();
    const { cfg, repo } = this.deps;
    const events = await repo.listIgEvents(20);
    return {
      configured: this.configured,
      connected: Boolean(a),
      igUserId: a?.igUserId ?? null,
      username: a?.username ?? null,
      expiresAt: a?.expiresAt ?? null,
      refreshedAt: a?.refreshedAt ?? null,
      webhookPublicHost: cfg.ig.webhookPublicHost,
      mentionPolling: cfg.ig.mentionPolling,
      scopes: IG_SCOPES,
      recentEvents: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        itemId: e.itemId,
        receivedAt: e.receivedAt,
        error: e.error,
      })),
    };
  }

  // ---- background jobs ----

  start(): void {
    this.timers.push(setInterval(() => void this.refreshIfDue(), REFRESH_TICK_MS));
    void this.refreshIfDue();
    if (this.deps.cfg.ig.mentionPolling) {
      this.timers.push(setInterval(() => void this.pollMentions(), POLL_TICK_MS));
    }
    for (const t of this.timers) t.unref();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /**
   * Fallback for the unverified `mentions` webhook: `GET /<ig-user-id>/tags` lists media the
   * account is tagged/mentioned in. Every newly seen media becomes a `comments`-focused item.
   */
  async pollMentions(): Promise<number> {
    const t = await this.token();
    if (!t) return 0;
    let media: IgMedia[];
    try {
      media = await this.deps.graph.recentTags(t.token, t.igUserId);
    } catch (e) {
      this.deps.log.warn(`instagram: mention poll failed: ${(e as Error).message}`);
      return 0;
    }
    let n = 0;
    for (const m of media) {
      if (this.polledMedia.has(m.id)) continue;
      this.polledMedia.add(m.id);
      const eventId = `poll:${m.id}`;
      if (!(await this.deps.repo.recordIgEvent({ id: eventId, kind: 'mention', raw: m }))) continue;
      try {
        const out = await this.handleMention(eventId, { media_id: m.id }, m);
        n += out ? 1 : 0;
      } catch (e) {
        this.deps.repo.markIgEvent(eventId, { error: (e as Error).message });
      }
    }
    return n;
  }

  // ---- webhook ----

  /** Process a verified webhook body. Fast: only DB writes and Graph lookups, no research. */
  async handleWebhook(body: WebhookBody): Promise<WebhookResult> {
    const res: WebhookResult = { handled: [], duplicates: 0, ignored: 0 };
    for (const entry of body.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        const mid = m.message?.mid;
        if (!mid || m.message?.is_echo) {
          res.ignored++;
          continue;
        }
        // Hosted mode (ADR 0032): every DM is gated on pairing before any item is created.
        // Self-hosted (`hosted` null) skips this entirely — behaviour byte-identical.
        let ctx: TenantCtx | undefined;
        if (this.hosted) {
          const gate = await this.hostedDmGate(m, mid, res);
          if (!gate) continue;
          if (gate.userId) ctx = { userId: gate.userId };
        }
        const share = (m.message?.attachments ?? []).find(
          (a) => a.type === 'ig_reel' || a.type === 'share' || a.type === 'story_mention',
        );
        const urlInText = m.message?.text ? firstUrlIn(m.message.text) : undefined;
        if (!share && !urlInText) {
          // Plain DM without a share. Instagram sends "share a reel, then type a message" as two
          // webhook events a few hundred ms apart, so text right after a share from the same
          // sender is that share's note. Anything else is recorded and ignored (the bot does not
          // chat in DMs).
          const attached = await this.attachLateNote(m, ctx);
          if (
            (await this.deps.repo.recordIgEvent({
              id: mid,
              kind: attached ? 'dm_note' : 'other',
              raw: m,
              senderId: m.sender?.id ?? null,
            })) &&
            attached
          ) {
            this.deps.repo.markIgEvent(mid, { itemId: attached });
            res.handled.push({ id: mid, kind: 'dm_note', itemId: attached, error: null });
          } else {
            res.ignored++;
          }
          continue;
        }
        if (
          !(await this.deps.repo.recordIgEvent({
            id: mid,
            kind: 'dm_share',
            raw: m,
            senderId: m.sender?.id ?? null,
          }))
        ) {
          res.duplicates++;
          continue;
        }
        try {
          const out = await this.handleDmShare(mid, m, share, urlInText, ctx);
          res.handled.push({ id: mid, kind: 'dm_share', itemId: out.item.id, error: null });
        } catch (e) {
          const msg = (e as Error).message;
          this.deps.repo.markIgEvent(mid, { error: msg });
          res.handled.push({ id: mid, kind: 'dm_share', itemId: null, error: msg });
        }
      }
      const changes: Change[] = [...(entry.changes ?? [])];
      if (entry.field && entry.value) changes.push({ field: entry.field, value: entry.value });
      for (const c of changes) {
        if (c.field !== 'mentions' && c.field !== 'comments') {
          res.ignored++;
          continue;
        }
        const v = c.value ?? {};
        const mediaId = v.media_id;
        const commentId = v.comment_id ?? (c.field === 'comments' ? v.id : undefined);
        if (!mediaId && !commentId) {
          res.ignored++;
          continue;
        }
        const id = commentId ? `comment:${commentId}` : `media:${mediaId}`;
        if (
          !(await this.deps.repo.recordIgEvent({
            id,
            kind: c.field === 'mentions' ? 'mention' : 'comment',
            raw: c,
          }))
        ) {
          res.duplicates++;
          continue;
        }
        try {
          const out = await this.handleMention(id, {
            ...(mediaId ? { media_id: mediaId } : {}),
            ...(commentId ? { comment_id: commentId } : {}),
          });
          if (out)
            res.handled.push({ id, kind: c.field ?? 'mention', itemId: out.item.id, error: null });
          else {
            this.deps.repo.markIgEvent(id, { error: 'no mention of the shadow account' });
            res.ignored++;
          }
        } catch (e) {
          const msg = (e as Error).message;
          this.deps.repo.markIgEvent(id, { error: msg });
          res.handled.push({ id, kind: c.field ?? 'mention', itemId: null, error: msg });
        }
      }
    }
    return res;
  }

  /** Last "please connect" prompt per sender, for the hourly rate limit (self-hosted/no-pg path). */
  private lastPrompt = new Map<string, number>();

  /**
   * Hosted-mode DM gate (ADR 0032), run before anything is ingested:
   * - linked sender → proceed, with the link owner's user id as the ingest tenant;
   * - DM text is a valid pairing code → link the sender, react + confirm, ingest nothing;
   * - DM text is STOP/UNSUBSCRIBE → record the opt-out, reply once, never prompt again;
   * - anyone else → ingest nothing, one polite prompt per sender per hour (persisted in
   *   `ig_prompts` in hosted mode, so a restart does not reset the window).
   * Returns the tenant to ingest under, or null when the message was fully handled/blocked.
   */
  private async hostedDmGate(
    m: Messaging,
    mid: string,
    res: WebhookResult,
  ): Promise<{ userId?: string } | null> {
    const hosted = this.hosted;
    if (!hosted) return {};
    const senderId = m.sender?.id;
    if (!senderId) return {};
    const link = await hosted.resolveLink(senderId);
    if (link) return { userId: link.userId };
    const text = m.message?.text?.trim() ?? '';
    if (text) {
      const paired = await hosted.resolvePairing(text, senderId, null);
      if (paired) {
        // Dedupe on Meta's message id so a webhook redelivery never double-replies.
        if (
          !(await this.deps.repo.recordIgEvent({
            id: mid,
            kind: 'dm_pairing',
            raw: m,
            senderId,
          }))
        ) {
          res.duplicates++;
        } else {
          // Awaited only for the *dispatch*: `reply`/`acknowledge` resolve an async token
          // (pg-lazy account read, ADR 0032) and then hand the send to the Graph client without
          // awaiting it, so the webhook still never waits on Meta.
          await this.acknowledge(senderId, mid);
          await this.reply(senderId, PAIRING_ACK);
          res.handled.push({ id: mid, kind: 'dm_pairing', itemId: null, error: null });
        }
        return null;
      }
    }
    if (!(await this.deps.repo.recordIgEvent({ id: mid, kind: 'other', raw: m, senderId }))) {
      res.duplicates++;
      return null;
    }
    // STOP/UNSUBSCRIBE is honored before anything else: record it, confirm once, prompt never
    // again. The reply is deduped on Meta's message id via the `ig_events` row above.
    if (STOP_KEYWORDS.has(text.toUpperCase())) {
      await this.deps.repo.recordIgPromptOptout(senderId, this.now());
      await this.reply(senderId, STOP_REPLY);
      res.handled.push({ id: mid, kind: 'dm_optout', itemId: null, error: null });
      return null;
    }
    if (await this.deps.repo.isIgPromptOptedOut(senderId)) {
      res.ignored++;
      return null;
    }
    if (await this.claimPrompt(senderId)) await this.reply(senderId, PAIRING_PROMPT);
    res.ignored++;
    return null;
  }

  /**
   * Atomically claim the hourly prompt window for a sender. Hosted mode persists it in
   * `ig_prompts` (ADR 0032) so a restart cannot re-prompt; the in-memory map stays for the
   * self-hosted path, which never prompts at all.
   */
  private async claimPrompt(senderId: string): Promise<boolean> {
    const now = this.now();
    if (this.deps.repo.isPg)
      return await this.deps.repo.claimIgPrompt(senderId, PROMPT_WINDOW_MS, now);
    if (now - (this.lastPrompt.get(senderId) ?? 0) <= PROMPT_WINDOW_MS) return false;
    this.lastPrompt.set(senderId, now);
    return true;
  }

  /**
   * DM text. The caller awaits only the token lookup; the Graph send itself is never awaited, so
   * a slow Meta call still cannot delay the webhook 200.
   */
  private async reply(senderId: string, text: string): Promise<void> {
    const t = await this.token();
    if (!t) return;
    this.deps.graph
      .sendText(t.token, t.igUserId, senderId, text)
      .catch((e) => this.deps.log.warn(`instagram: dm reply failed: ${(e as Error).message}`));
  }

  private async handleDmShare(
    mid: string,
    m: Messaging,
    share: DmAttachment | undefined,
    urlInText: string | undefined,
    ctx?: TenantCtx,
  ): Promise<IngestOutcome> {
    const cdn = share?.payload?.url;
    const text = m.message?.text?.trim() ?? '';
    // Prefer a permalink (dedupe + comments); the signed CDN url is a download shortcut only.
    let url = urlInText ?? null;
    if (!url && share?.payload?.reel_video_id) {
      const t = await this.token();
      if (t) {
        try {
          const media = await this.deps.graph.ownMedia(t.token, share.payload.reel_video_id);
          url = media.permalink ?? null;
        } catch {
          /* not our media or not resolvable */
        }
      }
    }
    if (!url && cdn) url = cdn;
    if (!url) throw new Error('DM share carried no url');
    const note = urlInText && text ? text.replace(urlInText, '').trim() : text;
    const req: IngestRequest = {
      url,
      channel: 'ig_dm',
      focus: 'whole',
      modeHint: 'auto',
      ...(note ? { note } : share?.payload?.title ? { note: share.payload.title } : {}),
    };
    const out = await this.ingestForUser(req, ctx);
    this.deps.repo.markIgEvent(mid, { itemId: out.item.id });
    // Acknowledge at once: the heart tells the owner "got it, working on it"; the answer itself
    // arrives by push. Fire-and-forget so a slow Graph call never delays the webhook 200.
    if (m.sender?.id) void this.acknowledge(m.sender.id, mid);
    // Meta puts the reel *permalink* (an HTML page) in payload.url for ig_reel shares; only a
    // real media URL is worth handing to the worker as a download shortcut.
    if (cdn && !isInstagramPage(cdn)) this.hintCdn(out.item.id, cdn, share?.payload?.reel_video_id);
    if (m.sender?.id) {
      this.recentShares.set(m.sender.id, {
        itemId: out.item.id,
        chatId: out.chat.id,
        at: (this.deps.now ?? Date.now)(),
        titleNote: !note && !!share?.payload?.title,
      });
    }
    return out;
  }

  /**
   * Dialect-safe ingest for DM shares: like `ingest()` but every repo call is awaited, so the
   * hosted Postgres dialect (whose sync signatures return promises, see repo.ts) produces real
   * rows and a real item id for `markIgEvent`. On SQLite awaiting is a no-op and the behaviour
   * matches `ingest()` for DM shares (no clientId, focus always `whole`).
   */
  private async ingestForUser(req: IngestRequest, ctx?: TenantCtx): Promise<IngestOutcome> {
    const { repo, adapterFor } = this.deps;
    const url = req.url ?? (req.text ? firstUrlIn(req.text) : undefined);
    let platform: Platform = 'text';
    let canonicalUrl: string | null = null;
    if (url) {
      const det = detectPlatform(url);
      if (!det) throw new Error('unsupported URL (only http/https)');
      platform = det.platform;
      canonicalUrl = det.canonicalUrl;
    }
    const mode: Mode = resolveRequestedMode(req.modeHint) ?? 'standard';
    const binding = adapterFor(mode);
    if (canonicalUrl) {
      const dup = await repo.findRecentDuplicate(canonicalUrl, req.focus, DEDUPE_HOURS, ctx);
      const chat = dup ? await repo.getChatByItem(dup.id, ctx) : undefined;
      if (dup && chat) {
        if (req.note?.trim())
          await repo.addMessage(
            { chatId: chat.id, role: 'user', kind: 'question', content: req.note },
            ctx,
          );
        const run = await repo.createRun(
          {
            itemId: dup.id,
            chatId: chat.id,
            kind: 'research',
            mode,
            adapter: binding.adapter.id,
            model: binding.model,
            pinned: false,
          },
          ctx,
        );
        await repo.updateItem(
          dup.id,
          {
            status: 'new',
            ...(req.note ? { note: [dup.note, req.note].filter(Boolean).join('\n\n') } : {}),
          },
          ctx,
        );
        return { item: dup, chat, run, deduplicated: true };
      }
    }
    const title = canonicalUrl
      ? titleFromUrl(canonicalUrl, platform)
      : titleFromText(req.text ?? '');
    const created = await repo.createItemWithChat(
      req,
      platform,
      canonicalUrl,
      title,
      undefined,
      ctx,
    );
    const run = await repo.createRun(
      {
        itemId: created.item.id,
        chatId: created.chat.id,
        kind: 'research',
        mode,
        adapter: binding.adapter.id,
        model: binding.model,
        pinned: false,
      },
      ctx,
    );
    if (req.note?.trim())
      await repo.addMessage(
        { chatId: created.chat.id, role: 'user', kind: 'question', content: req.note },
        ctx,
      );
    return { item: created.item, chat: created.chat, run, deduplicated: false };
  }

  /** Last DM share per sender, so the text typed right after it can become the note. */
  private recentShares = new Map<
    string,
    { itemId: string; chatId: string; at: number; titleNote: boolean }
  >();

  /**
   * Text-only DM from a sender whose share arrived less than LATE_NOTE_WINDOW_MS ago: it is the
   * note for that share. It goes onto the item (a still-queued run sees it as the question) and
   * always shows in the chat as the owner's message, so they can see it was fed in: a placeholder
   * question copied from the reel title is rewritten, anything else appends a new one. Returns
   * the item id it was attached to, or null.
   */
  private async attachLateNote(m: Messaging, ctx?: TenantCtx): Promise<string | null> {
    const sender = m.sender?.id;
    const text = m.message?.text?.trim();
    if (!sender || !text) return null;
    const recent = this.recentShares.get(sender);
    if (!recent) return null;
    const now = (this.deps.now ?? Date.now)();
    if (now - recent.at > LATE_NOTE_WINDOW_MS) {
      this.recentShares.delete(sender);
      return null;
    }
    const { repo } = this.deps;
    const item = await repo.getItem(recent.itemId, ctx);
    if (!item) return null;
    // A note copied from the reel's title is a placeholder; the sender's own words replace it.
    const base = recent.titleNote ? null : item.note;
    const note = [base, text].filter(Boolean).join('\n\n');
    await repo.updateItem(item.id, { note }, ctx);
    const placeholder = recent.titleNote
      ? (await repo.listMessages(recent.chatId, ctx)).find(
          (x) => x.role === 'user' && x.kind === 'question' && x.content === item.note,
        )
      : undefined;
    if (placeholder) await repo.updateMessageContent(placeholder.id, text, ctx);
    else
      await repo.addMessage(
        { chatId: recent.chatId, role: 'user', kind: 'question', content: text },
        ctx,
      );
    this.deps.onChatUpdated?.(recent.chatId);
    this.recentShares.set(sender, { ...recent, titleNote: false });
    return item.id;
  }

  /** Per-item CDN shortcut for the media worker, kept in memory (signed urls expire anyway). */
  private cdnHints = new Map<string, ExtractParams['hints']>();
  private hintCdn(itemId: string, cdnUrl: string, mediaId?: string) {
    this.cdnHints.set(itemId, { cdn_url: cdnUrl, ...(mediaId ? { media_id: mediaId } : {}) });
  }
  mediaHints(item: ItemRow): ExtractParams['hints'] {
    return this.cdnHints.get(item.id) ?? {};
  }

  /**
   * A comment mention (or a comment on our own media). Fetches the media and, when we know the
   * comment, the comment itself: reply ⇒ focus thread:<parent>, top-level ⇒ focus comments.
   * Returns null when the fetched comment does not mention the shadow account (comments field).
   */
  private async handleMention(
    eventId: string,
    v: { media_id?: string; comment_id?: string },
    prefetched?: IgMedia,
  ): Promise<IngestOutcome | null> {
    const t = await this.token();
    if (!t) throw new Error('Instagram account not connected');
    const { graph, repo } = this.deps;
    const account = await this.account();
    let comment: IgComment | null = null;
    if (v.comment_id) {
      try {
        comment = await graph.mentionedComment(t.token, t.igUserId, v.comment_id);
      } catch (e) {
        if (!(e instanceof IgGraphError)) throw e;
        this.deps.log.warn(`instagram: mentioned_comment ${v.comment_id} failed: ${e.message}`);
      }
    }
    let media: IgMedia | null = prefetched ?? null;
    if (!media && v.media_id) {
      try {
        media = await graph.mentionedMedia(t.token, t.igUserId, v.media_id);
      } catch (e) {
        if (!(e instanceof IgGraphError)) throw e;
        // Own media (comments field) is fetched by id directly.
        media = await graph.ownMedia(t.token, v.media_id);
      }
    }
    if (!media?.permalink) throw new Error('could not resolve the mentioned media permalink');

    const handle = account?.username ?? null;
    if (comment && handle && !new RegExp(`@${escapeRe(handle)}\\b`, 'i').test(comment.text ?? '')) {
      return null;
    }
    const focus = comment?.parent_id ? `thread:${comment.parent_id}` : 'comments';
    const note = comment ? noteFromMention(comment.text ?? '', handle) : '';
    const req: IngestRequest = {
      url: media.permalink,
      channel: 'ig_mention',
      focus,
      modeHint: 'auto',
      ...(note ? { note } : {}),
    };
    // `ingestAsync`, not `ingest`: the hosted dialect's repo reads are pg-lazy (ADR 0032), and a
    // sync caller reads fields off a Promise. Awaiting is a no-op on SQLite.
    const out = await ingestAsync(req, { repo, adapterFor: this.deps.adapterFor });
    repo.markIgEvent(eventId, { itemId: out.item.id });
    if (!out.deduplicated) this.storeMediaContext(out.item.id, media, comment, focus);
    if (media.media_url) this.hintCdn(out.item.id, media.media_url, media.id);
    return out;
  }

  /** Caption + comments (+ the primary thread) from the Graph API, stored as channel extractions. */
  private storeMediaContext(
    itemId: string,
    media: IgMedia,
    comment: IgComment | null,
    focus: string,
  ) {
    const { repo } = this.deps;
    if (media.caption) {
      repo.addExtraction({ itemId, kind: 'caption', content: media.caption, tool: CHANNEL_TOOL });
    }
    const all = flattenComments(media.comments?.data ?? []);
    if (all.length) {
      repo.addExtraction({
        itemId,
        kind: 'comments',
        content: { total: all.length, sampled: all.slice(0, 200) },
        tool: CHANNEL_TOOL,
      });
    }
    if (focus.startsWith('thread:')) {
      const parentId = focus.slice('thread:'.length);
      const parent = all.find((c) => c.id === parentId);
      const replies = all.filter((c) => c.parent_id === parentId);
      if (parent || replies.length || comment) {
        repo.addExtraction({
          itemId,
          kind: 'thread',
          content: {
            parent: parent ?? null,
            replies: replies.length ? replies : comment ? [flat(comment)] : [],
          },
          tool: CHANNEL_TOOL,
        });
      }
    }
  }

  // ---- acknowledgement / completion ----

  /**
   * `love` on the DM as soon as its share was accepted. Mentions get nothing public. Like
   * `reply`, the caller awaits the token lookup but never the Graph send.
   */
  private async acknowledge(senderId: string, messageId: string): Promise<void> {
    const t = await this.token();
    if (!t) return;
    this.deps.graph
      .react(t.token, t.igUserId, senderId, messageId)
      .catch((e) => this.deps.log.warn(`instagram: reaction failed: ${(e as Error).message}`));
  }

  /**
   * Worker hook when a run ends. The DM was already hearted on receipt and the answer travels by
   * push, so nothing is sent here; kept so the channel can react to failures later.
   */
  async onOutcome(_item: ItemRow, _outcome: 'answered' | 'failed' | 'capped'): Promise<void> {}

  /** Settings → "Send test DM to myself": proves messaging works end to end. */
  async sendTestDm(recipientId: string, text: string): Promise<void> {
    const t = await this.token();
    if (!t) throw new Error('Instagram account not connected');
    await this.deps.graph.sendText(t.token, t.igUserId, recipientId, text);
  }
}

interface FlatComment {
  id: string;
  text: string;
  username?: string;
  timestamp?: string;
  parent_id?: string;
  like_count?: number;
}
function flat(c: IgComment): FlatComment {
  const { replies: _r, ...rest } = c;
  return rest;
}
export function flattenComments(list: IgComment[]): FlatComment[] {
  const out: FlatComment[] = [];
  for (const c of list) {
    out.push(flat(c));
    for (const r of c.replies?.data ?? []) out.push({ ...flat(r), parent_id: r.parent_id ?? c.id });
  }
  return out;
}
