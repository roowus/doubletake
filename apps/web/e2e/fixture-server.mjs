// Fixture API for the visual-regression suite (docs/ARCHITECTURE.md §9). A plain node:http
// server that serves the built PWA from `dist/` and answers the handful of `/api` routes the
// screenshotted pages call with fixed data, so a screenshot never depends on a live server,
// clock or brain. The chat answer is the same `rich-answer.md` fixture the server and unit
// tests use, so table + chart + mermaid rendering is pinned by the same file everywhere.
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../dist');
const port = Number(process.env.PORT ?? 4173);

const raw = readFileSync(resolve(here, '../../server/test/fixtures/rich-answer.md'), 'utf8');
// Split the trailing ```answer block off the prose the same way `parseAnswerBlock` does.
const fence = raw.match(/```answer\s*\n([\s\S]*?)\n```\s*$/);
const answerText = fence ? raw.slice(0, fence.index).trim() : raw.trim();
const structured = fence ? JSON.parse(fence[1]) : null;

const T = (h, m = 0) =>
  `2026-09-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const CHAT_ID = '01M1WPFIXTURE0000000000001';

const chats = [
  {
    id: CHAT_ID,
    itemId: '01M1WPFIXTUREITEM000000001',
    title: 'Osmo Pocket 3 vs Insta360 Ace Pro 2 for travel',
    platform: 'youtube',
    channel: 'android_share',
    status: 'answered',
    category: 'tech',
    unreadCount: 1,
    lastMessageAt: T(10, 2),
    createdAt: T(10, 0),
    sourceUrl: 'https://www.youtube.com/watch?v=fixture01',
    tags: ['camera', 'travel', 'vlog'],
  },
  {
    id: '01M1WPFIXTURE0000000000002',
    itemId: '01M1WPFIXTUREITEM000000002',
    title: 'Is the Lisbon tram 28 worth queuing for?',
    platform: 'instagram',
    channel: 'ig_dm',
    status: 'answered',
    category: 'travel',
    unreadCount: 0,
    lastMessageAt: T(9, 15),
    createdAt: T(9, 10),
    sourceUrl: 'https://www.instagram.com/reel/fixture02/',
    tags: ['lisbon', 'travel'],
  },
  {
    id: '01M1WPFIXTURE0000000000003',
    itemId: '01M1WPFIXTUREITEM000000003',
    title: 'Sourdough focaccia, no-knead overnight',
    platform: 'tiktok',
    channel: 'android_share',
    status: 'answered',
    category: 'food',
    unreadCount: 0,
    lastMessageAt: T(8, 40),
    createdAt: T(8, 30),
    sourceUrl: 'https://www.tiktok.com/@fixture/video/3',
    tags: ['recipe', 'baking'],
  },
  {
    id: '01M1WPFIXTURE0000000000004',
    itemId: '01M1WPFIXTUREITEM000000004',
    title: 'Does the "80/20 sleep rule" thread hold up?',
    platform: 'reddit',
    channel: 'compose',
    status: 'running',
    category: 'health',
    unreadCount: 0,
    lastMessageAt: T(7, 55),
    createdAt: T(7, 50),
    sourceUrl: 'https://www.reddit.com/r/sleep/comments/fixture04/',
    tags: ['sleep', 'claims'],
  },
  {
    id: '01M1WPFIXTURE0000000000005',
    itemId: '01M1WPFIXTUREITEM000000005',
    title: 'Cheapest way to ship a bike frame within the EU',
    platform: 'web',
    channel: 'compose',
    status: 'answered',
    category: 'shopping',
    unreadCount: 0,
    lastMessageAt: T(6, 20),
    createdAt: T(6, 5),
    sourceUrl: 'https://example.com/bike-shipping',
    tags: ['cycling', 'shipping'],
  },
];

const run = {
  id: '01M1WPFIXTURERUN0000000001',
  kind: 'research',
  mode: 'standard',
  adapter: 'claude',
  model: 'claude-sonnet-5',
  pinned: false,
  status: 'done',
  costUsd: 0.0421,
  startedAt: T(10, 0),
  finishedAt: T(10, 2),
  error: null,
};

const detail = {
  chat: chats[0],
  item: {
    note: 'Which one should I take on the Portugal trip? Mostly walking around and food.',
    focus: 'whole',
    modeRequested: 'auto',
    modeEffective: 'standard',
    questionType: 'compare',
    canonicalUrl: 'https://www.youtube.com/watch?v=fixture01',
    sourceUrl: 'https://www.youtube.com/watch?v=fixture01',
    title: 'Osmo Pocket 3 vs Insta360 Ace Pro 2 — which travel camera? (12:41)',
    preview: null,
  },
  messages: [
    {
      id: 'm1',
      role: 'user',
      kind: 'share',
      content: 'https://www.youtube.com/watch?v=fixture01',
      structured: null,
      runId: null,
      createdAt: T(10, 0),
    },
    {
      id: 'm2',
      role: 'assistant',
      kind: 'answer',
      content: answerText,
      structured,
      runId: run.id,
      createdAt: T(10, 2),
    },
  ],
  runs: [run],
  entities: structured?.entities ?? [],
  extractions: [
    {
      id: 'x1',
      kind: 'transcript',
      tool: 'whisper',
      createdAt: T(10, 1),
      text: 'So the big question everyone asks me is which of these two should you actually bring on a trip…',
    },
    {
      id: 'x2',
      kind: 'page_text',
      tool: 'readability',
      createdAt: T(10, 1),
      text: 'Osmo Pocket 3 vs Insta360 Ace Pro 2 — which travel camera? 1.2M views.',
    },
  ],
};

const ev = (seq, type, payload, m) => ({
  runId: run.id,
  chatId: CHAT_ID,
  seq,
  type,
  payload,
  at: T(10, m),
});
const events = [
  ev(1, 'status', { phase: 'classify', detail: 'compare · standard' }, 0),
  ev(2, 'status', { phase: 'extract', detail: 'transcript (whisper), page text' }, 0),
  ev(3, 'tool_call', { tool: 'web_fetch', input: { url: 'https://www.dji.com/osmo-pocket-3' } }, 1),
  ev(
    4,
    'tool_result',
    { tool: 'web_fetch', summary: 'DJI Osmo Pocket 3 — 1-inch CMOS, 3-axis gimbal, $519' },
    1,
  ),
  ev(
    5,
    'tool_call',
    { tool: 'web_fetch', input: { url: 'https://www.insta360.com/product/insta360-ace-pro-2' } },
    1,
  ),
  ev(
    6,
    'tool_result',
    { tool: 'web_fetch', summary: 'Insta360 Ace Pro 2 — 1/1.3-inch, waterproof 12 m, $399' },
    1,
  ),
  ev(7, 'done', { stopReason: 'end_turn', costUsd: 0.0421 }, 2),
];

const tags = [
  ['travel', 2],
  ['camera', 1],
  ['vlog', 1],
  ['lisbon', 1],
  ['recipe', 1],
  ['baking', 1],
  ['sleep', 1],
  ['claims', 1],
  ['cycling', 1],
  ['shipping', 1],
].map(([name, count]) => ({ name, kind: 'tag', count }));

const coll = (id, name, query, count, extra = {}) => ({
  id,
  name,
  query,
  manual: false,
  auto: true,
  hidden: false,
  count,
  shareUrl: null,
  ...extra,
});
const collections = [
  coll('c-portugal', 'Portugal trip', 'tag:travel', 2, { manual: true, auto: false }),
  coll('c-kitchen', 'Kitchen', 'tag:recipe', 1, { manual: true, auto: false }),
  coll('e-place', 'Places', 'entity:place', 3),
  coll('e-recipe', 'Recipes', 'entity:recipe', 1),
  coll('e-product', 'Products', 'entity:product', 2),
  coll('e-tool', 'Tools', 'entity:tool', 0),
  coll('e-tip', 'Tips', 'entity:tip', 4),
  coll('e-media', 'Media', 'entity:media', 1),
  coll('e-person', 'People', 'entity:person', 0),
  coll('e-event', 'Events', 'entity:event', 0),
  coll('k-tech', 'Tech', 'category:tech', 1),
  coll('k-travel', 'Travel', 'category:travel', 1),
  coll('k-food', 'Food', 'category:food', 1),
  coll('k-health', 'Health', 'category:health', 1),
  coll('k-shopping', 'Shopping', 'category:shopping', 1),
];

const place = (name, city, region, country, lat, lon) => ({
  kind: 'place',
  name,
  attributes: { city, region, country },
  geo: { lat, lon, label: `${name}, ${city}`, source: 'brain' },
  confidence: 0.85,
  chatId: chats[1].id,
  itemTitle: chats[1].title,
  platform: 'instagram',
  createdAt: T(9, 15),
});
const entities = {
  place: [
    place('Miradouro de Santa Luzia', 'Lisbon', 'Lisboa', 'Portugal', 38.7116, -9.1301),
    place('Time Out Market', 'Lisbon', 'Lisboa', 'Portugal', 38.7071, -9.1458),
    place('Café A Brasileira', 'Lisbon', 'Lisboa', 'Portugal', 38.7107, -9.1424),
  ],
  product: (structured?.entities ?? []).map((e) => ({
    ...e,
    chatId: CHAT_ID,
    itemTitle: chats[0].title,
    platform: 'youtube',
    createdAt: T(10, 2),
  })),
};

const status = {
  spentTodayUsd: 0.31,
  dailyCapUsd: 5,
  brain: 'claude',
  brainIds: ['claude', 'gemini'],
  brains: [
    { id: 'claude', default: true, modes: [], ok: true, detail: null, checkedAt: T(9, 58) },
    { id: 'gemini', default: false, modes: ['quick'], ok: true, detail: null, checkedAt: T(9, 58) },
  ],
  notesDir: '/home/owner/Doubletake',
  push: {
    kinds: ['answer_ready'],
    channels: [],
    vapidPublicKey: 'BFixtureVapidKeyNotReal',
    quietHours: { enabled: true, start: '23:00', end: '07:00', timeZone: 'Europe/Lisbon' },
    pending: 0,
  },
};

const devices = [
  {
    id: 'd1',
    name: 'MacBook Pro',
    platform: 'web',
    lastSeenAt: T(10, 3),
    revokedAt: null,
    createdAt: T(6),
  },
  {
    id: 'd2',
    name: 'Galaxy S25',
    platform: 'android',
    lastSeenAt: T(9, 50),
    revokedAt: null,
    createdAt: T(6, 30),
  },
];

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, hasOwner: true })],
  [
    'GET',
    /^\/api\/chats$/,
    (u) => {
      const q = u.searchParams.get('q')?.toLowerCase();
      const tag = u.searchParams.get('tag');
      const collection = u.searchParams.get('collection');
      let out = chats;
      if (q) out = out.filter((c) => c.title.toLowerCase().includes(q));
      if (tag) out = out.filter((c) => c.tags.includes(tag));
      if (collection) out = out.filter((c) => c.tags.includes('travel'));
      return out;
    },
  ],
  ['GET', /^\/api\/chats\/[^/]+\/collections$/, () => ({ collectionIds: ['c-portugal'] })],
  ['GET', /^\/api\/chats\/[^/]+\/runs\/[^/]+\/events$/, () => ({ events })],
  [
    'GET',
    /^\/api\/chats\/([^/]+)$/,
    (_u, m) => {
      const c = chats.find((x) => x.id === m[1]);
      return c ? { ...detail, chat: c } : null;
    },
  ],
  ['POST', /^\/api\/chats\/[^/]+\/read$/, () => ({ ok: true })],
  ['GET', /^\/api\/tags$/, () => tags],
  ['GET', /^\/api\/todos$/, () => []],
  [
    'GET',
    /^\/api\/collections$/,
    (u) =>
      u.searchParams.get('all') === 'true'
        ? collections
        : collections.filter((c) => c.manual || c.count > 0),
  ],
  ['GET', /^\/api\/collections\/preview$/, () => ({ count: 2 })],
  ['GET', /^\/api\/entities$/, (u) => entities[u.searchParams.get('kind') ?? ''] ?? []],
  ['GET', /^\/api\/status$/, () => status],
  ['GET', /^\/api\/devices$/, () => devices],
  ['GET', /^\/api\/push\/subscriptions$/, () => []],
  ['GET', /^\/api\/ig\/status$/, () => null],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

function serveStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, rel);
  try {
    if (!statSync(file).isFile()) throw new Error('dir');
  } catch {
    file = join(dist, 'index.html'); // SPA fallback: the client router owns every path
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
  for (const [method, re, handler] of routes) {
    const m = url.pathname.match(re);
    if (!m || req.method !== method) continue;
    const body = handler(url, m);
    if (body === null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not found' }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  // Every write route the pages could reach by accident: acknowledge, change nothing.
  res.writeHead(req.method === 'GET' ? 404 : 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(req.method === 'GET' ? { error: 'not found' } : { ok: true }));
});

// `/api/events` is a WebSocket; refusing the upgrade makes the client back off quietly.
server.on('upgrade', (_req, socket) => socket.destroy());

server.listen(port, '127.0.0.1', () => {
  console.log(`fixture api + dist on http://127.0.0.1:${port} (chat ${CHAT_ID})`);
});
