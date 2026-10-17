import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import { LlmWizard } from './components/LlmWizard/LlmWizard';
import { TopBar } from './components/Shell/TopBar';
import { StatusBar } from './components/StatusBar/StatusBar';
import { useLlmStore } from './store/llmStore';

function AppLayout() {
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const wizardOpen = useLlmStore((s) => s.wizardOpen);
  // Programmatic closes from the exit dialog must bypass the close guard,
  // otherwise window.close() re-triggers onCloseRequested and loops forever.
  const forceCloseRef = useRef(false);

  useEffect(() => {
    useVaultStore.getState().loadVault();
    useEditorStore.getState().initVault().catch(console.error);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event: { preventDefault(): void }) => {
        if (forceCloseRef.current) return;
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
    <div
      data-testid="app-shell"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
    >
      <TopBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <aside
          style={{
            width: 'var(--sidebar-width)',
            flexShrink: 0,
            boxSizing: 'border-box',
            background: 'var(--surface-sunken)',
            borderRight: '1px solid var(--line)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <VaultTree />
        </aside>
        <main style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--bg)' }}>
        <Routes>
          <Route path="/" element={<WelcomeView />} />
          <Route path="/editor/:encodedPath" element={<EditorView />} />
          <Route path="/preview/:encodedPath" element={<PreviewView />} />
          <Route path="/graph" element={<GraphView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/brain" element={<SecondBrainView />} />
        </Routes>
        </main>
      </div>
      <StatusBar />
      <ExitDialog
        open={showExitDialog}
        isSyncing={isSyncing}
        onSyncAndQuit={async () => {
          setIsSyncing(true);
          const { push } = useSyncStore.getState();
          const vaultPath = useVaultStore.getState().vaultPath;
          if (vaultPath) await push(vaultPath).catch(() => {});
          forceCloseRef.current = true;
          await getCurrentWindow().close();
        }}
        onQuit={async () => {
          setShowExitDialog(false);
          forceCloseRef.current = true;
          await getCurrentWindow().close();
        }}
        onCancel={() => setShowExitDialog(false)}
      />
      {wizardOpen && <LlmWizard />}
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
