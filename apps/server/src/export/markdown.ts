import fs from 'node:fs';
import path from 'node:path';
import type { Answer } from '@doubletake/shared';

export interface ExportInput {
  notesDir: string;
  itemId: string;
  title: string;
  sourceUrl: string | null;
  platform: string;
  note: string | null;
  mode: string;
  costUsd: number | null;
  createdAt: string;
  /** Conversation in order: the answer first, then follow-ups. */
  messages: { role: string; kind?: string; content: string; createdAt: string }[];
  structured: Answer | null;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

function yamlStr(s: string): string {
  return JSON.stringify(s);
}

/**
 * Write (or rewrite) the Obsidian-friendly note for one item:
 * `<notesDir>/<yyyy>/<yyyy-mm-dd> <slug>.md`. Idempotent: the path is derived from item id + date,
 * so follow-ups re-export over the same file. Returns the absolute path.
 */
export function exportItemMarkdown(input: ExportInput): string {
  const d = new Date(input.createdAt);
  const yyyy = String(d.getFullYear());
  const day = d.toISOString().slice(0, 10);
  const dir = path.join(input.notesDir, yyyy);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${day} ${slugify(input.title)} ${input.itemId.slice(-6)}.md`);

  const s = input.structured;
  const tags = (s?.tags ?? []).map(slugify).filter(Boolean);
  const fm: string[] = ['---'];
  fm.push(`title: ${yamlStr(input.title)}`);
  fm.push(`doubletake_id: ${input.itemId}`);
  if (input.sourceUrl) fm.push(`url: ${yamlStr(input.sourceUrl)}`);
  fm.push(`platform: ${input.platform}`);
  fm.push(`captured: ${input.createdAt}`);
  fm.push(`mode: ${input.mode}`);
  if (s?.category) fm.push(`category: ${s.category}`);
  if (input.costUsd != null) fm.push(`cost_usd: ${input.costUsd.toFixed(4)}`);
  if (tags.length) fm.push(`tags: [${tags.join(', ')}]`);
  fm.push('---', '');

  const body: string[] = [];
  body.push(`# ${input.title}`, '');
  if (input.sourceUrl) body.push(`Source: ${input.sourceUrl}`, '');
  if (input.note?.trim())
    body.push('> [!note] Owner note', `> ${input.note.trim().replaceAll('\n', '\n> ')}`, '');
  if (s?.summary) body.push(`**Summary:** ${s.summary}`, '');

  for (const m of input.messages) {
    // The first user message is the owner note already rendered above.
    if (m.role === 'user' && m.kind === 'question') continue;
    if (m.role === 'user')
      body.push(`## Follow-up (${m.createdAt.slice(0, 16).replace('T', ' ')})`, '', m.content, '');
    else body.push(m.content, '');
  }

  if (s?.entities.length) {
    body.push('## Extracted', '');
    for (const e of s.entities) {
      const attrs = Object.entries(e.attributes ?? {})
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ');
      body.push(
        `- **${e.name}** (${e.kind})${attrs ? ` — ${attrs}` : ''}${e.url ? ` — ${e.url}` : ''}`,
      );
    }
    body.push('');
  }
  if (s?.claims.length) {
    body.push('## Claims', '', '| Claim | Verdict | Sources |', '|---|---|---|');
    for (const c of s.claims)
      body.push(`| ${c.claim.replaceAll('|', '\\|')} | ${c.verdict} | ${c.sources.join(' ')} |`);
    body.push('');
  }
  if (s?.recommendations.length) {
    body.push('## Recommendations', '');
    for (const r of s.recommendations) body.push(`- ${r}`);
    body.push('');
  }
  fs.writeFileSync(file, `${fm.join('\n')}${body.join('\n')}`);
  return file;
}
