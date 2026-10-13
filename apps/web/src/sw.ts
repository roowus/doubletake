/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// Navigations are NETWORK-FIRST for every build: users always get the deployed shell when
// online; the precached shell is only the OFFLINE fallback. (Cache-first here served dead
// shells after deploys and trapped users on the login page - never again.) The denylist
// exempts the API, share-pages, and the hosted public pages (/, /privacy, /terms, /delete),
// which the server answers fresh.
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
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
