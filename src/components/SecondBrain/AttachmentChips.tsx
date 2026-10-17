import React from 'react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import type { ChatAttachment } from '../../lib/attachments/types';

interface Props {
  attachments: ChatAttachment[];
  onRemove(vaultPath: string): void;
}

/** Attachments queued for the next message, shown above the input. */
export function AttachmentChips({ attachments, onRemove }: Props): JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <div
      data-testid="attachment-chips"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}
    >
      {attachments.map((a) => (
        <span
          key={a.vaultPath}
          data-testid={`chip-${a.name}`}
          data-kind={a.kind}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            maxWidth: 220,
            padding: '2px var(--space-2)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-pill)',
            fontFamily: 'var(--sans)',
            fontSize: '0.8125rem',
            color: 'var(--ink)',
          }}
        >
          {a.kind === 'pdf' ? (
            <FileText size={16} strokeWidth={1.5} color="var(--ink-muted)" />
          ) : (
            <ImageIcon size={16} strokeWidth={1.5} color="var(--ink-muted)" />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <button
            type="button"
            aria-label={`Quitar ${a.name}`}
            onClick={() => onRemove(a.vaultPath)}
            style={{
              display: 'inline-flex',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--ink-muted)',
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </span>
      ))}
    </div>
  );
}
