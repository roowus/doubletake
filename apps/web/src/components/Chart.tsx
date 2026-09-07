import {
  type ChartSpec,
  type PieChart,
  parseChartSpec,
  type SeriesChart,
  type StatChart,
} from '@doubletake/shared';

/**
 * Themed SVG for the ```chart fence (spec in packages/shared/src/chart.ts). Everything is
 * drawn from the validated numbers: labels are React text nodes, colours come from the
 * `--chart-N` tokens through class names, sizes are viewBox units so the figure scales with
 * the prose measure. The same data is always emitted as a table too — visually hidden for
 * screen readers, or visible as the fallback when the spec does not validate.
 */

const W = 640;
const H = 320;
const PAD = { top: 16, right: 16, bottom: 44, left: 56 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const CURRENCY = /^[$€£¥₹]$/;

/** "$1,200" for currency units, "12 kg" otherwise. */
export function fmt(v: number | string, unit?: string): string {
  if (typeof v === 'string') return v;
  const n = nf.format(v);
  if (!unit) return n;
  return CURRENCY.test(unit) ? `${unit}${n}` : `${n} ${unit}`;
}

function xLabel(x: number | string): string {
  return typeof x === 'string' ? x : nf.format(x);
}

/** Categories in order of first appearance across every series. */
function categories(spec: SeriesChart | PieChart): string[] {
  const seen = new Map<string, true>();
  for (const s of spec.series) for (const p of s.values) seen.set(xLabel(p.x), true);
  return [...seen.keys()];
}

function niceTicks(min: number, max: number): number[] {
  if (min === max) return [min];
  const span = max - min;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function yScale(spec: SeriesChart | PieChart) {
  let lo = 0;
  let hi = 0;
  for (const s of spec.series) {
    for (const p of s.values) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
  }
  if (lo === hi) hi = lo + 1;
  const ticks = niceTicks(lo, hi);
  const min = Math.min(lo, ticks[0] ?? lo);
  const max = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const y = (v: number) => PAD.top + PLOT_H - ((v - min) / (max - min)) * PLOT_H;
  return { y, ticks, min, max };
}

function Axes({
  ticks,
  y,
  unit,
}: {
  ticks: number[];
  y: (v: number) => number;
  unit?: string | undefined;
}) {
  return (
    <g className="axes">
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
            className={t === 0 ? 'zero' : 'grid'}
          />
          <text x={PAD.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className="tick">
            {fmt(t, unit)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ cats, xOf }: { cats: string[]; xOf: (i: number) => number }) {
  const every = Math.ceil(cats.length / 8);
  return (
    <g className="xlabels">
      {cats.map((c, i) =>
        i % every === 0 ? (
          <text key={c} x={xOf(i)} y={H - PAD.bottom + 18} textAnchor="middle" className="tick">
            {trunc(c, cats.length > 4 ? 10 : 18)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function Bars({ spec }: { spec: SeriesChart }) {
  const cats = categories(spec);
  const { y, ticks } = yScale(spec);
  const groupW = PLOT_W / cats.length;
  const barW = (groupW * 0.72) / spec.series.length;
  const zero = y(0);
  return (
    <>
      <Axes ticks={ticks} y={y} unit={spec.unit} />
      {spec.series.map((s, si) => (
        <g key={s.name} className={`s${(si % 8) + 1}`}>
          {s.values.map((p) => {
            const ci = cats.indexOf(xLabel(p.x));
            const x = PAD.left + ci * groupW + groupW * 0.14 + si * barW;
            const top = Math.min(y(p.y), zero);
            return (
              <rect
                key={xLabel(p.x)}
                x={x}
                y={top}
                width={barW}
                height={Math.max(1, Math.abs(zero - y(p.y)))}
                rx={2}
              />
            );
          })}
        </g>
      ))}
      <XLabels cats={cats} xOf={(i) => PAD.left + i * groupW + groupW / 2} />
    </>
  );
}

function Lines({ spec }: { spec: SeriesChart }) {
  const cats = categories(spec);
  const { y, ticks } = yScale(spec);
  const numeric = spec.series.every((s) => s.values.every((p) => typeof p.x === 'number'));
  let xOf: (p: number | string) => number;
  if (numeric) {
    const xs = spec.series.flatMap((s) => s.values.map((p) => p.x as number));
    const lo = Math.min(...xs);
    const hi = Math.max(...xs) === lo ? lo + 1 : Math.max(...xs);
    xOf = (p) => PAD.left + (((p as number) - lo) / (hi - lo)) * PLOT_W;
  } else {
    const step = cats.length > 1 ? PLOT_W / (cats.length - 1) : 0;
    xOf = (p) => PAD.left + cats.indexOf(xLabel(p)) * step + (cats.length > 1 ? 0 : PLOT_W / 2);
  }
  return (
    <>
      <Axes ticks={ticks} y={y} unit={spec.unit} />
      {spec.series.map((s, si) => (
        <g key={s.name} className={`s${(si % 8) + 1}`}>
          <polyline
            points={s.values.map((p) => `${xOf(p.x)},${y(p.y)}`).join(' ')}
            className="line"
          />
          {s.values.length <= 24 &&
            s.values.map((p) => <circle key={xLabel(p.x)} cx={xOf(p.x)} cy={y(p.y)} r={3.5} />)}
        </g>
      ))}
      <XLabels
        cats={cats}
        xOf={(i) => (numeric ? xOf(Number(cats[i]?.replace(/,/g, ''))) : xOf(cats[i] ?? ''))}
      />
    </>
  );
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx} ${cy}L${p(a0)}A${r} ${r} 0 ${large} 1 ${p(a1)}Z`;
}

function Pie({ spec }: { spec: PieChart }) {
  const values = (spec.series[0]?.values ?? []).filter((p) => p.y > 0);
  const total = values.reduce((s, p) => s + p.y, 0);
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(PLOT_W, H - 32) / 2;
  let a = -Math.PI / 2;
  return (
    <>
      {values.map((p, i) => {
        const a0 = a;
        a += (p.y / total) * Math.PI * 2;
        const a1 = total === p.y ? a0 + Math.PI * 2 - 1e-4 : a;
        return (
          <path key={xLabel(p.x)} d={arc(cx, cy, r, a0, a1)} className={`s${(i % 8) + 1} slice`} />
        );
      })}
    </>
  );
}

function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return (
    <ul className="chart-legend">
      {names.map((n, i) => (
        <li key={n}>
          <span className={`swatch s${(i % 8) + 1}`} />
          {n}
        </li>
      ))}
    </ul>
  );
}

/** The data behind the picture, for screen readers and as the fallback. */
function DataTable({ spec, hidden }: { spec: ChartSpec; hidden: boolean }) {
  const cls = hidden ? 'sr-only' : 'chart-table';
  if (spec.type === 'stat')
    return (
      <table className={cls}>
        <tbody>
          {spec.rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{fmt(r.value, spec.unit)}</td>
              {r.delta && <td>{r.delta}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    );
  const cats = categories(spec);
  return (
    <table className={cls}>
      <thead>
        <tr>
          <th scope="col">{spec.type === 'pie' ? 'Slice' : 'x'}</th>
          {spec.series.map((s) => (
            <th scope="col" key={s.name}>
              {s.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cats.map((c) => (
          <tr key={c}>
            <th scope="row">{c}</th>
            {spec.series.map((s) => {
              const p = s.values.find((v) => xLabel(v.x) === c);
              return <td key={s.name}>{p ? fmt(p.y, spec.unit) : ''}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ spec }: { spec: StatChart }) {
  return (
    <dl className="stat-grid">
      {spec.rows.map((r) => (
        <div key={r.label} className="stat">
          <dt>{r.label}</dt>
          <dd>{fmt(r.value, spec.unit)}</dd>
          {r.delta && (
            <dd
              className={`delta ${r.delta.trim().startsWith('-') ? 'down' : r.delta.trim().startsWith('+') ? 'up' : ''}`}
            >
              {r.delta}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export function Chart({ spec }: { spec: ChartSpec }) {
  const title = spec.title;
  return (
    <figure className={`chart ${spec.type}`}>
      {title && <figcaption>{title}</figcaption>}
      {spec.type === 'stat' ? (
        <Stat spec={spec} />
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={title ?? `${spec.type} chart`}
            focusable={false}
          >
            {spec.type === 'bar' && <Bars spec={spec} />}
            {spec.type === 'line' && <Lines spec={spec} />}
            {spec.type === 'pie' && <Pie spec={spec} />}
          </svg>
          <Legend names={spec.type === 'pie' ? categories(spec) : spec.series.map((s) => s.name)} />
        </>
      )}
      <DataTable spec={spec} hidden={spec.type !== 'stat'} />
    </figure>
  );
}

/** A ```chart fence: draw it, or show the raw block with a one-line reason. */
export function ChartBlock({ text }: { text: string }) {
  const parsed = parseChartSpec(text);
  if (parsed.ok) return <Chart spec={parsed.spec} />;
  return (
    <figure className="chart broken">
      <figcaption className="muted small">Couldn't draw this chart ({parsed.reason}).</figcaption>
      <pre>
        <code className="language-chart">{text}</code>
      </pre>
    </figure>
  );
}
