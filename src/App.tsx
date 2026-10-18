import React, { useCallback, useEffect, useState } from 'react';
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
import { ExitDialog } from './components/Sync/ExitDialog';
import { SyncDialogs } from './components/Sync/SyncDialogs';
import { onInboxCaptured, onRequestQuit, onVoiceChanged, quitApp } from './lib/tauri';
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

function AppLayout() {
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const wizardOpen = useLlmStore((s) => s.wizardOpen);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const inBrain = viewForPath(useLocation().pathname) === 'brain';
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    useVaultStore.getState().loadVault();
    useEditorStore.getState().initVault().catch(console.error);
  }, []);

  // Closing the window only hides it (done in the backend); *Salir* (tray menu,
  // Cmd+Q) asks us to run the unsynced-changes guard before really quitting.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onRequestQuit(() => {
      const { config, status } = useSyncStore.getState();
      if (config.isConnected && status.hasChanges) setShowExitDialog(true);
      else void quitApp();
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
          {inBrain && vaultPath ? <ConversationList vaultPath={vaultPath} /> : <VaultTree />}
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
          setIsSyncing(false);
          setShowExitDialog(false);
          // A held-back push (deletion guard) must be answered first: don't quit.
          if (useSyncStore.getState().pendingDeletion) return;
          await quitApp();
        }}
        onQuit={async () => {
          setShowExitDialog(false);
          await quitApp();
        }}
        onCancel={() => setShowExitDialog(false)}
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
