import React from 'react';
import { useNavigate } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { MessageSquare, NotebookPen } from 'lucide-react';
import { useBrainStore } from '../../store/brainStore';
import { useVaultStore } from '../../store/vaultStore';
import { chatAttachmentFromAbs } from '../../lib/attachments/types';
import { explainInNotePrompt } from '../../lib/attachments/prompts';

interface PreviewPanelProps {
  filePath: string;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function getExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

const actionButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-1) var(--space-3)',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--ink)',
  fontFamily: 'var(--sans)',
  fontSize: '0.875rem',
  cursor: 'pointer',
};

export function PreviewPanel({ filePath }: PreviewPanelProps) {
  const ext = getExtension(filePath);
  const src = convertFileSrc(filePath);
  const navigate = useNavigate();
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const askWithAttachments = useBrainStore((s) => s.askWithAttachments);

  const isImage = IMAGE_EXTS.has(ext);
  const isPdf = ext === 'pdf';
  if (!isImage && !isPdf) return null;

  const attachment = vaultPath ? chatAttachmentFromAbs(filePath, vaultPath) : null;

  const ask = (text: string, send: boolean) => {
    if (!attachment) return;
    askWithAttachments([attachment], { text, send });
    navigate('/brain');
  };

  const containerStyle: React.CSSProperties = {
    background: 'var(--bg)',
    padding: 'var(--space-6)',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  };
  const viewStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div style={containerStyle}>
      {attachment && (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" style={actionButton} onClick={() => ask('', false)}>
            <MessageSquare size={16} strokeWidth={1.5} color="var(--ink-muted)" />
            Preguntar a la IA
          </button>
          <button type="button" style={actionButton} onClick={() => ask(explainInNotePrompt(attachment), true)}>
            <NotebookPen size={16} strokeWidth={1.5} color="var(--ink-muted)" />
            Explicar en una nota
          </button>
        </div>
      )}
      <div style={viewStyle}>
        {isImage ? (
          <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />
        ) : (
          <iframe src={src} title="preview" style={{ width: '100%', height: '100%', border: 'none' }} />
        )}
      </div>
    </div>
  );
}
