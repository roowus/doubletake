/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// Navigations are NETWORK-FIRST for every build: users always get the deployed shell when
// online; the precached shell is only the OFFLINE fallback. (Cache-first here served dead
// shells after deploys and trapped users on the login page - never again.) The denylist
// exempts the API, share-pages, and the hosted public pages (/, /privacy, /terms, /delete),
// which the server answers fresh.
// Build stamp: every deploy activates a worker whose stamp differs, so the activate handler
// below purges ALL caches once per deploy. Legacy cache-first workers left poisoned entries
// inside the same-named precache cache (dead shells, login redirects); name-based cleanup
// cannot see those, so we hard-reset instead of trusting them.
declare const __DT_VERSION__: string;
const CACHE_STAMP = `dt-cache-stamp:${typeof __DT_VERSION__ === 'string' ? __DT_VERSION__ : 'dev'}`;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(
    async (params) => {
      // fetch(navigationRequest) THROWS (navigate mode). Fetch by URL instead, and on
      // failure fall back to the precached shell (offline) - never to a stale one.
      const req = (params.event as FetchEvent | undefined)?.request ?? params.request;
      try {
        return await fetch(req.url, { method: 'GET', headers: { accept: 'text/html' } });
      } catch {
        return (await caches.match(req)) ?? (await caches.match('/index.html')) ?? Response.error();
      }
    },
    { denylist: [/^\/api\//, /^\/s\//, /^\/$/, /^\/privacy/, /^\/terms/, /^\/delete/, /^\/welcome/] },
  ),
);

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      // Once per deploy: drop every cache so no legacy entry survives the update, then
      // re-fetch the current precache. Clients are claimed and an out-of-date page reloads.
      const stamp = await caches.match(CACHE_STAMP);
      const current = await stamp?.text();
      if (current !== CACHE_STAMP) {
        await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
        await caches.open('dt-cache-stamp').then((c) => c.put(CACHE_STAMP, new Response(CACHE_STAMP)));
      }
      await self.clients.claim();
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        client.postMessage({ type: 'dt:updated' });
      }
    })(),
  ),
);

interface PushPayload {
  title: string;
  body: string;
  chatId: string;
  url: string;
  tag: string;
}

self.addEventListener('push', (e) => {
  let p: PushPayload;
  try {
    p = e.data?.json() as PushPayload;
  } catch {
    return;
  }
  if (!p?.title) return;
  e.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: p.url, chatId: p.chatId },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data as { url?: string; chatId?: string } | undefined;
  const target = new URL(
    data?.url ?? (data?.chatId ? `/chat/${data.chatId}` : '/'),
    self.location.origin,
  );
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = wins.find((w) => new URL(w.url).origin === target.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(target.href);
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
