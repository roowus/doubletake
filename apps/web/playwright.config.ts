import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression for the PWA (docs/ARCHITECTURE.md §9). The suite screenshots the built app
 * served by `e2e/fixture-server.mjs`, which also answers `/api` with fixed data, so a run never
 * needs the real server. Snapshots are rendered on Linux Chromium only (the CI `web-visual` job):
 * font hinting differs per OS, so a macOS run compares nothing unless `E2E_SNAPSHOTS=1`.
 */
const onLinux = process.platform === 'linux' || !!process.env.E2E_SNAPSHOTS;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}{ext}',
  ignoreSnapshots: !onLinux,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    // The app reads its font files and the Leaflet/Mermaid chunks from the same origin.
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node e2e/fixture-server.mjs',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'phone-light',
      use: { viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 2 },
    },
    {
      name: 'phone-dark',
      use: { viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 },
    },
    {
      name: 'desktop-light',
      use: { viewport: { width: 1280, height: 860 }, colorScheme: 'light' },
    },
  ],
});
