// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cleanSvg, Markdown } from './Markdown';

const render = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

describe('Markdown', () => {
  it('renders GFM tables and strikethrough', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | ~~2~~ |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td><del>2</del></td>');
  });

  it('never renders raw HTML from the answer', () => {
    const html = render('hi <img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  it('inlines a fenced svg block after sanitizing it', () => {
    const md = [
      'Flow:',
      '```svg',
      '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script>',
      '<a href="https://evil"><circle cx="5" cy="5" r="4" fill="url(https://evil/x)"/></a>',
      '<use href="#x"/><rect width="2" height="2" fill="url(#grad)"/></svg>',
      '```',
    ].join('\n');
    const html = render(md);
    expect(html).toContain('<figure class="svg"');
    expect(html).toContain('<svg viewBox="0 0 10 10">');
    expect(html).toContain('<circle cx="5" cy="5" r="4"></circle>');
    expect(html).toContain('fill="url(#grad)"');
    expect(html).not.toMatch(/onload|<script|<a |href=|<use|evil/);
  });

  it('falls back to a code block when the svg block is not a single clean <svg>', () => {
    expect(render('```svg\n<div>nope</div>\n```')).toContain('<pre><code class="language-svg">');
    expect(render('```svg\n<svg/><svg/>\n```')).toContain('<pre>');
    expect(render('```js\nconst x = 1;\n```')).toContain('<code class="language-js">');
  });

  it('cleanSvg strips foreignObject and event handlers', () => {
    const out = cleanSvg(
      '<svg viewBox="0 0 1 1"><foreignObject><body onload="x"/></foreignObject><g onclick="x"><path d="M0 0"/></g></svg>',
    );
    expect(out).toBe('<svg viewBox="0 0 1 1"><g><path d="M0 0"></path></g></svg>');
  });
});
