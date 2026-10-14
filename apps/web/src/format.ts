/** Short relative time for list rows: "now", "5m", "3h", then "Sep 4" (or with year when old). */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Countdown for a short-lived code (Instagram pairing): "14:32" under an hour, "1:02:30" above
 * it, "0:00" once the deadline has passed. Clamped, so clock skew or a stale render never shows
 * a negative time.
 */
export function countdown(msLeft: number): string {
  const total = Number.isFinite(msLeft) && msLeft > 0 ? Math.floor(msLeft / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "active now" · "seen 3h ago" · "seen Sep 4" — for device and account rows. */
export function seen(iso: string | null | undefined): string {
  const a = ago(iso);
  if (!a) return '';
  if (a === 'now') return 'active now';
  return /^\d+[mh]$/.test(a) ? `seen ${a} ago` : `seen ${a}`;
}
