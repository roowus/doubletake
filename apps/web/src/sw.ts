/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// App shell handling is build-time switched (ADR 0032):
// - Self-hosted builds (default): precache + cache-first shell for offline use.
// - Hosted builds (SW_SHELL_CACHE=0): NO shell caching at all. Every navigation goes to the
//   network, so a deploy can never leave anyone on a dead cached shell. The public pages
//   (/, /privacy, /terms, /delete) are server-rendered and must always be fresh.
declare const SW_SHELL_CACHE: boolean;
if (SW_SHELL_CACHE) {
  precacheAndRoute(self.__WB_MANIFEST);
  cleanupOutdatedCaches();
  registerRoute(
    new NavigationRoute(
      async () => (await caches.match('/index.html')) ?? (await fetch('/index.html')),
      { denylist: [/^\/api\//, /^\/s\//] },
    ),
  );
} else {
  cleanupOutdatedCaches();
  registerRoute(
    new NavigationRoute(async (params) => {
      const req = (params.event as FetchEvent | undefined)?.request ?? params.request;
      try {
        return await fetch(req);
      } catch {
        return (await caches.match('/index.html')) ?? Response.error();
      }
    }, { denylist: [/^\/api\//, /^\/s\//] }),
  );
}

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
