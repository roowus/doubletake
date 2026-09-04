import type { ModeRequested } from '@doubletake/shared';

const MODES: { id: ModeRequested; label: string; short: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', short: 'from the note', hint: 'Picks a mode from your note' },
  { id: 'quick', label: 'Quick', short: '< 90 s', hint: 'A few sentences in under 90 seconds' },
  {
    id: 'standard',
    label: 'Standard',
    short: '~5 min',
    hint: 'Sources and claims, about 5 minutes',
  },
  { id: 'deep', label: 'Deep', short: '~20 min', hint: 'Full report, up to 25 minutes' },
];

export function ModeChips(props: {
  value: ModeRequested;
  onChange: (m: ModeRequested) => void;
  allowAuto?: boolean;
}) {
  return (
    <fieldset className="chips scroll">
      <legend className="sr-only">Research mode</legend>
      {MODES.filter((m) => props.allowAuto !== false || m.id !== 'auto').map((m) => (
        <button
          type="button"
          key={m.id}
          aria-pressed={props.value === m.id}
          className="chip"
          title={m.hint}
          onClick={() => props.onChange(m.id)}
        >
          {m.label}
          <span className="count">{m.short}</span>
        </button>
      ))}
    </fieldset>
  );
}
