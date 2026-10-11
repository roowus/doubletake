/**
 * Hand-rolled force-directed layout for the map-of-everything graph — no d3, no dependencies.
 * Pure: no DOM, no timers. The component drives `step()` from requestAnimationFrame, or calls
 * `settle()` once when the owner prefers reduced motion.
 *
 * Deterministic: nodes start on a circle with a tiny per-id jitter, so the same graph always
 * settles into the same shape (and unit tests can assert on exact outcomes).
 *
 * Forces, in the classic Fruchterman-Reingold family:
 *   - many-body repulsion between every pair (O(n²) per tick — fine at the graph's ~550-node cap),
 *   - a spring on each edge pulling towards `SPRING_LENGTH`,
 *   - a gentle pull towards the centre of the viewport,
 * all scaled by a heat `alpha` that decays every tick until the layout is at rest.
 */

export interface ForceNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** While set (the node is being dragged) the node stays put; neighbours follow the springs. */
  fx?: number | undefined;
  fy?: number | undefined;
}

export interface ForceEdge {
  source: string;
  target: string;
}

export interface ForceSim {
  /** Input order preserved; `nodes[i]` corresponds to `nodeIds[i]`. */
  nodes: ForceNode[];
  readonly byId: ReadonlyMap<string, ForceNode>;
  /** Edges resolved to direct node references, so a tick needs no lookups. */
  readonly edges: readonly { a: ForceNode; b: ForceNode }[];
  width: number;
  height: number;
  /** Simulation heat from 1 down to `ALPHA_MIN`; forces and the decay are scaled by it. */
  alpha: number;
  /** One integration step; decays `alpha`. */
  step(): void;
}

const REPULSION = 1800;
const SPRING_LENGTH = 72;
const SPRING_STRENGTH = 0.015;
const CENTER_PULL = 0.02;
const VELOCITY_DECAY = 0.82;
/** 0.975^300 ≈ 5e-4: the layout reaches `ALPHA_MIN` inside the 300-tick settle budget. */
const ALPHA_DECAY = 0.975;
export const ALPHA_MIN = 0.001;
export const SETTLE_TICKS = 300;

/** FNV-1a → [-1, 1): deterministic per-id nudge so identical graphs settle identically. */
function jitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

export function createSim(
  nodeIds: readonly string[],
  edges: readonly ForceEdge[],
  width: number,
  height: number,
): ForceSim {
  if (!(width > 0) || !(height > 0)) throw new Error('force layout needs a positive viewport');
  const r = Math.min(width, height) * 0.4;
  const nodes: ForceNode[] = nodeIds.map((id, i) => {
    const angle = (i / Math.max(nodeIds.length, 1)) * 2 * Math.PI;
    return {
      id,
      x: width / 2 + r * Math.cos(angle) + jitter(id) * 4,
      y: height / 2 + r * Math.sin(angle) + jitter(`${id}#y`) * 4,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resolved = edges.map((e) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) throw new Error(`edge references unknown node: ${e.source} → ${e.target}`);
    if (a === b) throw new Error(`self edge: ${e.source}`);
    return { a, b };
  });
  return {
    nodes,
    byId,
    edges: resolved,
    width,
    height,
    alpha: 1,
    step() {
      const { nodes, edges, width, height } = this;
      const alpha = this.alpha;
      // Many-body repulsion: every pair pushes apart with force k²/d.
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (!a) continue;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          if (!b) continue;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 === 0) {
            // Coincident nodes: nudge apart deterministically instead of dividing by zero.
            dx = jitter(`${a.id}~${j}`) || 1;
            dy = jitter(`${b.id}~${i}`) || 1;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const f = (REPULSION * alpha) / d2;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      // Springs: edges pull their endpoints towards SPRING_LENGTH apart.
      for (const e of edges) {
        const dx = e.b.x - e.a.x;
        const dy = e.b.y - e.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - SPRING_LENGTH) * SPRING_STRENGTH * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        e.a.vx += fx;
        e.a.vy += fy;
        e.b.vx -= fx;
        e.b.vy -= fy;
      }
      // Gentle centring, then integrate with velocity decay.
      const cx = width / 2;
      const cy = height / 2;
      for (const n of nodes) {
        if (n.fx !== undefined && n.fy !== undefined) {
          n.x = n.fx;
          n.y = n.fy;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx += (cx - n.x) * CENTER_PULL * alpha;
        n.vy += (cy - n.y) * CENTER_PULL * alpha;
        n.vx *= VELOCITY_DECAY;
        n.vy *= VELOCITY_DECAY;
        n.x += n.vx;
        n.y += n.vy;
      }
      this.alpha = alpha * ALPHA_DECAY;
    },
  };
}

/** Largest distance any node moves in one more tick — how "at rest" the layout is. */
export function movement(sim: ForceSim): number {
  let max = 0;
  for (const n of sim.nodes) {
    const d = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
    if (d > max) max = d;
  }
  return max;
}

/** Run the simulation until it is at rest or `maxTicks` have elapsed. Returns the same sim. */
export function settle(sim: ForceSim, maxTicks = SETTLE_TICKS): ForceSim {
  for (let i = 0; i < maxTicks && sim.alpha > ALPHA_MIN; i++) sim.step();
  return sim;
}
