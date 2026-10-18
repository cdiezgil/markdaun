import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Strike from '@tiptap/extension-strike';
import Blockquote from '@tiptap/extension-blockquote';
import type { AnyExtension } from '@tiptap/core';
import { Markdown } from 'tiptap-markdown';

import { createWikilinkExtension, type WikilinkOptions } from './extensions/WikilinkExtension';
import { MermaidCodeBlock } from './extensions/MermaidCodeBlock';
import { HighlightExtension } from './extensions/HighlightExtension';
import { TagExtension } from './extensions/TagExtension';
import { EditorShortcuts } from './extensions/EditorShortcuts';
import { MarkdownTyping } from './extensions/MarkdownTyping';

export interface EditorExtensionsOptions {
  wikilinkOptions: WikilinkOptions;
  /** Maps the path typed in `![alt](path)` to the `src` the editor displays. Default: unchanged. */
  resolveImageSrc?: (path: string) => string;
}

/**
 * The editor's extension set. Default key bindings that moved to the shortcut
 * map (strike, code block, blockquote) are removed so they never act twice.
 */
export function buildEditorExtensions({
  wikilinkOptions,
  resolveImageSrc = (p) => p,
}: EditorExtensionsOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: {},
      codeBlock: false,
      blockquote: false,
      bulletList: {},
      orderedList: {},
      horizontalRule: {},
      strike: false,
    }),
    Strike.extend({ addKeyboardShortcuts: () => ({}) }),
    Blockquote.extend({ addKeyboardShortcuts: () => ({}) }),
    MermaidCodeBlock,
    Link.configure({
      openOnClick: true,
      autolink: true,
      protocols: ['https', 'http', 'mailto'],
      validate: (href) => /^https?:\/\//i.test(href) || href.startsWith('mailto:'),
    }),
    // The typing rule for `![alt](path)` lives in MarkdownTyping (it resolves relative paths).
    Image.extend({ addInputRules: () => [] }).configure({ inline: false, allowBase64: false }),
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
    createWikilinkExtension(wikilinkOptions),
    EditorShortcuts,
    MarkdownTyping.configure({ resolveImageSrc }),
  ];
}
