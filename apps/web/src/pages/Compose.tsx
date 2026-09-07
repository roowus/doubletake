import type { Channel, ModeRequested } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { ModeControl } from '../components/ModeControl';
import { navigate, navigateWithTransition } from '../router';

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Add tab: a full page, not a modal. Also the landing page for the Web Share Target
 * (`/share?url=&text=&title=`) and for native shares replayed after pairing.
 */
export function Compose({
  shared,
  channel,
}: {
  shared?: { url?: string; text?: string; title?: string };
  /** Overrides the channel recorded on the item (native share replayed after pairing). */
  channel?: Channel;
}) {
  const initial = shared?.url ?? shared?.text ?? '';
  const [input, setInput] = useState(initial);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<ModeRequested>('auto');
  const [brains, setBrains] = useState<string[]>([]);
  const [pin, setPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .status('skip')
      .then((s) => alive && setBrains(s.brainIds ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const trimmed = input.trim();
  const isUrl = URL_RE.test(trimmed);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.ingest({
        ...(isUrl ? { url: trimmed } : { text: trimmed }),
        ...(note.trim() ? { note: note.trim() } : {}),
        channel: channel ?? (shared ? 'web_share_target' : 'compose'),
        focus: 'whole',
        modeHint: mode,
        ...(pin ? { adapter: pin } : {}),
      });
      navigateWithTransition(`/chat/${res.chatId}`, true);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
      setBusy(false);
    }
  }

  return (
    <div className="page narrow compose">
      <form className="stack loose" onSubmit={submit} aria-busy={busy}>
        <div className="page-head">
          {shared && (
            <button
              type="button"
              className="ghost icon"
              aria-label="Back"
              onClick={() => navigate('/')}
            >
              <Icon name="arrow-left" size={22} />
            </button>
          )}
          <h1>{shared ? 'Shared with Doubletake' : 'What did you see?'}</h1>
        </div>
        <div className="field">
          <label htmlFor="c-input">Link or question</label>
          <textarea
            id="c-input"
            className="compose-input"
            placeholder="Paste a link or type a question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby="c-input-help"
            rows={4}
            // biome-ignore lint/a11y/noAutofocus: single-purpose compose screen
            autoFocus={!initial}
          />
          <div id="c-input-help" className="help">
            {trimmed && !isUrl
              ? 'Researched as a question.'
              : 'Instagram, TikTok, YouTube, X, Reddit or any web page. Plain text works too.'}
          </div>
        </div>
        <div className="field">
          <label htmlFor="c-note">
            Note <span className="muted">(optional)</span>
          </label>
          <input
            id="c-note"
            placeholder="is this true · compare · save for later"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="c-note-help"
            // biome-ignore lint/a11y/noAutofocus: single-purpose compose screen
            autoFocus={!!initial}
          />
          <div id="c-note-help" className="help">
            What you want to know. With Auto, the note also picks the mode.
          </div>
        </div>
        <div className="field">
          <span className="label">Mode</span>
          <ModeControl value={mode} onChange={setMode} />
        </div>
        {err && (
          <div className="banner error" role="alert">
            <Icon name="alert" />
            <span>{err}</span>
          </div>
        )}
        <div className="form-actions compose-actions">
          {brains.length > 1 ? (
            <Menu
              label="Brain for this run"
              className="ghost brain-pick"
              align="start"
              trigger={
                <>
                  <Icon name="bot" size={18} />
                  <span>{pin ?? 'Default brain'}</span>
                  <Icon name="chevron-down" size={16} />
                </>
              }
              items={[
                { label: 'Mode default', onSelect: () => setPin(null) },
                'separator',
                ...brains.map((b) => ({ label: b, onSelect: () => setPin(b) })),
              ]}
            />
          ) : (
            <span />
          )}
          <button type="submit" className="primary" disabled={busy || !trimmed}>
            <Icon name="send" size={18} />
            {busy ? 'Sending…' : 'Research'}
          </button>
        </div>
      </form>
    </div>
  );
}
