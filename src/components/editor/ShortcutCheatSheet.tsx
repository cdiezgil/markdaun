import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  MARKDOWN_TYPING_RULES,
  formatShortcut,
} from '../../lib/editor/shortcuts';
import { isMac } from '../../lib/shortcut';

export interface ShortcutCheatSheetProps {
  open: boolean;
  onClose: () => void;
  /** Platform override (tests). Defaults to the detected platform. */
  mac?: boolean;
}

const KEY_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--ink-muted)',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px var(--space-2)',
  whiteSpace: 'nowrap',
};

const HEADING_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-muted)',
  margin: '0 0 var(--space-2)',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--space-4)',
  fontSize: 13,
  padding: '2px 0',
};

/** Floating cheat sheet of editor shortcuts and Markdown typing rules (Mod-/). */
export function ShortcutCheatSheet({ open, onClose, mac = isMac() }: ShortcutCheatSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const isToggle = e.key === '/' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
      if (e.key === 'Escape' || isToggle) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      data-testid="shortcut-cheatsheet-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 'var(--space-8)',
      }}
    >
      <div
        role="dialog"
        aria-label="Atajos de teclado"
        className="md-pop"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, calc(100vw - 2 * var(--space-8)))',
          maxHeight: 'calc(100vh - 2 * var(--space-8))',
          overflowY: 'auto',
          background: 'var(--surface)',
          color: 'var(--ink)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-pop)',
          padding: 'var(--space-6)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 var(--space-4)' }}>
          Atajos de teclado
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'var(--space-6)',
          }}
        >
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group}>
              <h3 style={HEADING_STYLE}>{group}</h3>
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} style={ROW_STYLE}>
                  <span>{s.label}</span>
                  <kbd style={KEY_STYLE}>{formatShortcut(s, mac)}</kbd>
                </div>
              ))}
            </section>
          ))}
          <section style={{ gridColumn: '1 / -1' }}>
            <h3 style={HEADING_STYLE}>Escritura Markdown</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                columnGap: 'var(--space-6)',
              }}
            >
              {MARKDOWN_TYPING_RULES.map((r) => (
                <div key={r.typed} style={ROW_STYLE}>
                  <span>{r.result}</span>
                  <kbd style={KEY_STYLE}>{r.typed}</kbd>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
