/**
 * Pure graph model: derives backlinks, orphans, sizes, folders and tag nodes
 * from the backend graph, and applies the view filters. No React, no Tauri.
 */

export type NodeKind = 'md' | 'image' | 'pdf' | 'other';

export interface BackendNode {
  path: string;
  name: string;
  kind: NodeKind;
  x: number | null;
  y: number | null;
  tags?: string[];
  excerpt?: string;
}

export interface BackendEdge {
  source: string;
  target: string;
}

export interface BackendGraph {
  nodes: BackendNode[];
  edges: BackendEdge[];
}

export const MIN_DIAMETER = 12;
export const MAX_DIAMETER = 28;

export interface NoteModel {
  path: string;
  label: string;
  kind: NodeKind;
  /** Folder relative to the vault root ('' for the root). */
  folder: string;
  backlinks: number;
  links: number;
  isOrphan: boolean;
  diameter: number;
  saved: { x: number; y: number } | null;
  tags: string[];
  excerpt: string;
}

export interface TagNodeModel {
  id: string;
  label: string;
  count: number;
}

export interface GraphModel {
  nodes: NoteModel[];
  edges: BackendEdge[];
  tagNodes: TagNodeModel[];
  tagEdges: BackendEdge[];
  /** Notes outside the selected folder, kept only as dimmed context (empty without a folder). */
  outside: Set<string>;
}

/** Diameter in px, linear between MIN and MAX by backlink count. */
export function nodeDiameter(backlinks: number, maxBacklinks: number): number {
  if (maxBacklinks <= 0) return MIN_DIAMETER;
  const t = Math.min(1, Math.max(0, backlinks / maxBacklinks));
  return Math.round(MIN_DIAMETER + t * (MAX_DIAMETER - MIN_DIAMETER));
}

function folderOf(path: string, vaultPath: string): string {
  const prefix = vaultPath.endsWith('/') ? vaultPath : `${vaultPath}/`;
  const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

export function buildGraphModel(graph: BackendGraph, vaultPath: string): GraphModel {
  const known = new Set(graph.nodes.map((n) => n.path));
  const edges = graph.edges.filter((e) => known.has(e.source) && known.has(e.target));

  const backlinks = new Map<string, number>();
  const links = new Map<string, number>();
  for (const e of edges) {
    links.set(e.source, (links.get(e.source) ?? 0) + 1);
    backlinks.set(e.target, (backlinks.get(e.target) ?? 0) + 1);
  }

  // Unlinked attachments are noise; unlinked notes are orphans worth showing.
  const kept = graph.nodes.filter(
    (n) => n.kind === 'md' || (links.get(n.path) ?? 0) + (backlinks.get(n.path) ?? 0) > 0,
  );
  const max = Math.max(0, ...kept.map((n) => backlinks.get(n.path) ?? 0));

  const nodes: NoteModel[] = kept.map((n) => {
    const b = backlinks.get(n.path) ?? 0;
    const l = links.get(n.path) ?? 0;
    return {
      path: n.path,
      label: n.kind === 'md' ? n.name.replace(/\.md$/i, '') : n.name,
      kind: n.kind,
      folder: folderOf(n.path, vaultPath),
      backlinks: b,
      links: l,
      isOrphan: b + l === 0,
      diameter: nodeDiameter(b, max),
      saved: n.x !== null && n.y !== null ? { x: n.x, y: n.y } : null,
      tags: n.tags ?? [],
      excerpt: n.excerpt ?? '',
    };
  });

  const counts = new Map<string, number>();
  const tagEdges: BackendEdge[] = [];
  for (const n of nodes) {
    if (n.kind !== 'md') continue;
    for (const t of new Set(n.tags)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      tagEdges.push({ source: n.path, target: `tag:${t}` });
    }
  }
  const tagNodes: TagNodeModel[] = [...counts].map(([t, count]) => ({
    id: `tag:${t}`,
    label: t,
    count,
  }));

  return { nodes, edges, tagNodes, tagEdges, outside: new Set() };
}

export const edgeKey = (e: BackendEdge) => `${e.source}→${e.target}`;

function isInFolder(noteFolder: string, folder: string): boolean {
  return noteFolder === folder || noteFolder.startsWith(`${folder}/`);
}

/**
 * Restricts the model to a vault-relative folder (subfolders included; '' = whole vault).
 * Outside notes linked to/from an inside note stay as dimmed context; the rest is dropped.
 * Orphan flags stay vault-wide; tag nodes only come from inside notes.
 */
export function restrictToFolder(model: GraphModel, folder: string): GraphModel {
  if (!folder) return model;
  const inside = new Set(
    model.nodes.filter((n) => isInFolder(n.folder, folder)).map((n) => n.path),
  );
  const edges = model.edges.filter((e) => inside.has(e.source) || inside.has(e.target));
  const outside = new Set<string>();
  for (const e of edges) {
    if (!inside.has(e.source)) outside.add(e.source);
    if (!inside.has(e.target)) outside.add(e.target);
  }
  const nodes = model.nodes.filter((n) => inside.has(n.path) || outside.has(n.path));

  const tagEdges = model.tagEdges.filter((e) => inside.has(e.source));
  const counts = new Map<string, number>();
  for (const e of tagEdges) counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
  const tagNodes = model.tagNodes
    .filter((t) => counts.has(t.id))
    .map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));

  return { nodes, edges, tagNodes, tagEdges, outside };
}

