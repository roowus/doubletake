import { describe, expect, it } from 'vitest';
import { ALPHA_MIN, createSim, movement, settle } from './forcelayout';

describe('forcelayout', () => {
  it('settle() leaves every position finite and at rest, with edges wired to real nodes', () => {
    const sim = createSim(
      ['chat:a', 'chat:b', 'entity:tool:wax', 'tag:wax'],
      [
        { source: 'entity:tool:wax', target: 'chat:a' },
        { source: 'entity:tool:wax', target: 'chat:b' },
        { source: 'tag:wax', target: 'chat:a' },
      ],
      800,
      600,
    );
    settle(sim);
    expect(sim.nodes).toHaveLength(4);
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    expect(sim.alpha).toBeLessThanOrEqual(ALPHA_MIN);
    // At rest: one more tick would move nothing visible.
    expect(movement(sim)).toBeLessThan(0.5);
    // Every edge connects two nodes of the simulation.
    for (const e of sim.edges) {
      expect(sim.byId.get(e.a.id)).toBe(e.a);
      expect(sim.byId.get(e.b.id)).toBe(e.b);
    }
  });

  it('is deterministic: the same graph settles to the same coordinates', () => {
    const run = () =>
      settle(createSim(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 400, 400)).nodes.map(
        (n) => [n.id, Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10],
      );
    expect(run()).toEqual(run());
  });

  it('springs pull an edge pair together without letting it collapse', () => {
    // Three nodes start ~415 px apart on their init circle; the spring on a—b should close
    // most of that gap while repulsion keeps every pair strictly separated.
    const nodes = settle(
      createSim(['a', 'b', 'far'], [{ source: 'a', target: 'b' }], 600, 600),
    ).nodes;
    const dist = (a: string, b: string) => {
      const p = nodes.find((n) => n.id === a);
      const q = nodes.find((n) => n.id === b);
      if (!p || !q) throw new Error('missing node');
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    expect(dist('a', 'b')).toBeLessThan(120);
    expect(dist('a', 'b')).toBeGreaterThan(0);
    expect(dist('a', 'far')).toBeGreaterThan(0);
  });

  it('keeps a dragged node pinned via fx/fy', () => {
    const sim = createSim(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 500, 500);
    const a = sim.byId.get('a');
    if (!a) throw new Error('missing node');
    a.fx = 100;
    a.fy = 120;
    for (let i = 0; i < 50; i++) sim.step();
    expect(a.x).toBe(100);
    expect(a.y).toBe(120);
  });

  it('refuses edges to unknown nodes and empty viewports', () => {
    expect(() => createSim(['a'], [{ source: 'a', target: 'ghost' }], 500, 500)).toThrow(
      /unknown node/,
    );
    expect(() => createSim(['a'], [], 0, 500)).toThrow(/viewport/);
  });
});
