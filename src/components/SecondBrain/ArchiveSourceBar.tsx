import React from 'react';
import { Archive } from 'lucide-react';

export interface ArchiveSourceBarProps {
  /** Vault-relative current location of the source. */
  source: string;
  archived: boolean;
  archiving: boolean;
  /** Folder of the first accepted note; null while no card was accepted. */
  targetFolder: string | null;
  onArchive(targetFolder: string): void;
}

const TEXT: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--ink-muted)',
};

/** Digestion conversations: archive the original once a note was accepted. */
export function ArchiveSourceBar({ source, archived, archiving, targetFolder, onArchive }: ArchiveSourceBarProps): JSX.Element {
  const name = source.split('/').pop() ?? source;
  const destination = targetFolder === null ? null : `${targetFolder ? `${targetFolder}/` : ''}Fuentes`;
  return (
    <div
      data-testid="archive-source-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface)',
        marginBottom: 'var(--space-2)',
      }}
    >
      {archived ? (
        <span style={TEXT}>Fuente archivada · {source}</span>
      ) : (
        <>
          <span style={TEXT}>
            Fuente: {name}
            {destination ? ` → ${destination}` : ' · acepta una nota para poder archivarla'}
          </span>
          <button
            data-testid="archive-source"
            disabled={targetFolder === null || archiving}
            onClick={() => targetFolder !== null && onArchive(targetFolder)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              height: 28,
              padding: '0 var(--space-3)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              cursor: targetFolder === null || archiving ? 'not-allowed' : 'pointer',
              opacity: targetFolder === null || archiving ? 0.5 : 1,
            }}
          >
            <Archive size={14} strokeWidth={1.5} /> Archivar fuente
          </button>
        </>
      )}
    </div>
  );
}
