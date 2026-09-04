import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostAllowed } from '../src/api/instagram.js';
import { buildServer } from '../src/api/server.js';
import type {
  IgComment,
  IgGraph,
  IgMedia,
  IgProfile,
  IgTokenResponse,
} from '../src/channels/instagram/graph.js';
import { IgGraphError } from '../src/channels/instagram/graph.js';
import {
  flattenComments,
  InstagramChannel,
  noteFromMention,
  verifySignature,
} from '../src/channels/instagram/index.js';
import { CHANNEL_TOOL, QueueWorker } from '../src/queue/worker.js';
import { SecretBox } from '../src/secrets/box.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

/** In-memory Graph API with the shapes the guide documents. */
class FakeGraph implements IgGraph {
  calls: string[] = [];
  reactions: { recipientId: string; messageId: string }[] = [];
  sent: { recipientId: string; text: string }[] = [];
  media = new Map<string, IgMedia>();
  comments = new Map<string, IgComment>();
  tags: IgMedia[] = [];
  async me(_token: string): Promise<IgProfile> {
    this.calls.push('me');
    return { id: 'IG1', username: 'dt_shadow' };
  }
  async exchangeCode(code: string): Promise<IgTokenResponse> {
    this.calls.push(`exchangeCode:${code}`);
    return { access_token: `short-${code}` };
  }
  async exchangeLongLived(token: string): Promise<IgTokenResponse> {
    this.calls.push('exchangeLongLived');
    return { access_token: `long-${token}`, expires_in: 60 * 86400 };
  }
  async refresh(token: string): Promise<IgTokenResponse> {
    this.calls.push('refresh');
    return { access_token: `${token}-refreshed`, expires_in: 60 * 86400 };
  }
  async mentionedComment(_t: string, _ig: string, commentId: string): Promise<IgComment> {
    const c = this.comments.get(commentId);
    if (!c) throw new IgGraphError(400, 100, 'no comment');
    return c;
  }
  async mentionedMedia(_t: string, _ig: string, mediaId: string): Promise<IgMedia> {
    const m = this.media.get(mediaId);
    if (!m) throw new IgGraphError(400, 100, 'no media');
    return m;
  }
  async ownMedia(_t: string, mediaId: string): Promise<IgMedia> {
    const m = this.media.get(`own:${mediaId}`);
    if (!m) throw new IgGraphError(400, 100, 'no own media');
    return m;
  }
  async react(_t: string, _ig: string, recipientId: string, messageId: string) {
    this.reactions.push({ recipientId, messageId });
  }
  async sendText(_t: string, _ig: string, recipientId: string, text: string) {
    this.sent.push({ recipientId, text });
  }
  async recentTags(): Promise<IgMedia[]> {
    return this.tags;
  }
  async subscribeApp(_t: string, _ig: string, fields: string[]) {
    this.calls.push(`subscribe:${fields.join(',')}`);
  }
}

const env = tempEnv('dt-ig-');
env.cfg.publicUrl = 'https://dt.example.test';
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
const graph = new FakeGraph();
const box = SecretBox.open(env.cfg.dataDir);
const logs: string[] = [];
const log = {
  info: (m: string) => logs.push(m),
  warn: (m: string) => logs.push(m),
  error: (m: string) => logs.push(m),
};
let now = Date.parse('2026-09-03T12:00:00Z');
const ig = new InstagramChannel({
  cfg: env.cfg,
  repo: env.repo,
  graph,
  box,
  adapterId: brain.id,
  log,
  now: () => now,
});
worker.onOutcome = (item, outcome) => ig.onOutcome(item, outcome);
worker.mediaHints = (item) => ig.mediaHints(item);
let app: FastifyInstance;
let token = '';

beforeAll(async () => {
  app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain, ig });
  await app.ready();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'correct horse battery', deviceName: 'Mac' },
  });
  token = (setup.json() as { token: string }).token;
  worker.start();
});
afterAll(async () => {
  ig.stop();
  await worker.stop();
  await app.close();
  env.cleanup();
});

