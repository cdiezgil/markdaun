import React, { useEffect, useState } from 'react';
import { chatWriteNote } from '../../lib/tauri';
import { humanizeNoteError } from './noteErrors';

export interface SaveAsNoteDialogProps {
  open: boolean;
  /** Assistant message content to save. */
  content: string;
  conversationTitle: string;
  /** Vault-relative folders ('' is the root). */
  folders: string[];
  /** Vault-relative paths of the source notes. */
  sources: string[];
  vaultPath: string;
  onClose(): void;
  /** Called with the absolute path after a successful write. */
  onSaved(absolutePath: string): void;
}

export function slugify(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'nota';
}

function wikilink(path: string): string {
  const base = path.split('/').pop() ?? path;
  return `[[${base.replace(/\.[^/.]+$/, '')}]]`;
}

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--bg)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--space-3)',
};

export function SaveAsNoteDialog({
  open,
  content,
  conversationTitle,
  folders,
  sources,
  vaultPath,
  onClose,
  onSaved,
}: SaveAsNoteDialogProps): JSX.Element | null {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [includeSources, setIncludeSources] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(`${slugify(conversationTitle)}.md`);
      setFolder('');
      setIncludeSources(false);
      setError(null);
      setExists(false);
      setBusy(false);
    }
  }, [open, conversationTitle]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fileName = name.trim().toLowerCase().endsWith('.md') ? name.trim() : `${name.trim()}.md`;
  const relPath = folder ? `${folder}/${fileName}` : fileName;
  const body =
    includeSources && sources.length > 0
      ? `${content}\n\n## Fuentes\n\n${sources.map((s) => `- ${wikilink(s)}`).join('\n')}\n`
      : content;

  const save = async (mode: 'create' | 'append') => {
    if (!name.trim()) {
      setError('El nombre del archivo es obligatorio.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const abs = await chatWriteNote(relPath, body, mode, vaultPath);
      onSaved(abs);
    } catch (e) {
      setExists(e === 'already_exists');
      setError(humanizeNoteError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--selection)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-note-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save('create');
        }}
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-pop)',
          padding: 'var(--space-6)',
          minWidth: 340,
          maxWidth: 480,
          fontFamily: 'var(--font-sans)',
          color: 'var(--ink)',
        }}
      >
        <p id="save-note-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          Guardar como nota
        </p>
        <label style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          Nombre del archivo
          <input
            data-testid="save-note-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
              setExists(false);
            }}
            style={field}
          />
        </label>
        <label style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          Carpeta
          <select
            data-testid="save-note-folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            style={field}
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                {f === '' ? '/ (raíz de la bóveda)' : f}
              </option>
            ))}
          </select>
        </label>
        {sources.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
            <input
              type="checkbox"
              data-testid="save-note-sources"
              checked={includeSources}
              onChange={(e) => setIncludeSources(e.target.checked)}
            />
            Incluir fuentes
          </label>
        )}
        {error && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 'var(--space-3)' }}>
            {error}{' '}
            {exists && (
              <button
                type="button"
                onClick={() => void save('append')}
                style={{ background: 'transparent', border: 'none', color: 'var(--daun)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
              >
                Añadir al final en su lugar
              </button>
            )}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="save-note-cancel"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--ink)', cursor: 'pointer', padding: 'var(--space-2) var(--space-4)', fontSize: 14 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            data-testid="save-note-submit"
            disabled={busy}
            style={{ background: 'var(--daun)', color: 'var(--on-daun)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: 'var(--space-2) var(--space-4)', fontSize: 14, fontWeight: 500 }}
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
