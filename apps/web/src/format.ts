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

/** "active now" · "seen 3h ago" · "seen Sep 4" — for device and account rows. */
export function seen(iso: string | null | undefined): string {
  const a = ago(iso);
  if (!a) return '';
  if (a === 'now') return 'active now';
  return /^\d+[mh]$/.test(a) ? `seen ${a} ago` : `seen ${a}`;
}
