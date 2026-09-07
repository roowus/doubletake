import type { EntityKind } from '@doubletake/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { getToken } from './api';
import { Shell } from './components/Shell';
import { Toaster } from './components/Toast';
import { resetLive } from './live';
import {
  installNativeListeners,
  pendingShareToPath,
  resumeNativePush,
  takePendingShare,
} from './native';
import { Chat } from './pages/Chat';
import { Compose } from './pages/Compose';
import { ENTITY_KINDS, Entities } from './pages/Entities';
import { Inbox } from './pages/Inbox';
import { Library } from './pages/Library';
import { Settings } from './pages/Settings';
import { Todo } from './pages/Todo';
import { Welcome } from './pages/Welcome';
import { navigate, usePath } from './router';

// Leaflet is only needed on the map, so it ships as its own chunk.
const MapView = lazy(() => import('./pages/MapView').then((m) => ({ default: m.MapView })));

export function App() {
  const path = usePath();
  const [authed, setAuthed] = useState(!!getToken());

  useEffect(() => {
    const onUnauth = () => setAuthed(false);
    window.addEventListener('doubletake:unauthorized', onUnauth);
    installNativeListeners();
    return () => window.removeEventListener('doubletake:unauthorized', onUnauth);
  }, []);

  // A share received by the native sheet while unpaired is replayed once we are signed in.
  useEffect(() => {
    if (!authed) return;
    void takePendingShare().then((s) => {
      if (s) navigate(pendingShareToPath(s), true);
    });
    // A re-paired device keeps its FCM token but the server forgot it; re-post when allowed.
    void resumeNativePush();
  }, [authed]);

  if (!authed) {
    return (
      <Welcome
        onAuthed={() => {
          setAuthed(true);
          resetLive();
          // Preserve a pending share target.
          if (!location.pathname.startsWith('/share')) navigate('/', true);
        }}
      />
    );
  }

  const url = new URL(path, location.origin);
  let page: React.ReactNode;
  const chatMatch = url.pathname.match(/^\/chat\/([^/]+)$/);
  const settingsMatch = url.pathname.match(/^\/settings(?:\/([a-z-]+))?$/);
  if (chatMatch?.[1]) page = <Chat id={chatMatch[1]} />;
  else if (url.pathname === '/compose') page = <Compose />;
  else if (url.pathname === '/share')
    page = (
      <Compose
        shared={{
          ...(url.searchParams.get('url') ? { url: url.searchParams.get('url') ?? '' } : {}),
          ...(url.searchParams.get('text') ? { text: url.searchParams.get('text') ?? '' } : {}),
          ...(url.searchParams.get('title') ? { title: url.searchParams.get('title') ?? '' } : {}),
        }}
        {...(url.searchParams.get('channel') === 'android_share' ||
        url.searchParams.get('channel') === 'ios_share'
          ? { channel: url.searchParams.get('channel') as 'android_share' | 'ios_share' }
          : {})}
      />
    );
  else if (url.pathname === '/library') page = <Library />;
  else if (url.pathname === '/todo') page = <Todo />;
  else if (settingsMatch) page = <Settings section={settingsMatch[1]} />;
  else if (url.pathname === '/map')
    page = (
      <Suspense
        fallback={
          <div className="page muted" aria-busy="true">
            Loading map…
          </div>
        }
      >
        <MapView />
      </Suspense>
    );
  else if (url.pathname.startsWith('/entities/')) {
    const kind = url.pathname.slice('/entities/'.length) as EntityKind;
    page = <Entities kind={ENTITY_KINDS.includes(kind) ? kind : 'place'} />;
  } else page = <Inbox />;

  return (
    <Shell pathname={url.pathname} bare={!!chatMatch}>
      {page}
      <Toaster />
    </Shell>
  );
}
