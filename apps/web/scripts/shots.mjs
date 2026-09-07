// Screenshot every route of a running Doubletake server for design review.
//
//   DOUBLETAKE_URL=http://127.0.0.1:7391 DOUBLETAKE_TOKEN_FILE=/tmp/dt-tok.txt \
//     node scripts/shots.mjs /tmp/dt-shots/before
//
// Phone (390×844) in both colour schemes and desktop (1280×860). The device token is
// injected into localStorage; nothing is written back to the server.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = (process.env.DOUBLETAKE_URL ?? 'http://127.0.0.1:7391').replace(/\/$/, '');
const out = process.argv[2] ?? '/tmp/dt-shots/out';
const token = process.env.DOUBLETAKE_TOKEN_FILE
  ? readFileSync(process.env.DOUBLETAKE_TOKEN_FILE, 'utf8').trim()
  : process.env.DOUBLETAKE_TOKEN;
if (!token) throw new Error('set DOUBLETAKE_TOKEN_FILE or DOUBLETAKE_TOKEN');
mkdirSync(out, { recursive: true });

const routes = [
  '/',
  '/library',
  '/compose',
  '/settings',
  '/settings/research',
  '/settings/notifications',
  '/settings/appearance',
  '/map',
  '/entities/place',
];
const targets = [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1280, height: 860 }, 'light'],
];

const browser = await chromium.launch();
for (const [name, viewport, colorScheme] of targets) {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('doubletake.token', t), token);
  const shoot = async (route, file, fullPage = false) => {
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${name}${file}.png`, fullPage });
  };
  for (const route of routes)
    await shoot(route, route === '/' ? '_inbox' : route.replace(/\//g, '_'));
  // Inbox filter sheet (open) and a filtered inbox with the summary chip.
  await page.goto(`${base}/`, { waitUntil: 'networkidle' }).catch(() => {});
  const funnel = page.locator('button[aria-label^="Filters"]');
  if (await funnel.count()) {
    await funnel.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${name}_inbox-filter.png` });
  }
  await shoot('/?platform=youtube&status=answered', '_inbox-filtered');
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const href = await page
    .locator('a[href^="/chat/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (href) {
    await shoot(href, '_chat');
    await shoot(href, '_chat-full', true);
  }
  // Signed-out welcome screen.
  await page.evaluate(() => localStorage.removeItem('doubletake.token'));
  await shoot('/', '_welcome');
  await ctx.close();
}
await browser.close();
console.log(`wrote screenshots to ${out}`);
