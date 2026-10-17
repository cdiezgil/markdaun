import { describe, it, expect } from 'vitest';
import { layoutGraph, type LayoutNode } from './graphLayout';

const mk = (id: string, folder = '', fixed: LayoutNode['fixed'] = null): LayoutNode => ({
  id,
  radius: 24,
  folder,
  fixed,
});

describe('layoutGraph', () => {
  it('returns an empty map for no nodes', () => {
    expect(layoutGraph([], []).size).toBe(0);
  });

  it('gives every node a finite position', () => {
    const pos = layoutGraph([mk('a'), mk('b'), mk('c')], [{ source: 'a', target: 'b' }]);
    expect(pos.size).toBe(3);
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const nodes = [mk('a'), mk('b'), mk('c'), mk('d')];
    const links = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ];
    expect(layoutGraph(nodes, links)).toEqual(layoutGraph(nodes, links));
  });

  it('keeps saved positions exactly', () => {
    const pos = layoutGraph([mk('a', '', { x: 50, y: 75 }), mk('b')], [{ source: 'a', target: 'b' }]);
    expect(pos.get('a')).toEqual({ x: 50, y: 75 });
  });

  it('does not overlap nodes', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => mk(`n${i}`));
    const pos = layoutGraph(nodes, []);
    const pts = [...pos.values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(d).toBeGreaterThan(40);
      }
    }
  });

  it('ignores links to unknown nodes', () => {
    const pos = layoutGraph([mk('a')], [{ source: 'a', target: 'ghost' }]);
    expect(pos.size).toBe(1);
  });
});
