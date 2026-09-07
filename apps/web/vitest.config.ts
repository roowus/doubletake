import { defineConfig } from 'vitest/config';

// Unit tests live under src/; e2e/ is Playwright's and must not be collected by vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
