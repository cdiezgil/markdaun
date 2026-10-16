import React from 'react';
import { useEditorStore } from '../../store/editorStore';

const MESSAGES: Record<string, string> = {
  idle: '',
  saving: 'Guardando\u2026',
  saved: 'Guardado',
};

/**
 * SaveIndicator — TC-03
 *
 * Displays the current save status as a discrete caption.
 * Position: absolute, bottom-right of the editor container.
 */
export default function SaveIndicator() {
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const text = MESSAGES[saveStatus] ?? '';

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="save-indicator"
      data-save-status={saveStatus}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        color: 'var(--ink-muted)',
        pointerEvents: 'none',
        userSelect: 'none',
        minWidth: '7ch',
      }}
    >
      {text}
    </span>
  );
}
