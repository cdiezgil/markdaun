import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Editor } from '@tiptap/react';

import EditorToolbar from '../components/editor/EditorToolbar';
import EditorCanvas from '../components/editor/EditorCanvas';
import SaveIndicator from '../components/editor/SaveIndicator';
import { useEditorStore } from '../store/editorStore';

/**
 * EditorView — TC-01, TC-03, TC-21
 *
 * Layout (flex column, full height):
 *   1. EditorToolbar (44 px fixed, top)
 *   2. EditorCanvas  (flex-grow, scrollable)
 *   3. SaveIndicator (absolute, bottom-right)
 *
 * When activeNotePath is null (no note selected) renders a blank bg surface.
 * Reads the file path from the :encodedPath URL param and calls openNote.
 */
export function EditorView() {
  const { encodedPath } = useParams<{ encodedPath?: string }>();
  const filePath = encodedPath ? decodeURIComponent(encodedPath) : null;

  const { activeNotePath, openNote, vaultPath } = useEditorStore();
  const [editor, setEditor] = useState<Editor | null>(null);

  // Open the note whenever the URL param changes
  useEffect(() => {
    if (filePath && vaultPath && filePath !== activeNotePath) {
      openNote(filePath).catch(console.error);
    }
  }, [filePath, vaultPath]);

  if (!activeNotePath) {
    return (
      <div
        data-testid="editor-empty"
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
      data-testid="editor-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        background: 'var(--bg)',
      }}
    >
      <EditorToolbar editor={editor} />

      <EditorCanvas onEditorReady={setEditor} />

      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-4)',
          right: 'var(--space-4)',
          zIndex: 10,
        }}
      >
        <SaveIndicator />
      </div>
    </div>
  );
}
