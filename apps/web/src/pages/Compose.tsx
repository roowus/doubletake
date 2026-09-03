import type { Channel, ModeRequested } from '@doubletake/shared';
import { useState } from 'react';
import { ApiError, api } from '../api';
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
    <div className="page">
      <form className="card stack" onSubmit={submit}>
        <h3 style={{ margin: 0 }}>{shared ? 'Shared with Doubletake' : 'What did you see?'}</h3>
        <textarea
          placeholder="Paste a link (Instagram, TikTok, YouTube, X, Reddit, any page) or type a question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: single-purpose compose screen
          autoFocus={!initial}
        />
        <input
          placeholder="Optional note: what do you want to know? (“is this true”, “compare”, “save for later”)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: single-purpose compose screen
          autoFocus={!!initial}
        />
        <ModeChips value={mode} onChange={setMode} />
        {err && <div className="msg error small">{err}</div>}
        <div className="row">
          <button type="submit" className="primary" disabled={busy || !input.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/')}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
