/**
 * Turn a stored extraction's JSON content into readable text, whatever produced it
 * (media worker, platform extractor, Instagram Graph). Used for the chat view's Sources tab,
 * for FTS indexing and for the untrusted blocks of follow-ups (docs/MEDIA-PIPELINE.md §Shapes).
 */

import { fmtTs } from '../media/stage.js';

const MAX_CHARS = 20_000;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

function cap(s: string): string {
  const t = s.trim();
  return t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS)}\n… (truncated)` : t;
}

function transcript(c: unknown): string {
  if (isRec(c) && Array.isArray(c.segments)) {
    return c.segments
      .map((s) => (isRec(s) ? `[${fmtTs(Number(s.start ?? 0))}] ${str(s.text).trim()}` : ''))
      .filter((l) => l.length > 0)
      .join('\n');
  }
  return generic(c);
}

function ocr(c: unknown): string {
  if (isRec(c)) {
    if (Array.isArray(c.frames) && c.frames.length) {
      return c.frames
        .map((f) => {
          if (!isRec(f)) return '';
          const lines = Array.isArray(f.lines) ? f.lines.map(str).filter(Boolean) : [];
          return lines.length ? `[${fmtTs(Number(f.ts ?? 0))}] ${lines.join(' | ')}` : '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (Array.isArray(c.merged)) return c.merged.map(str).filter(Boolean).join('\n');
  }
  return generic(c);
}

function frames(c: unknown): string {
  if (isRec(c) && Array.isArray(c.frames)) {
    return c.frames
      .map((f) => (isRec(f) ? `[${fmtTs(Number(f.ts ?? 0))}] ${str(f.text).trim()}` : ''))
      .filter(Boolean)
      .join('\n');
  }
  return generic(c);
}

function comment(v: unknown, depth = 0): string {
  const pad = '  '.repeat(depth);
  if (typeof v === 'string') return `${pad}- ${v.trim()}`;
  if (!isRec(v)) return '';
  const who = str(v.author) || str(v.username) || 'anon';
  const likes = Number(v.likes ?? v.like_count ?? v.score ?? 0);
  const body = str(v.text ?? v.body)
    .trim()
    .replace(/\s*\n\s*/g, ' ');
  if (!body) return '';
  return `${pad}- ${who}${likes ? ` (+${likes})` : ''}: ${body}`;
}

function comments(c: unknown): string {
  const list = Array.isArray(c)
    ? c
    : isRec(c)
      ? Array.isArray(c.sampled)
        ? c.sampled
        : Array.isArray(c.comments)
          ? c.comments
          : null
      : null;
  if (!list) return generic(c);
  const head =
    isRec(c) && typeof c.total === 'number' ? `${c.total} comments, ${list.length} shown\n` : '';
  return (
    head +
    list
      .map((x) => comment(x))
      .filter(Boolean)
      .join('\n')
  );
}

function thread(c: unknown): string {
  if (isRec(c) && ('parent' in c || 'replies' in c)) {
    const parts: string[] = [];
    if (c.parent) parts.push(comment(c.parent));
    if (Array.isArray(c.replies))
      parts.push(...c.replies.map((r) => comment(r, 1)).filter(Boolean));
    return parts.join('\n');
  }
  return comments(c);
}

function caption(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!isRec(c)) return generic(c);
  const parts: string[] = [];
  const o = isRec(c.oembed) ? c.oembed : null;
  const meta = isRec(c.meta) ? c.meta : null;
  const title = str(c.title) || (o ? str(o.title) : '') || (meta ? str(meta.title) : '');
  const author =
    str(c.author) || (o ? str(o.author_name) : '') || (isRec(c.user) ? str(c.user.name) : '');
  if (title) parts.push(title);
  if (author) parts.push(`by ${author}`);
  const body =
    str(c.selftext) || str(c.text) || str(c.caption) || (meta ? str(meta.description) : '');
  if (body) parts.push('', body);
  if (typeof c.score === 'number') parts.push('', `score ${c.score}`);
  return parts.length ? parts.join('\n') : generic(c);
}

function page(c: unknown): string {
  if (typeof c === 'string') return c;
  if (isRec(c)) {
    const parts: string[] = [];
    const title = str(c.title);
    if (title) parts.push(title);
    if (str(c.author)) parts.push(`by ${str(c.author)}`);
    if (str(c.text)) parts.push('', str(c.text));
    if (parts.length) return parts.join('\n');
  }
  return generic(c);
}

function generic(c: unknown): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.every((x) => typeof x === 'string')) return c.join('\n');
  try {
    return JSON.stringify(c, null, 1);
  } catch {
    return String(c);
  }
}

/** Human-readable text for one extraction; empty string when there is nothing to show. */
export function extractionText(kind: string, content: unknown): string {
  switch (kind) {
    case 'transcript':
      return cap(transcript(content));
    case 'ocr':
      return cap(ocr(content));
    case 'frame_description':
      return cap(frames(content));
    case 'comments':
      return cap(comments(content));
    case 'thread':
      return cap(thread(content));
    case 'caption':
      return cap(caption(content));
    case 'page_text':
      return cap(page(content));
    default:
      return cap(generic(content));
  }
}

/** Parse the JSON column of an `extractions` row; falls back to the raw string. */
export function parseExtraction(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
