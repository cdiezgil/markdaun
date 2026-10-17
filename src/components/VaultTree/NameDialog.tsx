import React, { useEffect, useRef, useState } from 'react';

export interface NameDialogProps {
  open: boolean;
  title: string;
  /** Small explanatory line under the title (e.g. ".md se añade solo"). */
  hint?: string;
  submitLabel?: string;
  /** Receives the trimmed name. May throw; the message is shown in the dialog. */
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

function humanizeError(err: unknown): string {
  const msg = typeof err === 'string' ? err : String(err);
  if (msg === 'already_exists') return 'Ya existe una nota o carpeta con ese nombre.';
  if (msg === 'invalid_name') return 'Nombre no válido.';
  if (msg === 'cannot_move_into_subtree') return 'No se puede mover una carpeta dentro de sí misma.';
  if (msg.startsWith('io_error:')) return 'Error de disco al crear la entrada.';
  return msg;
}

export function NameDialog({ open, title, hint, submitLabel = 'Crear', onSubmit, onCancel }: NameDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
      setBusy(false);
      // Focus after the dialog is in the DOM
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (!name) {
      setError('El nombre es obligatorio.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'color-mix(in srgb, var(--ink) 40%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      data-testid="name-dialog-overlay"
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-pop)',
          padding: 'var(--space-6)',
          minWidth: 320,
          maxWidth: 480,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
      >
        <p
          id="name-dialog-title"
          style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-2)' }}
        >
          {title}
        </p>
        {hint && (
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 'var(--space-3)' }}>
            {hint}
          </p>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          data-testid="name-dialog-input"
          aria-label="Nombre"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 14,
            color: 'var(--ink)',
            background: 'var(--bg)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--line-strong)'}`,
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-3)',
            outline: 'none',
          }}
        />
        {error && (
          <p
            role="alert"
            data-testid="name-dialog-error"
            style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 'var(--space-3)' }}
          >
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            data-testid="name-dialog-cancel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink)',
              cursor: 'pointer',
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            data-testid="name-dialog-submit"
            style={{
              background: 'var(--daun)',
              border: 'none',
              color: 'var(--on-daun)',
              cursor: busy ? 'wait' : 'pointer',
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {busy ? 'Creando…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
