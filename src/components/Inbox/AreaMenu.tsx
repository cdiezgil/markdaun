import React, { useEffect, useRef } from 'react';
import { Folder } from 'lucide-react';

export interface AreaMenuProps {
  /** Top-level folders of the vault. */
  areas: string[];
  /** Area used last time ('' = vault root); highlighted. */
  lastArea: string | null;
  /** How many items the choice applies to. */
  count: number;
  onChoose(area: string): void;
  onClose(): void;
}

const ITEM: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  width: '100%',
  padding: 'var(--space-2) var(--space-3)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
};

/** Small floating menu: the user picks the area the digestion works in. */
export function AreaMenu({ areas, lastArea, count, onChoose, onClose }: AreaMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const entries = [
    ...areas.map((a) => ({ key: a, testId: `area-${a}`, label: a })),
    { key: '', testId: 'area-root', label: 'Bóveda (raíz)' },
  ];

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="menu"
      aria-label="Elegir área"
      data-testid="area-menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        zIndex: 10,
        minWidth: 220,
        marginTop: 'var(--space-1)',
        padding: 'var(--space-2)',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-pop)',
        outline: 'none',
      }}
    >
      <div style={{ padding: 'var(--space-1) var(--space-3)', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink-muted)' }}>
        {count === 1 ? '¿En qué área va esto?' : `¿En qué área van estos ${count}?`}
      </div>
      {entries.map((e) => (
        <button
          key={e.testId}
          role="menuitem"
          data-testid={e.testId}
          aria-current={lastArea === e.key ? 'true' : undefined}
          onClick={() => onChoose(e.key)}
          style={{ ...ITEM, background: lastArea === e.key ? 'var(--selection)' : 'transparent' }}
        >
          <Folder size={14} strokeWidth={1.5} color={lastArea === e.key ? 'var(--daun)' : 'var(--ink-muted)'} />
          {e.label}
        </button>
      ))}
    </div>
  );
}
