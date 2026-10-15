import { expect, test } from '@playwright/test';

/**
 * Theme defaults and persistence (ADR 0030 + the 2026-10-14 default change).
 *
 * Paper is the default regardless of the OS. The app used to default to `system`, so a
 * dark-mode laptop opened the app in ink while the landing page is light-only, and the two
 * read as different products. Ink is still available; it just is not chosen for you.
 */

test('a fresh visitor gets paper even when the OS asks for dark', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('paper');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    ),
  ).toBe('#f7f3e9');
  await ctx.close();
});

test('choosing Ink is remembered on the next load', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'doubletake.appearance',
      JSON.stringify({ theme: 'ink', prose: 'm', motion: 'system' }),
    ),
  );
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('ink');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    ),
  ).toBe('#16130f');
});

test('Match device follows the OS in both directions', async ({ browser }) => {
  for (const [scheme, want] of [
    ['light', '#f7f3e9'],
    ['dark', '#16130f'],
  ] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem(
        'doubletake.appearance',
        JSON.stringify({ theme: 'system', prose: 'm', motion: 'system' }),
      ),
    );
    await page.reload();
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      ),
    ).toBe(want);
    await ctx.close();
  }
});
