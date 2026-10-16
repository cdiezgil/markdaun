import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useVaultStore } from './store/vaultStore';
import { VaultTree } from './components/VaultTree/VaultTree';
import { WelcomeView } from './views/WelcomeView';
import { EditorView } from './views/EditorView';
import { PreviewView } from './views/PreviewView';

function AppLayout() {
  useEffect(() => {
    useVaultStore.getState().loadVault();
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <aside
        style={{
          width: 'var(--sidebar-width)',
          flexShrink: 0,
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
        }}
        data-testid="sidebar"
      >
        <VaultTree />
      </aside>
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<WelcomeView />} />
          <Route path="/editor/:encodedPath" element={<EditorView />} />
          <Route path="/preview/:encodedPath" element={<PreviewView />} />
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
