import type { EntityKind } from '@doubletake/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { getToken, setToken } from './api';
import { Shell } from './components/Shell';
import { Toaster } from './components/Toast';
import { detectHostedOnce, parseAuthHash, useHosted } from './lib/hosted';
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
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Todo } from './pages/Todo';
import { Welcome } from './pages/Welcome';
import { navigate, usePath } from './router';

// Leaflet is only needed on the map, so it ships as its own chunk.
const MapView = lazy(() => import('./pages/MapView').then((m) => ({ default: m.MapView })));
// Same for the graph simulation (Library → Map of everything).
const GraphMap = lazy(() => import('./components/GraphMap').then((m) => ({ default: m.GraphMap })));

export function App() {
  const path = usePath();
  const [authed, setAuthed] = useState(!!getToken());
  const hosted = useHosted();
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    const onUnauth = () => setAuthed(false);
    window.addEventListener('doubletake:unauthorized', onUnauth);
    installNativeListeners();
    return () => window.removeEventListener('doubletake:unauthorized', onUnauth);
  }, []);

  // Hosted mode (ADR 0032) is probed once at boot; until it answers the app stays self-hosted.
  useEffect(() => {
    void detectHostedOnce();
  }, []);

  // A Google OAuth round trip lands back with `#dth_token=<bearer>` or `#error=<msg>` in the
  // hash. Store the bearer exactly like a paired device token, surface errors on the login.
  useEffect(() => {
    const h = parseAuthHash(location.hash);
    if (!h.token && !h.error) return;
    if (h.token) setToken(h.token);
    setOauthError(h.error ?? null);
    history.replaceState(
      null,
      '',
      location.pathname + location.search + (h.rest ? `#${h.rest}` : ''),
    );
    window.dispatchEvent(new Event('doubletake:navigate'));
    if (h.token) {
      setAuthed(true);
      resetLive();
      navigate('/', true);
    }
  }, []);

  // Hosted and anonymous: every view is the login page. Hosted and signed in: never the login.
  // Public pages (/privacy /terms /delete /welcome) and the server-served landing (/) are exempt:
  // the server answers them for anonymous visitors, so the gate must never bounce them to /login
  // even when a cached SPA shell boots at that URL.
  useEffect(() => {
    if (hosted?.hosted !== true) return;
    if (PUBLIC_APP_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
      if (!authed && path === '/') {
        // The shell booted at the landing URL without a session: reload so the server's
        // static landing (not this shell) is served. Guarded so it happens at most once.
        if (!sessionStorage.getItem('dt:landing-reload')) {
          sessionStorage.setItem('dt:landing-reload', '1');
          location.reload();
        } else {
          sessionStorage.removeItem('dt:landing-reload');
          navigate('/login', true);
        }
      }
      return;
    }
    if (!authed && !path.startsWith('/login')) navigate('/login', true);
    if (authed && path === '/login') navigate('/', true);
  }, [hosted, authed, path]);

  // A share received by the native sheet while unpaired is replayed once we are signed in.
  useEffect(() => {
    if (!authed) return;
    void takePendingShare().then((s) => {
      if (s) navigate(pendingShareToPath(s), true);
    });
    // A re-paired device keeps its FCM token but the server forgot it; re-post when allowed.
    void resumeNativePush();
  }, [authed]);

  if (hosted?.hosted === true && !authed) {
    return (
      <Login
        hosted={hosted}
        oauthError={oauthError}
        returnTo={location.pathname + location.search}
        onAuthed={() => {
          setAuthed(true);
          setOauthError(null);
          resetLive();
          navigate('/', true);
        }}
      />
    );
  }

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
  else if (url.pathname === '/graph')
    page = (
      <Suspense
        fallback={
          <div className="page muted" aria-busy="true">
            Loading map…
          </div>
        }
      >
        <GraphMap />
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
