import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { openExternal } from '../../lib/openExternal';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';

import { createWikilinkExtension } from '../editor/extensions/WikilinkExtension';
import { vaultStoreWikilinkOptions } from '../editor/extensions/vaultWikilinkOptions';
import { MermaidCodeBlock } from '../editor/extensions/MermaidCodeBlock';
import { HighlightExtension } from '../editor/extensions/HighlightExtension';
import { TagExtension } from '../editor/extensions/TagExtension';
import '../editor/editor.css';
import './brain.css';

interface AssistantMarkdownProps {
  /** Markdown source of the assistant answer. */
  content: string;
  /** Called with the note's absolute path when a [[wikilink]] is clicked. */
  onOpenNote(path: string): void;
}

/**
 * Renders assistant Markdown read-only with the same extensions as the editor
 * (wikilinks, tags, highlights, Mermaid) so `**`, `>` or ``` never show raw.
 */
export function AssistantMarkdown({ content, onOpenNote }: AssistantMarkdownProps): JSX.Element {
  const onOpenRef = React.useRef(onOpenNote);
  onOpenRef.current = onOpenNote;

  const wikilink = useMemo(
    () =>
      createWikilinkExtension({
        ...vaultStoreWikilinkOptions,
        onOpen: (entry) => onOpenRef.current(entry.path),
      }),
    [],
  );

  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      MermaidCodeBlock,
      Link.configure({
        openOnClick: false,   // handled below via click delegate
        autolink: false,
        protocols: ['https', 'http', 'mailto'],
        validate: (href) => /^https?:\/\//i.test(href) || href.startsWith('mailto:'),
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Markdown.configure({ html: false }),
      HighlightExtension,
      TagExtension,
      wikilink,
    ],
    content,
    editorProps: { attributes: { 'data-testid': 'assistant-markdown', class: 'brain-md' } },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.();
    if (current !== content) editor.commands.setContent(content);
  }, [editor, content]);

  // Delegate external link clicks to the system browser via Tauri opener.
  // Wikilink clicks are already handled by the WikilinkExtension (onOpen).
  const containerRef = useRef<HTMLDivElement>(null);
  const handleLinkClick = useCallback((e: MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) {
      openExternal(href).catch(console.error);
    }
  }, []);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('click', handleLinkClick);
    return () => el.removeEventListener('click', handleLinkClick);
  }, [handleLinkClick]);

  return <div ref={containerRef}><EditorContent editor={editor} /></div>;
}
