import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Edge } from '@xyflow/react';
import type { Node } from '@xyflow/react';

// ── Backend types ─────────────────────────────────────────────────────────────

interface BackendGraphNode {
  path: string;
  name: string;
  kind: 'md' | 'image' | 'pdf' | 'other';
  x: number | null;
  y: number | null;
}

interface BackendGraphEdge {
  source: string;
  target: string;
}

interface VaultGraph {
  nodes: BackendGraphNode[];
  edges: BackendGraphEdge[];
}

// ── Frontend node data ────────────────────────────────────────────────────────

export interface GraphNodeData extends Record<string, unknown> {
  path: string;
  label: string;
  kind: 'md' | 'image' | 'pdf' | 'other';
  isOrphan: boolean;
}

export interface OrphanGroupData extends Record<string, unknown> {
  /** Relative subfolder path (relative to vault root), or "root" for vault-root files. */
  folderName: string;
}

// ── computeInitialLayout ──────────────────────────────────────────────────────

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.5°
const LAYOUT_RADIUS = 400;
const REPULSION_K = 5000;
const ATTRACTION_K = 0.05;
const GRAVITY_K = 0.01;
const ITERATIONS = 50;

/**
 * Assign (x, y) positions to nodes that don't have saved positions.
 * Uses a golden-angle circular seed + 50 iterations of force simulation.
 */
export function computeInitialLayout(
  nodes: Array<{ path: string }>,
  edges: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  // Seed positions with golden-angle spiral
  nodes.forEach((node, i) => {
    const angle = i * GOLDEN_ANGLE;
    const r = LAYOUT_RADIUS * Math.sqrt((i + 1) / nodes.length);
    positions.set(node.path, {
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
    });
  });

  // Build adjacency set for attraction
  const edgePairs = edges.map((e) => ({ source: e.source, target: e.target }));

  // Force iterations
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    nodes.forEach((n) => forces.set(n.path, { fx: 0, fy: 0 }));

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pi = positions.get(nodes[i].path)!;
        const pj = positions.get(nodes[j].path)!;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const force = REPULSION_K / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(nodes[i].path)!.fx += fx;
        forces.get(nodes[i].path)!.fy += fy;
        forces.get(nodes[j].path)!.fx -= fx;
        forces.get(nodes[j].path)!.fy -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edgePairs) {
      const ps = positions.get(edge.source);
      const pt = positions.get(edge.target);
      if (!ps || !pt) continue;
      const dx = pt.x - ps.x;
      const dy = pt.y - ps.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const force = ATTRACTION_K * dist;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fs = forces.get(edge.source)!;
      const ft = forces.get(edge.target)!;
      fs.fx += fx;
      fs.fy += fy;
      ft.fx -= fx;
      ft.fy -= fy;
    }

    // Gravity toward origin
    for (const node of nodes) {
      const p = positions.get(node.path)!;
      const f = forces.get(node.path)!;
      f.fx -= GRAVITY_K * p.x;
      f.fy -= GRAVITY_K * p.y;
    }

    // Apply forces
    for (const node of nodes) {
      const p = positions.get(node.path)!;
      const f = forces.get(node.path)!;
      positions.set(node.path, {
        x: p.x + f.fx,
        y: p.y + f.fy,
      });
    }
  }

  return positions;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface GraphStoreState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: Node<any>[];
  edges: Edge[];
  isLoading: boolean;
  error: string | null;
  showOrphans: boolean;
  searchQuery: string;

  loadGraph(vaultPath: string): Promise<void>;
  savePosition(vaultPath: string, filePath: string, x: number, y: number): Promise<void>;
  setShowOrphans(v: boolean): void;
  setSearchQuery(q: string): void;
}

export const useGraphStore = create<GraphStoreState>((set) => ({
  nodes: [],
  edges: [],
  isLoading: false,
  error: null,
  showOrphans: true,
  searchQuery: '',

  async loadGraph(vaultPath: string) {
    set({ isLoading: true, error: null });
    try {
      const graph = await invoke<VaultGraph>('get_vault_graph', {
        vault_path: vaultPath,
      });

      const { nodes, edges } = buildReactFlowGraph(graph, vaultPath);
      set({ nodes, edges, isLoading: false });
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e), isLoading: false });
    }
  },

  async savePosition(vaultPath: string, filePath: string, x: number, y: number) {
    try {
      await invoke('save_node_position', {
        vault_path: vaultPath,
        file_path: filePath,
        x,
        y,
      });
    } catch (e) {
      console.error('savePosition failed:', e);
    }
  },

  setShowOrphans(v: boolean) {
    set({ showOrphans: v });
  },

  setSearchQuery(q: string) {
    set({ searchQuery: q });
  },
}));

// ── Graph builder ─────────────────────────────────────────────────────────────

function buildReactFlowGraph(
  graph: VaultGraph,
  vaultPath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { nodes: Node<any>[]; edges: Edge[] } {
  const { nodes: backendNodes, edges: backendEdges } = graph;

  // Determine connected paths (have at least one edge)
  const connected = new Set<string>();
  for (const edge of backendEdges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  // Nodes without saved positions need layout
  const nodesNeedingLayout = backendNodes
    .filter((n) => n.x === null)
    .map((n) => ({ path: n.path }));

  const layoutPositions = computeInitialLayout(nodesNeedingLayout, backendEdges);

  // Build orphan groups: keyed by relative folder path
  const orphanGroupMap = new Map<string, string>(); // folderKey → RF groupId
  const rfNodes: Node<GraphNodeData | OrphanGroupData>[] = [];
  const rfEdges: Edge[] = backendEdges.map((e) => ({
    id: `${e.source}→${e.target}`,
    source: e.source,
    target: e.target,
  }));

  // Vault path normalised (without trailing slash)
  const vaultPrefix = vaultPath.endsWith('/') ? vaultPath : vaultPath + '/';

  for (const bn of backendNodes) {
    const isOrphan = !connected.has(bn.path);
    const label =
      bn.kind === 'md' ? bn.name.replace(/\.md$/i, '') : bn.name;

    const savedPos =
      bn.x !== null && bn.y !== null ? { x: bn.x, y: bn.y } : null;
    const computedPos = layoutPositions.get(bn.path);
    const position = savedPos ?? computedPos ?? { x: 0, y: 0 };

    if (isOrphan) {
      // Determine folder key relative to vault root
      const relPath = bn.path.startsWith(vaultPrefix)
        ? bn.path.slice(vaultPrefix.length)
        : bn.path;
      const parts = relPath.split('/');
      const folderKey = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';

      if (!orphanGroupMap.has(folderKey)) {
        const groupId = `orphanGroup_${folderKey}`;
        orphanGroupMap.set(folderKey, groupId);
        rfNodes.push({
          id: groupId,
          type: 'orphanGroup',
          position: { x: 0, y: 0 },
          data: { folderName: folderKey } as OrphanGroupData,
          style: { width: 200, height: 150 },
        });
      }

      const groupId = orphanGroupMap.get(folderKey)!;
      rfNodes.push({
        id: bn.path,
        type: bn.kind === 'md' ? 'graphNode' : 'default',
        position,
        data: { path: bn.path, label, kind: bn.kind, isOrphan } as GraphNodeData,
        parentId: groupId,
        extent: 'parent',
      });
    } else {
      rfNodes.push({
        id: bn.path,
        type: bn.kind === 'md' ? 'graphNode' : 'default',
        position,
        data: { path: bn.path, label, kind: bn.kind, isOrphan } as GraphNodeData,
      });
    }
  }

  return { nodes: rfNodes, edges: rfEdges };
}
