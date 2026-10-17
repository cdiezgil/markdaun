import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrainStore } from '../../store/brainStore';
import { MessageBubble, type NoteContext } from './MessageBubble';
import { useVaultStore } from '../../store/vaultStore';
import { useEditorStore } from '../../store/editorStore';
import type { ChatAttachment as ChatAttachmentT } from '../../lib/attachments/types';
import { vaultFolders } from '../../lib/vaultFolders';
import { describeBrainError, VISION_UNSUPPORTED_MESSAGE } from '../../lib/brainErrors';
import { useLlmStore } from '../../store/llmStore';
import { supportsVision } from '../../lib/llm/vision';
import { Paperclip } from 'lucide-react';
import { attachmentKindOf, chatAttachmentFromAbs, MAX_ATTACHMENTS } from '../../lib/attachments/types';
import { ENTRY_MIME } from '../VaultTree/TreeNode';
import { AttachmentChips } from './AttachmentChips';
import { AttachmentPicker } from './AttachmentPicker';

const noteStyle: React.CSSProperties = {
  fontFamily: 'var(--sans)',
  fontSize: '0.8125rem',
  color: 'var(--ink-muted)',
};

interface ChatPanelProps {
  vaultPath: string;
}

export function ChatPanel({ vaultPath }: ChatPanelProps): JSX.Element {
  const messages = useBrainStore((s) => s.messages);
  const isLoading = useBrainStore((s) => s.isLoading);
  const error = useBrainStore((s) => s.error);
  const query = useBrainStore((s) => s.query);
  const pendingAttachments = useBrainStore((s) => s.pendingAttachments);
  const notices = useBrainStore((s) => s.notices);
  const pendingPrompt = useBrainStore((s) => s.pendingPrompt);
  const addAttachment = useBrainStore((s) => s.addAttachment);
  const removeAttachment = useBrainStore((s) => s.removeAttachment);

  const activeConn = useLlmStore((s) => s.connections.find((c) => c.id === s.active?.connectionId));
  const activeModel = useLlmStore((s) => s.active?.model ?? '');
  const visionBlocked = pendingAttachments.length > 0 && !supportsVision(activeConn, activeModel);

  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = messagesEndRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Auto-resize textarea (up to 5 lines).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 20;
    const maxH = lineHeight * 5 + 16; // 5 lines + padding
    ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`;
  }, [input]);

  // A prompt handed over by another view (preview / note actions): consume once.
  useEffect(() => {
    if (!pendingPrompt) return;
    const { text, send } = pendingPrompt;
    useBrainStore.getState().consumePendingPrompt();
    if (send && !visionBlocked) {
      void query(text, vaultPath);
    } else {
      setInput(text);
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const attach = (a: ChatAttachmentT) => {
    const r = addAttachment(a);
    setHint(r === 'limit' ? `Máximo ${MAX_ATTACHMENTS} adjuntos por mensaje.` : null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes(ENTRY_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    const path = e.dataTransfer.getData(ENTRY_MIME);
    if (!path) return;
    e.preventDefault();
    if (!attachmentKindOf(path)) {
      setHint('Solo se pueden adjuntar imágenes y PDFs.');
      return;
    }
    const a = chatAttachmentFromAbs(path, vaultPath);
    if (a) attach(a);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading || visionBlocked) return;
    setInput('');
    await query(text, vaultPath);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleSourceClick = (path: string) => {
    navigate(`/editor/${encodeURIComponent(path)}`);
  };

  const tree = useVaultStore((s) => s.tree);
  const conversationTitle = useBrainStore(
    (s) => s.conversations.find((c) => c.id === s.currentConversationId)?.title ?? 'nota',
  );
  const noteContext: NoteContext = {
    vaultPath,
    conversationTitle,
    folders: vaultFolders(tree, vaultPath),
    onOpenNote: handleSourceClick,
    onNoteWritten: () => {
      void useVaultStore.getState().refreshTree();
      void useEditorStore.getState().initVault().catch(() => {});
    },
  };

  return (
    <div
      data-testid="chat-panel"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onSourceClick={handleSourceClick}
            noteContext={noteContext}
          />
        ))}

        {isLoading && (
          <div
            data-testid="chat-spinner"
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 'var(--space-4)',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                border: '2px solid var(--line)',
                borderTopColor: 'var(--daun)',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }}
            />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && (
          <div
            data-testid="chat-error"
            role="alert"
            style={{
              color: 'var(--danger)',
              fontFamily: 'var(--sans)',
              fontSize: '0.875rem',
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 'var(--space-3)',
            }}
          >
            {describeBrainError(error)}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div
        style={{
          padding: 'var(--space-3)',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          background: 'var(--bg)',
          position: 'relative',
        }}
      >
        {pickerOpen && <AttachmentPicker onPick={attach} onClose={() => setPickerOpen(false)} />}
        <AttachmentChips attachments={pendingAttachments} onRemove={removeAttachment} />
        {notices.length > 0 && (
          <div data-testid="chat-notices" style={noteStyle}>
            {notices.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
        )}
        {hint && (
          <div data-testid="attachment-hint" role="status" style={noteStyle}>
            {hint}
          </div>
        )}
        {visionBlocked && (
          <div data-testid="vision-warning" role="alert" style={{ ...noteStyle, color: 'var(--danger)' }}>
            {VISION_UNSUPPORTED_MESSAGE}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <button
          type="button"
          aria-label="Adjuntar archivo"
          title="Adjuntar imagen o PDF"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={isLoading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: pickerOpen || pendingAttachments.length > 0 ? 'var(--daun)' : 'var(--ink-muted)',
          }}
        >
          <Paperclip size={20} strokeWidth={1.5} />
        </button>
        <textarea
          data-testid="chat-input"
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pregunta a tus notas…"
          disabled={isLoading}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-3)',
            fontFamily: 'var(--mono)',
            fontSize: '0.875rem',
            color: 'var(--ink)',
            outline: 'none',
            lineHeight: '1.5',
            overflow: 'hidden',
          }}
        />
        <button
          data-testid="chat-send-btn"
          onClick={handleSend}
          disabled={isLoading || !input.trim() || visionBlocked}
          style={{
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-4)',
            fontFamily: 'var(--sans)',
            fontWeight: 500,
            fontSize: '0.875rem',
            cursor: isLoading || !input.trim() || visionBlocked ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          Enviar
        </button>
        </div>
      </div>
    </div>
  );
}
