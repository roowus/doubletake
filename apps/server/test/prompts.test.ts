import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAnswerBlock } from '@doubletake/shared';
import { describe, expect, it } from 'vitest';
import { renderFollowUp, SYSTEM_FRAMING } from '../src/brains/prompts.js';

const fixture = readFileSync(resolve(import.meta.dirname, 'fixtures/rich-answer.md'), 'utf8');

describe('SYSTEM_FRAMING', () => {
  it('documents the three drawn fences and keeps the text-first rule', () => {
    for (const fence of ['`chart`', '`mermaid`', '`svg`', '`answer`']) {
      expect(SYSTEM_FRAMING).toContain(`tagged ${fence}`);
    }
    expect(SYSTEM_FRAMING).toContain('never put essential facts only in the picture');
    // The chart spec the web renderer validates against (packages/shared/src/chart.ts).
    expect(SYSTEM_FRAMING).toContain('"type":"bar"|"line"|"pie"');
    expect(SYSTEM_FRAMING).toContain('"type":"stat"');
    expect(SYSTEM_FRAMING).toMatch(/no click directives/);
  });

  it('forbids answering "I don\'t know" without searching and asks for a worth-it judgement', () => {
    expect(SYSTEM_FRAMING).toMatch(
      /Never answer "I don't know what X is" while a search tool is available/,
    );
    expect(SYSTEM_FRAMING).toContain('is it practical, is it necessary, is it worth the cost');
    expect(SYSTEM_FRAMING).toContain('"Worth it?"');
  });

  it('ships a fixture answer that exercises table, chart, mermaid and the answer block', () => {
    expect(fixture).toMatch(/^\| Sensor \|/m);
    expect(fixture).toContain('```chart\n{"type":"bar"');
    expect(fixture).toContain('```mermaid\nflowchart TD');
    const { text, structured } = parseAnswerBlock(fixture);
    expect(structured?.entities.map((e) => e.kind)).toEqual(['product', 'product']);
    expect(text).not.toContain('```answer');
    expect(text).toContain('```mermaid');
  });
});

describe('renderFollowUp', () => {
  const chat = {
    chatId: 'c1',
    history: [{ role: 'user' as const, content: 'what is this' }],
    brief: {
      systemFraming: SYSTEM_FRAMING,
      untrusted: [],
      note: null,
      focus: 'whole',
      questionType: 'other' as const,
      outputTemplate: '',
      localContextHints: [],
      sourceUrl: null,
      title: null,
    },
  };

  it('tells the model to search unknown terms instead of saying it does not know (both paths)', () => {
    for (const resume of [true, false]) {
      const p = renderFollowUp(chat, 'is grill me any good?', resume);
      expect(p).toMatch(
        /never reply that you do not know what something is without having searched/,
      );
      expect(p).not.toMatch(/Answer from what you know\./);
    }
  });

  it('states the real search budget in the non-resume path, not "not available"', () => {
    const p = renderFollowUp(chat, 'q', false);
    expect(p).toContain('Web search: up to 2 searches.');
    expect(p).not.toContain('Web search: not available');
    const custom = renderFollowUp(chat, 'q', false, {
      webSearch: true,
      webFetch: false,
      maxSearches: 5,
      maxFetches: 0,
      readRoots: [],
      readDeny: [],
      maxReadBytes: 0,
      writeRoot: null,
    });
    expect(custom).toContain('Web search: up to 5 searches.');
  });
});
