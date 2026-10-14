// Mobile audit: at 390 and 320 wide, check (a) no horizontal scroll and (b) interactive
// elements meet a 40 px minimum target. Both are hard failures. Deliberate truncation
// (`text-overflow: ellipsis`, i.e. .srow-value, .todo-row-hint, .brain-pick) is reported as a
// note only — it is the intended design, not a layout break.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const server = spawn('node', ['e2e/fixture-server.mjs'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

const ROUTES = [
  { name: 'welcome', path: '/welcome', auth: false },
  { name: 'login-hosted', path: '/login', auth: false, hosted: true },
  { name: 'inbox', path: '/', auth: true },
  { name: 'library', path: '/library', auth: true },
  { name: 'compose', path: '/compose', auth: true },
  { name: 'settings', path: '/settings', auth: true },
  { name: 'settings-appearance', path: '/settings/appearance', auth: true },
  { name: 'todo', path: '/todo', auth: true },
];

const browser = await chromium.launch();
let problems = 0;

for (const width of [390, 320]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width, height: 780 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      await page.goto('http://127.0.0.1:4173/');
      if (route.auth) {
        await page.evaluate(() => localStorage.setItem('doubletake.token', 'dt_fixture_token'));
      }
      await page.goto(`http://127.0.0.1:4173${route.path}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);

      const report = await page.evaluate(() => {
        const de = document.documentElement;
        const out = { overflow: de.scrollWidth - de.clientWidth, small: [], clipped: [], truncated: [] };
        const label = (el) => {
          const t = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28);
          return `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}${
            t ? ` "${t}"` : ''
          }`;
        };
        for (const el of document.querySelectorAll('a, button, input, select, textarea, [role]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          // An element inside a labelled row gets the row's hit area; measure the row instead.
          const row = el.closest('label, .row, .check, .seg, .srow, .segmented, li');
          const rr = row ? row.getBoundingClientRect() : r;
          // A pseudo-element may also widen the target (e.g. the switch's 44x44 ::before).
          const before = getComputedStyle(el, '::before');
          const eh = Number.parseFloat(before.height) || 0;
          const ew = Number.parseFloat(before.width) || 0;
          const h = Math.max(r.height, rr.height, eh);
          const w = Math.max(r.width, rr.width, ew);
          if (h < 40 - 0.5 || w < 24 - 0.5) {
            out.small.push(`${label(el)} ${Math.round(w)}x${Math.round(h)}`);
          }
        }
        for (const el of document.querySelectorAll('h1, h2, h3, p, span, a, button, label, li')) {
          if (el.children.length) continue;
          const cs = getComputedStyle(el);
          // Ellipsis means "we meant to cut this off" — a note, not a defect. Clipping with no
          // ellipsis means the text is silently lost, which is a real defect.
          if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'hidden') {
            const deliberate = cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap';
            (deliberate ? out.truncated : out.clipped).push(label(el));
          }
        }
        return out;
      });

      if (report.overflow > 0) {
        problems++;
        console.log(`H-SCROLL ${route.name} @${width} ${theme}: ${report.overflow}px`);
      }
      for (const s of [...new Set(report.small)]) {
        problems++;
        console.log(`SMALL-TARGET ${route.name} @${width} ${theme}: ${s}`);
      }
      for (const c of [...new Set(report.clipped)]) {
        problems++;
        console.log(`CLIPPED ${route.name} @${width} ${theme}: ${c}`);
      }
      for (const t of [...new Set(report.truncated)]) {
        console.log(`note: ellipsis ${route.name} @${width} ${theme}: ${t}`);
      }
    }
    await ctx.close();
  }
}

await browser.close();
server.kill();
console.log(problems === 0 ? 'MOBILE AUDIT CLEAN' : `${problems} problems`);
