import { useState } from 'react';

/**
 * Free-form task for the saved list (ADR 0031): a title and an optional note. Used in the chat's
 * "Add a task" sheet (the task remembers which chat it came from) and on the To do page.
 */
export function TaskForm({
  initialTitle = '',
  onSave,
}: {
  initialTitle?: string;
  onSave: (title: string, note: string | null) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = title.trim();
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!trimmed || busy) return;
        setBusy(true);
        try {
          await onSave(trimmed, note.trim() || null);
          setTitle('');
          setNote('');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="task-title">Task</label>
        <input
          id="task-title"
          placeholder="Install the app and try the export"
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: single-field sheet opened on purpose
          autoFocus
        />
      </div>
      <div className="field">
        <label htmlFor="task-note">
          Note <span className="muted">(optional)</span>
        </label>
        <input
          id="task-note"
          placeholder="when, why, with whom"
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={!trimmed || busy}>
          Save task
        </button>
      </div>
    </form>
  );
}
