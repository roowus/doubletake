import type { EntityKind } from '@doubletake/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { Shell } from './components/Shell';
import { Toaster } from './components/Toast';
import { detectHostedOnce, parseAuthHash, useHosted } from './lib/hosted';
import { resetLive } from './live';
import {
  installNativeListeners,
  isLocalBundleOrigin,
  isNative,
  KEY_SERVER_URL,
  mirrorPreferences,
  nativeEntryUrl,
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

// Routes that show the app itself; the only paths the hosted gate may guard.
const APP_ROUTE_RE = /^(\/|\/library|\/chat\b|\/todo|\/settings|\/map)/;

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

  // Hosted sign-in happens in the app: the WebView loads doubletake.gg's own login (see the
  // entry effect below), and on every native page whose server answers "hosted" this writes
  // where the session lives, so the share sheet posts there. A self-hosted server never reaches
  // here — the same probe drives `detectHostedOnce`, so the two can never disagree.
  useEffect(() => {
    if (!isNative()) return;
    void (async () => {
      if (!(await welcomeScreen(api.setupStatus))) return;
      const origin = location.origin.replace(/\/+$/, '');
      const url = (localStorage.getItem(KEY_SERVER_URL) ?? '').replace(/\/+$/, '');
      // The hosted page's own origin is the hosted server; an explicit URL only wins when it is
      // where this page came from (a device paired against its owner's server).
      await mirrorPreferences('doubletake.hosted', url && url !== origin ? '' : origin);
    })();
  }, []);

  // The bundle is the self-hosted sign-in UI; hosted accounts live on doubletake.gg, whose own
  // shell renders the login. On a phone the WebView is therefore pointed at the hosted page
  // instead of showing a sign-in form that cannot create an account here.
  useEffect(() => {
    if (!isNative() || !isLocalBundleOrigin(location.origin)) return;
    const target = nativeEntryUrl(location.origin, localStorage.getItem(KEY_SERVER_URL));
    if (target !== location.origin.replace(/\/+$/, '')) location.replace(target);
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

  // Hosted and anonymous: every view is the login page. The server serves the landing and
  // the legal pages publicly at /, /privacy, /terms, /delete and /welcome, and the service
  // worker navigation fallback now exempts them, so this gate only guards app views.
  // Signed-in visitors entering via /login go to their library (the landing owns /).
  useEffect(() => {
    if (hosted?.hosted !== true) return;
    // Guard ONLY real app views. Public pages (/, /privacy, /terms, /delete, /welcome) and
    // unknown paths must never bounce to /login, no matter what a cached service worker
    // serves — this is the fix for the stuck-in-the-login-loop bug.
    // The dt_session cookie counts as a session too: after a 401 the bearer is cleared but
    // the cookie may still be valid, and a reload must recover the session, not bounce.
    const cookieAuthed = document.cookie.includes('dt_session=');
    const signed = authed || cookieAuthed;
    if (!signed && APP_ROUTE_RE.test(path)) navigate('/login', true);
    if (signed && path === '/login') navigate('/library', true);
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

/**
 * The share sheet's copy of this session — `doubletake.hosted` is the origin the app signed in
 * at, `doubletake.serverUrl` the self-hosted one. Written from here (the WebView) every time a
 * native page's server says it is hosted, so a phone that signed in at doubletake.gg posts its
 * shares to doubletake.gg and a paired device posts to its own server.
 *
 * Returns true when the server answered that it is hosted. Derived from `api.setupStatus` so
 * the native branch is the same request the hosted gate makes, just through the shared client.
 */
async function welcomeScreen(probe: () => Promise<{ hosted?: boolean }>): Promise<boolean> {
  try {
    return (await probe()).hosted === true;
  } catch {
    return false;
  }
}
