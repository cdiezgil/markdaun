import React, { useState } from 'react';
import { useSyncStore } from '../store/syncStore';
import { useVaultStore } from '../store/vaultStore';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { AiConnections } from '../components/Settings/AiConnections';
import { Trash } from '../components/Settings/Trash';
import { QuickCaptureSettings } from '../components/Settings/QuickCaptureSettings';

export function SettingsView(): JSX.Element {
  const config = useSyncStore((s) => s.config);
  const isLoading = useSyncStore((s) => s.isLoading);
  const error = useSyncStore((s) => s.error);
  const connect = useSyncStore((s) => s.connect);
  const disconnect = useSyncStore((s) => s.disconnect);

  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);

  const [repoUrl, setRepoUrl] = useState('');
  const [pat, setPat] = useState('');
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const vaultHasFiles = tree.length > 0;

  const handleConnect = () => {
    if (!repoUrl || !pat || !vaultPath) return;
    if (vaultHasFiles) {
      // Show confirm before overwriting remote
      setShowOverwriteConfirm(true);
    } else {
      // Empty vault: clone directly
      connect(repoUrl, pat, vaultPath);
    }
  };

  const handleConfirmConnect = () => {
    setShowOverwriteConfirm(false);
    if (vaultPath) {
      connect(repoUrl, pat, vaultPath);
    }
  };

  const handleDisconnect = () => {
    setShowDisconnectConfirm(true);
  };

  const handleConfirmDisconnect = () => {
    setShowDisconnectConfirm(false);
    disconnect();
  };

  return (
    <div
      data-testid="settings-view"
      style={{
        maxWidth: 'var(--measure)',
        margin: '0 auto',
        padding: 'var(--space-8)',
        fontFamily: 'var(--sans)',
        color: 'var(--ink)',
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          marginBottom: 'var(--space-6)',
        }}
      >
        Ajustes
      </h1>

      {/* GitHub Sync section */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            marginBottom: 'var(--space-4)',
          }}
        >
          GitHub Sync
        </h2>

        {!config.isConnected ? (
          /* ── Connection form ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label
                htmlFor="github-url"
                style={{ display: 'block', fontSize: 13, marginBottom: 'var(--space-1)', color: 'var(--ink-muted)' }}
              >
                URL del repositorio
              </label>
              <input
                id="github-url"
                data-testid="github-url-input"
                type="text"
                placeholder="https://github.com/usuario/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="github-pat"
                style={{ display: 'block', fontSize: 13, marginBottom: 'var(--space-1)', color: 'var(--ink-muted)' }}
              >
                Personal Access Token
              </label>
              <input
                id="github-pat"
                data-testid="github-pat-input"
                type="password"
                placeholder="ghp_..."
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{error}</p>
            )}

            <button
              data-testid="github-connect-btn"
              onClick={handleConnect}
              disabled={isLoading || !repoUrl || !pat}
              style={{
                background: 'var(--daun)',
                color: 'var(--on-daun)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 14,
                fontWeight: 500,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              {isLoading ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
        ) : (
          /* ── Connected state ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 14, color: 'var(--ink-muted)', margin: 0 }}>
              Conectado a{' '}
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>
                {config.repoUrl}
              </span>
            </p>

            <button
              data-testid="github-disconnect-btn"
              onClick={handleDisconnect}
              disabled={isLoading}
              style={{
                background: 'var(--surface)',
                color: 'var(--danger)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 14,
                fontWeight: 500,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              Desvincular
            </button>
          </div>
        )}
      </section>

      <AiConnections />

      <QuickCaptureSettings />

      <Trash />

      {/* Overwrite confirm dialog */}
      <ConfirmDialog
        open={showOverwriteConfirm}
        title="Sobrescribir repositorio remoto"
        message="Los ficheros actuales del vault se subirán al repositorio remoto, sobrescribiendo su contenido. ¿Continuar?"
        confirmLabel="Conectar y subir"
        onConfirm={handleConfirmConnect}
        onCancel={() => setShowOverwriteConfirm(false)}
      />

      {/* Disconnect confirm dialog */}
      <ConfirmDialog
        open={showDisconnectConfirm}
        title="Desvincular repositorio"
        message="Los ficheros locales quedarán intactos, pero perderás el backup remoto. ¿Continuar?"
        confirmLabel="Desvincular"
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setShowDisconnectConfirm(false)}
      />
    </div>
  );
}
