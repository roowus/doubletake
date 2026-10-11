import type { GraphNode, LibraryGraph } from '@doubletake/shared';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ApiError, api } from '../api';
import { ALPHA_MIN, createSim, type ForceSim, settle } from '../lib/forcelayout';
import { Link, navigate } from '../router';
import { Icon } from './Icon';

/**
 * Map of everything (Library → Graph): an Obsidian-style force-directed graph over
 * `GET /api/library/graph`. Chats are small dots, things (entities) larger, tags tiny squares;
 * edges are their relations. There is no d3 — the layout is the pure simulation in
 * `lib/forcelayout.ts`, stepped on requestAnimationFrame (two ticks per frame) until it is at
 * rest; under reduced motion `settle()` renders the finished layout immediately.
 *
 * Interaction: drag a node to move it (its neighbours follow), drag the background to pan,
 * the wheel zooms around the cursor, clicking a node opens it (`/chat/:id`, `/entities/:kind`,
 * `/?tag=`) after announcing it to screen readers. All colours come from the theme's CSS
 * variables, so the graph follows light/dark like the rest of the app.
 */

const LABEL_ZOOM = 1.4;
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 6;

interface View {
  x: number;
  y: number;
  k: number;
}

function prefersReducedMotion(): boolean {
  return (
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion === 'reduce'
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function GraphMap() {
  const [graph, setGraph] = useState<LibraryGraph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const sim = useRef<ForceSim | null>(null);
  const raf = useRef(0);
  const viewRef = useRef(view);
  const drag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const pan = useRef<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    api
      .graph()
      .then((g) => {
        setGraph(g);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, []);

  // Track the container so the SVG's viewBox always matches the real pixel size.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the simulation once the data and a real viewport exist, then animate to rest.
  useEffect(() => {
    if (!graph || graph.nodes.length === 0 || size.w === 0) return;
    const s = createSim(
      graph.nodes.map((n) => n.id),
      graph.edges,
      size.w,
      size.h,
    );
    sim.current = s;
    if (prefersReducedMotion()) {
      settle(s);
      bump();
      return;
    }
    const frame = () => {
      if (s.alpha <= ALPHA_MIN) return;
      s.step();
      s.step();
      bump();
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [graph, size.w, size.h]);

  // React registers wheel listeners passively, so zoom needs a native non-passive one. The svg
  // exists from the first render and never remounts; the setter and refs are stable.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
        // Keep the point under the cursor fixed while zooming.
        const px = (mx - v.x) / v.k;
        const py = (my - v.y) / v.k;
        return { k, x: mx - k * px, y: my - k * py };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  /** Screen pixels → simulation coordinates (viewBox units are container pixels). */
  const toSim = (clientX: number, clientY: number) => {
    const rect = svg.current?.getBoundingClientRect();
    const v = viewRef.current;
    const mx = clientX - (rect?.left ?? 0);
    const my = clientY - (rect?.top ?? 0);
    return { x: (mx - v.x) / v.k, y: (my - v.y) / v.k };
  };

  const open = (nd: GraphNode) => {
    setSelected(nd);
    const where =
      nd.kind === 'chat' ? 'the chat' : nd.kind === 'entity' ? 'the things list' : 'the tag view';
    setAnnounce(`${nd.kind}: ${nd.label}. Opening ${where}.`);
    const d = nd.kindDetail ?? {};
    if (nd.kind === 'chat' && d.chatId) navigate(`/chat/${d.chatId}`);
    else if (nd.kind === 'entity' && d.entityKind) navigate(`/entities/${d.entityKind}`);
    else if (nd.kind === 'tag' && d.name) navigate(`/?tag=${encodeURIComponent(d.name)}`);
  };

  const onNodeDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onNodeMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const s = sim.current;
    if (!d || !s) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true;
    if (!d.moved) return;
    const n = s.byId.get(d.id);
    if (!n) return;
    const p = toSim(e.clientX, e.clientY);
    n.fx = p.x;
    n.fy = p.y;
    n.x = p.x;
    n.y = p.y;
    bump();
  };
  const onNodeUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = sim.current;
    const n = s?.byId.get(d.id);
    if (n) {
      n.fx = undefined;
      n.fy = undefined;
    }
    if (!d.moved) {
      const nd = graph?.nodes.find((m) => m.id === d.id);
      if (nd) open(nd);
    } else if (s) {
      // The drag ended with the sim at rest; give the neighbours a nudge to resettle.
      s.alpha = Math.max(s.alpha, 0.3);
      if (!prefersReducedMotion()) {
        cancelAnimationFrame(raf.current);
        const frame = () => {
          if (s.alpha <= ALPHA_MIN) return;
          s.step();
          s.step();
          bump();
          raf.current = requestAnimationFrame(frame);
        };
        raf.current = requestAnimationFrame(frame);
      } else {
        settle(s);
        bump();
      }
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onBgDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = viewRef.current;
    pan.current = { startX: e.clientX, startY: e.clientY, x: v.x, y: v.y, moved: false };
  };
  const onBgMove = (e: ReactPointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.moved && Math.hypot(dx, dy) > 4) p.moved = true;
    if (p.moved) setView((v) => ({ ...v, x: p.x + dx, y: p.y + dy }));
  };
  const onBgUp = () => {
    const p = pan.current;
    pan.current = null;
    if (p && !p.moved) {
      setSelected(null);
      setAnnounce('Cleared selection.');
    }
  };

  const zoomBy = (factor: number) =>
    setView((v) => {
      const k = clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX);
      const px = (size.w / 2 - v.x) / v.k;
      const py = (size.h / 2 - v.y) / v.k;
      return { k, x: size.w / 2 - k * px, y: size.h / 2 - k * py };
    });

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = 48 / view.k;
    switch (e.key) {
      case 'ArrowLeft':
        setView((v) => ({ ...v, x: v.x + step }));
        break;
      case 'ArrowRight':
        setView((v) => ({ ...v, x: v.x - step }));
        break;
      case 'ArrowUp':
        setView((v) => ({ ...v, y: v.y + step }));
        break;
      case 'ArrowDown':
        setView((v) => ({ ...v, y: v.y - step }));
        break;
      case '+':
      case '=':
        zoomBy(1.25);
        break;
      case '-':
        zoomBy(0.8);
        break;
      case 'Escape':
        setSelected(null);
        setAnnounce('Cleared selection.');
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const nodes = graph?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const counts = {
    chat: nodes.filter((n) => n.kind === 'chat').length,
    entity: nodes.filter((n) => n.kind === 'entity').length,
    tag: nodes.filter((n) => n.kind === 'tag').length,
  };
  const showLabels = (id: string) => view.k >= LABEL_ZOOM || hover === id || selected?.id === id;

  return (
    <div className="page stack loose">
      <div className="page-head">
        <Link to="/library" className="icon-link" aria-label="Back to the Library">
          <Icon name="arrow-left" />
        </Link>
        <h2>Map of everything</h2>
        {graph && (
          <span className="muted">
            {counts.chat} chats · {counts.entity} things · {counts.tag} tags
          </span>
        )}
      </div>

      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}

      {/* A pan/zoom canvas: focusable and keyboard-operable (arrows pan, +/- zoom, Esc clears). */}
      <div
        ref={box}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable interactive canvas region
        tabIndex={0}
        aria-label="Map of everything: graph of chats, things and tags. Drag to pan, wheel to zoom, click a dot to open it."
        onKeyDown={onKeyDown}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--surface)',
          height: 'clamp(420px, 72vh, 760px)',
          overflow: 'hidden',
          outline: 'none',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        <svg
          ref={svg}
          width="100%"
          height="100%"
          viewBox={size.w > 0 ? `0 0 ${size.w} ${size.h}` : undefined}
          style={{
            touchAction: 'none',
            display: 'block',
            cursor: pan.current ? 'grabbing' : 'grab',
          }}
          onPointerDown={onBgDown}
          onPointerMove={onBgMove}
          onPointerUp={onBgUp}
          aria-hidden="true"
        >
          {sim.current && (
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              <g stroke="var(--border)" strokeWidth={1 / view.k} opacity={0.75}>
                {sim.current.edges.map((e) => (
                  <line key={`${e.a.id}|${e.b.id}`} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
                ))}
              </g>
              {sim.current.nodes.map((n) => {
                const meta = byId.get(n.id);
                if (!meta) return null;
                const isSel = selected?.id === n.id;
                const ring = isSel || hover === n.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onNodeDown(e, n.id)}
                    onPointerMove={onNodeMove}
                    onPointerUp={onNodeUp}
                    onPointerEnter={() => setHover(n.id)}
                    onPointerLeave={() => setHover(null)}
                  >
                    {meta.kind === 'tag' ? (
                      <rect
                        x={-4}
                        y={-4}
                        width={8}
                        height={8}
                        rx={1.5}
                        fill="var(--chart-3)"
                        stroke={ring ? 'var(--text)' : 'transparent'}
                        strokeWidth={1.5 / view.k}
                      />
                    ) : (
                      <circle
                        r={meta.kind === 'entity' ? 6.5 : 4}
                        fill={meta.kind === 'entity' ? 'var(--accent-2)' : 'var(--accent)'}
                        stroke={ring ? 'var(--text)' : 'transparent'}
                        strokeWidth={1.5 / view.k}
                      />
                    )}
                    <circle r={12} fill="none" pointerEvents="all" />
                    {showLabels(n.id) && (
                      <text
                        y={16}
                        textAnchor="middle"
                        fontSize={11}
                        fill="var(--text-muted)"
                        stroke="var(--surface)"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {meta.label.length > 28 ? `${meta.label.slice(0, 27)}…` : meta.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div className="muted" style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
        <Legend shape="chat" label={`Chat (${counts.chat})`} />
        <Legend shape="entity" label={`Thing (${counts.entity})`} />
        <Legend shape="tag" label={`Tag (${counts.tag})`} />
        <span>Drag to arrange · wheel to zoom · click a dot to open it</span>
      </div>

      {graph && nodes.length === 0 && (
        <div className="card quiet empty">
          <Icon name="compass" className="icon-lg" />
          <p>Nothing to map yet. Chats, things and tags appear here as you share and research.</p>
        </div>
      )}
    </div>
  );
}

function Legend({ shape, label }: { shape: GraphNode['kind']; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {shape === 'tag' ? (
        <span
          style={{
            width: 8,
            height: 8,
            background: 'var(--chart-3)',
            borderRadius: 2,
            display: 'inline-block',
          }}
        />
      ) : (
        <span
          style={{
            width: shape === 'entity' ? 13 : 8,
            height: shape === 'entity' ? 13 : 8,
            background: shape === 'entity' ? 'var(--accent-2)' : 'var(--accent)',
            borderRadius: '50%',
            display: 'inline-block',
          }}
        />
      )}
      {label}
    </span>
  );
}
