import type { ExtractionDto } from '@doubletake/shared';
import { useState } from 'react';
import { Icon } from './Icon';

const LABEL: Record<string, string> = {
  transcript: 'Transcript',
  ocr: 'On-screen text',
  frame_description: 'Frames',
  caption: 'Caption',
  comments: 'Comments',
  thread: 'Thread',
  page_text: 'Page text',
};

/** Collapsible "Sources" panel: every extraction the brain saw, flattened to readable text. */
export function Sources({ extractions }: { extractions: ExtractionDto[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  if (extractions.length === 0) return null;
  const current = extractions.find((e) => e.id === active) ?? extractions[0];
  return (
    <div className="card stack tight">
      <button
        type="button"
        className="disclosure"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="grow truncate">
          <b>Sources</b>{' '}
          <span className="muted small">
            {extractions.map((e) => LABEL[e.kind] ?? e.kind).join(' · ')}
          </span>
        </span>
        <Icon name="chevron-down" className="chev" />
      </button>
      {open && current && (
        <>
          <div className="chips scroll">
            {extractions.map((e) => (
              <button
                type="button"
                key={e.id}
                className={`chip ${e.id === current.id ? 'on' : ''}`}
                onClick={() => setActive(e.id)}
                title={e.tool ?? undefined}
              >
                {LABEL[e.kind] ?? e.kind}
              </button>
            ))}
          </div>
          <div className="small muted">
            {current.tool ?? 'unknown tool'} · {current.createdAt.slice(0, 16).replace('T', ' ')}
          </div>
          <pre className="sources-text">{current.text}</pre>
        </>
      )}
    </div>
  );
}

/** Tag chips with remove buttons and an add field. `onChange` receives the server's new list. */
export function TagEditor({
  tags,
  manualHint,
  onAdd,
  onRemove,
}: {
  tags: string[];
  manualHint?: string;
  onAdd: (name: string) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onAdd(name);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="row wrap small" onSubmit={submit}>
      {tags.map((t) => (
        <span className="tag" key={t}>
          {t}
          <button
            type="button"
            className="tag-x"
            aria-label={`Remove tag ${t}`}
            title="Remove tag"
            disabled={busy}
            onClick={() => onRemove(t)}
          >
            <Icon name="x" size={14} />
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        placeholder={manualHint ?? '+ tag'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={40}
        disabled={busy}
      />
    </form>
  );
}
