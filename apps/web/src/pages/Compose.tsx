import type { Channel, ModeRequested } from '@doubletake/shared';
import { useState } from 'react';
import { ApiError, api } from '../api';
import { Icon } from '../components/Icon';
import { ModeChips } from '../components/ModeChips';
import { navigate } from '../router';

/** Compose box; also the landing page for the Web Share Target (`/share?url=&text=&title=`). */
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    const isUrl = /^https?:\/\/\S+$/i.test(trimmed);
    try {
      const res = await api.ingest({
        ...(isUrl ? { url: trimmed } : { text: trimmed }),
        ...(note.trim() ? { note: note.trim() } : {}),
        channel: channel ?? (shared ? 'web_share_target' : 'compose'),
        focus: 'whole',
        modeHint: mode,
      });
      navigate(`/chat/${res.chatId}`, true);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <form className="card stack loose" onSubmit={submit} aria-busy={busy}>
        <div className="page-head">
          <button
            type="button"
            className="ghost icon"
            aria-label="Back"
            onClick={() => navigate('/')}
          >
            <Icon name="arrow-left" size={22} />
          </button>
          <h2>{shared ? 'Shared with Doubletake' : 'What did you see?'}</h2>
        </div>
        <div className="field">
          <label htmlFor="c-input">Link or question</label>
          <textarea
            id="c-input"
            placeholder="Paste a link or type a question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby="c-input-help"
            // biome-ignore lint/a11y/noAutofocus: single-purpose compose screen
            autoFocus={!initial}
          />
          <div id="c-input-help" className="help">
            Instagram, TikTok, YouTube, X, Reddit or any web page. Plain text works too.
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
            What you want to know. It also picks the mode when Auto is selected.
          </div>
        </div>
        <div className="field">
          <span className="label">Mode</span>
          <ModeChips value={mode} onChange={setMode} />
        </div>
        {err && (
          <div className="banner error" role="alert">
            <Icon name="alert" />
            <span>{err}</span>
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={() => navigate('/')}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !input.trim()}>
            <Icon name="send" size={18} />
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
