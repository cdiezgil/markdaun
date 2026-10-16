import React, { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Label for the confirm button. Defaults to "Eliminar". */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      data-testid="confirm-dialog-overlay"
    >
      <div
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
        aria-labelledby="confirm-dialog-title"
      >
        <p
          id="confirm-dialog-title"
          style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-2)' }}
        >
          {title}
        </p>
        <p style={{ fontSize: 14, color: 'var(--ink-muted)', marginBottom: 'var(--space-6)' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
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
            onClick={onConfirm}
            data-testid="confirm-dialog-delete"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line-strong)',
              color: 'var(--danger)',
              cursor: 'pointer',
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
