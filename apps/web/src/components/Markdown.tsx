import DOMPurify from 'dompurify';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Answer text is markdown with GitHub extensions (tables, task lists, strikethrough, autolinks).
 * Raw HTML is never rendered. The one exception is a fenced ```svg block: a small diagram the
 * brain drew, which is inlined after DOMPurify's SVG profile has run with scripts, foreign
 * objects, links, `<use>`/`<image>` references, stylesheets and event handlers stripped, so it
 * can only draw. Anything that is not a clean `<svg>` falls back to a plain code block.
 */
const SVG_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'use', 'image', 'a', 'style', 'set', 'animate'],
  FORBID_ATTR: ['href', 'xlink:href', 'style'],
  // A stray text node or a second root would break the layout; keep exactly one <svg>.
  WHOLE_DOCUMENT: false,
};
const EXTERNAL_URL = /url\s*\(\s*['"]?\s*(?!#)/i;
let hooked = false;

/** Sanitize brain-drawn SVG source; returns null when nothing safe and drawable remains. */
export function cleanSvg(src: string): string | null {
  if (!DOMPurify.isSupported) return null;
  if (!hooked) {
    hooked = true;
    // fill="url(https://…)" would fetch from a remote host; only same-document references stay.
    DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (EXTERNAL_URL.test(data.attrValue)) data.keepAttr = false;
    });
  }
  const out = DOMPurify.sanitize(src.trim(), SVG_CONFIG).trim();
  if (!/^<svg[\s>]/i.test(out) || !/<\/svg>\s*$/i.test(out)) return null;
  if (out.indexOf('<svg') !== out.lastIndexOf('<svg')) return null;
  return out;
}

type HastNode = NonNullable<ExtraProps['node']>;

function fencedSvg(node: HastNode | undefined): string | null {
  const code = node?.children.find(
    (c): c is HastNode => c.type === 'element' && (c as HastNode).tagName === 'code',
  );
  const cls = code?.properties?.className;
  const langs = Array.isArray(cls) ? cls.map(String) : typeof cls === 'string' ? [cls] : [];
  if (!langs.includes('language-svg')) return null;
  const text = (code?.children ?? []).map((c) => (c.type === 'text' ? c.value : '')).join('');
  return cleanSvg(text);
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
            const svg = fencedSvg(node);
            if (svg)
              return (
                <figure
                  className="svg"
                  role="img"
                  aria-label="Diagram"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: DOMPurify SVG profile above
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              );
            return <pre {...rest}>{c}</pre>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