const auth = () => ({ authorization: `Bearer ${token}` });
const sign = (body: string) =>
  `sha256=${crypto.createHmac('sha256', 'shh-secret').update(body).digest('hex')}`;
async function postWebhook(body: unknown, sig?: string) {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/webhooks/instagram',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig ?? sign(raw) },
    payload: raw,
  });
}

describe('SecretBox', () => {
  it('round-trips and rejects tampering', () => {
    const sealed = box.seal('IGQVJ-token-123');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('IGQVJ');
    expect(box.open(sealed)).toBe('IGQVJ-token-123');
    const parts = sealed.split('.');
    parts[2] = Buffer.from('x').toString('base64');
    expect(() => box.open(parts.join('.'))).toThrow();
    // Same keyfile ⇒ same box.
    expect(SecretBox.open(env.cfg.dataDir).open(sealed)).toBe('IGQVJ-token-123');
  });
});

describe('helpers', () => {
  it('verifySignature is strict about format and value', () => {
    const body = Buffer.from('{"a":1}');
    expect(verifySignature('shh-secret', body, sign('{"a":1}'))).toBe(true);
    expect(verifySignature('shh-secret', body, sign('{"a":2}'))).toBe(false);
    expect(verifySignature('shh-secret', body, undefined)).toBe(false);
    expect(verifySignature('shh-secret', body, 'sha1=abc')).toBe(false);
    expect(verifySignature('other', body, sign('{"a":1}'))).toBe(false);
  });
  it('noteFromMention strips the handle only', () => {
    expect(noteFromMention('@dt_shadow is this true?', 'dt_shadow')).toBe('is this true?');
    expect(noteFromMention('hey @DT_SHADOW  compare with @other', 'dt_shadow')).toBe(
      'hey compare with @other',
    );
    expect(noteFromMention('@dt_shadow', 'dt_shadow')).toBe('');
  });
  it('flattenComments keeps parent ids for replies', () => {
    const flatList = flattenComments([
      { id: 'c1', text: 'top', replies: { data: [{ id: 'c2', text: 'reply' }] } },
      { id: 'c3', text: 'other' },
    ]);
    expect(flatList.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(flatList[1]?.parent_id).toBe('c1');
    expect('replies' in (flatList[0] ?? {})).toBe(false);
  });
  it('hostAllowed lets only the webhook through the public host', () => {
    expect(hostAllowed(env.cfg, 'hook.example.com', '/webhooks/instagram?x=1')).toBe(true);
    expect(hostAllowed(env.cfg, 'HOOK.example.com:443', '/api/chats')).toBe(false);
    expect(hostAllowed(env.cfg, 'hook.example.com', '/')).toBe(false);
    expect(hostAllowed(env.cfg, 'laptop.ts.net', '/api/chats')).toBe(true);
    expect(
      hostAllowed(
        { ...env.cfg, ig: { ...env.cfg.ig, webhookPublicHost: null } },
        'hook.example.com',
        '/',
      ),
    ).toBe(true);
  });
});

describe('webhook verification', () => {
  it('answers the subscribe challenge only with the right token', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    const bad = await app.inject({
      method: 'GET',
      url: '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345',
    });
    expect(bad.statusCode).toBe(403);
  });
  it('rejects a bad or missing signature and accepts a good one', async () => {
    const body = { object: 'instagram', entry: [] };
    expect((await postWebhook(body, 'sha256=00')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/instagram',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(body),
        })
      ).statusCode,
    ).toBe(401);
    expect((await postWebhook(body)).statusCode).toBe(200);
  });
  it('404s every non-webhook path on the public host', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'hook.example.com' },
    });
    expect(res.statusCode).toBe(404);
    const hook = await app.inject({
      method: 'GET',
      url: '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=z',
      headers: { host: 'hook.example.com' },
    });
    expect(hook.statusCode).toBe(200);
  });
});

