import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cleanSvg } from '../svg';
import { ChartBlock } from './Chart';
import { Mermaid } from './Mermaid';

/**
 * Answer text is markdown with GitHub extensions (tables, task lists, strikethrough, autolinks).
 * Raw HTML is never rendered. Three fenced blocks are drawn instead of shown as code:
 * ```svg (a small diagram the brain drew, inlined after DOMPurify's SVG profile — `svg.ts`),
 * ```chart (a JSON spec drawn by components/Chart.tsx) and ```mermaid (rendered lazily by
 * components/Mermaid.tsx at securityLevel strict). Anything that fails to parse or sanitize
 * falls back to a plain code block.
 *
 * Two rewrites happen before rendering (ADR 0034):
 * - `[[3]]` becomes a link to `#claim-3`. The `a` override below turns a `#claim-` link into a
 *   superscript evidence mark, so the mark is real link text rather than raw HTML (raw HTML is
 *   not rendered, by design).
 * - A trailing `Sources: <urls>` paragraph is dropped. The sources now have their own report
 *   under the answer, built from the structured claims; printing the same URLs twice in two
 *   different shapes made the page longer without adding anything.
 */
export { cleanSvg } from '../svg';

type HastNode = NonNullable<ExtraProps['node']>;

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  title?: string | null;
  [key: string]: unknown;
}

const MARK = /\[\[(\d{1,2})\]\]/g;

/** Split a text node on `[[n]]` into text and `#claim-n` link nodes, in place. */
function splitMarks(node: MdNode): MdNode[] {
  const value = node.value ?? '';
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(MARK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', value: value.slice(last, at) });
    out.push({
      type: 'link',
      url: `#claim-${m[1]}`,
      title: null,
      children: [{ type: 'text', value: m[1] ?? '' }],
    });
    last = at + m[0].length;
  }
  if (out.length === 0) return [node];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function walk(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && MARK.test(child.value ?? '')) {
      MARK.lastIndex = 0;
      next.push(...splitMarks(child));
    } else {
      next.push(child);
      walk(child);
    }
    MARK.lastIndex = 0;
  }
  node.children = next;
}

/** A last paragraph that only names sources (`Sources: url url`) is redundant now. */
function dropSourcesTail(root: MdNode): void {
  const children = root.children ?? [];
  const lastIdx = children.map((c) => c.type).lastIndexOf('paragraph');
  if (lastIdx === -1) return;
  const para = children[lastIdx];
  if (!para?.children) return;
  const flat = para.children
    .map((c) => (c.type === 'text' ? (c.value ?? '') : c.type === 'link' ? (c.url ?? '') : ''))
    .join(' ')
    .trim();
  if (/^sources?\s*:/i.test(flat)) children.splice(lastIdx, 1);
}

/** remark plugin: evidence marks, then the redundant sources tail. */
function remarkAnswerMarks() {
  return (tree: unknown) => {
    const root = tree as MdNode;
    walk(root);
    dropSourcesTail(root);
  };
}

/** The fence language and text of a ```lang block, or null for anything else. */
function fence(node: HastNode | undefined): { lang: string; text: string } | null {
  const code = node?.children.find(
    (c): c is HastNode => c.type === 'element' && (c as HastNode).tagName === 'code',
  );
  const cls = code?.properties?.className;
  const langs = Array.isArray(cls) ? cls.map(String) : typeof cls === 'string' ? [cls] : [];
  const lang = langs.find((l) => l.startsWith('language-'))?.slice('language-'.length);
  if (!lang) return null;
  const text = (code?.children ?? []).map((c) => (c.type === 'text' ? c.value : '')).join('');
  return { lang: lang.toLowerCase(), text };
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkAnswerMarks]}
        components={{
          a: ({ href, children: c, ...rest }) => {
            if (href?.startsWith('#claim-')) {
              return (
                <sup className="mark">
                  <a href={href} aria-label={`Claim ${href.slice('#claim-'.length)}`}>
                    {c}
                  </a>
                </sup>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                {c}
              </a>
            );
          },
          pre: ({ node, children: c, ...rest }) => {
            const f = fence(node);
            if (f?.lang === 'svg') {
              const svg = cleanSvg(f.text);
              if (svg)
                return (
                  <figure
                    className="svg"
                    role="img"
                    aria-label="Diagram"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: DOMPurify SVG profile (svg.ts)
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                );
            }
            if (f?.lang === 'chart') return <ChartBlock text={f.text} />;
            if (f?.lang === 'mermaid') return <Mermaid text={f.text} />;
            return <pre {...rest}>{c}</pre>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
