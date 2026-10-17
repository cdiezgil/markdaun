import React from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';

interface GraphFilterPanelProps {
  vaultPath: string;
}

const floating: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-pop)',
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    height: 28,
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-pill)',
    border: `1px solid ${active ? 'var(--daun)' : 'var(--line)'}`,
    background: active ? 'var(--mark)' : 'var(--surface)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    lineHeight: '16px',
    fontWeight: 500,
    cursor: 'pointer',
  };
}

/** Floating top-left panel: graph search + Enlaces / Etiquetas / Huérfanas chips. */
export function GraphFilterPanel({ vaultPath }: GraphFilterPanelProps) {
  const {
    showLinks,
    showTags,
    showOrphans,
    searchQuery,
    setShowLinks,
    setShowTags,
    setShowOrphans,
    setSearchQuery,
    loadGraph,
  } = useGraphStore();

  const chips: Array<[string, string, boolean, (v: boolean) => void]> = [
    ['toggle-links', 'Enlaces', showLinks, setShowLinks],
    ['toggle-tags', 'Etiquetas', showTags, setShowTags],
    ['toggle-orphans', 'Huérfanas', showOrphans, setShowOrphans],
  ];

  return (
    <div
      data-testid="graph-controls"
      style={{
        ...floating,
        position: 'absolute',
        top: 'var(--space-6)',
        left: 'var(--space-6)',
        zIndex: 10,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2)',
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          height: 32,
          width: 200,
          padding: '0 10px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg)',
        }}
      >
        <Search size={15} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
        <input
          type="text"
          data-testid="graph-search"
          aria-label="Buscar en el grafo"
          placeholder="Buscar en el grafo"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 'none',
            background: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            lineHeight: '18px',
            color: 'var(--ink)',
          }}
        />
      </label>
      {chips.map(([testId, label, active, set]) => (
        <button
          key={testId}
          type="button"
          data-testid={testId}
          aria-pressed={active}
          style={chipStyle(active)}
          onClick={() => set(!active)}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        aria-label="Recargar grafo"
        data-testid="reload-graph"
        onClick={() => {
          loadGraph(vaultPath).catch(console.error);
        }}
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 0,
          borderRadius: 'var(--radius-md)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <RefreshCw size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
      </button>
    </div>
  );
}
