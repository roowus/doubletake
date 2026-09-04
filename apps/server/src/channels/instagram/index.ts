/**
 * Instagram shadow-account channel (docs/channels/instagram-setup.md, ADR 0006, ADR 0018).
 *
 * Two ways in: a DM share (reel/post shared to the shadow account, optional text = note) and a
 * comment @mention (top-level ⇒ focus=comments, reply ⇒ focus=thread:<parent>). The bot never
 * posts publicly; completion is signalled by the normal push plus a `love` reaction on the DM.
 */

import crypto from 'node:crypto';
import type { IngestRequest } from '@doubletake/shared';
import type { Config } from '../../config/index.js';
import type { ItemRow, Repo } from '../../db/repo.js';
import { firstUrlIn } from '../../extract/registry.js';
import { type IngestOutcome, ingest } from '../../ingest/index.js';
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
  adapterId: string;
  log: IgLogger;
  /** Overridable for tests. */
  now?: () => number;
}

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

  get configured(): boolean {
    const { appId, appSecret, verifyToken } = this.deps.cfg.ig;
    return Boolean(appId && appSecret && verifyToken);
  }

  // ---- account / token ----

  private account() {
    return this.deps.repo.getIgAccount();
  }

  private token(): { igUserId: string; token: string } | null {
    const a = this.account();
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
    return this.status();
  }

  disconnect(): void {
    this.deps.repo.deleteIgAccount();
  }

  /** Refresh the long-lived token when it is ≥30 days old. Returns true when refreshed. */
  async refreshIfDue(): Promise<boolean> {
    const a = this.account();
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

  status(): IgStatus {
    const a = this.account();
    const { cfg, repo } = this.deps;
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
      recentEvents: repo.listIgEvents(20).map((e) => ({
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
    const t = this.token();
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
      if (!this.deps.repo.recordIgEvent({ id: eventId, kind: 'mention', raw: m })) continue;
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
        const share = (m.message?.attachments ?? []).find(
          (a) => a.type === 'ig_reel' || a.type === 'share' || a.type === 'story_mention',
        );
        const urlInText = m.message?.text ? firstUrlIn(m.message.text) : undefined;
        if (!share && !urlInText) {
          // Plain DM without a share: record and ignore (the bot does not chat in DMs).
          this.deps.repo.recordIgEvent({
            id: mid,
            kind: 'other',
            raw: m,
            senderId: m.sender?.id ?? null,
          });
          res.ignored++;
          continue;
        }
        if (
          !this.deps.repo.recordIgEvent({
            id: mid,
            kind: 'dm_share',
            raw: m,
            senderId: m.sender?.id ?? null,
          })
        ) {
          res.duplicates++;
          continue;
        }
        try {
          const out = await this.handleDmShare(mid, m, share, urlInText);
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
          !this.deps.repo.recordIgEvent({
            id,
            kind: c.field === 'mentions' ? 'mention' : 'comment',
            raw: c,
          })
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

  private async handleDmShare(
    mid: string,
    m: Messaging,
    share: DmAttachment | undefined,
    urlInText: string | undefined,
  ): Promise<IngestOutcome> {
    const cdn = share?.payload?.url;
    const text = m.message?.text?.trim() ?? '';
    // Prefer a permalink (dedupe + comments); the signed CDN url is a download shortcut only.
    let url = urlInText ?? null;
    if (!url && share?.payload?.reel_video_id) {
      const t = this.token();
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
    const out = ingest(req, { repo: this.deps.repo, adapterId: this.deps.adapterId });
    this.deps.repo.markIgEvent(mid, { itemId: out.item.id });
    if (cdn) this.hintCdn(out.item.id, cdn, share?.payload?.reel_video_id);
    return out;
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
    const t = this.token();
    if (!t) throw new Error('Instagram account not connected');
    const { graph, repo } = this.deps;
    const account = this.account();
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
    const out = ingest(req, { repo, adapterId: this.deps.adapterId });
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

  // ---- completion ----

  /** `love` on the originating DM when the run finished; mentions get nothing public. */
  async onOutcome(item: ItemRow, outcome: 'answered' | 'failed' | 'capped'): Promise<void> {
    if (item.channel !== 'ig_dm' || outcome !== 'answered') return;
    const t = this.token();
    if (!t) return;
    for (const ev of this.deps.repo.igEventsForItem(item.id)) {
      if (ev.kind !== 'dm_share' || !ev.senderId) continue;
      try {
        await this.deps.graph.react(t.token, t.igUserId, ev.senderId, ev.id);
      } catch (e) {
        this.deps.log.warn(`instagram: reaction failed: ${(e as Error).message}`);
      }
    }
  }

  /** Settings → "Send test DM to myself": proves messaging works end to end. */
  async sendTestDm(recipientId: string, text: string): Promise<void> {
    const t = this.token();
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
