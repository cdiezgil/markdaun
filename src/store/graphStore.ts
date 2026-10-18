import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Edge, Node } from '@xyflow/react';
import {
  buildGraphModel,
  restrictToFolder,
  type BackendGraph,
  type GraphModel,
  type NodeKind,
  type TagNodeModel,
} from '../lib/graph/graphModel';
import { useVaultStore } from './vaultStore';
import { vaultFolders } from '../lib/vaultFolders';
import { layoutGraph, type LayoutNode } from '../lib/graph/graphLayout';

// ── Node data ─────────────────────────────────────────────────────────────────

export interface GraphNodeData extends Record<string, unknown> {
  path: string;
  label: string;
  kind: NodeKind;
  isOrphan: boolean;
  diameter: number;
  backlinks: number;
  links: number;
  folder: string;
  tags: string[];
  excerpt: string;
}

export interface TagNodeData extends Record<string, unknown> {
  label: string;
  count: number;
}

type Pos = { x: number; y: number };

const LABEL_ROOM = 34; // collision breathing room for the label under a node

function noteRadius(diameter: number): number {
  return diameter / 2 + LABEL_ROOM;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface GraphStoreState {
  /** Model restricted to `folder` (what is laid out and shown). */
  model: GraphModel | null;
  /** Vault-wide model, kept to re-restrict when the folder changes. */
  baseModel: GraphModel | null;
  /** Selected vault-relative folder; '' = whole vault (Bóveda). */
  folder: string;
  /** Note nodes (graphNode), laid out. */
  nodes: Node<GraphNodeData>[];
  /** Link edges between notes. */
  edges: Edge[];
  /** Tag nodes (tagNode), shown only when the Etiquetas filter is on. */
  tagNodes: Node<TagNodeData>[];
  tagEdges: Edge[];
  /** Bumped on every (re)load so the canvas can re-fit the view. */
  loadId: number;
  isLoading: boolean;
  error: string | null;
  showLinks: boolean;
  showTags: boolean;
  showOrphans: boolean;
  searchQuery: string;
  selectedPath: string | null;

  loadGraph(vaultPath: string): Promise<void>;
  savePosition(vaultPath: string, filePath: string, x: number, y: number): Promise<void>;
  moveNode(id: string, x: number, y: number): void;
  selectNode(path: string | null): void;
  setShowLinks(v: boolean): void;
  setShowTags(v: boolean): void;
  setShowOrphans(v: boolean): void;
  setSearchQuery(q: string): void;
  setFolder(vaultPath: string, folder: string): void;
}

const folderKey = (vaultPath: string) => `markdaun.graph.folder:${vaultPath}`;

function readStoredFolder(vaultPath: string): string {
  try {
    return localStorage.getItem(folderKey(vaultPath)) ?? '';
  } catch {
    return '';
  }
}

function storeFolder(vaultPath: string, folder: string) {
  try {
    if (folder) localStorage.setItem(folderKey(vaultPath), folder);
    else localStorage.removeItem(folderKey(vaultPath));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

function folderExists(folder: string, base: GraphModel, vaultPath: string): boolean {
  if (!folder) return true;
  const known = new Set(vaultFolders(useVaultStore.getState().tree, vaultPath));
  return (
    known.has(folder) ||
    base.nodes.some((n) => n.folder === folder || n.folder.startsWith(`${folder}/`))
  );
}

export const useGraphStore = create<GraphStoreState>((set, get) => ({
  model: null,
  baseModel: null,
  folder: '',
  nodes: [],
  edges: [],
  tagNodes: [],
  tagEdges: [],
  loadId: 0,
  isLoading: false,
  error: null,
  showLinks: true,
  showTags: false,
  showOrphans: true,
  searchQuery: '',
  selectedPath: null,

  async loadGraph(vaultPath: string) {
    set({ isLoading: true, error: null });
    try {
      const graph = await invoke<BackendGraph>('get_vault_graph', { vaultPath });
      const base = buildGraphModel(graph, vaultPath);
      let folder = readStoredFolder(vaultPath);
      if (!folderExists(folder, base, vaultPath)) {
        folder = '';
        storeFolder(vaultPath, '');
      }
      const built = buildFlow(restrictToFolder(base, folder));
      set((s) => ({ ...built, baseModel: base, folder, loadId: s.loadId + 1, isLoading: false }));
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e), isLoading: false });
    }
  },

  async savePosition(vaultPath: string, filePath: string, x: number, y: number) {
    try {
      await invoke('save_node_position', { vaultPath, filePath, x, y });
    } catch (e) {
      console.error('savePosition failed:', e);
    }
  },

  moveNode(id, x, y) {
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, position: { x, y } } : n)),
      tagNodes: s.tagNodes.map((n) => (n.id === id ? { ...n, position: { x, y } } : n)),
    }));
  },

  selectNode: (path) => set({ selectedPath: path }),
  setShowLinks: (v) => set({ showLinks: v }),
  setShowTags: (v) => set({ showTags: v }),
  setShowOrphans: (v) => set({ showOrphans: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  setFolder(vaultPath, folder) {
    const base = get().baseModel;
    storeFolder(vaultPath, folder);
    if (!base) {
      set({ folder });
      return;
    }
    const built = buildFlow(restrictToFolder(base, folder));
    set((s) => ({ ...built, folder, selectedPath: null, loadId: s.loadId + 1 }));
  },
}));

// ── Flow builder ──────────────────────────────────────────────────────────────

const edgeId = (s: string, t: string) => `${s}→${t}`;

function buildFlow(model: GraphModel) {
  const layoutNodes: LayoutNode[] = [
    ...model.nodes.map((n) => ({
      id: n.path,
      radius: noteRadius(n.diameter),
      folder: n.folder,
      fixed: n.saved ? { x: n.saved.x + n.diameter / 2, y: n.saved.y + n.diameter / 2 } : null,
    })),
    ...model.tagNodes.map((t) => ({ id: t.id, radius: 40, folder: '', fixed: null })),
  ];
  const positions = layoutGraph(layoutNodes, [...model.edges, ...model.tagEdges]);
  const at = (id: string): Pos => positions.get(id) ?? { x: 0, y: 0 };

  const nodes: Node<GraphNodeData>[] = model.nodes.map((n) => ({
    id: n.path,
    type: 'graphNode',
    // React Flow positions by top-left; the layout works with centres.
    position: n.saved ?? { x: at(n.path).x - n.diameter / 2, y: at(n.path).y - n.diameter / 2 },
    data: {
      path: n.path,
      label: n.label,
      kind: n.kind,
      isOrphan: n.isOrphan,
      diameter: n.diameter,
      backlinks: n.backlinks,
      links: n.links,
      folder: n.folder,
      tags: n.tags,
      excerpt: n.excerpt,
    },
  }));

  const tagNodes: Node<TagNodeData>[] = model.tagNodes.map((t: TagNodeModel) => ({
    id: t.id,
    type: 'tagNode',
    position: at(t.id),
    data: { label: t.label, count: t.count },
  }));

  const mkEdge = (e: { source: string; target: string }): Edge => ({
    id: edgeId(e.source, e.target),
    source: e.source,
    target: e.target,
  });

  return {
    model,
    nodes,
    edges: model.edges.map(mkEdge),
    tagNodes,
    tagEdges: model.tagEdges.map(mkEdge),
  };
}
