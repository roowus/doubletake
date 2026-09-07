// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MessageDto, RunDto } from '@doubletake/shared';
import { parseAnswerBlock } from '@doubletake/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Claims, Turn } from './Answer';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

// The same fixture the server tests use: a brain reply with a table, a chart, a mermaid
// flowchart, a task list and the trailing ```answer block.
const raw = readFileSync(
  resolve(import.meta.dirname, '../../../server/test/fixtures/rich-answer.md'),
  'utf8',
);
const { text, structured } = parseAnswerBlock(raw);

const run: RunDto = {
  id: 'r1',
  kind: 'research',
  mode: 'standard',
  adapter: 'claude',
  model: 'claude-sonnet-5',
  pinned: true,
  status: 'done',
  costUsd: 0.0421,
  startedAt: '2026-09-07T10:00:00Z',
  finishedAt: '2026-09-07T10:02:10Z',
  error: null,
};
const msg: MessageDto = {
  id: 'm1',
  role: 'assistant',
  kind: 'answer',
  content: text,
  structured: structured ?? null,
  runId: 'r1',
  createdAt: '2026-09-07T10:02:10Z',
};

describe('Turn (answer)', () => {
  it('renders the fixture answer as prose with table, chart, diagram and recommendations', () => {
    const html = renderToStaticMarkup(<Turn msg={msg} run={run} />);
    expect(html).toContain('<article class="turn answer">');
    // Run meta in the label: mode, pinned brain@model, duration, cost.
    expect(html).toContain('<span>standard</span>');
    expect(html).toContain('<span>claude@claude-sonnet-5</span>');
    expect(html).toContain('<span>2 min</span>');
    expect(html).toContain('<span>$0.042</span>');
    // Prose blocks.
    expect(html).toContain('<th>Osmo Pocket 3</th>');
    expect(html).toContain('<figure class="chart bar">');
    expect(html).toContain('<figcaption>Street price, USD</figcaption>');
    expect(html).toContain('<figure class="mermaid pending"');
    expect(html).toContain('<input type="checkbox" disabled="" checked=""');
    expect(html).toContain('<h3>Recommendations</h3>');
    // The structured block never leaks into the prose.
    expect(html).not.toContain('```answer');
    expect(html).not.toContain('"summary"');
  });

  it('renders claims with verdict chips and numbered source links', () => {
    const html = renderToStaticMarkup(<Claims claims={structured?.claims ?? []} />);
    expect(html).toContain('class="verdict true"');
    expect(html).toContain('href="https://www.dji.com/osmo-pocket-3"');
    expect(html).toContain('>[1]</a>');
  });
});
