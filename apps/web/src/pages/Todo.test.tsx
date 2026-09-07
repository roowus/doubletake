// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Entity, type MessageDto, parseAnswerBlock, type RunDto } from '@doubletake/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Turn } from '../components/Answer';
import { Things } from '../components/AnswerTabs';

vi.mock('mermaid', () => ({ default: { initialize() {}, render: async () => ({ svg: '' }) } }));

const { text, structured } = parseAnswerBlock(
  readFileSync(resolve(__dirname, '../../../server/test/fixtures/rich-answer.md'), 'utf8'),
);

const entities: Entity[] = [
  {
    kind: 'place',
    name: 'Café Kitsuné',
    attributes: { city: 'Paris' },
    url: 'https://maps.example/kitsune',
    confidence: 0.9,
  },
  { kind: 'tool', name: 'ripgrep', attributes: {}, confidence: 0.8 },
];

const run: RunDto = {
  id: 'r1',
  kind: 'research',
  mode: 'standard',
  adapter: 'claude',
  model: null,
  pinned: false,
  status: 'done',
  costUsd: null,
  startedAt: '2026-09-07T10:00:00Z',
  finishedAt: '2026-09-07T10:00:30Z',
  error: null,
};
const msg: MessageDto = {
  id: 'm1',
  role: 'assistant',
  kind: 'answer',
  content: text,
  structured: structured ?? null,
  runId: 'r1',
  createdAt: '2026-09-07T10:00:30Z',
};

describe('saving things to the list (ADR 0031)', () => {
  it('Things rows get a bookmark button per entity when onSave is given', () => {
    const html = renderToStaticMarkup(<Things entities={entities} onSave={() => {}} />);
    expect(html).toContain('aria-label="Save Café Kitsuné to your list"');
    expect(html).toContain('aria-label="Save ripgrep to your list"');
    expect(html.match(/class="thing-save"/g)?.length).toBe(2);
  });

  it('Things rows have no save button without onSave (read-only contexts)', () => {
    const html = renderToStaticMarkup(<Things entities={entities} />);
    expect(html).not.toContain('thing-save');
  });

  it('recommendations offer "save as a task" when the turn gets onSaveTask', () => {
    const html = renderToStaticMarkup(<Turn msg={msg} run={run} onSaveTask={() => {}} />);
    expect(html).toContain('<h3>Recommendations</h3>');
    expect(html).toContain('aria-label="Save this recommendation as a task"');
    const plain = renderToStaticMarkup(<Turn msg={msg} run={run} />);
    expect(plain).not.toContain('Save this recommendation as a task');
  });
});
