import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import {
  countBytes,
  countLines,
  countWords,
  formatBytes,
  readingTime,
} from '../../lib/noteStats';

const DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function relativePath(abs: string, vault: string | null): string {
  if (vault && abs.startsWith(vault)) return abs.slice(vault.length).replace(/^[\\/]+/, '');
  return abs;
}

/** Middle-truncate a long path, keeping the file name visible. */
function truncateMiddle(p: string, max = 48): string {
  if (p.length <= max) return p;
  const keep = max - 1;
  const head = Math.ceil(keep / 3);
  return `${p.slice(0, head)}…${p.slice(p.length - (keep - head))}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function NoteStats(): JSX.Element | null {
  const path = useEditorStore((s) => s.activeNotePath);
  const vaultPath = useEditorStore((s) => s.vaultPath);
  const content = useEditorStore((s) => s.activeNoteContent);
  const selection = useEditorStore((s) => s.selectionText);

  const md = useDebounced(content ?? '', DEBOUNCE_MS);
  const sel = useDebounced(selection, DEBOUNCE_MS);

  if (!path) return null;

  const rel = relativePath(path, vaultPath);
  const words = countWords(md);
  const selWords = sel ? countWords(sel) : 0;
  const bytes = countBytes(md);
  const lines = countLines(md);

  const wordsLabel = selWords > 0 ? `${selWords} / ${words}` : `${words}`;
  const wordsNoun = plural(words, 'palabra', 'palabras');

  return (
    <div data-testid="note-stats" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <button
        data-testid="note-path"
        title={path}
        onClick={() => void navigator.clipboard?.writeText(rel)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        {truncateMiddle(rel)}
      </button>
      <span data-testid="stat-words">{wordsLabel} {wordsNoun}</span>
      <span data-testid="stat-bytes" title={`${bytes} bytes`}>{formatBytes(bytes)}</span>
      <span data-testid="stat-lines">{lines} {plural(lines, 'línea', 'líneas')}</span>
      <span data-testid="stat-reading">{readingTime(words)}</span>
    </div>
  );
}
