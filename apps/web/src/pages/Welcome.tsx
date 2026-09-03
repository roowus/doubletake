import { useEffect, useState } from 'react';
import { ApiError, api, setToken } from '../api';
import { apiBase, isNative, nativePlatform, parsePairingInput, setServerUrl } from '../native';

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  if (/Macintosh/i.test(ua)) return 'Mac browser';
  if (/Windows/i.test(ua)) return 'Windows browser';
  return 'Browser';
}

/** First run (set owner password), login on a new device, or redeem a pairing code. */
export function Welcome({ onAuthed }: { onAuthed: () => void }) {
  const [hasOwner, setHasOwner] = useState<boolean | null>(null);
  const native = isNative();
  // On Android the app is not served by the server, so pairing must also learn the server URL.
  const [tab, setTab] = useState<'password' | 'pair'>(native ? 'pair' : 'password');
  const [serverUrl, setServerUrlState] = useState(apiBase());
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (native && !apiBase()) {
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

  /** Pasting the QR URL (`https://host/?code=X`) or its JSON fills both fields at once. */
  function onCodeInput(raw: string) {
    const parsed = parsePairingInput(raw);
    if (parsed.url && native) {
      setServerUrlState(parsed.url);
      setCode(parsed.code ?? '');
    } else setCode(raw);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      let token: string;
      if (native) {
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
    <div className="center">
      <form className="card narrow stack" onSubmit={submit}>
        <h2 style={{ margin: 0 }}>Doubletake</h2>
        <div className="muted small">Share it now, get a researched answer later.</div>
        {hasOwner === false && (
          <div className="small">
            First run: choose the owner password. You will use it to sign in new devices.
          </div>
        )}
        {hasOwner && (
          <div className="chips">
            <button
              type="button"
              className={`chip ${tab === 'password' ? 'on' : ''}`}
              onClick={() => setTab('password')}
            >
              Password
            </button>
            <button
              type="button"
              className={`chip ${tab === 'pair' ? 'on' : ''}`}
              onClick={() => setTab('pair')}
            >
              Pairing code
            </button>
          </div>
        )}
        {native && (
          <input
            placeholder="Server URL (https://your-mac.tailnet.ts.net)"
            value={serverUrl}
            onChange={(e) => setServerUrlState(e.target.value)}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
          />
        )}
        {tab === 'pair' ? (
          <input
            placeholder="6-character code from Settings → Pair a device"
            value={code}
            onChange={(e) => onCodeInput(e.target.value)}
            autoCapitalize="characters"
            // biome-ignore lint/a11y/noAutofocus: single-field sign-in screen
            autoFocus
          />
        ) : (
          <input
            type="password"
            placeholder={hasOwner ? 'Owner password' : 'New owner password (8+ characters)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: single-field sign-in screen
            autoFocus
          />
        )}
        <input
          placeholder="Device name"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />
        {err && <div className="msg error small">{err}</div>}
        <button type="submit" className="primary" disabled={busy || hasOwner === null}>
          {hasOwner === false
            ? 'Set password & continue'
            : tab === 'pair'
              ? 'Pair this device'
              : 'Sign in'}
        </button>
      </form>
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
