import { plural } from './shell';

export interface GraphStats {
  notes: number;
  links: number;
  orphans: number;
}

interface StatNode {
  id?: string;
  data?: Record<string, unknown>;
}

interface StatEdge {
  source?: string;
  target?: string;
}

/**
 * Note/link/orphan counts for the graph status line (md notes only).
 * `outside` ids (dimmed context notes of a folder restriction) are not counted.
 */
export function graphStats(
  nodes: StatNode[],
  edges: StatEdge[],
  outside?: Set<string>,
): GraphStats {
  let notes = 0;
  let orphans = 0;
  let links = 0;
  for (const e of edges) {
    if (!outside?.has(e.source ?? '') && !outside?.has(e.target ?? '')) links += 1;
  }
  for (const n of nodes) {
    if (n.id !== undefined && outside?.has(n.id)) continue;
    if (n.data?.kind !== 'md') continue;
    notes += 1;
    if (n.data.isOrphan === true) orphans += 1;
  }
  return { notes, links, orphans };
}

export function formatGraphStats({ notes, links, orphans }: GraphStats): string {
  return [
    `${notes} ${plural(notes, 'nota', 'notas')}`,
    `${links} ${plural(links, 'enlace', 'enlaces')}`,
    `${orphans} ${plural(orphans, 'huérfana', 'huérfanas')}`,
  ].join(' · ');
}
