import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAnswerBlock } from '@doubletake/shared';
import { describe, expect, it } from 'vitest';
import { SYSTEM_FRAMING } from '../src/brains/prompts.js';

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
