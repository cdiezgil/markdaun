import React, { useEffect } from 'react';
import { Network } from 'lucide-react';
import { useVaultStore } from '../store/vaultStore';
import { useGraphStore } from '../store/graphStore';
import { GraphCanvas } from '../components/GraphView/GraphCanvas';

/**
 * GraphView — TC-14, TC-20
 *
 * Renders the document graph canvas.
 * Loads graph data when vaultPath becomes available.
 * Shows a placeholder when no vault is configured.
 */
export function GraphView() {
  const vaultPath = useVaultStore((state) => state.vaultPath);
  const loadGraph = useGraphStore((state) => state.loadGraph);
  const isLoading = useGraphStore((state) => state.isLoading);

  useEffect(() => {
    if (vaultPath) {
      loadGraph(vaultPath).catch(console.error);
    }
  }, [vaultPath]);

  if (!vaultPath) {
    return (
      <div
        data-testid="graph-placeholder"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 'var(--space-3)',
          color: 'var(--ink-muted)',
          background: 'var(--bg)',
        }}
      >
        <Network size={48} strokeWidth={1.5} />
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px' }}>
          Abre una bóveda para ver el grafo
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="graph-view"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {isLoading && (
        <div
          className="graph-loading-spinner"
          data-testid="graph-loading-spinner"
          aria-label="Cargando grafo"
        />
      )}
      <GraphCanvas vaultPath={vaultPath} />
    </div>
  );
}
