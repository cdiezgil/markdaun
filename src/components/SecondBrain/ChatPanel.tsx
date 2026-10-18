import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBrainStore } from '../../store/brainStore';
import { MessageBubble, type NoteContext } from './MessageBubble';
import { useVaultStore } from '../../store/vaultStore';
import { useEditorStore } from '../../store/editorStore';
import type { ChatAttachment as ChatAttachmentT } from '../../lib/attachments/types';
import { vaultFolders } from '../../lib/vaultFolders';
import { describeBrainError, VISION_UNSUPPORTED_MESSAGE } from '../../lib/brainErrors';
import { useLlmStore } from '../../store/llmStore';
import { supportsVision } from '../../lib/llm/vision';
import { ArrowUp, Paperclip } from 'lucide-react';
import { ScopeChip } from './ScopeChip';
import './brain.css';
import { attachmentKindOf, chatAttachmentFromAbs, MAX_ATTACHMENTS } from '../../lib/attachments/types';
import { ENTRY_MIME } from '../VaultTree/TreeNode';
import { AttachmentChips } from './AttachmentChips';
import { AttachmentPicker } from './AttachmentPicker';

const noteStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
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
  const scope = useBrainStore((s) => s.scope);
  const setScope = useBrainStore((s) => s.setScope);

  const activeConn = useLlmStore((s) => s.connections.find((c) => c.id === s.active?.connectionId));
  const activeModel = useLlmStore((s) => s.active?.model ?? '');
  const visionBlocked = pendingAttachments.length > 0 && !supportsVision(activeConn, activeModel);

  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // `/brain?ask=<vault-relative path>` (e.g. from the graph): new conversation
  // scoped to that note, composer focused, param consumed.
  const askParam = searchParams.get('ask');
  useEffect(() => {
    if (!askParam) return;
    useBrainStore.getState().askAboutNote(askParam);
    setSearchParams({}, { replace: true });
    textareaRef.current?.focus();
  }, [askParam, setSearchParams]);

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

  const send = isLoading || !input.trim() || visionBlocked;

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
      {/* Thread */}
      <div className="brain-scroll" style={{ flex: 1, overflowY: 'auto', padding: '40px var(--space-8) var(--space-6)' }}>
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
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
            <div data-testid="chat-spinner" style={{ display: 'flex', justifyContent: 'center' }}>
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
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                padding: 'var(--space-2) var(--space-3)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {describeBrainError(error)}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Floating composer */}
      <div style={{ padding: '0 var(--space-8) var(--space-6)', position: 'relative' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative' }}>
          {pickerOpen && <AttachmentPicker onPick={attach} onClose={() => setPickerOpen(false)} />}
          <div
            data-testid="chat-composer"
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--surface)',
              boxShadow: 'var(--shadow-pop)',
              padding: '12px 12px 10px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-1)',
            }}
          >
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
            <textarea
              data-testid="chat-input"
              aria-label="Pregunta a tus notas"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pregunta a tus notas…"
              disabled={isLoading}
              rows={2}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                resize: 'none',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: 0,
                fontFamily: 'var(--font-sans)',
                fontSize: 15,
                lineHeight: '22px',
                color: 'var(--ink)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                <button
                  type="button"
                  aria-label="Adjuntar archivo"
                  title="Adjuntar imagen o PDF"
                  className="md-hover"
                  onClick={() => setPickerOpen((v) => !v)}
                  disabled={isLoading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    border: 'none',
                    background: 'transparent',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    color: pickerOpen || pendingAttachments.length > 0 ? 'var(--daun)' : 'var(--ink-muted)',
                  }}
                >
                  <Paperclip size={16} strokeWidth={1.5} />
                </button>
                <ScopeChip scope={scope} onChange={(next) => void setScope(next, vaultPath)} vaultPath={vaultPath} disabled={isLoading} />
              </div>
              <button
                data-testid="chat-send-btn"
                aria-label="Enviar"
                onClick={handleSend}
                disabled={send}
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--daun)',
                  color: 'var(--on-daun)',
                  opacity: send ? 0.5 : 1,
                  cursor: send ? 'not-allowed' : 'pointer',
                }}
              >
                <ArrowUp size={18} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div
            style={{
              marginTop: 'var(--space-2)',
              textAlign: 'center',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              lineHeight: '16px',
              color: 'var(--ink-muted)',
            }}
          >
            Brain responde a partir de tus notas y cita siempre sus fuentes.
          </div>
        </div>
      </div>
    </div>
  );
}
