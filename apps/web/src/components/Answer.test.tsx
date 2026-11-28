// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MessageDto } from '@doubletake/shared';
import { parseAnswerBlock } from '@doubletake/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Claims, SourcesReport, Turn } from './Answer';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

// The same fixture the server tests use: a brain reply with a table, a chart, a mermaid
// flowchart, a task list, inline evidence marks and the trailing ```answer block.
const raw = readFileSync(
  resolve(import.meta.dirname, '../../../server/test/fixtures/rich-answer.md'),
  'utf8',
);
const { text, structured } = parseAnswerBlock(raw);

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
    const html = renderToStaticMarkup(<Turn msg={msg} />);
    expect(html).toContain('<article class="turn answer">');
    // No run label above the answer: the run's meta lives in the footer row (ADR 0034).
    expect(html).not.toContain('turn-label');
    expect(html).not.toContain('claude@claude-sonnet-5');
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

  it('turns [[n]] into a superscript mark that links to the claim row', () => {
    const html = renderToStaticMarkup(<Turn msg={msg} />);
    expect(html).toContain('<sup class="mark"><a href="#claim-1" aria-label="Claim 1">1</a></sup>');
    expect(html).toContain('href="#claim-3"');
    // The literal brackets are gone from the prose.
    expect(html).not.toContain('[[1]]');
  });

  it('drops the trailing "Sources:" line, because the sources report owns it', () => {
    const html = renderToStaticMarkup(<Turn msg={msg} />);
    expect(html).not.toMatch(/Sources:\s*<a/);
  });
});

describe('Claims', () => {
  it('prints one row per claim with verdict, source host and the id a mark jumps to', () => {
    const html = renderToStaticMarkup(<Claims claims={structured?.claims ?? []} />);
    expect(html).toContain('class="report"');
    expect(html).toContain('>Claims<');
    expect(html).toContain('1 supported');
    expect(html).toContain('1 contested');
    expect(html).toContain('1 refuted');
    expect(html).toContain('id="claim-1"');
    expect(html).toContain('id="claim-3"');
    expect(html).toContain('class="verdict true"');
    expect(html).toContain('class="verdict mixed"');
    expect(html).toContain('class="verdict false"');
    expect(html).toContain('dji.com');
  });

  it('explains every verdict that is not plainly true', () => {
    const html = renderToStaticMarkup(<Claims claims={structured?.claims ?? []} />);
    expect(html).toContain('class="claim-reason"');
    expect(html).toContain('$519 against $399');
    // A true claim needs no reason, so the first row carries none.
    expect(html.indexOf('claim-reason')).toBeGreaterThan(html.indexOf('id="claim-2"'));
  });

  it('says so when an answer made no claims', () => {
    const html = renderToStaticMarkup(<Claims claims={[]} />);
    expect(html).toContain('nothing to verify');
    expect(html).not.toContain('class="report"');
  });
});

describe('SourcesReport', () => {
  it('lists each distinct URL once with the claim numbers that cite it', () => {
    const html = renderToStaticMarkup(<SourcesReport claims={structured?.claims ?? []} />);
    expect(html).toContain('>Sources<');
    expect(html).toContain('href="https://www.dji.com/osmo-pocket-3"');
    expect(html).toContain('src-host');
    expect(html).toContain('[1] [3]');
    expect(html.match(/dji\.com\/osmo-pocket-3"/g)?.length).toBe(1);
  });

  it('says so when nothing was cited', () => {
    const html = renderToStaticMarkup(<SourcesReport claims={[]} />);
    expect(html).toContain('No sources were cited');
  });
});