export interface GraphFilters {
  showLinks: boolean;
  showTags: boolean;
  showOrphans: boolean;
  query: string;
}

export interface FilteredGraph {
  nodeIds: Set<string>;
  edges: BackendEdge[];
  tagNodes: TagNodeModel[];
  tagEdges: BackendEdge[];
  /** Ids matching the search query, or null when there is no query. */
  matches: Set<string> | null;
  /** Visible notes outside the selected folder (rendered dimmed). */
  dimmedIds: Set<string>;
  /** Keys (`source→target`) of visible edges touching a dimmed note. */
  dimmedEdges: Set<string>;
}

export function filterGraph(model: GraphModel, f: GraphFilters): FilteredGraph {
  const visible = model.nodes.filter((n) =>
    model.outside.has(n.path) ? f.showLinks : f.showOrphans || !n.isOrphan,
  );
  const nodeIds = new Set(visible.map((n) => n.path));

  const edges = f.showLinks
    ? model.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    : [];

  let tagEdges: BackendEdge[] = [];
  let tagNodes: TagNodeModel[] = [];
  if (f.showTags) {
    tagEdges = model.tagEdges.filter((e) => nodeIds.has(e.source));
    const used = new Set(tagEdges.map((e) => e.target));
    tagNodes = model.tagNodes.filter((t) => used.has(t.id));
  }

  const q = f.query.trim().toLowerCase();
  let matches: Set<string> | null = null;
  if (q) {
    matches = new Set();
    for (const n of visible) if (n.label.toLowerCase().includes(q)) matches.add(n.path);
    for (const t of tagNodes) if (t.label.toLowerCase().includes(q)) matches.add(t.id);
  }

  const dimmedIds = new Set([...nodeIds].filter((id) => model.outside.has(id)));
  const dimmedEdges = new Set(
    edges.filter((e) => dimmedIds.has(e.source) || dimmedIds.has(e.target)).map(edgeKey),
  );

  return { nodeIds, edges, tagNodes, tagEdges, matches, dimmedIds, dimmedEdges };
}

export interface HaloInput {
  folder: string;
  x: number;
  y: number;
  radius: number;
}

export interface Halo {
  folder: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const HALO_PADDING = 56;

/** Bounding box (with padding) around each named folder's nodes. */
export function folderHalos(items: HaloInput[]): Halo[] {
  const groups = new Map<string, HaloInput[]>();
  for (const it of items) {
    if (!it.folder) continue;
    groups.set(it.folder, [...(groups.get(it.folder) ?? []), it]);
  }
  return [...groups].map(([folder, g]) => {
    const x0 = Math.min(...g.map((i) => i.x - i.radius)) - HALO_PADDING;
    const y0 = Math.min(...g.map((i) => i.y - i.radius)) - HALO_PADDING;
    const x1 = Math.max(...g.map((i) => i.x + i.radius)) + HALO_PADDING;
    const y1 = Math.max(...g.map((i) => i.y + i.radius)) + HALO_PADDING;
    return { folder, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
}
