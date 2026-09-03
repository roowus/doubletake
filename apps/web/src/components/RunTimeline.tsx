import type { RunEvent } from '@doubletake/shared';

function line(e: RunEvent): string {
  const p = e.payload;
  switch (e.type) {
    case 'status':
      return `· ${String(p.phase ?? p.message ?? JSON.stringify(p))}${p.detail ? ` — ${String(p.detail)}` : ''}`;
    case 'tool_call':
      return `→ ${String(p.tool ?? p.name ?? 'tool')} ${p.input ? JSON.stringify(p.input).slice(0, 160) : ''}`;
    case 'tool_result':
      return `← ${String(p.tool ?? p.name ?? 'tool')} ${p.summary ? String(p.summary).slice(0, 160) : ''}`;
    case 'text':
      return String(p.text ?? '').slice(0, 300);
    case 'error':
      return `✕ ${String(p.message ?? p.error ?? JSON.stringify(p))}`;
    case 'done':
      return `✓ done (${String(p.stopReason ?? '')}${p.costUsd != null ? `, $${Number(p.costUsd).toFixed(3)}` : ''})`;
  }
}

export function RunTimeline({ events }: { events: RunEvent[] }) {
  if (events.length === 0) return <div className="timeline muted">waiting for the worker…</div>;
  return (
    <div className="timeline">
      {events.map((e) => (
        <div className={`ev ${e.type}`} key={`${e.runId}:${e.seq}`}>
          {line(e)}
        </div>
      ))}
    </div>
  );
}
