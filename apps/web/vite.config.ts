import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Dev: the API lives on the server process (default port 7391); proxy so the app is same-origin.
const API = process.env.DOUBLETAKE_API ?? 'http://127.0.0.1:7391';

// Settings → About shows the build: short git sha plus the day, or "dev" outside a checkout.
function buildVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return `${sha} · ${new Date().toISOString().slice(0, 10)}`;
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: { __DT_VERSION__: JSON.stringify(buildVersion()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from main.tsx, web only: inside Capacitor the assets are local and a stale
      // precache would keep serving the previous APK's bundle after an update.
      injectRegister: null,
      // Custom worker: precache + Web Push handlers (src/sw.ts).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Doubletake',
        short_name: 'Doubletake',
        description: 'Share it now, get a researched answer later.',
        theme_color: '#f7f4ee',
        background_color: '#f7f4ee',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        // Web Share Target: installed PWAs (Android Chrome, desktop Chrome) show up in the share sheet.
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      injectManifest: {
        // Never precache /api; the worker also denylists it and /s/ share pages for navigations.
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
