import { expect, test } from '@playwright/test';

/**
 * Hosted-mode gating (ADR 0032), behaviour-level only (no screenshots). The /api/status route
 * is mocked per-test here rather than in fixture-server.mjs so the visual suite's fixture
 * (self-hosted, hosted flag absent) is untouched.
 */
test('hosted and anonymous redirects every view to login', async ({ page }) => {
  await page.route('**/api/status**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hosted: true, inviteRequired: true }),
    }),
  );
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('tab', { name: 'Register' })).toBeVisible();
  // Register reveals the invite field because the mocked status is invite-only.
  await page.getByRole('tab', { name: 'Register' }).click();
  await expect(page.getByLabel('Invite code')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});

test('an OAuth hash token is stored and lands in the shell', async ({ page }) => {
  await page.route('**/api/status**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hosted: true, inviteRequired: false }),
    }),
  );
  // The Google callback returns to a view with the bearer in the URL fragment.
  await page.goto('/#dth_token=dt_oauth_token');
  await expect(page).not.toHaveURL(/dth_token/);
  expect(await page.evaluate(() => localStorage.getItem('doubletake.token'))).toBe(
    'dt_oauth_token',
  );
  // Signed in, the four-tab shell works.
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();
});

test('a self-hosted status (fixture default) shows no login redirect', async ({ page }) => {
  // Sign in the way the visual suite does; the fixture server accepts any token.
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('doubletake.token', 'dt_fixture_token'));
  await page.goto('/library');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
});
