/**
 * Hosted-mode public pages (ADR 0032): landing, privacy policy, terms, and the account
 * deletion page. Static, self-contained HTML with no JS (except the one delete button) so
 * crawlers and Google's verification fetches see the real content in the served markup —
 * no client rendering involved. Registered only when hosted mode is on; the flag off leaves
 * the PWA (or nothing) at every one of these paths, byte-for-byte as before.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HostedAuth } from '../auth/hosted.js';
import { cookieValue, HOSTED_SESSION_COOKIE, isHostedMode } from './hosted.js';
import { LANDING_HTML } from './landing-html.js';

const FOOTER = `<footer><p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/delete">Delete account</a> · <a href="/login">Sign in</a></p><p>Doubletake · contact: <a href="mailto:roowus.dev@gmail.com">roowus.dev@gmail.com</a></p></footer>`;

/** Shared paper-and-ink shell; no external assets, no scripts. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doubletake</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4efe4; color: #2a2620;
    font: 17px/1.65 Georgia, 'Times New Roman', serif; }
  main { max-width: 44rem; margin: 0 auto; padding: 3rem 1.25rem 2rem; }
  h1 { font-size: 2rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; }
  p, li { margin: .6rem 0; }
  ul { padding-left: 1.3rem; }
  a { color: #4a3f2d; }
  .pitch { font-size: 1.15rem; font-style: italic; color: #55503f; }
  footer { border-top: 1px solid #d8cfba; margin-top: 3rem; padding-top: 1rem;
    font-size: .9rem; color: #6b6350; }
  footer p { margin: .25rem 0; }
  button { font: inherit; background: #8c2f24; color: #f4efe4; border: 0;
    border-radius: 6px; padding: .55rem 1.1rem; cursor: pointer; }
  #del-out { font-size: .95rem; }
</style>
</head>
<body>
<main>
${body}
${FOOTER}
</main>
</body>
</html>`;
}

function landingPage(): string {
  return page(
    'Share it now, get a researched answer later',
    `<h1>Doubletake</h1>
<p class="pitch">Share it now. Get a researched answer later. Your AI agents read it back as memory.</p>
<p>Doubletake is a save-it-and-ask assistant. Send a link from your phone's share sheet, and your own AI provider researches it — transcript, comments, the page itself — then answers your question with sources and remembers what mattered.</p>
<ul>
<li><strong>Save from the share sheet.</strong> Share any link, video or post; it lands in your library instantly, from anywhere on the phone.</li>
<li><strong>Researched answers with sources.</strong> Ask a question about what you saved; the run reads the page (and its comments and transcripts) and answers with citations.</li>
<li><strong>MCP memory for your agents.</strong> Claude Code, Truss or any MCP client can sign in with an agent token and read your saved list and answers as memory.</li>
</ul>
<p><a href="/login"><button type="button">Sign in</button></a></p>`,
  );
}

function privacyPage(): string {
  return page(
    'Privacy Policy',
    `<h1>Privacy Policy</h1>
<p>Last updated: October 2026. Doubletake is a free, hosted service at doubletake.gg. Questions or deletion requests: <a href="mailto:roowus.dev@gmail.com">roowus.dev@gmail.com</a>.</p>

<h2>What we collect and store</h2>
<ul>
<li><strong>Account data:</strong> your e-mail address (from registration or Google Sign-In), your display name if you set one, and the hashed password if you set one. Passwords are stored only as argon2id hashes.</li>
<li><strong>What you save:</strong> the links, notes and media you share into Doubletake, and the library built from them (titles, tags, collections, your saved to-do list).</li>
<li><strong>Content we extract from saved links:</strong> page text, video transcripts, OCR of frames, comments and the like, fetched from the source when a run needs it. Extracted content is stored so runs and your agents can re-read it.</li>
<li><strong>Chats and answers:</strong> the questions you ask and the answers produced, including which model ran them.</li>
<li><strong>Usage and cost metadata:</strong> run timings, token counts and cost in USD, used to show your spend and enforce the caps you set.</li>
<li><strong>Sessions:</strong> the browser/device/agent tokens that sign in as you, stored only as SHA-256 hashes with a label and last-used time.</li>
</ul>

<h2>What we never store in readable form</h2>
<p>Your AI provider API keys (OpenRouter, Anthropic, or any other provider you connect) are <strong>encrypted at rest</strong> with a server master key (ChaCha20-Poly1305 authenticated encryption) and are <strong>only decrypted in memory, for the duration of one of your runs</strong>. They never appear in logs, error messages, API responses or backups. Revoking a credential wipes the stored key material immediately.</p>

<h2>Third parties</h2>
<ul>
<li><strong>Google</strong> — if you use Google Sign-In, Google shares your account identity (name, e-mail, account id) with us for authentication. We store the account id and e-mail.</li>
<li><strong>Your AI provider (e.g. OpenRouter or Anthropic)</strong> — research runs are executed and billed against <em>your own</em> credentials. Run content (saved pages, your question) is sent to the provider you chose to answer it. We do not run models ourselves and never bill you.</li>
<li><strong>Cloudflare</strong> — DNS and CDN in front of the site, subject to Cloudflare's own policies.</li>
<li><strong>Oracle Cloud</strong> — the hosting provider for the server and its Postgres database.</li>
</ul>

<h2>Google API Services User Data Policy / Limited Use</h2>
<p>Doubletake's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Doubletake will not use, transfer, or disclose Google user data except as described in this policy: to authenticate you, to maintain your account, and to provide the service you asked for. Doubletake does not use Google user data for advertising, does not sell it, and does not allow human review of it except with your consent, for security purposes, or as required by law.</p>

<h2>Data retention</h2>
<p>Your data is kept until you delete your account. There is no separate archival copy: the application database is the only store of your saved items, chats, answers and extracted content.</p>

<h2>Deletion</h2>
<p>You can delete your account at any time, self-serve and immediately: use the <strong>Delete account</strong> button on the Account settings page, or visit <a href="/delete">doubletake.gg/delete</a>. Deletion is immediate and permanent — the account row and everything attached to it (saved items, extracted content, chats, answers, to-dos, sessions, agent tokens, stored credential keys and spend records) is removed in a single transaction, and your sign-in token stops working at once. If you cannot sign in, e-mail <a href="mailto:roowus.dev@gmail.com">roowus.dev@gmail.com</a> from the account address and we will delete it for you.</p>`,
  );
}

function termsPage(): string {
  return page(
    'Terms of Service',
    `<h1>Terms of Service</h1>
<p>Last updated: October 2026. By creating an account on Doubletake you agree to these terms.</p>

<h2>The service</h2>
<p>Doubletake lets you save links and get researched answers to questions about them, using the AI provider credentials you supply. The service is free of charge to you for the application itself; AI usage is billed by your provider against your own credentials.</p>

<h2>No warranty; availability</h2>
<p>Doubletake is provided <strong>as is</strong>, without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. Because the service is free, <strong>there is no guarantee of service availability</strong>: it may be slow, interrupted, changed or discontinued at any time, with or without notice. Do not rely on Doubletake as your only copy of anything important.</p>

<h2>Your credentials and your spend</h2>
<p>You are responsible for the AI provider credentials you connect and for <strong>all spend you authorize</strong> with them. Caps (monthly and per-run) are offered as a courtesy limit enforced by the software, but the charges themselves come from your provider under your account with that provider. Doubletake is never the biller and is not party to your agreement with your provider. Keep your credentials and session tokens safe; anyone holding your password or token can run runs billed to you.</p>

<h2>Acceptable use</h2>
<p>You agree not to use Doubletake to save, extract or generate illegal content, to attack or abuse the shared service (excessive automated load, attempts to breach other accounts), or to resell access to it. Content that is illegal, or use that degrades the service for others, is not permitted.</p>

<h2>Termination</h2>
<p>Accounts may be suspended or terminated for abuse of the service or breach of these terms. You may delete your account at any time from Account settings or <a href="/delete">/delete</a>; deletion is immediate.</p>

<h2>Content ownership</h2>
<p>Content you save, notes you write and questions you ask remain <strong>yours</strong>. You grant Doubletake only the limited right to store, extract from, and process that content as needed to provide the service (including sending it to the AI provider you chose). Answers and extractions produced for you are yours to use; underlying source material remains the property of its owners.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of [TBD — owner's jurisdiction], without regard to conflict-of-law rules.</p>`,
  );
}

function deletePage(): string {
  return page(
    'Delete your account',
    `<h1>Delete your account</h1>
<p>Deleting your Doubletake account is immediate and permanent. In one step it removes your account, every saved item, the extracted page content and transcripts, your chats and answers, your saved list, all sessions and agent tokens, and the encrypted AI provider keys you stored. There is no undo and no recovery.</p>
<p>You must be signed in to delete from this page. If you are not signed in, <a href="/login">log in first</a>, then come back here — or use the <strong>Delete account</strong> button at the bottom of Account settings. If you cannot sign in at all, e-mail <a href="mailto:roowus.dev@gmail.com">roowus.dev@gmail.com</a> from your account address.</p>
<p><button type="button" id="del-btn">Delete my account permanently</button></p>
<p id="del-out" role="status"></p>
<script>
document.getElementById('del-btn').addEventListener('click', async function () {
  var out = document.getElementById('del-out');
  if (!window.confirm('Permanently delete your Doubletake account and everything saved in it? This cannot be undone.')) return;
  out.textContent = 'Deleting…';
  try {
    var res = await fetch('/api/account', { method: 'DELETE' });
    if (res.ok) {
      out.textContent = 'Your account has been deleted. Goodbye.';
    } else if (res.status === 401) {
      out.textContent = 'You are not signed in. Log in first, then return to this page.';
    } else {
      out.textContent = 'Deletion failed (' + res.status + '). Try Account settings, or e-mail roowus.dev@gmail.com.';
    }
  } catch (e) {
    out.textContent = 'Deletion failed (network error). Try again, or e-mail roowus.dev@gmail.com.';
  }
});
</script>`,
  );
}

/**
 * The PWA is served at `/` for anyone with a valid hosted session (browser cookie or
 * bearer); anonymous visitors — and that includes Google's crawlers — get the static
 * landing instead. Requests that carry an unauthenticated token are also shown the landing
 * rather than a 401: `/` is a page, not an API.
 */
