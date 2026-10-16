import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Brain, FolderOpen, Network } from 'lucide-react';
import { useVaultStore } from './store/vaultStore';
import { useEditorStore } from './store/editorStore';
import { useSyncStore } from './store/syncStore';
import { VaultTree } from './components/VaultTree/VaultTree';
import { WelcomeView } from './views/WelcomeView';
import { EditorView } from './views/EditorView';
import { PreviewView } from './views/PreviewView';
import { GraphView } from './views/GraphView';
import { SettingsView } from './views/SettingsView';
import { ExitDialog } from './components/Sync/ExitDialog';
import { getCurrentWindow } from './lib/tauri';
import { SecondBrainView } from './views/SecondBrainView';

function AppLayout() {
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    useVaultStore.getState().loadVault();
    useEditorStore.getState().initVault().catch(console.error);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event: { preventDefault(): void }) => {
        const { config, status } = useSyncStore.getState();
        if (config.isConnected && status.hasChanges) {
          event.preventDefault();
          setShowExitDialog(true);
        }
      })
      .then((fn) => { unlisten = fn; })
      .catch(console.error);
    return () => { unlisten?.(); };
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
          <NavLink
            to="/brain"
            data-testid="nav-brain"
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
            <Brain size={16} strokeWidth={1.5} />
            Brain
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
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/brain" element={<SecondBrainView />} />
        </Routes>
      </main>
      <ExitDialog
        open={showExitDialog}
        isSyncing={isSyncing}
        onSyncAndQuit={async () => {
          setIsSyncing(true);
          const { push } = useSyncStore.getState();
          const vaultPath = useVaultStore.getState().vaultPath;
          if (vaultPath) await push(vaultPath).catch(() => {});
          await getCurrentWindow().close();
        }}
        onQuit={async () => {
          await getCurrentWindow().close();
        }}
        onCancel={() => setShowExitDialog(false)}
      />
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
