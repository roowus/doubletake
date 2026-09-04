import type { EntityKind } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { getToken } from './api';
import { resetLive } from './live';
import { installNativeListeners, pendingShareToPath, takePendingShare } from './native';
import { Chat } from './pages/Chat';
import { ChatList } from './pages/ChatList';
import { Compose } from './pages/Compose';
import { ENTITY_KINDS, Entities } from './pages/Library';
import { Settings } from './pages/Settings';
import { Welcome } from './pages/Welcome';
import { Link, navigate, usePath } from './router';

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
        {...(url.searchParams.get('channel') === 'android_share'
          ? { channel: 'android_share' as const }
          : {})}
      />
    );
  else if (url.pathname === '/settings') page = <Settings />;
  else if (url.pathname.startsWith('/entities/')) {
    const kind = url.pathname.slice('/entities/'.length) as EntityKind;
    page = <Entities kind={ENTITY_KINDS.includes(kind) ? kind : 'place'} />;
  } else page = <ChatList />;

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Doubletake
        </Link>
        <span className="spacer" />
        <Link to="/compose" className="small">
          + New
        </Link>
        <Link to="/settings" className="small">
          Settings
        </Link>
      </header>
      <main>{page}</main>
    </div>
  );
}
