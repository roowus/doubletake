import { useEffect, useState } from 'react';
import { ApiError, api, setToken } from '../api';
import { Icon } from '../components/Icon';
import {
  apiBase,
  HOSTED_URL,
  isNative,
  nativePlatform,
  parsePairingInput,
  setServerUrl,
} from '../native';

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  if (/Macintosh/i.test(ua)) return 'Mac browser';
  if (/Windows/i.test(ua)) return 'Windows browser';
  return 'Browser';
}

/**
 * First run (set owner password), login on a new device, or redeem a pairing code.
 *
 * On a phone this page is the **self-hosted** entry point. Hosted accounts sign in on the hosted
 * service's own shell — the WebView is pointed there by `nativeEntryUrl`, which is why this page
 * normally never renders on a phone. When it does (the WebView could not reach the service, or
 * the owner asked for it) it offers the self-hosted path with the hosted service named, so the
 * hosted default stays discoverable without a server URL ever being required.
 */
export function Welcome({ onAuthed }: { onAuthed: () => void }) {
  const [hasOwner, setHasOwner] = useState<boolean | null>(null);
  const native = isNative();
  // On Android the app is not served by the server, so pairing must also learn the server URL.
  const [tab, setTab] = useState<'password' | 'pair'>(native ? 'pair' : 'password');
  // Hosted first, then self-hosted behind one link: with nothing stored there is no server to
  // talk to yet, so the URL field stays behind "Use my own server" instead of greeting everyone.
  const [ownServer, setOwnServer] = useState(!!apiBase());
  const [serverUrl, setServerUrlState] = useState(apiBase() || HOSTED_URL);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (native && !apiBase()) {
      // Nothing paired, so `/api/health` would ask the bundle's own origin. The self-hosted
      // form only needs to know whether that server has an owner, and it is not reachable yet.
      setHasOwner(true);
      return;
    }
    api
      .health()
      .then((h) => setHasOwner(h.hasOwner))
      .catch(() => setErr('Cannot reach the Doubletake server.'));
    const c = new URLSearchParams(location.search).get('code');
    if (c) {
      setCode(c.toUpperCase());
      setTab('pair');
    }
  }, [native]);

  /**
   * Pasting the QR URL (`https://host/?code=X`) or its JSON fills both fields at once. Only a
   * complete payload (URL *and* code) splits; a partial `http://l` typed by hand stays put.
   */
  function onCodeInput(raw: string) {
    const parsed = parsePairingInput(raw);
    if (parsed.url && parsed.code && native) {
      setServerUrlState(parsed.url);
      setCode(parsed.code);
    } else setCode(raw);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      let token: string;
      if (native && ownServer) {
        if (!/^https?:\/\//i.test(serverUrl.trim()))
          throw new ApiError(0, 'Server URL must start with https:// or http://');
        setServerUrl(serverUrl);
      }
      if (tab === 'pair')
        token = (await api.pairRedeem(code.trim().toUpperCase(), deviceName, platform())).token;
      else if (hasOwner) token = (await api.login(password, deviceName)).token;
      else token = (await api.setup(password, deviceName)).token;
      setToken(token);
      onAuthed();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="welcome-layout">
      <aside className="welcome-brand">
        <div className="hero">
          <span className="brand-mark">
            <Icon name="doubletake" size={30} />
          </span>
          <h1 className="welcome-name">Doubletake</h1>
          <p className="tagline">A field notebook that fills itself in.</p>
        </div>
        <ol className="welcome-steps">
          <li className="welcome-step">
            <strong className="welcome-step-title">Share</strong>
            <span>Send a post, a link or a photo from your phone the moment you see it.</span>
          </li>
          <li className="welcome-step">
            <strong className="welcome-step-title">Walk away</strong>
            <span>
              Your own machine reads it, checks the claims and pulls out the useful things.
            </span>
          </li>
          <li className="welcome-step">
            <strong className="welcome-step-title">Come back</strong>
            <span>
              A well-set page is waiting: the answer, its sources and everything it found.
            </span>
          </li>
        </ol>
      </aside>
      <form className="card welcome" onSubmit={submit} aria-busy={busy}>
        <h2 className="welcome-title">
          {native && !ownServer
            ? 'Use your own server'
            : hasOwner === false
              ? 'Set up this notebook'
              : 'Open your notebook'}
        </h2>
        {native && !ownServer ? (
          <p className="muted welcome-first">
            Doubletake runs on the hosted service by default, with an account at{' '}
            <span className="mono">{HOSTED_URL.replace(/^https:\/\//, '')}</span> — this app
            normally opens its sign-in. Point it at a notebook of your own instead: paste the
            pairing link from Settings → Pair a device.
          </p>
        ) : (
          hasOwner === false && (
            <p className="muted welcome-first">
              First run. Choose the owner password; you will use it to sign in new devices.
            </p>
          )
        )}
        {hasOwner && (!native || ownServer) && (
          <div className="tabs" role="tablist" aria-label="Sign-in method">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'password'}
              className={tab === 'password' ? 'on' : ''}
              onClick={() => setTab('password')}
            >
              Password
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pair'}
              className={tab === 'pair' ? 'on' : ''}
              onClick={() => setTab('pair')}
            >
              Pairing code
            </button>
          </div>
        )}
        {native && ownServer && (
          <div className="field">
            <label htmlFor="w-server">Server URL</label>
            <input
              id="w-server"
              placeholder="https://your-mac.tailnet.ts.net"
              value={serverUrl}
              onChange={(e) => setServerUrlState(e.target.value)}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              aria-describedby="w-server-help"
            />
            <div id="w-server-help" className="help">
              The address your laptop shows under Settings → Pair a device.
            </div>
          </div>
        )}
        {tab === 'pair' ? (
          <div className="field">
            <label htmlFor="w-code">Pairing code</label>
            <input
              id="w-code"
              className="mono"
              placeholder="ABC123"
              value={code}
              onChange={(e) => onCodeInput(e.target.value)}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              aria-describedby="w-code-help"
              // biome-ignore lint/a11y/noAutofocus: single-field sign-in screen
              autoFocus
            />
            <div id="w-code-help" className="help">
              Six characters from Settings → Pair a device on a signed-in device. You can also paste
              the whole pairing link.
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="w-pass">{hasOwner ? 'Owner password' : 'New owner password'}</label>
            <input
              id="w-pass"
              type="password"
              placeholder={hasOwner ? '' : 'At least 8 characters'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={hasOwner ? 'current-password' : 'new-password'}
              // biome-ignore lint/a11y/noAutofocus: single-field sign-in screen
              autoFocus
            />
          </div>
        )}
        {(!native || ownServer) && (
          <div className="field">
            <label htmlFor="w-device">Device name</label>
            <input
              id="w-device"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              aria-describedby="w-device-help"
            />
            <div id="w-device-help" className="help">
              Shown in Settings → Devices so you can revoke it later.
            </div>
          </div>
        )}
        {err && (
          <div className="banner error" role="alert">
            <Icon name="alert" />
            <span>{err}</span>
          </div>
        )}
        {native && ownServer ? (
          <button
            type="submit"
            className="primary block"
            disabled={busy || hasOwner === null || !code.trim()}
            aria-live="polite"
          >
            {busy ? 'Connecting…' : 'Pair this device'}
          </button>
        ) : (
          <button
            type="submit"
            className="primary block"
            disabled={busy || hasOwner === null}
            aria-live="polite"
          >
            {busy
              ? 'Connecting…'
              : hasOwner === false
                ? 'Set password & continue'
                : tab === 'pair'
                  ? 'Pair this device'
                  : 'Sign in'}
          </button>
        )}
      </form>
      {native && !ownServer && (
        <button
          type="button"
          className="welcome-selfhost"
          onClick={() => {
            setOwnServer(true);
            setHasOwner(true);
            setErr(null);
          }}
        >
          Use my own server
        </button>
      )}
    </div>
  );
}

function platform(): string {
  if (isNative()) return nativePlatform();
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad/i.test(ua)) return 'ios';
  return 'web';
}
