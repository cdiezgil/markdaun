import React from 'react';
import { Controls } from '@xyflow/react';
import { Eye, EyeOff, Search, RefreshCw } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';

interface GraphControlsProps {
  vaultPath: string;
}

/**
 * GraphControls — TC-17, TC-18, TC-19, TC-20
 *
 * Floating control bar: absolute bottom-right of the canvas.
 * Contains: RF Controls (zoom +/-/fit), orphan toggle, search, reload.
 */
export function GraphControls({ vaultPath }: GraphControlsProps) {
  const { showOrphans, searchQuery, setShowOrphans, setSearchQuery, loadGraph } =
    useGraphStore();

  const handleReload = () => {
    loadGraph(vaultPath).catch(console.error);
  };

  const iconStyle: React.CSSProperties = {
    color: 'var(--ink-muted)',
    cursor: 'pointer',
  };

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    padding: 0,
  };

  return (
    <div
      data-testid="graph-controls"
      style={{
        position: 'absolute',
        bottom: 'var(--space-4)',
        right: 'var(--space-4)',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        alignItems: 'flex-end',
      }}
    >
      {/* React Flow built-in zoom controls */}
      <Controls />

      {/* Custom controls panel */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-pop)',
          padding: '4px 8px',
        }}
      >
        {/* Orphan toggle */}
        <button
          type="button"
          aria-label={showOrphans ? 'Hide orphans' : 'Show orphans'}
          data-testid="toggle-orphans"
          style={buttonStyle}
          onClick={() => setShowOrphans(!showOrphans)}
        >
          {showOrphans ? (
            <Eye size={20} strokeWidth={1.5} style={iconStyle} />
          ) : (
            <EyeOff size={20} strokeWidth={1.5} style={iconStyle} />
          )}
        </button>

        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Search size={20} strokeWidth={1.5} style={{ ...iconStyle, pointerEvents: 'none' }} />
          <input
            type="text"
            aria-label="Search nodes"
            data-testid="graph-search"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              color: 'var(--ink)',
              width: 100,
            }}
          />
        </div>

        {/* Reload */}
        <button
          type="button"
          aria-label="Reload graph"
          data-testid="reload-graph"
          style={buttonStyle}
          onClick={handleReload}
        >
          <RefreshCw size={20} strokeWidth={1.5} style={iconStyle} />
        </button>
      </div>
    </div>
  );
}
