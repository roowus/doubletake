import { useState } from 'react';
import { ApiError, api, setToken } from '../api';
import { Icon } from '../components/Icon';
import type { HostedStatus } from '../lib/hosted';

/**
 * Hosted sign-in (ADR 0032): e-mail + password, with a register toggle that asks for an invite
 * code only when the server requires one, and Google as the revocable OAuth alternative. The
 * Google round trip comes back with `#dth_token=<bearer>` on whatever view it left from; App
 * captures that, so this page only fires the redirect.
 */
export function Login({
  hosted,
  oauthError,
  returnTo,
  onAuthed,
}: {
  hosted: HostedStatus;
  oauthError: string | null;
  returnTo: string;
  onAuthed: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r =
        mode === 'register'
          ? await api.hostedRegister(email.trim(), password, invite.trim() || undefined)
          : await api.hostedLogin(email.trim(), password);
      setToken(r.token);
      onAuthed();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  function google() {
    window.location.href = `/api/auth/google?return_to=${encodeURIComponent(returnTo || '/')}`;
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
            <span>Hosted brains read it, check the claims and pull out the useful things.</span>
          </li>
          <li className="welcome-step">
            <strong className="welcome-step-title">Come back</strong>
            <span>A well-set page is waiting: the answer, its sources and everything it found.</span>
          </li>
        </ol>
      </aside>
      <form className="card welcome" onSubmit={submit} aria-busy={busy}>
        <h2 className="welcome-title">Open your notebook</h2>
        <div className="tabs" role="tablist" aria-label="Account action">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'on' : ''}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'on' : ''}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>
        <div className="field">
          <label htmlFor="h-email">E-mail</label>
          <input
            id="h-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            // biome-ignore lint/a11y/noAutofocus: single-field sign-in screen
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="h-pass">Password</label>
          <input
            id="h-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
        </div>
        {mode === 'register' && hosted.inviteRequired && (
          <div className="field">
            <label htmlFor="h-invite">Invite code</label>
            <input
              id="h-invite"
              className="mono"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <div className="help">This hosted instance is invite-only.</div>
          </div>
        )}
        {(err || oauthError) && (
          <div className="banner error" role="alert">
            <Icon name="alert" />
            <span>{err ?? oauthError}</span>
          </div>
        )}
        <button type="submit" className="primary block" disabled={busy || !email || !password}>
          {busy ? 'Connecting…' : mode === 'register' ? 'Create account' : 'Log in'}
        </button>
        <div className="or-rule" aria-hidden="true">
          <span>or</span>
        </div>
        <button type="button" className="block" onClick={google}>
          Sign in with Google
        </button>
      </form>
    </div>
  );
}
