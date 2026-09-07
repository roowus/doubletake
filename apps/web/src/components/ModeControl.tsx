import type { ModeRequested } from '@doubletake/shared';
import { useId } from 'react';

export const MODES: { id: ModeRequested; label: string; time: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', time: 'from the note', hint: 'Picks a mode from your note' },
  { id: 'quick', label: 'Quick', time: '< 90 s', hint: 'A few sentences in under 90 seconds' },
  {
    id: 'standard',
    label: 'Standard',
    time: '~5 min',
    hint: 'Sources and claims, about 5 minutes',
  },
  { id: 'deep', label: 'Deep', time: '~20 min', hint: 'Full report, up to 25 minutes' },
];

/**
 * Segmented research-mode control: a radio group styled as one bar. The selected mode's hint
 * is read out below so the labels stay one word each.
 */
export function ModeControl({
  value,
  onChange,
  allowAuto = true,
  name,
}: {
  value: ModeRequested;
  onChange: (m: ModeRequested) => void;
  allowAuto?: boolean;
  name?: string;
}) {
  const id = useId();
  const group = name ?? `mode-${id}`;
  const modes = MODES.filter((m) => allowAuto || m.id !== 'auto');
  const current = modes.find((m) => m.id === value) ?? modes[0];
  return (
    <div className="segmented-wrap">
      <fieldset className="segmented" aria-describedby={`${group}-hint`}>
        <legend className="sr-only">Research mode</legend>
        {modes.map((m) => (
          <label key={m.id} className="segment" data-on={m.id === value || undefined}>
            <input
              type="radio"
              name={group}
              value={m.id}
              checked={m.id === value}
              onChange={() => onChange(m.id)}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </fieldset>
      <p id={`${group}-hint`} className="help">
        {current?.hint}
        {current && current.id !== 'auto' ? ` (${current.time}).` : '.'}
      </p>
    </div>
  );
}
