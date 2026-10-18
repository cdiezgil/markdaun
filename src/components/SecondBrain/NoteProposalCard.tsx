import React, { useEffect, useRef, useState } from 'react';
import { FilePlus, FileText } from 'lucide-react';
import { chatWriteNote, noteExists, readNoteTail } from '../../lib/tauri';
import type { NoteMode } from '../../lib/chat/noteBlocks';
import { humanizeNoteError } from './noteErrors';
import { isNewFolder } from '../../lib/chat/digest';

export interface NoteProposal {
  path: string;
  mode: NoteMode;
  content: string;
  /** The path was rewritten into the area chosen for the digestion. */
  adjusted?: boolean;
}

export type ProposalStatus = 'pending' | 'created' | 'appended' | 'discarded';

export interface NoteProposalCardProps {
  proposal: NoteProposal;
  vaultPath: string;
  /** Open the written note (absolute path). */
  onOpen(absolutePath: string): void;
  /** Called after a successful write so the caller can refresh the vault tree. */
  onWritten?(absolutePath: string, mode: NoteMode): void;
  initialStatus?: ProposalStatus;
  initialAbsolutePath?: string;
  /** Vault-relative folders ('' = root); enables the "carpeta nueva" badge. */
  folders?: string[];
  /** Lets the parent keep per-message state in memory. */
  onStatusChange?(status: ProposalStatus, absolutePath?: string): void;
}

const TAIL_LINES = 8;

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  margin: 'var(--space-2) 0',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  color: 'var(--ink)',
  maxWidth: '80%',
};

const monoBlock: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-sm)',
};

const btn = (primary: boolean): React.CSSProperties => ({
  background: primary ? 'var(--daun)' : 'transparent',
  color: primary ? 'var(--on-daun)' : 'var(--ink)',
  border: primary ? 'none' : '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-1) var(--space-3)',
  fontSize: 13,
  cursor: 'pointer',
});

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--daun)',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
};

export function NoteProposalCard({
  proposal,
  vaultPath,
  onOpen,
  onWritten,
  initialStatus = 'pending',
  initialAbsolutePath,
  folders,
  onStatusChange,
}: NoteProposalCardProps): JSX.Element {
  const [path, setPath] = useState(proposal.path);
  const [mode, setMode] = useState<NoteMode>(proposal.mode);
  const [status, setStatus] = useState<ProposalStatus>(initialStatus);
  const [absPath, setAbsPath] = useState<string | undefined>(initialAbsolutePath);
  const [exists, setExists] = useState<boolean | null>(null);
  const [tail, setTail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pathRef = useRef<HTMLInputElement>(null);

  const validPath = path.trim().toLowerCase().endsWith('.md');

  useEffect(() => {
    if (status !== 'pending' || !validPath) {
      setExists(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ex = await noteExists(path.trim(), vaultPath);
        if (cancelled) return;
        setExists(ex);
        if (mode === 'append' && ex) {
          const t = await readNoteTail(path.trim(), vaultPath, TAIL_LINES);
          if (!cancelled) setTail(t);
        } else if (!cancelled) {
          setTail('');
        }
      } catch {
        if (!cancelled) setExists(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, mode, status, vaultPath, validPath]);

  const finish = (s: ProposalStatus, abs?: string) => {
    setStatus(s);
    if (abs) setAbsPath(abs);
    onStatusChange?.(s, abs);
  };

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const abs = await chatWriteNote(path.trim(), proposal.content, mode, vaultPath);
      onWritten?.(abs, mode);
      finish(mode === 'create' ? 'created' : 'appended', abs);
    } catch (e) {
      setError(humanizeNoteError(e));
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'pending') {
    return (
      <div data-testid="proposal-done" style={{ ...cardStyle, color: 'var(--ink-muted)' }}>
        {status === 'discarded' ? (
          'Descartada'
        ) : (
          <>
            ✓ {status === 'created' ? 'Creada' : 'Añadida'} ·{' '}
            <button style={linkBtn} onClick={() => absPath && onOpen(absPath)}>
              Abrir
            </button>
          </>
        )}
      </div>
    );
  }

  const newFolder = mode === 'create' && !!folders && validPath && isNewFolder(path, folders);
  const createExists = mode === 'create' && exists === true;
  const appendMissing = mode === 'append' && exists === false;

  return (
    <div data-testid="note-proposal" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        {mode === 'create' ? (
          <FilePlus size={16} strokeWidth={1.5} color="var(--daun)" />
        ) : (
          <FileText size={16} strokeWidth={1.5} color="var(--daun)" />
        )}
        <input
          ref={pathRef}
          data-testid="proposal-path"
          aria-label="Ruta de la nota"
          value={path}
          readOnly={mode === 'append'}
          onChange={(e) => {
            setPath(e.target.value);
            setError(null);
          }}
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--ink)',
            background: 'var(--bg)',
            border: `1px solid ${validPath ? 'var(--line-strong)' : 'var(--danger)'}`,
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-1) var(--space-2)',
          }}
        />
        {newFolder && (
          <span
            data-testid="new-folder-badge"
            title="Esta carpeta aún no existe: se creará al aceptar."
            style={{
              flexShrink: 0,
              padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--sap)',
              color: 'var(--on-sap)',
              fontSize: 11,
              lineHeight: '18px',
            }}
          >
            carpeta nueva
          </span>
        )}
      </div>

      {proposal.adjusted && (
        <p data-testid="proposal-adjusted" style={{ margin: '0 0 var(--space-2)', color: 'var(--ink-muted)', fontSize: 12 }}>
          Ruta ajustada al área
        </p>
      )}
      {mode === 'append' && tail && (
        <pre data-testid="proposal-tail" style={{ ...monoBlock, color: 'var(--ink-muted)' }}>
          {tail}
        </pre>
      )}
      <pre
        data-testid="proposal-preview"
        style={{
          ...monoBlock,
          background: mode === 'append' ? 'var(--mark)' : 'var(--bg)',
          color: 'var(--ink)',
        }}
      >
        {proposal.content}
      </pre>

      {createExists && (
        <p style={{ margin: 'var(--space-2) 0', color: 'var(--amber)' }}>
          Ya existe{' '}
          <button style={linkBtn} onClick={() => pathRef.current?.focus()}>
            Renombrar
          </button>{' '}
          <button style={linkBtn} onClick={() => setMode('append')}>
            Añadir al final en su lugar
          </button>
        </p>
      )}
      {appendMissing && (
        <p style={{ margin: 'var(--space-2) 0', color: 'var(--amber)' }}>
          La nota no existe{' '}
          <button style={linkBtn} onClick={() => setMode('create')}>
            Crear en su lugar
          </button>
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: 'var(--space-2) 0', color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        {!createExists && !appendMissing && (
          <button
            data-testid="proposal-accept"
            style={btn(true)}
            disabled={busy || !validPath}
            onClick={() => void accept()}
          >
            {mode === 'create' ? 'Crear' : 'Añadir al final'}
          </button>
        )}
        <button data-testid="proposal-discard" style={btn(false)} onClick={() => finish('discarded')}>
          Descartar
        </button>
      </div>
    </div>
  );
}