async function rootPage(app: FastifyInstance, hosted: HostedAuth): Promise<void> {
  // The landing owns / for EVERYONE, signed in or not. This is an explicit route (not a
  // request hook) so it is registered before the static plugin and the not-found shell
  // fallback: GET / can never fall through to the app shell, whatever the auth state.
  const OPEN_PILL = `<a class="open-pill" href="/library">Open your library</a>`;
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const cookie = cookieValue(req.headers.cookie, HOSTED_SESSION_COOKIE);
    const token = bearer ?? cookie;
    let signedIn = false;
    if (token) {
      try {
        signedIn = Boolean(await hosted.authenticate(token));
      } catch {
        signedIn = false; // a malformed cookie/token must never break the landing
      }
    }
    reply.header('cache-control', 'no-store');
    const html = signedIn
      ? LANDING_HTML.replace('</body>', `${OPEN_PILL}</body>`)
      : LANDING_HTML;
    return reply.code(200).type('text/html; charset=utf-8').send(html);
  });
}

/** Hosted-only static pages; no-op (and every path keeps its old behaviour) when not hosted. */
export function registerHostedPages(app: FastifyInstance, hosted: HostedAuth | undefined): void {
  if (!isHostedMode() || !hosted) return;
  app.get('/welcome', async (_req, reply) =>
    reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(landingPage()),
  );
  app.get('/privacy', async (_req, reply) =>
    reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(privacyPage()),
  );
  app.get('/terms', async (_req, reply) =>
    reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(termsPage()),
  );
  app.get('/delete', async (_req, reply) =>
    reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(deletePage()),
  );
  void rootPage(app, hosted);
}
