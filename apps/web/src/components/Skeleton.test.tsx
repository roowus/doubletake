// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListSkeleton } from './Skeleton';

describe('ListSkeleton', () => {
  it('announces loading once and hides the placeholder rows from assistive tech', () => {
    const html = renderToStaticMarkup(<ListSkeleton rows={3} label="Loading collections" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading collections…');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    // Row widths cycle so the placeholder does not read as a grid.
    expect(html).toContain('sk w80');
    expect(html).toContain('sk w60');
  });

  it('never renders more rows than the width cycle provides', () => {
    const html = renderToStaticMarkup(<ListSkeleton rows={50} />);
    expect((html.match(/list-skeleton-row/g) ?? []).length).toBeLessThanOrEqual(8);
  });
});
