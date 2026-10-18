import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { onQuickCaptureOpen, quickCaptureHide, quickCaptureSave, quickCaptureSaveAudio } from '../../lib/tauri';
import {
  blobToBase64,
  MAX_RECORDING_MS,
  microphoneErrorMessage,
  VoiceRecorder,
} from '../../lib/voice/recorder';
import { isMac } from '../../lib/shortcut';

interface PastedImage {
  dataUrl: string;
  base64: string;
}

function quickErrorMessage(e: unknown): string {
  const raw = String(e);
  if (raw === 'no_vault') return 'Abre una bóveda en MarkDaun antes de capturar.';
  if (raw === 'invalid_image') return 'No se pudo leer la imagen pegada.';
  if (raw === 'image_too_large') return 'La imagen es demasiado grande (máximo 20 MB).';
  if (raw === 'empty_capture') return 'No hay nada que guardar.';
  return raw;
}

/** A recording shorter than this is taken for an accidental click. */
const MIN_RECORDING_MS = 1000;
const TICK_MS = 100;

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function readImage(file: Blob): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({ dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const GHOST: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--ink-muted)',
  cursor: 'pointer',
  padding: 'var(--space-1)',
};

/** The small always-on-top window opened by the global shortcut. */
export function QuickCaptureWindow(): JSX.Element {
  const [text, setText] = useState('');
  const [image, setImage] = useState<PastedImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const recorder = useRef<VoiceRecorder | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Guards against a double submit before React re-renders `saving`.
  const busy = useRef(false);

  /** Throws a running recording away and goes back to the text box. */
  const discardRecording = useCallback(() => {
    recorder.current?.cancel();
    recorder.current = null;
    setRecording(false);
    setElapsedMs(0);
    setLevel(0);
  }, []);

  const reset = useCallback(() => {
    discardRecording();
    setText('');
    setImage(null);
    setError(null);
    box.current?.focus();
  }, [discardRecording]);

  useEffect(() => {
    box.current?.focus();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onQuickCaptureOpen(reset)
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
      recorder.current?.cancel();
    };
  }, [reset]);

  const startRecording = async () => {
    if (busy.current || recorder.current) return;
    setError(null);
    try {
      recorder.current = await VoiceRecorder.start();
      setElapsedMs(0);
      setRecording(true);
    } catch (e) {
      setError(microphoneErrorMessage(e));
    }
  };

  /** Stops the recording and saves it into the inbox (the window then closes). */
  const finishRecording = useCallback(async () => {
    const rec = recorder.current;
    if (!rec || busy.current) return;
    busy.current = true;
    recorder.current = null;
    setSaving(true);
    setError(null);
    try {
      const audio = await rec.stop();
      setRecording(false);
      if (audio.durationMs < MIN_RECORDING_MS) {
        setError('La grabación es demasiado corta.');
        return;
      }
      await quickCaptureSaveAudio(await blobToBase64(audio.blob), audio.mime);
      reset();
    } catch (e) {
      setRecording(false);
      setError(quickErrorMessage(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [reset]);

  // While recording: clock, level meter, the 30-minute limit and the keys
  // (the text box is gone, so they are listened to on the document).
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const rec = recorder.current;
      if (!rec) return;
      const ms = rec.elapsedMs();
      setElapsedMs(ms);
      setLevel(rec.level());
      if (ms >= MAX_RECORDING_MS) void finishRecording();
    }, TICK_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        discardRecording();
        box.current?.focus();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void finishRecording();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [recording, finishRecording, discardRecording]);

  const canSave = !saving && (text.trim() !== '' || image !== null);

  const save = async () => {
    if (busy.current || (text.trim() === '' && !image)) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await quickCaptureSave(text, image?.base64);
      reset();
    } catch (e) {
      setError(quickErrorMessage(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void quickCaptureHide();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    readImage(file)
      .then(setImage)
      .catch(() => setError('No se pudo leer la imagen pegada.'));
  };

  return (
    <div
      data-testid="quick-capture"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
      }}
    >
      <div data-tauri-drag-region style={{ height: 'var(--space-4)', flexShrink: 0 }} />
      {recording ? (
        <div
          data-testid="recording-panel"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 'var(--space-3)',
            padding: '0 var(--space-4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--danger)' }} />
            Grabando
            <span data-testid="recording-time" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
              {clock(elapsedMs)}
            </span>
          </div>
          <div
            role="meter"
            aria-label="Nivel de entrada"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={level}
            style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--line)', overflow: 'hidden' }}
          >
            <div style={{ width: `${Math.round(level * 100)}%`, height: '100%', background: 'var(--daun)' }} />
          </div>
        </div>
      ) : (
      <textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder="Escribe, pega una URL o una imagen…"
        aria-label="Captura"
        style={{
          flex: 1,
          minHeight: 0,
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--ink)',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          lineHeight: '20px',
          padding: '0 var(--space-4)',
        }}
      />
      )}
      {image && (
        <div
          data-testid="image-chip"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            alignSelf: 'flex-start',
            margin: '0 var(--space-4) var(--space-2)',
            padding: 'var(--space-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-sunken)',
          }}
        >
          <img src={image.dataUrl} alt="Imagen pegada" style={{ height: 32, borderRadius: 'var(--radius-sm)' }} />
          <button type="button" aria-label="Quitar imagen" onClick={() => setImage(null)} style={GHOST}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" style={{ margin: '0 var(--space-4) var(--space-2)', fontSize: 12, lineHeight: '16px', color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2) var(--space-4) var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {!recording && (
            <button
              type="button"
              aria-label="Grabar nota de voz"
              title="Grabar nota de voz"
              onClick={() => void startRecording()}
              disabled={saving || text.trim() !== '' || image !== null}
              style={{
                ...GHOST,
                opacity: saving || text.trim() !== '' || image !== null ? 0.4 : 1,
              }}
            >
              <Mic size={16} strokeWidth={1.5} />
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
            {recording
              ? isMac()
                ? '⌘↵ detener y guardar · Esc descartar'
                : 'Ctrl+Intro detener y guardar · Esc descartar'
              : isMac()
                ? '⌘↵ guardar · Esc cerrar'
                : 'Ctrl+Intro guardar · Esc cerrar'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void (recording ? finishRecording() : save())}
          disabled={recording ? saving : !canSave}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            height: 28,
            padding: '0 var(--space-3)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            cursor: recording || canSave ? 'pointer' : 'default',
            opacity: recording || canSave ? 1 : 0.5,
          }}
        >
          {recording && <Square size={12} strokeWidth={1.5} />}
          {saving ? 'Guardando…' : recording ? 'Detener y guardar' : 'Guardar en Entrada'}
        </button>
      </div>
    </div>
  );
}
