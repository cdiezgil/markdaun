import React, { useState } from 'react';
import type { BrainMessage } from '../../store/brainStore';
import { FilePlus } from 'lucide-react';
import { describeBrainWarning } from '../../lib/brainErrors';
import { parseNoteBlocks } from '../../lib/chat/noteBlocks';
import { useNoteProposalStore } from '../../store/noteProposalStore';
import { NoteProposalCard } from './NoteProposalCard';
import { SaveAsNoteDialog } from './SaveAsNoteDialog';

/** Vault context that enables note proposals and "Guardar como nota". */
export interface NoteContext {
  vaultPath: string;
  conversationTitle: string;
  /** Vault-relative folders ('' is the root). */
  folders: string[];
  onOpenNote(absolutePath: string): void;
  /** Called after any successful write (refresh the vault tree). */
  onNoteWritten(): void;
}

export interface MessageBubbleProps {
  message: BrainMessage;
  onSourceClick(path: string): void;
  noteContext?: NoteContext;
}

function ProposalCard({
  stateKey,
  proposal,
  ctx,
}: {
  stateKey: string;
  proposal: { path: string; mode: 'create' | 'append'; content: string };
  ctx: NoteContext;
}): JSX.Element {
  const saved = useNoteProposalStore((s) => s.states[stateKey]);
  const setState = useNoteProposalStore((s) => s.set);
  return (
    <NoteProposalCard
      proposal={proposal}
      vaultPath={ctx.vaultPath}
      initialStatus={saved?.status}
      initialAbsolutePath={saved?.absolutePath}
      onStatusChange={(status, absolutePath) => setState(stateKey, { status, absolutePath })}
      onWritten={() => ctx.onNoteWritten()}
      onOpen={ctx.onOpenNote}
    />
  );
}

const SUPERSCRIPT_NUMS = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

function filenameWithoutExt(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^/.]+$/, '');
}

export function MessageBubble({ message, onSourceClick, noteContext }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const segments =
    !isUser && noteContext
      ? parseNoteBlocks(message.content)
      : [{ type: 'text' as const, text: message.content }];
  const hasNotes = segments.some((s) => s.type === 'note');
  const text = segments
    .filter((s): s is { type: 'text'; text: string } => s.type === 'text')
    .map((s) => s.text)
    .join('');
  const showBubble = !hasNotes || text.trim() !== '';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 'var(--space-3)',
      }}
    >
      {showBubble && (
      <div
        data-testid={`msg-bubble-${message.role}`}
        style={{
          background: isUser ? 'var(--daun)' : 'var(--surface)',
          color: isUser ? 'var(--on-daun)' : 'var(--ink)',
          border: isUser ? 'none' : '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--mono)',
          fontSize: '0.875rem',
          maxWidth: '80%',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {hasNotes ? text.trim() : message.content}
      </div>
      )}

      {noteContext &&
        segments.map((seg, i) =>
          seg.type === 'note' ? (
            <ProposalCard
              key={i}
              stateKey={`${message.id}:${i}`}
              proposal={seg}
              ctx={noteContext}
            />
          ) : null,
        )}

      {!isUser && noteContext && (
        <div style={{ marginTop: 'var(--space-1)', fontSize: '0.75rem', fontFamily: 'var(--sans)' }}>
          {savedPath ? (
            <span style={{ color: 'var(--ink-muted)' }}>
              ✓ Guardada ·{' '}
              <button
                onClick={() => noteContext.onOpenNote(savedPath)}
                style={{ background: 'transparent', border: 'none', color: 'var(--daun)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
              >
                Abrir
              </button>
            </span>
          ) : (
            <button
              data-testid="msg-save-as-note"
              onClick={() => setSaveOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', background: 'transparent', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer', font: 'inherit', padding: 0 }}
            >
              <FilePlus size={14} strokeWidth={1.5} /> Guardar como nota
            </button>
          )}
          <SaveAsNoteDialog
            open={saveOpen}
            content={message.content}
            conversationTitle={noteContext.conversationTitle}
            folders={noteContext.folders}
            sources={message.sources ?? []}
            vaultPath={noteContext.vaultPath}
            onClose={() => setSaveOpen(false)}
            onSaved={(abs) => {
              setSaveOpen(false);
              setSavedPath(abs);
              noteContext.onNoteWritten();
            }}
          />
        </div>
      )}

      {isUser && message.failed && (
        <div
          data-testid="msg-failed"
          style={{
            marginTop: 'var(--space-1)',
            fontSize: '0.75rem',
            color: 'var(--danger)',
            fontFamily: 'var(--sans)',
          }}
        >
          No enviado
        </div>
      )}

      {!isUser && message.warning && (
        <div
          data-testid="msg-warning"
          style={{
            marginTop: 'var(--space-1)',
            fontSize: '0.75rem',
            color: 'var(--ink-muted)',
            fontFamily: 'var(--sans)',
          }}
        >
          {describeBrainWarning(message.warning)}
        </div>
      )}

      {/* Source citations — only for assistant messages with sources */}
      {!isUser && message.sources && message.sources.length > 0 && (
        <div
          style={{
            marginTop: 'var(--space-1)',
            fontSize: '0.75rem',
            color: 'var(--ink-muted)',
            fontFamily: 'var(--sans)',
          }}
        >
          Fuentes:{' '}
          {message.sources.map((src, idx) => (
            <React.Fragment key={src}>
              <sup
                data-testid={`msg-source-${idx}`}
                onClick={() => onSourceClick(src)}
                style={{
                  cursor: 'pointer',
                  color: 'var(--daun)',
                  marginRight: 'var(--space-1)',
                  userSelect: 'none',
                }}
                title={src}
              >
                {SUPERSCRIPT_NUMS[idx] ?? `[${idx + 1}]`}
              </sup>
              {' '}
              <span
                style={{ cursor: 'pointer', color: 'var(--daun)' }}
                onClick={() => onSourceClick(src)}
              >
                {filenameWithoutExt(src)}
              </span>
              {idx < message.sources!.length - 1 ? '  ' : ''}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
