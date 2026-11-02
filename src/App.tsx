import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useVaultStore } from './store/vaultStore';
import { useEditorStore } from './store/editorStore';
import { useSyncStore } from './store/syncStore';
import { ConversationList } from './components/SecondBrain/ConversationList';
import { VaultTree } from './components/VaultTree/VaultTree';
import { WelcomeView } from './views/WelcomeView';
import { EditorView } from './views/EditorView';
import { PreviewView } from './views/PreviewView';
import { GraphView } from './views/GraphView';
import { SettingsView } from './views/SettingsView';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog';
import { finishQuit, flushEditsForQuit } from './lib/quitFlow';
import { SyncDialogs } from './components/Sync/SyncDialogs';
import { onInboxCaptured, onRequestQuit, onVoiceChanged } from './lib/tauri';
import { captureToast } from './lib/inbox';
import { useInboxStore } from './store/inboxStore';
import { Toast } from './components/Shell/Toast';
import { SecondBrainView } from './views/SecondBrainView';
import { LlmWizard } from './components/LlmWizard/LlmWizard';
import { TopBar } from './components/Shell/TopBar';
import { StatusBar } from './components/StatusBar/StatusBar';
import { useLlmStore } from './store/llmStore';
import { viewForPath } from './lib/shell';
import { InboxView } from './components/Inbox/InboxView';
import { IdeView } from './views/IdeView';
import { IdeTree } from './components/Ide/IdeTree';
import { useIdeStore } from './store/ideStore';
import { useAutoSync } from './hooks/useAutoSync';

function AppLayout() {
  // null: not quitting; 'syncing': flushing + final sync; 'confirm': edits could not be saved.
  const [quitPhase, setQuitPhase] = useState<null | 'syncing' | 'confirm'>(null);
  const quitting = useRef(false);
  const wizardOpen = useLlmStore((s) => s.wizardOpen);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const currentView = viewForPath(useLocation().pathname);
  const inBrain = currentView === 'brain';
  const inIde = currentView === 'ide';
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  // Editor side of automatic sync: save hold handshake and open-note reload.
  useAutoSync(setToast);

  useEffect(() => {
    useVaultStore.getState().loadVault();
    useEditorStore.getState().initVault().catch(console.error);
    useIdeStore.getState().loadProjects().catch(console.error);
  }, []);

  const syncConnected = useSyncStore((s) => s.config.isConnected);
  const syncVaultPath = useVaultStore((s) => s.vaultPath);
  // The GitHub connection (repo URL in config.db, PAT in the keyring) persists
  // across restarts and belongs to the vault it was made for: reload it on
  // startup and whenever the active vault changes.
  useEffect(() => {
    useSyncStore.getState().loadConfig().catch(console.error);
  }, [syncVaultPath]);
  useEffect(() => {
    if (syncConnected && syncVaultPath) {
      useSyncStore.getState().loadState().catch(console.error);
    }
  }, [syncConnected, syncVaultPath]);

  // Closing the window only hides it (done in the backend); *Salir* (tray menu,
  // Cmd+Q) asks us to run the unsynced-changes guard before really quitting.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onRequestQuit(() => {
      if (quitting.current) return;
      quitting.current = true;
      const syncFirst = useSyncStore.getState().config.isConnected;
      setQuitPhase('syncing');
      void flushEditsForQuit()
        .then((allWritten) => {
          if (allWritten) return finishQuit(syncFirst);
          // Something could not be written: ask before leaving it behind.
          setQuitPhase('confirm');
        })
        .catch((e) => {
          console.error('quit failed:', e);
          quitting.current = false;
          setQuitPhase(null);
        });
    })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Sync may have added/removed/merged notes on disk: reload the tree.
  const vaultChangeCount = useSyncStore((s) => s.vaultChangeCount);
  useEffect(() => {
    if (vaultChangeCount > 0) void useVaultStore.getState().refreshTree();
  }, [vaultChangeCount]);

  // A capture saved from the quick-capture window.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onInboxCaptured((summary) => {
      setToast(captureToast(summary));
      const vault = useVaultStore.getState().vaultPath;
      if (vault) void useInboxStore.getState().load(vault);
    })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // A voice note changed state (transcribing, model download, done, failed).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onVoiceChanged(() => {
      const vault = useVaultStore.getState().vaultPath;
      if (!vault) return;
      void useInboxStore
        .getState()
        .load(vault)
        .then(() => {
          // The transcript note is a new file: refresh the tree once downloads settle.
          const busy = useInboxStore.getState().items.some((i) => i.voice?.state === 'downloading');
          if (!busy) void useVaultStore.getState().refreshTree();
        });
    })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
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
          {inIde ? (
            <IdeTree />
          ) : inBrain && vaultPath ? (
            <ConversationList vaultPath={vaultPath} />
          ) : (
            <VaultTree />
          )}
        </aside>
        <main style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--bg)' }}>
        <Routes>
          <Route path="/" element={<WelcomeView />} />
          <Route path="/editor/:encodedPath" element={<EditorView />} />
          <Route path="/preview/:encodedPath" element={<PreviewView />} />
          <Route path="/graph" element={<GraphView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/brain" element={<SecondBrainView />} />
          <Route path="/inbox" element={<InboxView />} />
          <Route path="/ide" element={<IdeView />} />
          <Route path="/ide/editor/:encodedPath" element={<IdeView />} />
        </Routes>
        </main>
      </div>
      <StatusBar />
      {quitPhase === 'syncing' && (
        <div
          data-testid="quit-notice"
          role="status"
          style={{
            position: 'fixed',
            right: 'var(--space-6)',
            bottom: 'var(--space-12)',
            zIndex: 100,
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-pop)',
            color: 'var(--ink)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
          }}
        >
          Sincronizando antes de salir…
        </div>
      )}
      <ConfirmDialog
        open={quitPhase === 'confirm'}
        title="Salir"
        description="Hay cambios que no se han podido guardar. ¿Salir igualmente?"
        confirmLabel="Salir"
        onConfirm={() => {
          setQuitPhase('syncing');
          finishQuit(useSyncStore.getState().config.isConnected).catch((e) => {
            console.error('quit failed:', e);
            quitting.current = false;
            setQuitPhase(null);
          });
        }}
        onCancel={() => {
          quitting.current = false;
          setQuitPhase(null);
        }}
      />
      <SyncDialogs />
      <Toast message={toast} onDismiss={dismissToast} />
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
