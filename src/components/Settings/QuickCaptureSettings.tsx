import React, { useCallback, useEffect, useState } from 'react';
import { quickCaptureGetConfig, quickCaptureSetShortcut, type QuickConfig } from '../../lib/tauri';
import { acceleratorFromEvent, formatAccelerator, isMac, shortcutErrorMessage } from '../../lib/shortcut';

const SMALL: React.CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)' };

const BUTTON: React.CSSProperties = {
  height: 28,
  padding: '0 var(--space-3)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  cursor: 'pointer',
};

/** Settings → Captura rápida: the global shortcut with a key recorder. */
export function QuickCaptureSettings(): JSX.Element {
  const [config, setConfig] = useState<QuickConfig | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mac = isMac();

  useEffect(() => {
    quickCaptureGetConfig()
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);

  const apply = useCallback(async (accelerator: string) => {
    try {
      setConfig(await quickCaptureSetShortcut(accelerator));
      setError(null);
    } catch (e) {
      setError(shortcutErrorMessage(String(e)));
    }
  }, []);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      const r = acceleratorFromEvent(e, mac);
      if ('pending' in r) return;
      if ('cancel' in r) {
        setRecording(false);
        return;
      }
      if ('error' in r) {
        setError(
          r.error === 'modifier'
            ? 'Incluye Ctrl, Alt o Cmd en la combinación.'
            : 'Esa tecla no se puede usar en un atajo.',
        );
        return;
      }
      setRecording(false);
      void apply(r.accelerator);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, mac, apply]);

  const shown = recording
    ? 'Pulsa la combinación…'
    : config
      ? formatAccelerator(config.shortcut, mac)
      : '…';
  const isDefault = !config || config.shortcut === config.default_shortcut;

  return (
    <section data-testid="quick-capture-section" style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-2)' }}>Captura rápida</h2>
      <p style={{ ...SMALL, margin: '0 0 var(--space-3)' }}>
        Abre una ventana para apuntar una idea, pegar una URL o una imagen desde cualquier aplicación. Todo llega a la
        entrada.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <kbd
          data-testid="shortcut-value"
          style={{
            minWidth: 120,
            padding: 'var(--space-1) var(--space-3)',
            border: `1px solid ${recording ? 'var(--focus)' : 'var(--line-strong)'}`,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            color: recording ? 'var(--ink-muted)' : 'var(--ink)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
          }}
        >
          {shown}
        </kbd>
        <button
          type="button"
          style={BUTTON}
          onClick={() => {
            setError(null);
            setRecording((r) => !r);
          }}
        >
          Cambiar
        </button>
        {!isDefault && (
          <button type="button" style={BUTTON} onClick={() => void apply(config!.default_shortcut)}>
            Restablecer
          </button>
        )}
      </div>
      {config?.error && !error && (
        <p role="alert" style={{ ...SMALL, color: 'var(--amber)', margin: 'var(--space-2) 0 0' }}>
          El atajo no está activo: {config.error}. Elige otra combinación.
        </p>
      )}
      {error && (
        <p role="alert" style={{ ...SMALL, color: 'var(--danger)', margin: 'var(--space-2) 0 0' }}>
          {error}
        </p>
      )}
    </section>
  );
}
