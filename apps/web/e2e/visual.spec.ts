import { expect, type Page, test } from '@playwright/test';

/**
 * One screenshot per route per project (phone light/dark, desktop light). Data comes from
 * `fixture-server.mjs`; the chat is the rich-answer fixture so the table, chart and mermaid
 * diagram renderers are pinned here as well as in unit tests. Unit tests assert structure; this
 * suite asserts the page still *looks* like the design system in `design-system/doubletake`.
 */
const CHAT = '01M1WPFIXTURE0000000000001';

async function open(page: Page, path: string) {
  await page.goto('/');
  // Sign in the way the app does: the token lives in localStorage and there is no cookie.
  await page.evaluate(() => localStorage.setItem('doubletake.token', 'dt_fixture_token'));
  await page.goto(path, { waitUntil: 'networkidle' });
  // Fonts are bundled; make sure they have applied before the shot, else glyph widths shift.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

test('inbox', async ({ page }) => {
  await open(page, '/');
  await expect(page.getByRole('link', { name: /Osmo Pocket 3/ })).toBeVisible();
  await expect(page).toHaveScreenshot('inbox.png', { fullPage: true });
});

test('inbox filter sheet', async ({ page }) => {
  await open(page, '/');
  await page.locator('button[aria-label^="Filters"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveScreenshot('inbox-filter.png');
});

test('library', async ({ page }) => {
  await open(page, '/library');
  await expect(page.getByRole('link', { name: /Places/ })).toBeVisible();
  await expect(page).toHaveScreenshot('library.png', { fullPage: true });
});

test('chat with table, chart and diagram', async ({ page }) => {
  await open(page, `/chat/${CHAT}`);
  await expect(page.locator('.prose table:not(.sr-only)').first()).toBeVisible();
  await expect(page.locator('figure.chart svg')).toBeVisible();
  // Mermaid is a lazy chunk; its figure leaves the pending state once the SVG is in.
  await expect(page.locator('figure.mermaid:not(.pending) svg')).toBeVisible({ timeout: 15_000 });
  // Node labels must survive sanitising (SVG <text>, not <foreignObject>) and bars must be
  // coloured by their series class rather than falling back to black.
  await expect(page.locator('figure.mermaid svg text', { hasText: 'Pocket 3' })).toBeVisible();
  await expect(page.locator('figure.chart svg rect.bar').first()).toBeVisible();
  await expect(page).toHaveScreenshot('chat.png', { fullPage: true });
});

test('chat claims tab', async ({ page }) => {
  await open(page, `/chat/${CHAT}`);
  await page.getByRole('tab', { name: /Claims/ }).click();
  await expect(page.getByText('1-inch sensor')).toBeVisible();
  await expect(page).toHaveScreenshot('chat-claims.png', { fullPage: true });
});

test('compose', async ({ page }) => {
  await open(page, '/compose');
  await expect(page.getByRole('button', { name: /Research/ })).toBeVisible();
  await expect(page).toHaveScreenshot('compose.png', { fullPage: true });
});

test('settings', async ({ page }) => {
  await open(page, '/settings');
  await expect(page.getByRole('link', { name: /Appearance/ })).toBeVisible();
  await expect(page).toHaveScreenshot('settings.png', { fullPage: true });
});

test('settings appearance', async ({ page }) => {
  await open(page, '/settings/appearance');
  await expect(page.getByRole('switch').first()).toBeVisible();
  await expect(page).toHaveScreenshot('settings-appearance.png', { fullPage: true });
});

test('welcome', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('button', { name: /Sign in|Pair/ }).first()).toBeVisible();
  await expect(page).toHaveScreenshot('welcome.png', { fullPage: true });
});
