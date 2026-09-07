import DOMPurify from 'dompurify';

/**
 * SVG the brain drew or Mermaid generated is untrusted markup. Both go through DOMPurify's
 * SVG profile so the result can only draw: no scripts, event handlers, links, `<use>` /
 * `<image>` references to other documents, or `url()` fills that would fetch from a remote
 * host. Mermaid additionally needs its `<style>` block and inline `style=` attributes, which
 * are safe once every `url()` in them points inside the document; brain-drawn SVG gets neither.
 */
const BRAIN_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'use', 'image', 'a', 'style', 'set', 'animate'],
  FORBID_ATTR: ['href', 'xlink:href', 'style'],
  WHOLE_DOCUMENT: false,
};
const MERMAID_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['style'],
  ADD_ATTR: ['style', 'class', 'data-id'],
  FORBID_TAGS: ['script', 'foreignObject', 'use', 'image', 'a', 'set', 'animate'],
  FORBID_ATTR: ['href', 'xlink:href'],
  WHOLE_DOCUMENT: false,
};
const EXTERNAL_URL = /url\s*\(\s*['"]?\s*(?!#)/i;
let hooked = false;

function hook() {
  if (hooked) return;
  hooked = true;
  // fill="url(https://…)" would fetch from a remote host; only same-document references stay.
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (EXTERNAL_URL.test(data.attrValue)) data.keepAttr = false;
  });
  // The same for a <style> block: @import or url() to anywhere but #ids is dropped wholesale.
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style') {
      const css = node.textContent ?? '';
      if (/@import/i.test(css) || EXTERNAL_URL.test(css)) node.textContent = '';
    }
  });
}

function oneSvg(out: string): string | null {
  if (!/^<svg[\s>]/i.test(out) || !/<\/svg>\s*$/i.test(out)) return null;
  if (out.indexOf('<svg') !== out.lastIndexOf('<svg')) return null;
  return out;
}

/** Sanitize brain-drawn SVG source; returns null when nothing safe and drawable remains. */
export function cleanSvg(src: string): string | null {
  if (!DOMPurify.isSupported) return null;
  hook();
  return oneSvg(DOMPurify.sanitize(src.trim(), BRAIN_CONFIG).trim());
}

/** Sanitize the SVG Mermaid rendered (styles kept, everything active stripped). */
export function cleanMermaidSvg(src: string): string | null {
  if (!DOMPurify.isSupported) return null;
  hook();
  return oneSvg(DOMPurify.sanitize(src.trim(), MERMAID_CONFIG).trim());
}
