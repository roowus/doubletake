import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Dev: the API lives on the server process (default port 7391); proxy so the app is same-origin.
const API = process.env.DOUBLETAKE_API ?? 'http://127.0.0.1:7391';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Custom worker: precache + Web Push handlers (src/sw.ts).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Doubletake',
        short_name: 'Doubletake',
        description: 'Share it now, get a researched answer later.',
        theme_color: '#0f1115',
        background_color: '#0f1115',
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
        // Never precache anything under /api; the worker also denylists it for navigations.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
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
