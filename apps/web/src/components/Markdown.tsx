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
 */
export { cleanSvg } from '../svg';

type HastNode = NonNullable<ExtraProps['node']>;

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
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {c}
            </a>
          ),
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
