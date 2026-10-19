/**
 * IdeEditorCanvas — TC-05, TC-07, TC-17
 *
 * A variant of EditorCanvas that reads from useIdeStore instead of useEditorStore.
 * No WikilinkExtension (wikilinks are disabled — no vault context), no BacklinksSection.
 * Auto-save via the store's debounced setContent (1 s debounce).
 */
import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useIdeStore } from '../../store/ideStore';
import { buildEditorExtensions } from './editorExtensions';
import type { WikilinkOptions } from './extensions/WikilinkExtension';

import './editor.css';

interface IdeEditorCanvasProps {
  onEditorReady?: (editor: ReturnType<typeof useEditor>) => void;
}

/** No-op wikilink options: IDE editor has no vault, so no wikilinks are resolved. */
const noopWikilinkOptions: WikilinkOptions = {
  getVaultTree: () => [],
};

/** "path/to/file" caption plus last-save time when known. */
export function ideNoteCaption(filePath: string, savedAt: number | null): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = (parts.pop() ?? filePath).replace(/\.md$/i, '');
  const dir = parts.join(' / ');
  const label = dir ? `${dir} / ${name}` : name;
  if (savedAt === null) return label;
  const time = new Date(savedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return `${label} · guardado ${time}`;
}

export default function IdeEditorCanvas({ onEditorReady }: IdeEditorCanvasProps) {
  const { activeFileContent, activeFilePath, lastSavedAt, loadVersion, setContent } = useIdeStore();

  const editor = useEditor({
    extensions: buildEditorExtensions({ wikilinkOptions: noopWikilinkOptions }),
    content: activeFileContent ?? '',
    onUpdate: ({ editor: ed }) => {
      const md: string =
        (ed.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ??
        ed.getText();
      setContent(md);
    },
    editorProps: {
      attributes: { 'data-testid': 'ide-prosemirror-editor' },
    },
  });

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Reload content when a file is (re)loaded — TC-17
  useEffect(() => {
    if (!editor) return;
    if (activeFileContent !== null) {
      editor.commands.setContent(activeFileContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVersion]);

  return (
    <div
      style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}
      data-testid="ide-editor-canvas-container"
    >
      <article
        data-testid="ide-editor-column"
        style={{
          width: '100%',
          maxWidth: 'min(var(--measure), calc(100% - 2 * var(--space-8)))',
          margin: '0 auto',
          padding: 'var(--space-12) var(--space-8) var(--space-16)',
          boxSizing: 'content-box',
        }}
      >
        {activeFilePath && (
          <div
            data-testid="ide-editor-caption"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              lineHeight: '16px',
              color: 'var(--ink-muted)',
              marginBottom: 'var(--space-3)',
            }}
          >
            {ideNoteCaption(activeFilePath, lastSavedAt)}
          </div>
        )}
        <EditorContent editor={editor} />
      </article>
    </div>
  );
}
