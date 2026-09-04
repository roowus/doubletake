import type { EntityKind } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { getToken } from './api';
import { Icon } from './components/Icon';
import { resetLive } from './live';
import { installNativeListeners, pendingShareToPath, takePendingShare } from './native';
import { Chat } from './pages/Chat';
import { ChatList } from './pages/ChatList';
import { Compose } from './pages/Compose';
import { ENTITY_KINDS, Entities } from './pages/Library';
import { MapView } from './pages/MapView';
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
        {...(url.searchParams.get('channel') === 'android_share' ||
        url.searchParams.get('channel') === 'ios_share'
          ? { channel: url.searchParams.get('channel') as 'android_share' | 'ios_share' }
          : {})}
      />
    );
  else if (url.pathname === '/settings') page = <Settings />;
  else if (url.pathname === '/map') page = <MapView />;
  else if (url.pathname.startsWith('/entities/')) {
    const kind = url.pathname.slice('/entities/'.length) as EntityKind;
    page = <Entities kind={ENTITY_KINDS.includes(kind) ? kind : 'place'} />;
  } else page = <ChatList />;

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Icon name="sparkles" size={18} />
          </span>
          Doubletake
        </Link>
        <span className="spacer" />
        <nav className="actions" aria-label="Primary">
          <Link to="/compose" className="icon-link" aria-label="New item" title="New item">
            <Icon name="plus" size={22} />
          </Link>
          <Link to="/settings" className="icon-link" aria-label="Settings" title="Settings">
            <Icon name="settings" size={22} />
          </Link>
        </nav>
      </header>
      <main>{page}</main>
    </div>
  );
}
