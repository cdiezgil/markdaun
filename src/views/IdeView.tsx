/**
 * IdeView — TC-05, TC-07
 *
 * Mounted at /ide and /ide/editor/:encodedPath.
 * Renders EditorToolbar + IdeEditorCanvas.
 * When no file is active shows an empty bg surface.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Editor } from '@tiptap/react';

import EditorToolbar from '../components/editor/EditorToolbar';
import IdeEditorCanvas from '../components/editor/IdeEditorCanvas';
import { useIdeStore } from '../store/ideStore';

export function IdeView() {
  const { encodedPath } = useParams<{ encodedPath?: string }>();
  const filePath = encodedPath ? decodeURIComponent(encodedPath) : null;

  const activeFilePath = useIdeStore((s) => s.activeFilePath);
  const [editor, setEditor] = useState<Editor | null>(null);

  // Open the file whenever the URL param changes
  useEffect(() => {
    if (filePath && filePath !== activeFilePath) {
      useIdeStore.getState().openFile(filePath).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  if (!activeFilePath) {
    return (
      <div
        data-testid="ide-editor-empty"
        style={{
          display: 'flex',
          height: '100%',
          background: 'var(--bg)',
        }}
      />
    );
  }

  return (
    <div
      data-testid="ide-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        background: 'var(--bg)',
      }}
    >
      <EditorToolbar editor={editor} />
      <IdeEditorCanvas onEditorReady={setEditor} />
    </div>
  );
}
