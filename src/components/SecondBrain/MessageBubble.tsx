import React, { useState } from 'react';
import type { BrainMessage } from '../../store/brainStore';
import { FilePlus, FileText, Leaf } from 'lucide-react';
import { describeBrainWarning } from '../../lib/brainErrors';
import { parseNoteBlocks } from '../../lib/chat/noteBlocks';
import { useNoteProposalStore } from '../../store/noteProposalStore';
import { NoteProposalCard } from './NoteProposalCard';
import { SaveAsNoteDialog } from './SaveAsNoteDialog';
import { AssistantMarkdown } from './AssistantMarkdown';

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
      folders={ctx.folders}
      onStatusChange={(status, absolutePath) => setState(stateKey, { status, absolutePath })}
      onWritten={() => ctx.onNoteWritten()}
      onOpen={ctx.onOpenNote}
    />
  );
}

function filenameWithoutExt(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^/.]+$/, '');
}

const SMALL: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  lineHeight: '16px',
};

const GHOST_BUTTON: React.CSSProperties = {
  ...SMALL,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  height: 28,
  padding: '0 10px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink-muted)',
  fontWeight: 500,
  cursor: 'pointer',
};

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
  const sources = message.sources ?? [];

  if (isUser) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div
          data-testid="msg-bubble-user"
          style={{
            maxWidth: '70%',
            padding: '10px 14px',
            borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)',
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            lineHeight: '20px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>
        {message.failed && (
          <div
            data-testid="msg-failed"
            style={{ ...SMALL, marginTop: 'var(--space-1)', color: 'var(--danger)' }}
          >
            No enviado
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 15,
        lineHeight: '26px',
        color: 'var(--ink)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          ...SMALL,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-2)',
          fontWeight: 500,
          color: 'var(--ink-muted)',
        }}
      >
        <Leaf size={12} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
        Brain
      </div>

      {showBubble && (
        <div data-testid="msg-bubble-assistant">
          <AssistantMarkdown
            content={hasNotes ? text.trim() : message.content}
            onOpenNote={onSourceClick}
          />
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

      {message.warning && (
        <div
          data-testid="msg-warning"
          style={{ ...SMALL, marginTop: 'var(--space-1)', color: 'var(--ink-muted)' }}
        >
          {describeBrainWarning(message.warning)}
        </div>
      )}

      {(sources.length > 0 || noteContext) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginTop: 14,
          }}
        >
          {sources.length > 0 && <span style={{ ...SMALL, color: 'var(--ink-muted)' }}>Fuentes</span>}
          {sources.map((src, idx) => (
            <button
              key={src}
              type="button"
              data-testid={`msg-source-${idx}`}
              title={src}
              onClick={() => onSourceClick(src)}
              className="md-hover"
              style={{
                ...SMALL,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 10px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <FileText size={13} strokeWidth={1.5} color="var(--daun)" aria-hidden="true" />
              {filenameWithoutExt(src)}
            </button>
          ))}
          <span aria-hidden="true" style={{ flex: 1 }} />
          {noteContext &&
            (savedPath ? (
              <span style={{ ...SMALL, color: 'var(--ink-muted)' }}>
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
                type="button"
                className="md-hover"
                onClick={() => setSaveOpen(true)}
                style={GHOST_BUTTON}
              >
                <FilePlus size={14} strokeWidth={1.5} /> Guardar como nota
              </button>
            ))}
        </div>
      )}

      {noteContext && (
        <SaveAsNoteDialog
          open={saveOpen}
          content={message.content}
          conversationTitle={noteContext.conversationTitle}
          folders={noteContext.folders}
          sources={sources}
          vaultPath={noteContext.vaultPath}
          onClose={() => setSaveOpen(false)}
          onSaved={(abs) => {
            setSaveOpen(false);
            setSavedPath(abs);
            noteContext.onNoteWritten();
          }}
        />
      )}
    </div>
  );
}
