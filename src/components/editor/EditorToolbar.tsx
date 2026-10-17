import React, { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Code,
  SquareCode,
  Quote,
  List,
  ListOrdered,
  Link2,
  Image,
  Minus,
  Table,
} from 'lucide-react';

import { useEditorStore } from '../../store/editorStore';
import { pickImageFile, convertAssetSrc } from '../../lib/tauri';
import { TableSizePicker } from './TableSizePicker';

// ── ToolbarButton ─────────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  label: string;
  isActive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, isActive = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-active={isActive ? 'true' : 'false'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        border: 'none',
        background: 'transparent',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        color: isActive ? 'var(--daun)' : 'var(--ink-muted)',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── EditorToolbar ─────────────────────────────────────────────────────────────

interface EditorToolbarProps {
  editor: Editor | null;
}

export default function EditorToolbar({ editor }: EditorToolbarProps) {
  const { activeNotePath } = useEditorStore();
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const tableButtonRef = useRef<HTMLDivElement>(null);

  const handleInsertImage = async () => {
    if (!editor || !activeNotePath) return;

    try {
      const filePath = await pickImageFile();
      if (!filePath) return;

      const noteDir = activeNotePath.substring(0, activeNotePath.lastIndexOf('/'));
      const notePrefix = noteDir.endsWith('/') ? noteDir : noteDir + '/';
      const rel = filePath.startsWith(notePrefix)
        ? filePath.slice(notePrefix.length)
        : filePath;

      const src = convertAssetSrc(filePath);
      editor.chain().focus().setImage({ src, alt: rel }).run();
    } catch (e) {
      console.error('Failed to insert image:', e);
    }
  };

  const handleInsertLink = () => {
    if (!editor) return;
    const url = window.prompt('URL:');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const handleInsertTable = () => {
    if (!editor) return;
    setTablePickerOpen((open) => !open);
  };

  const handleTableSizeSelect = (rows: number, cols: number) => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setTablePickerOpen(false);
  };

  return (
    <div
      role="toolbar"
      aria-label="Editor toolbar"
      data-testid="editor-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '0 var(--space-3)',
        height: 'var(--toolbar-height)',
        background: 'var(--surface-sunken)',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        flexWrap: 'wrap',
        overflowX: 'auto',
      }}
    >
      {/* Headings */}
      <ToolbarButton
        label="Heading 1"
        isActive={editor?.isActive('heading', { level: 1 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Heading 2"
        isActive={editor?.isActive('heading', { level: 2 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Heading 3"
        isActive={editor?.isActive('heading', { level: 3 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Inline marks */}
      <ToolbarButton
        label="Bold"
        isActive={editor?.isActive('bold') ?? false}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Italic"
        isActive={editor?.isActive('italic') ?? false}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Strikethrough"
        isActive={editor?.isActive('strike') ?? false}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Inline code"
        isActive={editor?.isActive('code') ?? false}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Block elements */}
      <ToolbarButton
        label="Code block"
        isActive={editor?.isActive('codeBlock') ?? false}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <SquareCode size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Blockquote"
        isActive={editor?.isActive('blockquote') ?? false}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Bullet list"
        isActive={editor?.isActive('bulletList') ?? false}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Ordered list"
        isActive={editor?.isActive('orderedList') ?? false}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Link */}
      <ToolbarButton
        label="Link"
        isActive={editor?.isActive('link') ?? false}
        onClick={handleInsertLink}
      >
        <Link2 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Image */}
      <ToolbarButton label="Insert image" onClick={handleInsertImage}>
        <Image size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Table */}
      <div ref={tableButtonRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <ToolbarButton label="Insert table" onClick={handleInsertTable}>
          <Table size={20} strokeWidth={1.5} />
        </ToolbarButton>
      </div>
      {tablePickerOpen &&
        tableButtonRef.current &&
        (() => {
          const rect = tableButtonRef.current!.getBoundingClientRect();
          return (
            <TableSizePicker
              anchorRect={{ left: rect.left, bottom: rect.bottom }}
              onSelect={handleTableSizeSelect}
              onClose={() => setTablePickerOpen(false)}
            />
          );
        })()}

      {/* Horizontal rule */}
      <ToolbarButton
        label="Horizontal rule"
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={20} strokeWidth={1.5} />
      </ToolbarButton>
    </div>
  );
}
