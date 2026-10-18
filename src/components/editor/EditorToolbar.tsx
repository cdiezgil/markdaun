import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  ScanText,
  Workflow,
  Keyboard,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useEditorStore, processImagesOnSave } from '../../store/editorStore';
import { useBrainStore } from '../../store/brainStore';
import { collectNoteAttachments, describeSkipped } from '../../lib/attachments/noteRefs';
import { explainNoteImagesPrompt } from '../../lib/attachments/prompts';
import { pickImageFile, convertAssetSrc } from '../../lib/tauri';
import { TableSizePicker } from './TableSizePicker';
import { ShortcutCheatSheet } from './ShortcutCheatSheet';
import { EDITOR_ACTION_EVENT, type EditorActionDetail } from './extensions/EditorShortcuts';
import { ariaKeyShortcuts, shortcutById, withShortcut, type ShortcutId } from '../../lib/editor/shortcuts';
import { isMac } from '../../lib/shortcut';

// ── ToolbarButton ─────────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  label: string;
  /** Shortcut shown in the tooltip and exposed through aria-keyshortcuts. */
  shortcut?: ShortcutId;
  mac: boolean;
  isActive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, shortcut, mac, isActive = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? withShortcut(label, shortcut, mac) : label}
      aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcutById(shortcut), mac) : undefined}
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

function ToolbarSeparator() {
  return (
    <span
      aria-hidden="true"
      data-testid="toolbar-separator"
      style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 6px', flexShrink: 0 }}
    />
  );
}

// ── EditorToolbar ─────────────────────────────────────────────────────────────

interface EditorToolbarProps {
  editor: Editor | null;
  /** Platform override (tests). Defaults to the detected platform. */
  mac?: boolean;
}

export default function EditorToolbar({ editor, mac = isMac() }: EditorToolbarProps) {
  const { activeNotePath } = useEditorStore();
  const navigate = useNavigate();
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const handleExplainImages = () => {
    const { activeNotePath: notePath, activeNoteContent, vaultPath } = useEditorStore.getState();
    if (!notePath || !vaultPath) return;
    const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
    // The editor holds asset URLs for images; references must be the on-disk form.
    const markdown = processImagesOnSave(activeNoteContent ?? '', noteDir);
    const found = collectNoteAttachments(markdown, notePath, vaultPath);
    const notices = describeSkipped(found);
    if (found.attachments.length === 0) {
      notices.unshift('Esta nota no contiene imágenes ni PDFs locales.');
    }
    const noteName = (notePath.split('/').pop() ?? notePath).replace(/\.md$/, '');
    useBrainStore
      .getState()
      .askWithAttachments(found.attachments, { text: explainNoteImagesPrompt(noteName, markdown), send: false }, notices);
    navigate('/brain');
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

  const toggleSheet = useCallback(() => setSheetOpen((open) => !open), []);

  // Mod-/ toggles the cheat sheet from anywhere in the editor view (the open
  // sheet handles its own Mod-/ to close).
  useEffect(() => {
    if (sheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSheetOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sheetOpen]);

  // Shortcuts that need UI owned by the toolbar (link prompt, pickers).
  const handlersRef = useRef({ link: handleInsertLink, table: handleInsertTable, image: handleInsertImage });
  handlersRef.current = { link: handleInsertLink, table: handleInsertTable, image: handleInsertImage };
  useEffect(() => {
    const onAction = (e: Event) => {
      const { id } = (e as CustomEvent<EditorActionDetail>).detail;
      void handlersRef.current[id]();
    };
    window.addEventListener(EDITOR_ACTION_EVENT, onAction);
    return () => window.removeEventListener(EDITOR_ACTION_EVENT, onAction);
  }, []);

  return (
    <div
      data-testid="editor-toolbar-bar"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        justifyContent: 'center',
        padding: 'var(--space-2) var(--space-8)',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
      }}
    >
    <div
      role="toolbar"
      aria-label="Editor toolbar"
      data-testid="editor-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 2,
        width: '100%',
        maxWidth: 'var(--measure)',
        marginLeft: 'calc(-1 * var(--space-2))',
      }}
    >
      {/* Headings */}
      <ToolbarButton
        label="Heading 1"
        shortcut="heading1"
        mac={mac}
        isActive={editor?.isActive('heading', { level: 1 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Heading 2"
        shortcut="heading2"
        mac={mac}
        isActive={editor?.isActive('heading', { level: 2 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Heading 3"
        shortcut="heading3"
        mac={mac}
        isActive={editor?.isActive('heading', { level: 3 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Inline marks */}
      <ToolbarButton
        label="Bold"
        shortcut="bold"
        mac={mac}
        isActive={editor?.isActive('bold') ?? false}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Italic"
        shortcut="italic"
        mac={mac}
        isActive={editor?.isActive('italic') ?? false}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Strikethrough"
        shortcut="strike"
        mac={mac}
        isActive={editor?.isActive('strike') ?? false}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Inline code"
        shortcut="code"
        mac={mac}
        isActive={editor?.isActive('code') ?? false}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Block elements */}
      <ToolbarSeparator />

      <ToolbarButton
        label="Code block"
        shortcut="codeBlock"
        mac={mac}
        isActive={editor?.isActive('codeBlock') ?? false}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <SquareCode size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Blockquote"
        shortcut="blockquote"
        mac={mac}
        isActive={editor?.isActive('blockquote') ?? false}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Bullet list"
        shortcut="bulletList"
        mac={mac}
        isActive={editor?.isActive('bulletList') ?? false}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarButton
        label="Ordered list"
        shortcut="orderedList"
        mac={mac}
        isActive={editor?.isActive('orderedList') ?? false}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        label="Diagrama"
        shortcut="diagram"
        mac={mac}
        onClick={() => editor?.chain().focus().insertMermaid().run()}
      >
        <Workflow size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Link */}
      <ToolbarButton
        label="Link"
        shortcut="link"
        mac={mac}
        isActive={editor?.isActive('link') ?? false}
        onClick={handleInsertLink}
      >
        <Link2 size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Image */}
      <ToolbarButton label="Insert image" shortcut="image" mac={mac} onClick={handleInsertImage}>
        <Image size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Table */}
      <div ref={tableButtonRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <ToolbarButton label="Insert table" shortcut="table" mac={mac} onClick={handleInsertTable}>
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

      {/* Explain the images / PDFs referenced by this note with the AI */}
      <ToolbarButton label="Explicar imágenes de esta nota" mac={mac} onClick={handleExplainImages}>
        <ScanText size={20} strokeWidth={1.5} />
      </ToolbarButton>

      {/* Horizontal rule */}
      <ToolbarButton
        label="Horizontal rule"
        shortcut="horizontalRule"
        mac={mac}
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={20} strokeWidth={1.5} />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Shortcut cheat sheet */}
      <ToolbarButton label="Atajos de teclado" shortcut="cheatSheet" mac={mac} onClick={toggleSheet}>
        <Keyboard size={20} strokeWidth={1.5} />
      </ToolbarButton>
      <ShortcutCheatSheet open={sheetOpen} onClose={() => setSheetOpen(false)} mac={mac} />
    </div>
    </div>
  );
}
