import { useState } from 'react';
import { Icon } from './Icon';

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
