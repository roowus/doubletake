// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChartBlock, fmt } from './Chart';

const render = (spec: unknown) =>
  renderToStaticMarkup(
    <ChartBlock text={typeof spec === 'string' ? spec : JSON.stringify(spec)} />,
  );

describe('ChartBlock', () => {
  it('draws a bar chart with one <rect> per value, a legend and a hidden data table', () => {
    const html = render({
      type: 'bar',
      title: 'Price by size',
      unit: '$',
      series: [
        {
          name: 'Small',
          values: [
            { x: 'Jan', y: 4 },
            { x: 'Feb', y: 6 },
          ],
        },
        {
          name: 'Large',
          values: [
            { x: 'Jan', y: 9 },
            { x: 'Feb', y: 12 },
          ],
        },
      ],
    });
    expect(html).toContain('<figure class="chart bar">');
    expect(html).toContain('<figcaption>Price by size</figcaption>');
    expect(html.match(/<rect /g)?.length).toBe(4);
    // The series colour is applied by CSS through the .bar class, not an inline fill.
    expect(html.match(/<rect [^>]*class="bar"/g)?.length).toBe(4);
    expect(html).toContain('class="s1"');
    expect(html).toContain('class="s2"');
    expect(html).toContain('<ul class="chart-legend">');
    expect(html).toContain('<table class="sr-only">');
    expect(html).toContain('<td>$12</td>');
    // Axis ticks carry the unit so the picture is readable without the table.
    expect(html).toMatch(/<text[^>]*class="tick"[^>]*>\$0<\/text>/);
  });

  it('draws lines and pies from the same spec shape', () => {
    const line = render({
      type: 'line',
      series: [
        {
          name: 'Temp',
          values: [
            { x: 1, y: 20 },
            { x: 2, y: 22 },
            { x: 3, y: 19 },
          ],
        },
      ],
    });
    expect(line).toContain('<figure class="chart line">');
    expect(line).toMatch(/<polyline [^>]*class="line"/);
    expect(line.match(/<circle /g)?.length).toBe(3);

    const pie = render({
      type: 'pie',
      series: [
        {
          name: 'Share',
          values: [
            { x: 'A', y: 3 },
            { x: 'B', y: 1 },
          ],
        },
      ],
    });
    expect(pie).toContain('<figure class="chart pie">');
    expect(pie.match(/class="s\d slice"/g)?.length).toBe(2);
    // The pie legend names the categories, not the single series.
    expect(pie).toContain('<li><span class="swatch s1"></span>A</li>');
  });

  it('renders stat rows as a definition list with signed deltas classed up/down', () => {
    const html = render({
      type: 'stat',
      rows: [
        { label: 'Price', value: 1200, delta: '+4% vs last year' },
        { label: 'Weight', value: '2.1 kg', delta: '-300 g' },
        { label: 'Rating', value: 4.5 },
      ],
    });
    expect(html).toContain('<dl class="stat-grid">');
    expect(html).toContain('<dt>Price</dt>');
    expect(html).toContain('class="delta up"');
    expect(html).toContain('class="delta down"');
    expect(html).toContain('<table class="chart-table">');
    expect(html).not.toContain('<svg');
  });

  it('falls back to the raw block with a reason when the spec does not validate', () => {
    const bad = render({ type: 'donut', series: [] });
    expect(bad).toContain('<figure class="chart broken">');
    expect(bad).toContain('Couldn&#x27;t draw this chart (');
    expect(bad).toContain('<code class="language-chart">');
    expect(bad).not.toContain('<svg');

    const notJson = render('{ "type": "bar", ');
    expect(notJson).toContain('not valid JSON');
  });

  it('escapes labels rather than interpreting them', () => {
    const html = render({
      type: 'bar',
      title: '<img src=x onerror=alert(1)>',
      series: [{ name: '<b>x</b>', values: [{ x: '<i>', y: 1 }] }],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img');
  });

  it('formats numbers with currency prefixes and unit suffixes', () => {
    expect(fmt(1200, '$')).toBe('$1,200');
    expect(fmt(2.5, 'kg')).toBe('2.5 kg');
    expect(fmt(3)).toBe('3');
    expect(fmt('n/a', 'kg')).toBe('n/a');
  });
});
