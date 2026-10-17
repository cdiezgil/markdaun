import React from 'react';
import { useLocation } from 'react-router-dom';
import { AppStatus } from './AppStatus';
import { NoteStats } from './NoteStats';
import { ModelSwitcher } from '../ModelSwitcher/ModelSwitcher';
import { useGraphStore } from '../../store/graphStore';
import { graphStats, formatGraphStats } from '../../lib/graphStats';
import { viewForPath } from '../../lib/shell';

function GraphStats(): JSX.Element {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  return <span data-testid="graph-stats">{formatGraphStats(graphStats(nodes, edges))}</span>;
}

/**
 * Bottom bar, contextual by view:
 * notes -> save + sync (left), note data + AI selector (right);
 * graph -> graph counts + AI selector; brain/settings -> sync + AI selector.
 */
export function StatusBar(): JSX.Element {
  const view = viewForPath(useLocation().pathname);

  return (
    <footer
      data-testid="status-bar"
      style={{
        height: 30,
        flexShrink: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: '0 var(--space-4)',
        background: 'var(--surface-sunken)',
        borderTop: '1px solid var(--line)',
        color: 'var(--ink-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        lineHeight: '16px',
      }}
    >
      {view === 'graph' ? <GraphStats /> : <AppStatus showSave={view === 'notes'} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0 }}>
        {view === 'notes' && <NoteStats />}
        <ModelSwitcher />
      </div>
    </footer>
  );
}
