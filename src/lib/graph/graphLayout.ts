import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

export interface LayoutNode {
  id: string;
  /** Collision radius (node radius plus label breathing room). */
  radius: number;
  folder: string;
  /** Saved position: kept exactly where it is. */
  fixed?: { x: number; y: number } | null;
}

export interface LayoutLink {
  source: string;
  target: string;
}

type SimNode = SimulationNodeDatum & LayoutNode;

const TICKS = 300;

/**
 * Deterministic force layout (d3-force's phyllotaxis seed, fixed tick count).
 * Notes in the same folder are gently pulled together so folders read as clusters.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  links: LayoutLink[],
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;

  const sim: SimNode[] = nodes.map((n) => ({
    ...n,
    ...(n.fixed ? { x: n.fixed.x, y: n.fixed.y, fx: n.fixed.x, fy: n.fixed.y } : {}),
  }));
  const ids = new Set(sim.map((n) => n.id));
  const simLinks: SimulationLinkDatum<SimNode>[] = links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ source: l.source, target: l.target }));

  // Folder centroids ride along with the simulation via a custom force.
  const folderForce = (alpha: number) => {
    const acc = new Map<string, { x: number; y: number; n: number }>();
    for (const n of sim) {
      if (!n.folder) continue;
      const a = acc.get(n.folder) ?? { x: 0, y: 0, n: 0 };
      a.x += n.x ?? 0;
      a.y += n.y ?? 0;
      a.n += 1;
      acc.set(n.folder, a);
    }
    for (const n of sim) {
      const a = n.folder ? acc.get(n.folder) : undefined;
      if (!a || a.n < 2 || n.fx != null) continue;
      n.vx = (n.vx ?? 0) + (a.x / a.n - (n.x ?? 0)) * 0.08 * alpha;
      n.vy = (n.vy ?? 0) + (a.y / a.n - (n.y ?? 0)) * 0.08 * alpha;
    }
  };

  const simulation = forceSimulation<SimNode>(sim)
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((d) => d.id)
        .distance(110)
        .strength(0.6),
    )
    .force('charge', forceManyBody<SimNode>().strength(-260))
    .force('x', forceX<SimNode>(0).strength(0.04))
    .force('y', forceY<SimNode>(0).strength(0.04))
    .force('folder', folderForce)
    .force('collide', forceCollide<SimNode>((d) => d.radius).iterations(3))
    .stop();

  for (let i = 0; i < TICKS; i++) simulation.tick();

  for (const n of sim) out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  return out;
}
