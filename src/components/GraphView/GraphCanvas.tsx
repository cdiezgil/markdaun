import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Edge,
  type Node as RFNode,
  type NodeChange,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useNavigate } from 'react-router-dom';

import { GraphNode } from './GraphNode';
import { TagNode } from './TagNode';
import { FolderHalo } from './FolderHalo';
import { GraphFilterPanel } from './GraphFilterPanel';
import { GraphZoom } from './GraphZoom';
import { GraphLegend } from './GraphLegend';
import { GraphNoteCard } from './GraphNoteCard';
import { useGraphStore } from '../../store/graphStore';
import { useEditorStore } from '../../store/editorStore';
import { filterGraph, folderHalos } from '../../lib/graph/graphModel';
import type { GraphNodeData } from '../../store/graphStore';

const nodeTypes: NodeTypes = {
  graphNode: GraphNode as unknown as NodeTypes['graphNode'],
  tagNode: TagNode as unknown as NodeTypes['tagNode'],
  folderHalo: FolderHalo as unknown as NodeTypes['folderHalo'],
};

const EDGE_BASE = {
  stroke: 'var(--line-strong)',
  strokeWidth: 1,
  opacity: 0.45,
};
const EDGE_DIMMED = { stroke: 'var(--line-strong)', strokeWidth: 1, opacity: 0.15 };
const EDGE_ACTIVE = { stroke: 'var(--daun)', strokeWidth: 1.5, opacity: 1 };

interface GraphCanvasProps {
  vaultPath: string;
}

function GraphCanvasInner({ vaultPath }: GraphCanvasProps) {
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  const {
    model,
    nodes,
    edges,
    tagNodes,
    tagEdges,
    loadId,
    showLinks,
    showTags,
    showOrphans,
    searchQuery,
    selectedPath,
    moveNode,
    selectNode,
    savePosition,
  } = useGraphStore();
  const activePath = useEditorStore((s) => s.activeNotePath);

  // Fit the view whenever a (re)load lands.
  useEffect(() => {
    if (loadId === 0) return;
    const id = requestAnimationFrame(() => {
      fitView({ duration: 0, padding: 0.2 });
    });
    return () => cancelAnimationFrame(id);
  }, [loadId, fitView]);

  // Preselect the open note once per load (so clearing the selection sticks).
  const preselected = useRef(-1);
  useEffect(() => {
    if (preselected.current === loadId) return;
    if (activePath && nodes.some((n) => n.id === activePath)) {
      preselected.current = loadId;
      selectNode(activePath);
    }
  }, [activePath, nodes, loadId, selectNode]);

  const filtered = useMemo(
    () => (model ? filterGraph(model, { showLinks, showTags, showOrphans, query: searchQuery }) : null),
    [model, showLinks, showTags, showOrphans, searchQuery],
  );

  const flowNodes = useMemo<RFNode[]>(() => {
    if (!filtered) return [];
    const matches = filtered.matches;
    const visibleNotes = nodes.filter((n) => filtered.nodeIds.has(n.id));

    const halos = folderHalos(
      visibleNotes
        .filter((n) => !filtered.dimmedIds.has(n.id))
        .map((n) => ({
          folder: n.data.folder,
          x: n.position.x + n.data.diameter / 2,
          y: n.position.y + n.data.diameter / 2,
          radius: n.data.diameter / 2 + 12,
        })),
    ).map<RFNode>((h) => ({
      id: `halo:${h.folder}`,
      type: 'folderHalo',
      position: { x: h.x, y: h.y },
      data: { folder: h.folder },
      style: { width: h.width, height: h.height },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));

    const notes = visibleNotes.map<RFNode>((n) => ({
      ...n,
      data: {
        ...n.data,
        active: n.id === activePath,
        selected: n.id === selectedPath,
        dim: matches ? !matches.has(n.id) : false,
        outside: filtered.dimmedIds.has(n.id),
      },
    }));

    const tagIds = new Set(filtered.tagNodes.map((t) => t.id));
    const tags = tagNodes
      .filter((t) => tagIds.has(t.id))
      .map<RFNode>((t) => ({
        ...t,
        data: { ...t.data, dim: matches ? !matches.has(t.id) : false },
      }));

    return [...halos, ...notes, ...tags];
  }, [filtered, nodes, tagNodes, activePath, selectedPath]);

  const flowEdges = useMemo<Edge[]>(() => {
    if (!filtered) return [];
    const shown = new Set(filtered.edges.map((e) => `${e.source}→${e.target}`));
    const links = edges
      .filter((e) => shown.has(e.id))
      .map<Edge>((e) => ({
        ...e,
        type: 'straight',
        style: filtered.dimmedEdges.has(e.id)
          ? EDGE_DIMMED
          : e.source === activePath || e.target === activePath
            ? EDGE_ACTIVE
            : EDGE_BASE,
      }));
    const tagIds = new Set(filtered.tagEdges.map((e) => `${e.source}→${e.target}`));
    const tags = tagEdges
      .filter((e) => tagIds.has(e.id))
      .map<Edge>((e) => ({ ...e, type: 'straight', style: { ...EDGE_BASE, strokeDasharray: '4 4' } }));
    return [...links, ...tags];
  }, [filtered, edges, tagEdges, activePath]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position && !c.id.startsWith('halo:')) {
          moveNode(c.id, c.position.x, c.position.y);
        }
      }
    },
    [moveNode],
  );

  const handleNodeClick = (_: React.MouseEvent, node: RFNode) => {
    if (node.type === 'graphNode') selectNode(node.id);
  };

  const handleNodeDoubleClick = (_: React.MouseEvent, node: RFNode) => {
    if (node.type !== 'graphNode') return;
    const data = node.data as GraphNodeData;
    const route = data.kind === 'md' ? 'editor' : 'preview';
    navigate(`/${route}/${encodeURIComponent(data.path)}`);
  };

  const handleNodeDragStop: OnNodeDrag = (_, node) => {
    if (node.type !== 'graphNode') return;
    const data = node.data as GraphNodeData;
    savePosition(vaultPath, data.path, node.position.x, node.position.y).catch(console.error);
  };

  const selected = selectedPath ? nodes.find((n) => n.id === selectedPath) : undefined;
  const selectedVisible = selected && filtered?.nodeIds.has(selected.id);

  return (
    <div
      data-testid="graph-canvas"
      style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg)' }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => selectNode(null)}
        nodesConnectable={false}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--line)" />
      </ReactFlow>
      <GraphFilterPanel vaultPath={vaultPath} />
      {selectedVisible && <GraphNoteCard node={selected.data} />}
      <GraphLegend />
      <GraphZoom />
    </div>
  );
}

/** GraphCanvas — the force-laid-out document graph; wraps React Flow in its provider. */
export function GraphCanvas({ vaultPath }: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner vaultPath={vaultPath} />
    </ReactFlowProvider>
  );
}

