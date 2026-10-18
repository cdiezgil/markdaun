import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, FileText, Folder, Library } from 'lucide-react';
import { useVaultStore, type VaultEntry } from '../../store/vaultStore';
import { useEditorStore } from '../../store/editorStore';
import { vaultFolders } from '../../lib/vaultFolders';
import { toVaultRelative } from '../../lib/attachments/types';
import { scopeLabel } from '../../lib/chat/scope';
import type { QueryScope } from '../../lib/tauri';

interface ScopeChipProps {
  scope: QueryScope;
  onChange(scope: QueryScope): void;
  vaultPath: string;
  disabled?: boolean;
}

type View = 'main' | 'folders' | 'notes';

function notePaths(entries: VaultEntry[], vaultPath: string): string[] {
  return entries.flatMap((e) =>
    e.kind === 'folder'
      ? notePaths(e.children ?? [], vaultPath)
      : e.file_type === 'md'
        ? [toVaultRelative(e.path, vaultPath) ?? e.name]
        : [],
  );
}

const ITEM: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  width: '100%',
  minHeight: 32,
  padding: '0 var(--space-2)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  lineHeight: '20px',
  textAlign: 'left',
  cursor: 'pointer',
};

/** "@" context chip: shows the current scope and opens the scope menu. */
export function ScopeChip({ scope, onChange, vaultPath, disabled }: ScopeChipProps): JSX.Element {
  const tree = useVaultStore((s) => s.tree);
  const activeNote = useEditorStore((s) => s.activeNotePath);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('main');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);

  const activeRel =
    activeNote && activeNote.endsWith('.md') ? toVaultRelative(activeNote, vaultPath) : null;
  const folders = useMemo(() => vaultFolders(tree, vaultPath).filter((f) => f !== ''), [tree, vaultPath]);
  const notes = useMemo(() => notePaths(tree, vaultPath), [tree, vaultPath]);
  const shown = notes.filter((n) => n.toLowerCase().includes(search.trim().toLowerCase()));

  const close = () => {
    setOpen(false);
    setView('main');
    setSearch('');
  };
  const choose = (next: QueryScope) => {
    onChange(next);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const openMenu = () => {
    if (open) return close();
    setPicked(scope.kind === 'notes' ? scope.paths : []);
    setOpen(true);
  };

  return (
    <div ref={root} style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        data-testid="scope-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={openMenu}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          maxWidth: 360,
          padding: '0 10px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--bg)',
          color: scope.kind === 'vault' ? 'var(--ink-muted)' : 'var(--daun)',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          lineHeight: '16px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          @ {scopeLabel(scope)}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="scope-menu"
          aria-label="Contexto de Brain"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + var(--space-2))',
            left: 0,
            zIndex: 20,
            width: 300,
            maxHeight: 360,
            overflowY: 'auto',
            padding: 'var(--space-1)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-pop)',
          }}
        >
          {view === 'main' && (
            <>
              <button type="button" role="menuitem" className="md-hover" style={ITEM} onClick={() => choose({ kind: 'vault' })}>
                <Library size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
                <span style={{ flex: 1 }}>Toda la bóveda</span>
                {scope.kind === 'vault' && <Check size={14} strokeWidth={1.5} color="var(--daun)" aria-hidden="true" />}
              </button>
              <button
                type="button"
                role="menuitem"
                className="md-hover"
                disabled={!activeRel}
                style={{ ...ITEM, opacity: activeRel ? 1 : 0.5, cursor: activeRel ? 'pointer' : 'not-allowed' }}
                onClick={() => activeRel && choose({ kind: 'notes', paths: [activeRel] })}
              >
                <FileText size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
                <span style={{ flex: 1 }}>Esta nota</span>
              </button>
              <button type="button" role="menuitem" className="md-hover" style={ITEM} onClick={() => setView('folders')}>
                <Folder size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
                <span style={{ flex: 1 }}>Carpeta…</span>
                <ChevronRight size={14} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
              </button>
              <button type="button" role="menuitem" className="md-hover" style={ITEM} onClick={() => setView('notes')}>
                <FileText size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
                <span style={{ flex: 1 }}>Notas…</span>
                <ChevronRight size={14} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
              </button>
            </>
          )}

          {view === 'folders' &&
            (folders.length === 0 ? (
              <div style={{ ...ITEM, color: 'var(--ink-muted)', cursor: 'default' }}>No hay carpetas</div>
            ) : (
              folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="menuitem"
                  className="md-hover"
                  style={ITEM}
                  onClick={() => choose({ kind: 'folder', path: f })}
                >
                  <Folder size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                </button>
              ))
            ))}

          {view === 'notes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <input
                aria-label="Buscar notas"
                placeholder="Buscar notas"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{
                  height: 32,
                  padding: '0 10px',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {shown.map((n) => (
                  <label key={n} className="md-hover" style={{ ...ITEM, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      aria-label={n}
                      checked={picked.includes(n)}
                      onChange={() =>
                        setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))
                      }
                      style={{ accentColor: 'var(--daun)' }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.replace(/\.md$/i, '')}
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={picked.length === 0}
                onClick={() => choose({ kind: 'notes', paths: notes.filter((n) => picked.includes(n)) })}
                style={{
                  height: 32,
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--daun)',
                  color: 'var(--on-daun)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: picked.length === 0 ? 0.5 : 1,
                  cursor: picked.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Aplicar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
