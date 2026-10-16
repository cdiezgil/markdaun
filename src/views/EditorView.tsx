import React from 'react';
import { useParams } from 'react-router-dom';

export function EditorView() {
  const { encodedPath } = useParams<{ encodedPath: string }>();
  const filePath = encodedPath ? decodeURIComponent(encodedPath) : '';

  return (
    <div style={{ padding: 'var(--space-6)', height: '100%' }}>
      <p data-testid="editor-path">{filePath}</p>
      {/* TipTap editor — Bloque 2 */}
    </div>
  );
}
