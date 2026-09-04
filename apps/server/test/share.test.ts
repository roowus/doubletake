import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostAllowed } from '../src/api/instagram.js';
import { buildServer } from '../src/api/server.js';
import { Auth } from '../src/auth/index.js';
import { markdownToHtml, shareUrl } from '../src/library/share.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv } from './helpers.js';

const env = tempEnv('dt-share-');
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
let app: FastifyInstance;
let token = '';
const auth = () => ({ authorization: `Bearer ${token}` });

let colId = '';
let autoId = '';

beforeAll(async () => {
  app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
  await app.ready();
  token = new Auth(env.repo).createDevice('laptop', 'test').token;

  const { item, chat } = env.repo.createItemWithChat(
    {
      url: 'https://www.youtube.com/watch?v=abc',
      note: 'my private question <script>',
      channel: 'compose',
      focus: 'whole',
      modeHint: 'auto',
    },
    'youtube',
    'https://www.youtube.com/watch?v=abc',
    'Ski wax <b>basics</b>',
  );
  env.repo.addMessage({
    chatId: chat.id,
    role: 'assistant',
    kind: 'answer',
    content:
      '## Verdict\n\nMostly **true** — see [source](https://example.com/a).\n\n- tip one\n- tip <two>\n',
  });
  env.repo.addManualTag(item.id, 'skiing');
  colId = env.repo.createCollection({ name: 'Ski', query: '', manual: true, auto: false });
  env.repo.addCollectionItem(colId, item.id);
  autoId = env.repo.createCollection({
    name: 'Travel',
    query: 'category:travel',
    manual: false,
    auto: true,
  });
});
afterAll(async () => {
  await app.close();
  env.cleanup();
});

describe('shareable collection pages (ADR 0025)', () => {
  it('collections start unshared and auto collections refuse to share', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/collections?all=true',
      headers: auth(),
    });
    expect(list.json().find((c: { id: string }) => c.id === colId).shareUrl).toBeNull();
    const r = await app.inject({
      method: 'POST',
      url: `/api/collections/${autoId}/share`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
  });

  it('unknown token is 404 and the share route needs no device token', async () => {
    const r = await app.inject({ method: 'GET', url: '/s/nope-nope-nope' });
    expect(r.statusCode).toBe(404);
  });

  let url = '';
  it('sharing mints a stable token and the public page renders items without the note', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/collections/${colId}/share`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    url = r.json().shareUrl;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:0\/s\/[A-Za-z0-9_-]{20,}$/);
    // Idempotent: sharing again keeps the same link.
    const again = await app.inject({
      method: 'POST',
      url: `/api/collections/${colId}/share`,
      headers: auth(),
    });
    expect(again.json().shareUrl).toBe(url);
    const list = await app.inject({ method: 'GET', url: '/api/collections', headers: auth() });
    expect(list.json().find((c: { id: string }) => c.id === colId).shareUrl).toBe(url);

    const page = await app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['x-robots-tag']).toContain('noindex');
    const html = page.body;
    expect(html).toContain('<h1>Ski</h1>');
    expect(html).toContain('Ski wax &lt;b&gt;basics&lt;/b&gt;');
    expect(html).toContain('https://www.youtube.com/watch?v=abc');
    expect(html).toContain('<strong>true</strong>');
    expect(html).toContain('<li>tip &lt;two&gt;</li>');
    expect(html).toContain('<span>skiing</span>');
    expect(html).not.toContain('my private question');
    expect(html).not.toContain('<script');
  });

  it('revoking the link makes the page 404 and clears shareUrl', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/collections/${colId}/share`,
      headers: auth(),
    });
    expect(r.json().shareUrl).toBeNull();
    const page = await app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(page.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/collections', headers: auth() });
    expect(list.json().find((c: { id: string }) => c.id === colId).shareUrl).toBeNull();
  });

  it('hidden collections are not served even with a valid token', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/collections/${colId}/share`,
      headers: auth(),
    });
    env.repo.updateCollection(colId, { hidden: true });
    const page = await app.inject({ method: 'GET', url: new URL(r.json().shareUrl).pathname });
    expect(page.statusCode).toBe(404);
    env.repo.updateCollection(colId, { hidden: false });
  });

  it('public hostname serves /s/ only when DOUBLETAKE_SHARE_PUBLIC=on', () => {
    expect(hostAllowed(env.cfg, 'hook.example.com', '/s/abcdefghij')).toBe(false);
    const on = { ...env.cfg, sharePublic: true };
    expect(hostAllowed(on, 'hook.example.com', '/s/abcdefghij')).toBe(true);
    expect(hostAllowed(on, 'hook.example.com', '/api/chats')).toBe(false);
    expect(shareUrl(on, 'tok')).toBe('https://hook.example.com/s/tok');
    expect(shareUrl(env.cfg, 'tok')).toBe('http://127.0.0.1:0/s/tok');
  });

  it('markdown subset escapes html and keeps only http(s) links', () => {
    const html = markdownToHtml(
      '# T\n\n<img src=x onerror=1> and [x](javascript:alert(1))\n\n- `a<b`',
    );
    expect(html).toContain('<h3>T</h3>');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).not.toContain('<a href="javascript');
    expect(html).toContain('<code>a&lt;b</code>');
  });
});
