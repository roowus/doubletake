#!/usr/bin/env node
/**
 * Design-token drift guard (ADR 0033).
 *
 * The stylesheet is the one place a colour may be written. Everything else names a token.
 * This script fails the build when that stops being true:
 *
 *   1. a raw colour literal (hex, rgb/rgba, hsl/hsla) appears outside the token blocks;
 *   2. the ink block and the prefers-dark block declare a different set of tokens;
 *   3. `var(--name)` names a custom property nothing declares;
 *   4. index.html's theme-color metas or appearance.ts's CHROME_BG stop matching --bg;
 *   5. design-system/doubletake/tokens.json is stale (regenerate with --write).
 *
 * A rule that genuinely needs a literal (a mask, a QR plate, a pre-boot fallback in TS) may
 * carry a `tokens-lint-ignore` comment on the line or the line above, with a reason.
 *
 * Run: node scripts/check-tokens.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_PATH = resolve(ROOT, 'apps/web/src/styles.css');
const TOKENS_PATH = resolve(ROOT, 'design-system/doubletake/tokens.json');
const INDEX_PATH = resolve(ROOT, 'apps/web/index.html');
const APPEARANCE_PATH = resolve(ROOT, 'apps/web/src/appearance.ts');

const write = process.argv.includes('--write');
const css = readFileSync(CSS_PATH, 'utf8');
const problems = [];
const fail = (rule, where, detail) => problems.push(`${rule} ${where}: ${detail}`);

/** Split a stylesheet into comment-stripped lines, remembering which are inside a block comment. */
function stripComments(src) {
  const out = [];
  let inComment = false;
  for (const raw of src.split('\n')) {
    let line = '';
    let i = 0;
    while (i < raw.length) {
      if (inComment) {
        const end = raw.indexOf('*/', i);
        if (end === -1) {
          i = raw.length;
          break;
        }
        inComment = false;
        i = end + 2;
        continue;
      }
      const start = raw.indexOf('/*', i);
      if (start === -1) {
        line += raw.slice(i);
        break;
      }
      line += raw.slice(i, start);
      const end = raw.indexOf('*/', start + 2);
      if (end === -1) {
        inComment = true;
        i = raw.length;
        break;
      }
      i = end + 2;
    }
    out.push(line);
  }
  return out;
}

/**
 * True when a `tokens-lint-ignore` comment sits on the line, the three lines above it, or
 * anywhere inside a `tokens-lint-ignore-start` / `tokens-lint-ignore-end` region.
 */
function ignored(lines, index) {
  if ([0, 1, 2, 3].some((back) => (lines[index - back] ?? '').includes('tokens-lint-ignore'))) {
    return true;
  }
  for (let i = index; i >= 0; i--) {
    if (lines[i].includes('tokens-lint-ignore-end')) return false;
    if (lines[i].includes('tokens-lint-ignore-start')) return true;
  }
  return false;
}

/** The `{...}` body of the first block whose selector matches, with its line range. */
function block(src, selector, from = 0) {
  const at = src.indexOf(selector, from);
  if (at === -1) return null;
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  const startLine = src.slice(0, open).split('\n').length;
  const endLine = src.slice(0, close).split('\n').length;
  return {
    selector,
    open,
    close,
    startLine,
    endLine,
    body: src.slice(open + 1, close),
    props: declarations(src.slice(open + 1, close)),
  };
}

