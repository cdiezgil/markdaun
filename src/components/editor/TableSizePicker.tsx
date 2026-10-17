import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const MAX_ROWS = 8;
export const MAX_COLS = 10;

export interface TableSizePickerProps {
  /** Screen rect of the anchor button; the panel opens right below it. */
  anchorRect: { left: number; bottom: number };
  onSelect: (rows: number, cols: number) => void;
  onClose: () => void;
}

/**
 * Grid-based table size selector: hover highlights a rows × cols region,
 * the label shows the live size, click inserts.
 */
export function TableSizePicker({ anchorRect, onSelect, onClose }: TableSizePickerProps) {
  const [size, setSize] = useState<{ rows: number; cols: number }>({ rows: 3, cols: 3 });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const panelWidth = MAX_COLS * 19 + 24; // cells + gaps + padding

  return createPortal(
    <>
      {/* Transparent overlay: click outside closes the picker */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        data-testid="table-size-picker-overlay"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Tamaño de la tabla"
        data-testid="table-size-picker"
        style={{
          position: 'fixed',
          top: anchorRect.bottom + 6,
          left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - panelWidth - 8)),
          zIndex: 50,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-pop)',
          padding: 'var(--space-3)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${MAX_COLS}, 16px)`,
            gap: 3,
          }}
          onMouseLeave={() => setSize({ rows: 3, cols: 3 })}
        >
          {Array.from({ length: MAX_ROWS }, (_, r) =>
            Array.from({ length: MAX_COLS }, (_, c) => {
              const active = r < size.rows && c < size.cols;
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  aria-label={`${r + 1} × ${c + 1}`}
                  data-testid={`table-size-cell-${r}-${c}`}
                  onMouseEnter={() => setSize({ rows: r + 1, cols: c + 1 })}
                  onClick={() => onSelect(r + 1, c + 1)}
                  style={{
                    width: 16,
                    height: 16,
                    padding: 0,
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    background: active ? 'var(--daun)' : 'var(--surface-sunken)',
                  }}
                />
              );
            }),
          )}
        </div>
        <p
          data-testid="table-size-label"
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 13,
            color: 'var(--ink-muted)',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {size.rows} × {size.cols}
        </p>
      </div>
    </>,
    document.body,
  );
}
