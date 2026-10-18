import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { onQuickCaptureOpen, quickCaptureHide, quickCaptureSave } from '../../lib/tauri';
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
  const box = useRef<HTMLTextAreaElement>(null);
  // Guards against a double submit before React re-renders `saving`.
  const busy = useRef(false);

  const reset = useCallback(() => {
    setText('');
    setImage(null);
    setError(null);
    box.current?.focus();
  }, []);

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
    };
  }, [reset]);

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
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          {isMac() ? '⌘↵ guardar · Esc cerrar' : 'Ctrl+Intro guardar · Esc cerrar'}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          style={{
            height: 28,
            padding: '0 var(--space-3)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            cursor: canSave ? 'pointer' : 'default',
            opacity: canSave ? 1 : 0.5,
          }}
        >
          {saving ? 'Guardando…' : 'Guardar en Entrada'}
        </button>
      </div>
    </div>
  );
}
