import { useEffect, useState } from 'react';
import { cleanMermaidSvg } from '../svg';

/**
 * The ```mermaid fence. Mermaid (~170 KB gzipped) is loaded on first use as its own chunk, so
 * answers without a diagram never pay for it. The diagram text is untrusted: Mermaid runs at
 * `securityLevel: 'strict'` (labels are HTML-encoded, `click` directives are inert) with
 * HTML labels off so it draws with `<text>` rather than `<foreignObject>`, and the SVG it
 * returns is still passed through DOMPurify (`cleanMermaidSvg`) before it is inserted. A
 * diagram that fails to parse or to sanitize stays a code block with the reason beneath it.
 */

type MermaidModule = typeof import('mermaid').default;
let loading: Promise<MermaidModule> | null = null;
let seq = 0;

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Theme variables derived from the app tokens at first load (a theme switch re-initialises). */
function themeVariables() {
  const theme = document.documentElement.dataset.theme;
  const dark =
    theme === 'ink' ||
    (theme !== 'paper' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  return {
    darkMode: dark,
    background: cssVar('--surface', dark ? '#171a1d' : '#fffdf9'),
    primaryColor: cssVar('--accent-soft', dark ? '#1f3a33' : '#e3efea'),
    primaryTextColor: cssVar('--text', dark ? '#e9e6df' : '#1c1b18'),
    primaryBorderColor: cssVar('--accent', dark ? '#5fb59a' : '#1f6f5b'),
    lineColor: cssVar('--text-muted', dark ? '#9d9a91' : '#645f56'),
    secondaryColor: cssVar('--surface-2', dark ? '#1f2327' : '#efeae0'),
    tertiaryColor: cssVar('--bg', dark ? '#101214' : '#f7f4ee'),
    fontFamily: cssVar('--font-sans', 'system-ui, sans-serif'),
    fontSize: '14px',
  };
}

let initialisedFor: string | null = null;

export async function loadMermaid(): Promise<MermaidModule> {
  if (!loading) loading = import('mermaid').then((m) => m.default);
  const mermaid = await loading;
  const key = document.documentElement.dataset.theme ?? 'auto';
  if (initialisedFor !== key) {
    initialisedFor = key;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: themeVariables(),
      flowchart: { htmlLabels: false },
      sequence: { useMaxWidth: true },
      fontFamily: cssVar('--font-sans', 'system-ui, sans-serif'),
    });
  }
  return mermaid;
}

/** Render diagram text to sanitized SVG; throws with a readable message on failure. */
export async function renderMermaid(text: string): Promise<string> {
  const mermaid = await loadMermaid();
  const { svg } = await mermaid.render(`dt-mermaid-${++seq}`, text.trim());
  const clean = cleanMermaidSvg(svg);
  if (!clean) throw new Error('the diagram did not survive sanitising');
  return clean;
}

type State = { svg: string } | { error: string } | null;

export function Mermaid({ text }: { text: string }) {
  const [state, setState] = useState<State>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    renderMermaid(text)
      .then((svg) => alive && setState({ svg }))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        // Mermaid's parse errors are several lines; the first one says what was wrong.
        if (alive) setState({ error: msg.split('\n')[0]?.slice(0, 160) ?? 'could not render' });
      });
    return () => {
      alive = false;
    };
  }, [text]);

  if (state && 'svg' in state)
    return (
      <figure
        className="mermaid"
        role="img"
        aria-label="Diagram"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: cleanMermaidSvg (DOMPurify) above
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  return (
    <figure className={`mermaid ${state ? 'broken' : 'pending'}`} aria-busy={!state}>
      {state && (
        <figcaption className="muted small">Couldn't draw this diagram ({state.error}).</figcaption>
      )}
      <pre>
        <code className="language-mermaid">{text}</code>
      </pre>
    </figure>
  );
}
