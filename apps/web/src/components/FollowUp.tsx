import type { Mode } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import { Menu, type MenuAction } from './Menu';
import { MODES } from './ModeControl';

/**
 * The sticky composer at the foot of a chat: one line that grows to six, Enter sends a
 * follow-up question, the compass opens the Research menu (Quick / Standard / Deep re-run and,
 * when several brains are configured, a pin for this run). Sends are disabled while a run is
 * live so the same question is never queued twice.
 */
export function FollowUp({
  onSend,
  onResearch,
  busy,
}: {
  onSend: (content: string) => Promise<void>;
  onResearch: (mode: Mode, adapter: string | null) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [brains, setBrains] = useState<string[]>([]);
  const [pin, setPin] = useState<string | null>(null);
  // Brains only matter for the menu; one cheap status call (healthchecks skipped) on mount.
  useEffect(() => {
    api
      .status('skip')
      .then((s) => setBrains(s.brainIds ?? []))
      .catch(() => {});
  }, []);

  const items: (MenuAction | 'separator' | { heading: string })[] = MODES.filter(
    (m) => m.id !== 'auto',
  ).map((m) => ({
    label: m.label,
    hint: m.time,
    icon: 'compass' as const,
    onSelect: () => void onResearch(m.id as Mode, pin),
  }));
  if (brains.length > 1) {
    items.push('separator', { heading: 'Brain' });
    items.push({
      label: 'Mode default',
      checked: pin === null,
      onSelect: () => setPin(null),
    });
    for (const b of brains) items.push({ label: b, checked: pin === b, onSelect: () => setPin(b) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setDraft('');
    await onSend(content);
  }
  return (
    <form className="composer" onSubmit={submit}>
      <div className="bar">
        <textarea
          aria-label="Follow-up question"
          placeholder={busy ? 'Working on it…' : 'Ask a follow-up…'}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Menu
          label="Research this again"
          heading={pin ? `Research with ${pin}` : 'Research this'}
          side="top"
          trigger={<Icon name="compass" />}
          items={items}
        />
        <button
          type="submit"
          className="primary icon"
          disabled={!draft.trim() || busy}
          aria-label="Send"
        >
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
}
