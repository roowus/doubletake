import { describe, expect, it } from 'vitest';
import { CHART_MAX_POINTS, parseChartSpec } from '../src/chart.js';

describe('parseChartSpec', () => {
  it('accepts bar, line, pie and stat specs', () => {
    const bar = parseChartSpec(
      '{"type":"bar","title":"Price","unit":"$","series":[{"name":"2025","values":[{"x":"A","y":1},{"x":"B","y":2.5}]}]}',
    );
    expect(bar.ok).toBe(true);
    if (bar.ok && bar.spec.type === 'bar') expect(bar.spec.series[0]?.values).toHaveLength(2);

    expect(
      parseChartSpec(
        '{"type":"line","series":[{"name":"t","values":[{"x":1,"y":1},{"x":2,"y":4}]}]}',
      ).ok,
    ).toBe(true);
    expect(
      parseChartSpec(
        '{"type":"pie","series":[{"name":"share","values":[{"x":"a","y":60},{"x":"b","y":40}]}]}',
      ).ok,
    ).toBe(true);
    const stat = parseChartSpec(
      '{"type":"stat","rows":[{"label":"Weight","value":"1.2 kg"},{"label":"Price","value":499,"delta":"-12%"}]}',
    );
    expect(stat.ok).toBe(true);
  });

  it('rejects malformed JSON and unknown shapes with a short reason', () => {
    expect(parseChartSpec('{nope')).toEqual({ ok: false, reason: 'not valid JSON' });
    const r = parseChartSpec('{"type":"scatter","series":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/type/);
  });

  it('caps sizes and refuses non-finite numbers and empty labels', () => {
    const many = Array.from({ length: CHART_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
    const r = parseChartSpec(
      JSON.stringify({ type: 'line', series: [{ name: 's', values: many }] }),
    );
    expect(r.ok).toBe(false);
    expect(
      parseChartSpec('{"type":"bar","series":[{"name":"","values":[{"x":"a","y":1}]}]}').ok,
    ).toBe(false);
    expect(
      parseChartSpec('{"type":"bar","series":[{"name":"s","values":[{"x":"a","y":"1"}]}]}').ok,
    ).toBe(false);
    // A pie is one series only.
    expect(
      parseChartSpec(
        '{"type":"pie","series":[{"name":"a","values":[{"x":"a","y":1}]},{"name":"b","values":[{"x":"b","y":1}]}]}',
      ).ok,
    ).toBe(false);
  });
});
