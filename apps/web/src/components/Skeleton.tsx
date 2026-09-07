/**
 * Placeholder rows while a list loads: the shape of what is coming instead of "Loading…".
 * Purely decorative; the container carries `aria-busy` and a visually hidden label.
 */
/** Title widths per row, cycling so the placeholder does not look like a grid. */
const WIDTHS = [80, 60, 95, 80, 60, 95, 80, 60];

export function ListSkeleton({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="list-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {WIDTHS.slice(0, rows).map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
        <div className="list-skeleton-row skeleton" key={i} aria-hidden="true">
          <span className="sk lead" />
          <span className="sk-lines">
            <span className={`sk w${w}`} />
            <span className="sk w95" />
          </span>
        </div>
      ))}
    </div>
  );
}
