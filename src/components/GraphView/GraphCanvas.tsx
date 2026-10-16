import React, { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  type NodeTypes,
  type OnNodeDrag,
  type Node as RFNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useNavigate } from 'react-router-dom';

import { GraphNode } from './GraphNode';
import { OrphanGroup } from './OrphanGroup';
import { GraphControls } from './GraphControls';
import { useGraphStore } from '../../store/graphStore';
import type { GraphNodeData, OrphanGroupData } from '../../store/graphStore';

const nodeTypes: NodeTypes = {
  graphNode: GraphNode as unknown as NodeTypes['graphNode'],
  orphanGroup: OrphanGroup as unknown as NodeTypes['orphanGroup'],
};

interface GraphCanvasProps {
  vaultPath: string;
}

function GraphCanvasInner({ vaultPath }: GraphCanvasProps) {
  const navigate = useNavigate();
  const { nodes, edges, showOrphans, searchQuery, savePosition } = useGraphStore();

  // Filter / style nodes based on orphan toggle and search query
  const displayNodes = useMemo(() => {
    return nodes
      .filter((node) => {
        if (!showOrphans) {
          const data = node.data as Partial<GraphNodeData>;
          if (data.isOrphan || node.type === 'orphanGroup') return false;
        }
        return true;
      })
      .map((node) => {
        if (!searchQuery) return node;
        const data = node.data as Partial<GraphNodeData>;
        const label = (data.label ?? '').toLowerCase();
        const matches = label.includes(searchQuery.toLowerCase());
        if (matches) return node; // no opacity change for matching nodes
        return {
          ...node,
          style: {
            ...node.style,
            opacity: 0.2,
          },
        };
      });
  }, [nodes, showOrphans, searchQuery]);

  // Filter edges to match visible nodes
  const visibleNodeIds = useMemo(
    () => new Set(displayNodes.map((n) => n.id)),
    [displayNodes],
  );
  const displayEdges = useMemo(
    () =>
      edges.filter(
        (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target),
      ),
    [edges, visibleNodeIds],
  );

  // Double click → navigate to editor
  const handleNodeDoubleClick = (_: React.MouseEvent, node: RFNode) => {
    if (node.type !== 'graphNode') return;
    const data = node.data as GraphNodeData;
    navigate(`/editor/${encodeURIComponent(data.path)}`);
  };

  // Drag stop → save position
  const handleNodeDragStop: OnNodeDrag = (_, node) => {
    if (node.type === 'orphanGroup') return;
    const data = node.data as GraphNodeData;
    savePosition(vaultPath, data.path, node.position.x, node.position.y).catch(
      console.error,
    );
  };

  return (
    <div
      data-testid="graph-canvas"
      style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg)' }}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        fitView
        attributionPosition="bottom-left"
      >
        <Background color="var(--line)" gap={20} />
        <GraphControls vaultPath={vaultPath} />
      </ReactFlow>
    </div>
  );
}

/**
 * GraphCanvas — TC-14, TC-15, TC-16, TC-17, TC-18, TC-21
 *
 * Wraps the RF canvas in a ReactFlowProvider.
 */
export function GraphCanvas({ vaultPath }: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner vaultPath={vaultPath} />
    </ReactFlowProvider>
  );
}
