import React, { useEffect } from 'react';
import { useVaultStore, type VaultEntry } from '../../store/vaultStore';
import {
  attachmentKindOf,
  chatAttachmentFromAbs,
  toVaultRelative,
  type ChatAttachment,
} from '../../lib/attachments/types';

interface Props {
  onPick(a: ChatAttachment): void;
  onClose(): void;
}

function flatten(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((e) => (e.kind === 'folder' ? flatten(e.children ?? []) : [e]));
}

/** Popover listing the vault's images and PDFs. */
export function AttachmentPicker({ onPick, onClose }: Props): JSX.Element {
  const tree = useVaultStore((s) => s.tree);
  const vaultPath = useVaultStore((s) => s.vaultPath) ?? '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const files = flatten(tree)
    .filter((e) => attachmentKindOf(e.path) !== null)
    .map((e) => ({ entry: e, rel: toVaultRelative(e.path, vaultPath) ?? e.name }));

  return (
    <div
      role="dialog"
      aria-label="Adjuntar archivo"
      data-testid="attachment-picker"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 'var(--space-3)',
        marginBottom: 'var(--space-2)',
        width: 320,
        maxHeight: 280,
        overflowY: 'auto',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-pop)',
        padding: 'var(--space-1)',
        zIndex: 10,
      }}
    >
      {files.length === 0 ? (
        <p style={{ margin: 'var(--space-3)', color: 'var(--ink-muted)', fontFamily: 'var(--sans)', fontSize: '0.875rem' }}>
          No hay imágenes ni PDFs en la bóveda.
        </p>
      ) : (
        files.map(({ entry, rel }) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => {
              const att = chatAttachmentFromAbs(entry.path, vaultPath);
              if (att) onPick(att);
              onClose();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              background: 'transparent',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--sans)',
              fontSize: '0.875rem',
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {rel}
          </button>
        ))
      )}
    </div>
  );
}
