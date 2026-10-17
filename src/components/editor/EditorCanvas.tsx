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

import './editor.css';

interface EditorCanvasProps {
  /** Exposed so EditorView can forward the editor instance to EditorToolbar. */
  onEditorReady?: (editor: ReturnType<typeof useEditor>) => void;
}

export default function EditorCanvas({ onEditorReady }: EditorCanvasProps) {
  const { activeNoteContent, activeNotePath, vaultTree, setContent, setSelectionText } =
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
      <EditorContent editor={editor} />
    </div>
  );
}
