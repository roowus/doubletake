import { useEffect, useState } from 'react';
import { ApiError, api, setToken } from '../api';

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
  const [tab, setTab] = useState<'password' | 'pair'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .health()
      .then((h) => setHasOwner(h.hasOwner))
      .catch(() => setErr('Cannot reach the Doubletake server.'));
    const c = new URLSearchParams(location.search).get('code');
    if (c) {
      setCode(c.toUpperCase());
      setTab('pair');
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      let token: string;
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
        {tab === 'pair' ? (
          <input
            placeholder="6-character code from Settings → Pair a device"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoFocus
          />
        ) : (
          <input
            type="password"
            placeholder={hasOwner ? 'Owner password' : 'New owner password (8+ characters)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        )}
        <input
          placeholder="Device name"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />
        {err && <div className="msg error small">{err}</div>}
        <button className="primary" disabled={busy || hasOwner === null}>
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
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad/i.test(ua)) return 'ios';
  return 'web';
}
