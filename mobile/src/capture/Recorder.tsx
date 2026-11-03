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

const secondary = {
  minHeight: 48,
  padding: '0 var(--space-4)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-lg)',
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: 15,
  fontWeight: 500,
} as const;

export function Recorder({ db, onSaved, onClose }: { db: Db; onSaved: () => void; onClose: () => void }) {
  // A recording whose save failed stays here so it can be retried, never lost.
  const [held, setHeld] = useState<RecordingResult | null>(null);
  const [retrying, setRetrying] = useState(false);

  const save = useCallback(
    async (result: RecordingResult | null) => {
      if (!result) return;
      try {
        await enqueue(db, result.blob, result.mime, result.at);
      } catch {
        setHeld(result);
        reset();
        return;
      }
      setHeld(null);
      onSaved();
    },
    [db, onSaved],
  );

  const { state, elapsedMs, error, start, stop, reset } = useRecorder(save);

  useEffect(() => {
    void start();
  }, [start]);

  const onStop = async () => {
    await save(await stop());
  };

  const onRetry = async () => {
    if (!held) return;
    setRetrying(true);
    await save(held);
    setRetrying(false);
  };

  const onDiscard = () => {
    if (window.confirm('¿Descartar la grabación?')) onClose();
  };

  const denied = error?.kind === 'MicDenied';
  const recording = state !== 'idle';

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
      {held ? (
        <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
          No se pudo guardar la grabación
        </p>
      ) : error ? (
        <p role="alert" style={{ color: 'var(--danger)', maxWidth: '32ch', margin: 0 }}>
          {denied
            ? 'Permite el micrófono en los ajustes del navegador para grabar notas de voz.'
            : error.message}
        </p>
      ) : (
        <>
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontWeight: 500 }}>
            {state === 'saving' ? 'Guardando…' : state === 'recording' ? 'Grabando…' : 'Preparando…'}
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
      {recording && !held && !error && (
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
      )}
      {held && (
        <>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            style={{
              ...secondary,
              minHeight: 72,
              minWidth: 160,
              border: 'none',
              background: 'var(--gold)',
              color: 'var(--on-gold)',
              fontWeight: 700,
              fontSize: 17,
            }}
          >
            Reintentar
          </button>
          <button type="button" onClick={onDiscard} style={secondary}>
            Descartar
          </button>
        </>
      )}
      {!held && error && (
        <button type="button" onClick={onClose} style={secondary}>
          Cerrar
        </button>
      )}
    </main>
  );
}
