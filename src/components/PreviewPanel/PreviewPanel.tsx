import React from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

interface PreviewPanelProps {
  filePath: string;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function getExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function PreviewPanel({ filePath }: PreviewPanelProps) {
  const ext = getExtension(filePath);
  const src = convertFileSrc(filePath);

  const containerStyle: React.CSSProperties = {
    background: 'var(--bg)',
    padding: 'var(--space-6)',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (IMAGE_EXTS.has(ext)) {
    return (
      <div style={containerStyle}>
        <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />
      </div>
    );
  }

  if (ext === 'pdf') {
    return (
      <div style={containerStyle}>
        <iframe
          src={src}
          title="preview"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    );
  }

  return null;
}
