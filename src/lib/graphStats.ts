import { plural } from './shell';

export interface GraphStats {
  notes: number;
  links: number;
  orphans: number;
}

interface StatNode {
  data?: Record<string, unknown>;
}

/** Note/link/orphan counts for the graph status line (md notes only). */
export function graphStats(nodes: StatNode[], edges: unknown[]): GraphStats {
  let notes = 0;
  let orphans = 0;
  for (const n of nodes) {
    if (n.data?.kind !== 'md') continue;
    notes += 1;
    if (n.data.isOrphan === true) orphans += 1;
  }
  return { notes, links: edges.length, orphans };
}

export function formatGraphStats({ notes, links, orphans }: GraphStats): string {
  return [
    `${notes} ${plural(notes, 'nota', 'notas')}`,
    `${links} ${plural(links, 'enlace', 'enlaces')}`,
    `${orphans} ${plural(orphans, 'huérfana', 'huérfanas')}`,
  ].join(' · ');
}