/** Custom-property declarations in a rule body, comments removed. */
function declarations(body) {
  const props = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\*.*?\*\//g, '');
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/i.exec(line);
    if (!m) continue;
    // A multi-line value (font stacks) keeps its wrapped tail; join it back up.
    props[m[1]] = m[2].trim();
  }
  // Font stacks are declared across lines; re-read them from the raw body.
  for (const m of body.matchAll(/(--font-[a-z]+)\s*:\s*([^;]+);/g)) {
    props[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return props;
}

const paper = block(css, ':root {');
const darkPref = block(css, ':root:not([data-theme="paper"])');
const ink = block(css, ':root[data-theme="ink"]');

if (!paper || !darkPref || !ink) {
  console.error('check-tokens: could not find the three token blocks in styles.css');
  process.exit(1);
}

const tokenRanges = [paper, darkPref, ink];

// 1. Raw colour literals outside the token blocks. -------------------------------------------
const COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]+\s*[, ]|\b(?:rgba?|hsla?)\(\s*(?:var\(|from\b)/gi;
const cssLines = stripComments(css);
cssLines.forEach((line, i) => {
  const lineNo = i + 1;
  if (tokenRanges.some((b) => lineNo >= b.startLine && lineNo <= b.endLine)) return;
  if (!COLOUR.test(line)) return;
  COLOUR.lastIndex = 0;
  if (ignored(cssLines, i)) return;
  fail('RAW-COLOUR', `styles.css:${lineNo}`, line.trim().slice(0, 90));
});

// TypeScript: a colour in a component is drift unless it is a documented pre-boot fallback.
for (const file of [
  'apps/web/src/appearance.ts',
  'apps/web/src/components/Mermaid.tsx',
  'apps/web/src/pages/settings/Devices.tsx',
]) {
  const lines = readFileSync(resolve(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!COLOUR.test(line)) return;
    COLOUR.lastIndex = 0;
    if (ignored(lines, i)) return;
    fail('RAW-COLOUR', `${file}:${i + 1}`, line.trim().slice(0, 90));
  });
}

// 2. The two dark blocks must declare identical values. ---------------------------------------
const darkKeys = new Set(Object.keys(darkPref.props));
for (const key of Object.keys(ink.props)) {
  if (!darkKeys.has(key)) {
    fail(
      'INK-PARITY',
      `styles.css:${ink.startLine}`,
      `${key} is missing from the prefers-dark block`,
    );
    continue;
  }
  if (darkPref.props[key] !== ink.props[key]) {
    fail(
      'INK-PARITY',
      `styles.css:${ink.startLine}`,
      `${key}: prefers-dark has ${darkPref.props[key]}, ink has ${ink.props[key]}`,
    );
  }
}
for (const key of darkKeys) {
  if (!(key in ink.props)) {
    fail('INK-PARITY', `styles.css:${darkPref.startLine}`, `${key} is missing from the ink block`);
  }
  if (!(key in paper.props)) {
    fail(
      'INK-PARITY',
      `styles.css:${darkPref.startLine}`,
      `${key} overrides a token :root never declares`,
    );
  }
}

// 3. Every var(--x) must name a declared custom property. -------------------------------------
const declared = new Set();
for (const b of tokenRanges) for (const key of Object.keys(b.props)) declared.add(key);
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) declared.add(m[1]);
const EXTERNAL = /^--(?:safe-area-inset-|transform-origin$|active-tab-|radix-|base-ui-)/;
cssLines.forEach((line, i) => {
  for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const name = m[1];
    if (declared.has(name) || EXTERNAL.test(name)) continue;
    fail('UNDECLARED-VAR', `styles.css:${i + 1}`, `${name} is used but never declared`);
  }
});

// 4. The browser chrome colours are --bg. -----------------------------------------------------
const index = readFileSync(INDEX_PATH, 'utf8');
const metaLight = /media="\(prefers-color-scheme: light\)"\s*\/?>/.test(index)
  ? /content="(#[0-9a-f]{6})"\s*media="\(prefers-color-scheme: light\)"/i.exec(index)
  : null;
const metaDark = /content="(#[0-9a-f]{6})"\s*media="\(prefers-color-scheme: dark\)"/i.exec(index);
if (!metaLight || metaLight[1].toLowerCase() !== paper.props['--bg']?.toLowerCase()) {
  fail('CHROME-COLOUR', 'apps/web/index.html', `light theme-color must be ${paper.props['--bg']}`);
}
if (!metaDark || metaDark[1].toLowerCase() !== ink.props['--bg']?.toLowerCase()) {
  fail('CHROME-COLOUR', 'apps/web/index.html', `dark theme-color must be ${ink.props['--bg']}`);
}
const appearance = readFileSync(APPEARANCE_PATH, 'utf8');
const chrome = /CHROME_BG[^=]*=\s*\{\s*paper:\s*'(#[0-9a-f]{6})',\s*ink:\s*'(#[0-9a-f]{6})'/i.exec(
  appearance,
);
if (!chrome) {
  fail('CHROME-COLOUR', 'apps/web/src/appearance.ts', 'could not read CHROME_BG');
} else {
  if (chrome[1].toLowerCase() !== paper.props['--bg']?.toLowerCase()) {
    fail('CHROME-COLOUR', 'apps/web/src/appearance.ts', `paper must be ${paper.props['--bg']}`);
  }
  if (chrome[2].toLowerCase() !== ink.props['--bg']?.toLowerCase()) {
    fail('CHROME-COLOUR', 'apps/web/src/appearance.ts', `ink must be ${ink.props['--bg']}`);
  }
}

// 5. tokens.json is a generated mirror, never hand-edited. ------------------------------------
const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
const mirror = {
  $comment:
    'Generated from apps/web/src/styles.css by scripts/check-tokens.mjs (pnpm check:tokens). Do not edit.',
  paper: sortKeys(paper.props),
  ink: sortKeys(ink.props),
};
const serialised = `${JSON.stringify(mirror, null, 2)}\n`;
let current = '';
try {
  current = readFileSync(TOKENS_PATH, 'utf8');
} catch {
  current = '';
}
if (current !== serialised) {
  if (write) {
    writeFileSync(TOKENS_PATH, serialised);
    console.log(`wrote ${TOKENS_PATH.replace(`${ROOT}/`, '')}`);
  } else {
    fail(
      'STALE-MIRROR',
      'design-system/doubletake/tokens.json',
      'differs from styles.css; run `node scripts/check-tokens.mjs --write`',
    );
  }
}

// Report. -------------------------------------------------------------------------------------
if (problems.length === 0) {
  const counts = `${Object.keys(paper.props).length} paper tokens, ${Object.keys(ink.props).length} ink`;
  console.log(`tokens clean (${counts})`);
  process.exit(0);
}
for (const p of problems) console.log(p);
console.log(`${problems.length} token problem(s)`);
process.exit(1);
