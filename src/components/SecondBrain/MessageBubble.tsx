import React from 'react';
import type { BrainMessage } from '../../store/brainStore';
import { describeBrainWarning } from '../../lib/brainErrors';

export interface MessageBubbleProps {
  message: BrainMessage;
  onSourceClick(path: string): void;
}

const SUPERSCRIPT_NUMS = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

function filenameWithoutExt(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^/.]+$/, '');
}

export function MessageBubble({ message, onSourceClick }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 'var(--space-3)',
      }}
    >
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
        {message.content}
      </div>

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
