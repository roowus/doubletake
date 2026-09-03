import type { ModeRequested } from '@doubletake/shared';

const MODES: { id: ModeRequested; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Pick from the note' },
  { id: 'quick', label: 'Quick', hint: '< 90 s, a few sentences' },
  { id: 'standard', label: 'Standard', hint: 'Sources + claims' },
  { id: 'deep', label: 'Deep', hint: 'Full report' },
];

export function ModeChips(props: {
  value: ModeRequested;
  onChange: (m: ModeRequested) => void;
  allowAuto?: boolean;
}) {
  return (
    <div className="chips">
      {MODES.filter((m) => props.allowAuto !== false || m.id !== 'auto').map((m) => (
        <button
          type="button"
          key={m.id}
          className={`chip ${props.value === m.id ? 'on' : ''}`}
          title={m.hint}
          onClick={() => props.onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
