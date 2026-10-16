import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { FolderOpen, Network } from 'lucide-react';
import { useVaultStore } from './store/vaultStore';
import { useEditorStore } from './store/editorStore';
import { VaultTree } from './components/VaultTree/VaultTree';
import { WelcomeView } from './views/WelcomeView';
import { EditorView } from './views/EditorView';
import { PreviewView } from './views/PreviewView';
import { GraphView } from './views/GraphView';

function AppLayout() {
  useEffect(() => {
    useVaultStore.getState().loadVault();
    useEditorStore.getState().initVault().catch(console.error);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <aside
        style={{
          width: 'var(--sidebar-width)',
          flexShrink: 0,
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        data-testid="sidebar"
      >
        {/* Top nav: Files | Graph */}
        <nav
          data-testid="sidebar-nav"
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 'var(--toolbar-height)',
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          <NavLink
            to="/"
            end
            data-testid="nav-files"
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 var(--space-3)',
              height: '100%',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              fontWeight: 500,
              color: isActive ? 'var(--daun)' : 'var(--ink-muted)',
              textDecoration: 'none',
            })}
          >
            <FolderOpen size={16} strokeWidth={1.5} />
            Files
          </NavLink>
          <NavLink
            to="/graph"
            data-testid="nav-graph"
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 var(--space-3)',
              height: '100%',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              fontWeight: 500,
              color: isActive ? 'var(--daun)' : 'var(--ink-muted)',
              textDecoration: 'none',
            })}
          >
            <Network size={16} strokeWidth={1.5} />
            Graph
          </NavLink>
        </nav>
        <VaultTree />
      </aside>
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<WelcomeView />} />
          <Route path="/editor/:encodedPath" element={<EditorView />} />
          <Route path="/preview/:encodedPath" element={<PreviewView />} />
          <Route path="/graph" element={<GraphView />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
