import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Brain, FileText, FolderCode, Network } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NoteSearch } from './NoteSearch';
import { BrandMark } from '../Brand/BrandMark';
import { viewForPath, type ShellView } from '../../lib/shell';

const TABS: Array<{ view: ShellView; label: string; to: string; Icon: LucideIcon }> = [
  { view: 'notes', label: 'Notas', to: '/', Icon: FileText },
  { view: 'graph', label: 'Grafo', to: '/graph', Icon: Network },
  { view: 'brain', label: 'Brain', to: '/brain', Icon: Brain },
  { view: 'ide', label: 'IDE', to: '/ide', Icon: FolderCode },
];

/** Application top bar: logotype, view tabs and the ⌘K note search. */
export function TopBar(): JSX.Element {
  const { pathname } = useLocation();
  const current = viewForPath(pathname);

  return (
    <header
      style={{
        height: 48,
        flexShrink: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: '0 var(--space-4)',
        background: 'var(--surface-sunken)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <BrandMark size={20} />
          <span
            data-testid="logotype"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 17,
              lineHeight: 1,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
            }}
          >
            MarkDaun
          </span>
        </div>
        <nav
          aria-label="Vistas"
          style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 'var(--radius-md)' }}
        >
          {TABS.map(({ view, label, to, Icon }) => {
            const active = view === current;
            return (
              <Link
                key={view}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={active ? undefined : 'md-hover'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 30,
                  padding: '0 var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  lineHeight: '18px',
                  fontWeight: 500,
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-muted)',
                  boxShadow: active ? 'inset 0 0 0 1px var(--line)' : undefined,
                }}
              >
                <Icon size={16} strokeWidth={1.5} color={active ? 'var(--daun)' : 'var(--ink-muted)'} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <NoteSearch />
    </header>
  );
}
