import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrainStore } from '../../store/brainStore';
import { MessageBubble } from './MessageBubble';
import { describeBrainError } from '../../lib/brainErrors';

interface ChatPanelProps {
  vaultPath: string;
}

export function ChatPanel({ vaultPath }: ChatPanelProps): JSX.Element {
  const messages = useBrainStore((s) => s.messages);
  const isLoading = useBrainStore((s) => s.isLoading);
  const error = useBrainStore((s) => s.error);
  const query = useBrainStore((s) => s.query);

  const [input, setInput] = useState('');
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
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

  return (
    <div
      data-testid="chat-panel"
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
          <MessageBubble key={msg.id} message={msg} onSourceClick={handleSourceClick} />
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
          gap: 'var(--space-2)',
          alignItems: 'flex-end',
          background: 'var(--bg)',
        }}
      >
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
          disabled={isLoading || !input.trim()}
          style={{
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-4)',
            fontFamily: 'var(--sans)',
            fontWeight: 500,
            fontSize: '0.875rem',
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