describe('account', () => {
  it('reports unconfigured-but-not-connected, connects via OAuth callback, stores the token encrypted', async () => {
    const before = (
      await app.inject({ method: 'GET', url: '/api/ig/status', headers: auth() })
    ).json() as {
      configured: boolean;
      connected: boolean;
    };
    expect(before).toMatchObject({ configured: true, connected: false });

    const connect = await app.inject({ method: 'POST', url: '/api/ig/connect', headers: auth() });
    const url = new URL((connect.json() as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://dt.example.test/api/ig/callback');
    expect(url.searchParams.get('scope')).toContain('instagram_business_manage_messages');
    const state = url.searchParams.get('state') ?? '';

    const badState = await app.inject({
      method: 'GET',
      url: '/api/ig/callback?code=abc&state=wrong',
    });
    expect(badState.statusCode).toBe(400);
    const cb = await app.inject({
      method: 'GET',
      url: `/api/ig/callback?code=abc%23_&state=${state}`,
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/settings?ig=connected');
    expect(graph.calls).toEqual(
      expect.arrayContaining([
        'exchangeCode:abc',
        'exchangeLongLived',
        'me',
        'subscribe:messages,mentions,comments',
      ]),
    );
    const row = env.repo.getIgAccount();
    expect(row?.username).toBe('dt_shadow');
    expect(row?.accessTokenEnc).not.toContain('long-short-abc');
    expect(box.open(row?.accessTokenEnc ?? '')).toBe('long-short-abc');
    const after = (
      await app.inject({ method: 'GET', url: '/api/ig/status', headers: auth() })
    ).json() as {
      connected: boolean;
      username: string;
    };
    expect(after).toMatchObject({ connected: true, username: 'dt_shadow' });
  });
  it('refreshes the token only once it is 30 days old', async () => {
    expect(await ig.refreshIfDue()).toBe(false);
    now += 31 * 86400_000;
    expect(await ig.refreshIfDue()).toBe(true);
    expect(box.open(env.repo.getIgAccount()?.accessTokenEnc ?? '')).toBe(
      'long-short-abc-refreshed',
    );
    expect(await ig.refreshIfDue()).toBe(false);
  });
});

describe('DM share', () => {
  const dm = (mid: string, text: string | undefined, attachments: unknown[]) => ({
    object: 'instagram',
    entry: [
      {
        id: 'IG1',
        time: 1,
        messaging: [
          {
            sender: { id: 'USER9' },
            recipient: { id: 'IG1' },
            timestamp: 1,
            message: { mid, text, attachments },
          },
        ],
      },
    ],
  });

  it('creates an ig_dm item with the note, CDN hint, and reacts with love when answered', async () => {
    const res = await postWebhook(
      dm('mid-1', 'is this legit?', [
        {
          type: 'ig_reel',
          payload: {
            url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=abc',
            title: 'A reel',
            reel_video_id: '17900',
          },
        },
      ]),
    );
    expect(res.statusCode).toBe(200);
    await waitFor(() => env.repo.listItems().some((i) => i.channel === 'ig_dm'));
    const item = env.repo.listItems().find((i) => i.channel === 'ig_dm');
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.note).toBe('is this legit?');
    expect(item.sourceUrl).toContain('lookaside.fbsbx.com');
    expect(ig.mediaHints(item)).toEqual({
      cdn_url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=abc',
      media_id: '17900',
    });
    const ev = env.repo.igEventsForItem(item.id);
    expect(ev.map((e) => e.id)).toEqual(['mid-1']);
    expect(ev[0]?.senderId).toBe('USER9');
    await waitFor(() => graph.reactions.length > 0, 8000);
    expect(graph.reactions).toEqual([{ recipientId: 'USER9', messageId: 'mid-1' }]);
  });

  it('prefers a permalink in the text over the CDN url and dedupes redeliveries', async () => {
    const body = dm('mid-2', 'https://www.instagram.com/reel/C9abc123/ what do people say', [
      { type: 'share', payload: { url: 'https://lookaside.fbsbx.com/x?sig=1' } },
    ]);
    await postWebhook(body);
    await waitFor(() => env.repo.listItems().some((i) => i.sourceUrl?.includes('C9abc123')));
    const item = env.repo.listItems().find((i) => i.sourceUrl?.includes('C9abc123'));
    expect(item?.note).toBe('what do people say');
    expect(item?.focus).toBe('whole');
    const r = await ig.handleWebhook(body as never);
    expect(r).toMatchObject({ handled: [], duplicates: 1 });
  });

  it('ignores echoes and plain text DMs', async () => {
    const r = await ig.handleWebhook({
      object: 'instagram',
      entry: [
        {
          messaging: [
            { sender: { id: 'IG1' }, message: { mid: 'echo-1', text: 'hi', is_echo: true } },
            { sender: { id: 'USER9' }, message: { mid: 'plain-1', text: 'hello bot' } },
          ],
        },
      ],
    });
    expect(r).toEqual({ handled: [], duplicates: 0, ignored: 2 });
    expect(env.repo.listItems().some((i) => i.note === 'hello bot')).toBe(false);
  });
});

describe('comment mention', () => {
  beforeAll(() => {
    graph.media.set('M1', {
      id: 'M1',
      caption: 'Five skiing tips',
      permalink: 'https://www.instagram.com/p/SKI123/',
      media_url: 'https://scontent.cdninstagram.com/v/ski.mp4',
      media_type: 'VIDEO',
      username: 'skier',
      comments: {
        data: [
          {
            id: 'c1',
            text: 'tip 3 is wrong',
            username: 'a',
            replies: { data: [{ id: 'c2', text: 'no it is fine', username: 'b' }] },
          },
          { id: 'c3', text: '@dt_shadow is this true?', username: 'owner' },
        ],
      },
    });
    graph.comments.set('c3', { id: 'c3', text: '@dt_shadow is this true?', username: 'owner' });
    graph.comments.set('c4', {
      id: 'c4',
      text: '@dt_shadow who is right here',
      username: 'owner',
      parent_id: 'c1',
    });
    graph.comments.set('c5', { id: 'c5', text: 'nice video', username: 'someone' });
  });

  it('top-level mention ⇒ focus comments, note = text minus handle, caption+comments stored', async () => {
    const r = await ig.handleWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'IG1',
          changes: [{ field: 'mentions', value: { media_id: 'M1', comment_id: 'c3' } }],
        },
      ],
    });
    expect(r.handled).toHaveLength(1);
    const itemId = r.handled[0]?.itemId ?? '';
    const item = env.repo.getItem(itemId);
    expect(item).toMatchObject({
      channel: 'ig_mention',
      focus: 'comments',
      note: 'is this true?',
      sourceUrl: 'https://www.instagram.com/p/SKI123/',
    });
    const ex = env.repo.listExtractions(itemId).filter((e) => e.tool === CHANNEL_TOOL);
    expect(ex.map((e) => e.kind).sort()).toEqual(['caption', 'comments']);
    const comments = JSON.parse(ex.find((e) => e.kind === 'comments')?.content ?? '{}') as {
      total: number;
    };
    expect(comments.total).toBe(3);
    expect(ig.mediaHints(item as never)).toMatchObject({
      cdn_url: 'https://scontent.cdninstagram.com/v/ski.mp4',
      media_id: 'M1',
    });
    // A mention item is a new share on a new URL: whole, not reused from the DM tests.
    expect(env.repo.igEventsForItem(itemId).map((e) => e.id)).toEqual(['comment:c3']);
  });

  it('reply mention ⇒ focus thread:<parent>, thread extraction stored; flat change shape accepted', async () => {
    // Different media url so the 24 h dedupe does not fold it into the previous item.
    graph.media.set('M2', {
      ...(graph.media.get('M1') as IgMedia),
      id: 'M2',
      permalink: 'https://www.instagram.com/p/SKI456/',
    });
    const r = await ig.handleWebhook({
      object: 'instagram',
      entry: [{ id: 'IG1', field: 'mentions', value: { media_id: 'M2', comment_id: 'c4' } }],
    });
    expect(r.handled).toHaveLength(1);
    const itemId = r.handled[0]?.itemId ?? '';
    expect(env.repo.getItem(itemId)).toMatchObject({
      focus: 'thread:c1',
      note: 'who is right here',
    });
    const thread = env.repo.listExtractions(itemId).find((e) => e.kind === 'thread');
    expect(thread?.tool).toBe(CHANNEL_TOOL);
    const t = JSON.parse(thread?.content ?? '{}') as {
      parent: { id: string };
      replies: { id: string }[];
    };
    expect(t.parent.id).toBe('c1');
    expect(t.replies.map((x) => x.id)).toEqual(['c2']);
  });

  it('a comments-field event that does not mention the account is ignored; redeliveries dedupe', async () => {
    const r = await ig.handleWebhook({
      object: 'instagram',
      entry: [{ id: 'IG1', changes: [{ field: 'comments', value: { media_id: 'M1', id: 'c5' } }] }],
    });
    expect(r).toMatchObject({ handled: [], ignored: 1 });
    const again = await ig.handleWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'IG1',
          changes: [{ field: 'mentions', value: { media_id: 'M1', comment_id: 'c3' } }],
        },
      ],
    });
    expect(again).toMatchObject({ handled: [], duplicates: 1 });
  });

  it('research brief carries the channel extractions as untrusted blocks', async () => {
    const find = () =>
      brain.calls.find((c) => c.kind === 'run' && c.brief?.focus === 'thread:c1')?.brief;
    await waitFor(() => Boolean(find()), 8000);
    const brief = find();
    expect(brief).toBeDefined();
    const kinds = brief?.untrusted.map((b) => b.kind) ?? [];
    expect(kinds).toEqual(expect.arrayContaining(['caption', 'comments', 'thread']));
    expect(brief?.untrusted.find((b) => b.kind === 'thread')?.label).toBe('primary thread');
    expect(brief?.untrusted.every((b) => b.source === 'instagram')).toBe(true);
  });

  it('polling fallback turns newly tagged media into comments-focused items', async () => {
    graph.tags = [
      { id: 'M3', permalink: 'https://www.instagram.com/p/TAG789/', caption: 'tagged' },
    ];
    expect(await ig.pollMentions()).toBe(1);
    expect(await ig.pollMentions()).toBe(0);
    const item = env.repo.listItems().find((i) => i.sourceUrl?.includes('TAG789'));
    expect(item).toMatchObject({ channel: 'ig_mention', focus: 'comments' });
  });

  it('simulate-mention route and test DM route work with a device token', async () => {
    const sim = await app.inject({
      method: 'POST',
      url: '/api/ig/simulate-mention',
      headers: auth(),
      payload: { media_id: 'M1', comment_id: 'c3' },
    });
    expect(sim.statusCode).toBe(200);
    expect(sim.json()).toMatchObject({ duplicates: 1 });
    const t = await app.inject({
      method: 'POST',
      url: '/api/ig/test',
      headers: auth(),
      payload: { recipientId: 'USER9' },
    });
    expect(t.statusCode).toBe(200);
    expect(graph.sent).toEqual([{ recipientId: 'USER9', text: 'Doubletake test' }]);
    const del = await app.inject({ method: 'DELETE', url: '/api/ig/account', headers: auth() });
    expect(del.statusCode).toBe(204);
    expect(env.repo.getIgAccount()).toBeUndefined();
  });
});
