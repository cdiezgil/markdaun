import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useEditorStore, resolveImageSrc } from '../../store/editorStore';
import { vaultStoreWikilinkOptions } from './extensions/vaultWikilinkOptions';
import { buildEditorExtensions } from './editorExtensions';
import { convertAssetSrc } from '../../lib/tauri';
import BacklinksSection from './BacklinksSection';
import { useH1Follow } from '../../hooks/useH1Follow';
import { firstH1ContentEnd } from '../../lib/h1Follow';

import './editor.css';

interface EditorCanvasProps {
  /** Exposed so EditorView can forward the editor instance to EditorToolbar. */
  onEditorReady?: (editor: ReturnType<typeof useEditor>) => void;
  /** When true, hides TipTap and shows a plain-text Markdown textarea. */
  plainMdMode?: boolean;
}

/** "Carpeta / Nota" path (no extension) plus the last save time, when known. */
export function noteCaption(notePath: string, vaultPath: string | null, savedAt: number | null): string {
  const rel =
    vaultPath && notePath.startsWith(vaultPath + '/') ? notePath.slice(vaultPath.length + 1) : notePath;
  const path = rel.replace(/\.md$/, '').split('/').join(' / ');
  if (savedAt === null) return path;
  const time = new Date(savedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return `${path} \u00b7 guardado ${time}`;
}

const plainTextareaStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  maxWidth: 'min(var(--measure), calc(100% - 2 * var(--space-8)))',
  margin: '0 auto',
  padding: 'var(--space-12) var(--space-8) var(--space-16)',
  boxSizing: 'border-box',
  fontFamily: 'var(--font-mono)',
  fontSize: 14,
  lineHeight: '1.6',
  color: 'var(--ink)',
  background: 'var(--bg)',
  border: 'none',
  outline: 'none',
  resize: 'none',
  overflowY: 'auto',
};

export default function EditorCanvas({ onEditorReady, plainMdMode = false }: EditorCanvasProps) {
  const {
    activeNoteContent,
    activeNotePath,
    vaultPath,
    lastSavedAt,
    loadVersion,
    setContent,
    setSelectionText,
  } = useEditorStore();

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const editor = useEditor({
    extensions: buildEditorExtensions({
      wikilinkOptions: vaultStoreWikilinkOptions,
      resolveImageSrc: (path) => {
        const notePath = useEditorStore.getState().activeNotePath;
        if (!notePath) return path;
        return resolveImageSrc(path, notePath.substring(0, notePath.lastIndexOf('/')));
      },
    }),
    content: activeNoteContent ?? '',
    onUpdate: ({ editor: ed }) => {
      const md: string = (ed.storage as { markdown?: { getMarkdown?: () => string } })
        .markdown?.getMarkdown?.() ?? ed.getText();
      setContent(md);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to, empty } = ed.state.selection;
      setSelectionText(empty ? '' : ed.state.doc.textBetween(from, to, ' '));
    },
    editorProps: {
      attributes: {
        'data-testid': 'prosemirror-editor',
      },
    },
  });

  // Sync editor instance ref
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editorRef as any).current = editor;

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Reload content when a note is (re)loaded. A rename changes the path but
  // not the content, so it must not reset the cursor or unsaved edits.
  useEffect(() => {
    if (!editor) return;
    if (activeNoteContent !== null) {
      editor.commands.setContent(activeNoteContent);
    }
    // A brand-new note opens with the cursor in its empty H1.
    if (useEditorStore.getState().focusTitleOnOpen) {
      const end = firstH1ContentEnd(editor);
      if (end !== null) editor.commands.focus(end);
      useEditorStore.setState({ focusTitleOnOpen: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVersion]);

  useH1Follow(editor);

  // Handle drag-and-drop of images
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const { vaultPath } = useEditorStore.getState();
    if (!editor || !activeNotePath || !vaultPath) return;

    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name),
    );

    for (const file of files) {
      // Security: only allow files inside the vault
      // (drag-drop from native OS gives a File object — we use the name only)
      const noteDir = activeNotePath.substring(0, activeNotePath.lastIndexOf('/'));
      const rel = file.name;
      const absPath = noteDir + '/' + rel;
      const src = convertAssetSrc(absPath);
      editor.chain().focus().setImage({ src, alt: file.name }).run();
    }
  };

  return (
    <div
      style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      data-testid="editor-canvas-container"
    >
      {plainMdMode && (
        <textarea
          data-testid="plain-md-textarea"
          value={activeNoteContent ?? ''}
          onChange={(e) => setContent(e.target.value)}
          style={plainTextareaStyle}
          aria-label="Editor de Markdown en texto plano"
          spellCheck={false}
        />
      )}
      <article
        data-testid="editor-column"
        style={{
          display: plainMdMode ? 'none' : undefined,
          width: '100%',
          maxWidth: 'min(var(--measure), calc(100% - 2 * var(--space-8)))',
          margin: '0 auto',
          padding: 'var(--space-12) var(--space-8) var(--space-16)',
          boxSizing: 'content-box',
        }}
      >
        {activeNotePath && (
          <div
            data-testid="editor-caption"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              lineHeight: '16px',
              color: 'var(--ink-muted)',
              marginBottom: 'var(--space-3)',
            }}
          >
            {noteCaption(activeNotePath, vaultPath, lastSavedAt)}
          </div>
        )}
        <EditorContent editor={editor} />
        {activeNotePath && vaultPath && (
          <BacklinksSection notePath={activeNotePath} vaultPath={vaultPath} />
        )}
      </article>
    </div>
  );
}
