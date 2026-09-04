/**
 * Shareable read-only collection pages (ADR 0025). The owner mints a random token for a
 * collection; `GET /s/<token>` renders its items as one self-contained HTML page: title,
 * source link, platform, saved date, tags and the first answer. No scripts, no device token,
 * no owner note (that is the owner's private question), no extraction text. Revoking the token
 * or hiding/deleting the collection makes the page a 404.
 */

import { randomBytes } from 'node:crypto';
import type { Config } from '../config/index.js';
import type { Repo } from '../db/repo.js';
import { resolveCollection } from './collections.js';

export const SHARE_PATH_PREFIX = '/s/';

export function newShareToken(): string {
  return randomBytes(18).toString('base64url');
}

export function shareUrl(cfg: Config, token: string): string {
  const base =
    cfg.sharePublic && cfg.ig.webhookPublicHost
      ? `https://${cfg.ig.webhookPublicHost}`
      : (cfg.publicUrl ?? `http://${cfg.bind}:${cfg.port}`).replace(/\/$/, '');
  return `${base}${SHARE_PATH_PREFIX}${token}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Deliberately small Markdown subset (headings, bullets, paragraphs, bold, code, links) so the
 * page needs no dependency and cannot carry raw HTML from an answer.
 */
export function markdownToHtml(md: string): string {
  const inline = (raw: string): string => {
    let t = escapeHtml(raw);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, href: string) => {
      return `<a href="${href}" rel="noopener noreferrer nofollow">${label}</a>`;
    });
    return t;
  };
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join(' ')}</p>`);
    para = [];
  };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (h?.[2] !== undefined) {
      flushPara();
      flushList();
      const level = Math.min(6, (h[1]?.length ?? 1) + 2); // answers start at h2 → h4 on the page
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (b?.[1] !== undefined) {
      flushPara();
      list.push(inline(b[1]));
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(inline(line.trim()));
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}

export interface SharedItemView {
  title: string;
  url: string | null;
  platform: string;
  savedAt: string;
  tags: string[];
  answer: string | null;
}

export function sharedItems(
  repo: Repo,
  c: { id: string; query: string; manual: boolean },
): SharedItemView[] {
  const out: SharedItemView[] = [];
  for (const itemId of resolveCollection(repo, c)) {
    const item = repo.getItem(itemId);
    if (!item) continue;
    const chat = repo.getChatByItem(item.id);
    const answer = chat
      ? (repo.listMessages(chat.id).find((m) => m.role === 'assistant' && m.kind === 'answer')
          ?.content ?? null)
      : null;
    out.push({
      title: item.title ?? item.sourceUrl ?? item.text?.slice(0, 80) ?? 'Untitled',
      url: item.canonicalUrl ?? item.sourceUrl ?? null,
      platform: item.platform,
      savedAt: item.createdAt,
      tags: repo.listTags(item.id),
      answer,
    });
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

const CSS = `
:root{color-scheme:light dark;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5}
body{margin:0 auto;max-width:720px;padding:24px 16px 64px}
header h1{margin:0 0 4px;font-size:1.6rem}
header p{margin:0 0 24px;opacity:.7}
article{border:1px solid rgba(127,127,127,.35);border-radius:12px;padding:16px;margin:0 0 16px}
article h2{margin:0 0 4px;font-size:1.15rem}
.meta{font-size:.85rem;opacity:.7;margin:0 0 8px}
.tags span{display:inline-block;font-size:.8rem;border:1px solid rgba(127,127,127,.4);border-radius:999px;padding:0 8px;margin:0 4px 4px 0}
.answer{margin-top:8px}
.answer h4,.answer h5,.answer h6{margin:12px 0 4px;font-size:1rem}
.answer p,.answer ul{margin:6px 0}
code{font-size:.9em}
footer{margin-top:32px;font-size:.8rem;opacity:.6}
a{color:inherit}
`;

export function renderSharePage(name: string, items: SharedItemView[]): string {
  const cards = items.length
    ? items
        .map((it) => {
          const title = it.url
            ? `<a href="${escapeHtml(it.url)}" rel="noopener noreferrer nofollow">${escapeHtml(it.title)}</a>`
            : escapeHtml(it.title);
          const tags = it.tags.length
            ? `<div class="tags">${it.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
            : '';
          const answer = it.answer
            ? `<div class="answer">${markdownToHtml(it.answer)}</div>`
            : '<p class="meta">Research pending.</p>';
          return `<article><h2>${title}</h2><p class="meta">${escapeHtml(it.platform)} · saved ${escapeHtml(it.savedAt.slice(0, 10))}</p>${tags}${answer}</article>`;
        })
        .join('\n')
    : '<p class="meta">Nothing in this collection yet.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(name)} · Doubletake</title>
<style>${CSS}</style>
</head>
<body>
<header><h1>${escapeHtml(name)}</h1><p>${items.length} item${items.length === 1 ? '' : 's'} · shared read-only from a Doubletake library</p></header>
${cards}
<footer>Made with <a href="https://github.com/roowus/doubletake" rel="noopener noreferrer">Doubletake</a>. Answers were researched by an AI and may be wrong; check the sources.</footer>
</body>
</html>
`;
}
