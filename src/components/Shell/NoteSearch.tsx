import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useVaultStore, type VaultEntry } from '../../store/vaultStore';
import { useFileNavigation } from '../../hooks/useFileNavigation';
import { searchNotes, type NoteSearchResult } from '../../lib/fuzzy';

const MAX_RESULTS = 20;

function markdownNotes(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((e) =>
    e.kind === 'folder'
      ? markdownNotes(e.children ?? [])
      : e.file_type === 'md' || (!e.file_type && e.name.toLowerCase().endsWith('.md'))
        ? [e]
        : [],
  );
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);
}

/** Splits `text` into runs, wrapping the characters at `indices` in <mark>. */
function Highlighted({ text, indices }: { text: string; indices: number[] }): JSX.Element {
  if (indices.length === 0) return <>{text}</>;
  const hit = new Set(indices);
  const runs: Array<{ hit: boolean; text: string }> = [];
  Array.from(text).reduce((pos, ch) => {
    const h = hit.has(pos);
    const last = runs[runs.length - 1];
    if (last && last.hit === h) last.text += ch;
    else runs.push({ hit: h, text: ch });
    return pos + ch.length;
  }, 0);
  return (
    <>
      {runs.map((r, i) =>
        r.hit ? (
          <mark
            key={i}
            style={{ background: 'var(--mark)', color: 'inherit', fontWeight: 600 }}
          >
            {r.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{r.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * Top-bar note search (⌘K / Ctrl+K). Fuzzy-matches `.md` notes by name and
 * path. An empty query shows no dropdown (nothing is suggested until typing).
 */
export function NoteSearch(): JSX.Element {
  const tree = useVaultStore((s) => s.tree);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const selectNoteLocation = useVaultStore((s) => s.selectNoteLocation);
  const { navigateToFile } = useFileNavigation();

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const notes = useMemo(() => markdownNotes(tree), [tree]);
  const results = useMemo(
    () => searchNotes(query, notes, vaultPath, MAX_RESULTS),
    [query, notes, vaultPath],
  );
  const open = focused && query.trim() !== '';
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    // Capture so it also fires while the editor (or any input) has focus.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  function close() {
    setQuery('');
    setActive(0);
  }

  function openResult(r: NoteSearchResult) {
    const entry = notes.find((n) => n.path === r.item.path);
    if (!entry) return;
    selectNoteLocation(entry.path);
    navigateToFile(entry);
    close();
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      openResult(results[active]);
    }
  }

  return (
    <div
      data-testid="search-field"
      style={{ position: 'relative', width: 280, maxWidth: '100%', flexShrink: 0 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          height: 32,
          padding: '0 10px',
          background: 'var(--bg)',
          border: '1px solid',
          borderColor: focused ? 'var(--focus)' : 'var(--line)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--ink-muted)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
        }}
      >
        <Search size={16} strokeWidth={1.5} color="var(--ink-muted)" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Buscar notas"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? optionId(active) : undefined}
          placeholder="Buscar notas…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--ink)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
          }}
        />
        <span
          aria-hidden="true"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 500,
            lineHeight: '16px',
            padding: '1px 6px',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)',
          }}
        >
          {isMac() ? '⌘K' : 'Ctrl K'}
        </span>
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Resultados"
          className="md-pop"
          style={{
            position: 'absolute',
            top: 38,
            right: 0,
            zIndex: 50,
            width: 420,
            maxWidth: '90vw',
            maxHeight: 360,
            overflowY: 'auto',
            margin: 0,
            padding: 'var(--space-1)',
            listStyle: 'none',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-pop)',
          }}
        >
          {results.length === 0 ? (
            <li
              style={{
                padding: 'var(--space-2) var(--space-3)',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--ink-muted)',
              }}
            >
              Sin resultados
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.item.path}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // mouseDown (not click) so it fires before the input blurs and closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  openResult(r);
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: '6px var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: i === active ? 'var(--selection)' : 'transparent',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink)' }}>
                  <Highlighted text={r.title} indices={r.titleIndices} />
                </span>
                {r.dir && (
                  <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--ink-muted)' }}>
                    <Highlighted text={r.dir} indices={r.dirIndices} />
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
