import React from 'react';
import { AppStatus } from './AppStatus';
import { NoteStats } from './NoteStats';
import { ModelSwitcher } from '../ModelSwitcher/ModelSwitcher';

/** Bottom bar: app state on the left; note data and AI selector on the right. */
export function StatusBar(): JSX.Element {
  return (
    <footer
      data-testid="status-bar"
      style={{
        height: 'var(--toolbar-height)',
        flexShrink: 0,
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
      }}
    >
      <AppStatus />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0 }}>
        <NoteStats />
        <ModelSwitcher />
      </div>
    </footer>
  );
}
