import { useCallback, useEffect, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import type { Db } from '../store/db';
import { enqueue } from './queue';
import { useRecorder, type RecordingResult } from './useRecorder';

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function Recorder({ db, onSaved }: { db: Db; onSaved: () => void }) {
  const [saveError, setSaveError] = useState(false);

  const save = useCallback(
    async (result: RecordingResult | null) => {
      if (!result) return;
      try {
        await enqueue(db, result.blob, result.mime, result.at);
      } catch {
        setSaveError(true);
        return;
      }
      onSaved();
    },
    [db, onSaved],
  );

  const { state, elapsedMs, error, start, stop } = useRecorder(save);

  useEffect(() => {
    void start();
  }, [start]);

  const onStop = async () => {
    setSaveError(false);
    await save(await stop());
  };

  const denied = error?.kind === 'MicDenied';

  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-6)',
        padding: 'var(--space-4)',
        background: 'var(--bg)',
        color: 'var(--ink)',
        textAlign: 'center',
      }}
    >
      <Mic size={32} strokeWidth={1.5} color="var(--daun)" aria-hidden />
      {denied ? (
        <p role="alert" style={{ color: 'var(--danger)', maxWidth: '32ch', margin: 0 }}>
          Permite el micrófono en los ajustes del navegador para grabar notas de voz.
        </p>
      ) : (
        <>
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontWeight: 500 }}>
            {state === 'saving' ? 'Guardando…' : 'Grabando…'}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 56,
              lineHeight: '64px',
              fontWeight: 300,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatElapsed(elapsedMs)}
          </p>
        </>
      )}
      {saveError && (
        <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
          No se pudo guardar la grabación
        </p>
      )}
      <button
        type="button"
        onClick={onStop}
        disabled={state !== 'recording'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          minWidth: 160,
          minHeight: 72,
          padding: '0 var(--space-6)',
          border: 'none',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--gold)',
          color: 'var(--on-gold)',
          fontFamily: 'inherit',
          fontSize: 17,
          fontWeight: 700,
          opacity: state === 'recording' ? 1 : 0.5,
        }}
      >
        <Square size={20} strokeWidth={1.5} aria-hidden />
        Detener
      </button>
    </main>
  );
}
