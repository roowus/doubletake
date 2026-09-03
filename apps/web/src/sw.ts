/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// App shell precache (injected by vite-plugin-pwa). The API is never cached.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(
    async () => (await caches.match('/index.html')) ?? (await fetch('/index.html')),
    { denylist: [/^\/api\//] },
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
      icon: '/icon.svg',
      badge: '/icon.svg',
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
