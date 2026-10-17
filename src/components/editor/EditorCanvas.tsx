import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';

import { useEditorStore } from '../../store/editorStore';
import { createWikilinkExtension } from './extensions/WikilinkExtension';
import { MermaidCodeBlock } from './extensions/MermaidCodeBlock';
import { HighlightExtension } from './extensions/HighlightExtension';
import { TagExtension } from './extensions/TagExtension';
import { convertAssetSrc } from '../../lib/tauri';
import BacklinksSection from './BacklinksSection';

import './editor.css';

interface EditorCanvasProps {
  /** Exposed so EditorView can forward the editor instance to EditorToolbar. */
  onEditorReady?: (editor: ReturnType<typeof useEditor>) => void;
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

export default function EditorCanvas({ onEditorReady }: EditorCanvasProps) {
  const { activeNoteContent, activeNotePath, vaultPath, vaultTree, lastSavedAt, setContent, setSelectionText } =
    useEditorStore();

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: {},
        codeBlock: false,
        blockquote: {},
        bulletList: {},
        orderedList: {},
        horizontalRule: {},
        strike: {},
      }),
      MermaidCodeBlock,
      Link.configure({
        openOnClick: true,
        autolink: true,
        protocols: ['https', 'http', 'mailto'],
        validate: (href) => /^https?:\/\//i.test(href) || href.startsWith('mailto:'),
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      HighlightExtension,
      TagExtension,
      createWikilinkExtension(vaultTree),
    ],
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

  // Reload content when activeNotePath changes
  useEffect(() => {
    if (!editor) return;
    if (activeNoteContent !== null) {
      editor.commands.setContent(activeNoteContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNotePath]);

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
      style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      data-testid="editor-canvas-container"
    >
      <article
        data-testid="editor-column"
        style={{
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
