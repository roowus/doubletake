// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initialize = vi.fn();
const render = vi.fn();
vi.mock('mermaid', () => ({ default: { initialize, render } }));

import { Mermaid, renderMermaid } from './Mermaid';

// Mermaid's real output for a two-node flowchart, plus everything an attacker could smuggle
// into the diagram text and hope survives: a script, an onclick, a link, a remote image.
const HOSTILE_SVG = [
  '<svg id="dt" viewBox="0 0 100 50" class="flowchart"><style>#dt .node{fill:#fff} @import url(https://evil/x.css);</style>',
  '<script>alert(1)</script><g class="node" onclick="alert(1)"><rect width="10" height="10" style="fill:url(https://evil/p)"/>',
  '<text>Hello</text></g><a href="https://evil"><image href="https://evil/i.png"/></a></svg>',
].join('');

beforeEach(() => {
  initialize.mockClear();
  render.mockReset();
  render.mockResolvedValue({ svg: HOSTILE_SVG, bindFunctions: undefined });
});

describe('renderMermaid', () => {
  it('initialises mermaid at securityLevel strict with html labels off, once per theme', async () => {
    await renderMermaid('graph TD; A-->B');
    await renderMermaid('graph TD; B-->C');
    expect(initialize).toHaveBeenCalledTimes(1);
    const opts = initialize.mock.calls[0]?.[0];
    expect(opts.securityLevel).toBe('strict');
    expect(opts.startOnLoad).toBe(false);
    expect(opts.flowchart).toEqual({ htmlLabels: false });
    expect(opts.theme).toBe('base');
    expect(render).toHaveBeenCalledWith(
      expect.stringMatching(/^dt-mermaid-\d+$/),
      'graph TD; A-->B',
    );
  });

  it('strips scripts, handlers, links, remote images and remote urls from the rendered svg', async () => {
    const svg = await renderMermaid('graph TD; A-->B');
    expect(svg).toContain('<text>Hello</text>');
    expect(svg).toContain('<style>');
    expect(svg).not.toMatch(/<script|onclick|<a |href=|<image|evil|@import/);
    // The <rect>'s inline style pointed at a remote url, so the whole attribute goes.
    expect(svg).toMatch(/<rect width="10" height="10"><\/rect>/);
  });

  it('throws when nothing drawable survives', async () => {
    render.mockResolvedValue({ svg: '<div>not svg</div>' });
    await expect(renderMermaid('x')).rejects.toThrow(/sanitis/);
  });
});

describe('<Mermaid>', () => {
  it('shows the diagram once rendered, and the code with a reason when mermaid fails', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Mermaid text="graph TD; A-->B" />);
    });
    expect(host.querySelector('figure.mermaid[role="img"]')).not.toBeNull();
    expect(host.innerHTML).toContain('<text>Hello</text>');
    expect(host.innerHTML).not.toContain('<script');

    render.mockRejectedValue(new Error('Parse error on line 1:\nsomething'));
    await act(async () => {
      root.render(<Mermaid text="graph TD; A--" />);
    });
    expect(host.querySelector('figure.mermaid.broken')).not.toBeNull();
    expect(host.textContent).toContain("Couldn't draw this diagram (Parse error on line 1:)");
    expect(host.querySelector('code.language-mermaid')?.textContent).toBe('graph TD; A--');
    root.unmount();
  });
});
