import React, { useEffect, useState } from 'react';
import {
  onVoiceModelProgress,
  voiceDownloadModel,
  voiceGetConfig,
  voiceSetModel,
  type VoiceConfig,
  type VoiceModelProgress,
} from '../../lib/tauri';

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

/** Settings → Notas de voz: which Whisper model transcribes, and its download. */
export function VoiceSettings(): JSX.Element {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<VoiceModelProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    voiceGetConfig()
      .then(setConfig)
      .catch((e) => setError(String(e)));
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onVoiceModelProgress(setProgress)
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const choose = async (id: string) => {
    setError(null);
    try {
      setConfig(await voiceSetModel(id));
    } catch (e) {
      setError(String(e));
    }
  };

  const download = async (id: string) => {
    setError(null);
    setDownloading(id);
    setProgress(null);
    try {
      setConfig(await voiceDownloadModel(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(null);
      setProgress(null);
    }
  };

  const status = (id: string, downloaded: boolean): string => {
    if (downloading === id) {
      if (progress && progress.id === id && progress.total) {
        return `Descargando… ${Math.round((progress.done / progress.total) * 100)} %`;
      }
      return 'Descargando…';
    }
    return downloaded ? 'Descargado' : 'Se descargará al usarlo';
  };

  return (
    <section data-testid="voice-section" style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-2)' }}>Notas de voz</h2>
      <p style={{ ...SMALL, margin: '0 0 var(--space-3)' }}>
        La transcripción se hace en este equipo, sin enviar el audio a ningún servicio. El modelo se descarga la primera
        vez que lo usas.
      </p>
      <div role="radiogroup" aria-label="Modelo de transcripción" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {config?.models.map((m) => (
          <div
            key={m.id}
            data-testid={`model-${m.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, flex: 1 }}>
              <input
                type="radio"
                name="voice-model"
                checked={config.model === m.id}
                onChange={() => void choose(m.id)}
              />
              <span>{m.label}</span>
              <span style={SMALL}>
                {m.approx_mb} MB · {status(m.id, m.downloaded)}
              </span>
            </label>
            {!m.downloaded && downloading !== m.id && (
              <button type="button" style={BUTTON} disabled={downloading !== null} onClick={() => void download(m.id)}>
                Descargar ahora
              </button>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" style={{ ...SMALL, color: 'var(--danger)', margin: 'var(--space-2) 0 0' }}>
          {error}
        </p>
      )}
    </section>
  );
}
