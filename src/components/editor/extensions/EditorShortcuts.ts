import { Extension } from '@tiptap/core';

import { SHORTCUTS, tiptapKey, type ShortcutId } from '../../../lib/editor/shortcuts';

/** Window event fired for shortcuts that need UI owned by the toolbar (link prompt, pickers). */
export const EDITOR_ACTION_EVENT = 'markdaun:editor-action';

export type EditorUiActionId = 'link' | 'table' | 'image';

export interface EditorActionDetail {
  id: EditorUiActionId;
}

function emit(id: EditorUiActionId): boolean {
  window.dispatchEvent(new CustomEvent<EditorActionDetail>(EDITOR_ACTION_EVENT, { detail: { id } }));
  return true;
}

/**
 * Keyboard shortcuts of the editor. Combos come from `lib/editor/shortcuts.ts`.
 * Mod-K is never bound here (it is the global note search) and Mod-/ is handled
 * app-wide by the cheat sheet so it also works when the toolbar has focus.
 */
export const EditorShortcuts = Extension.create({
  name: 'editorShortcuts',

  addKeyboardShortcuts() {
    const actions: Partial<Record<ShortcutId, () => boolean>> = {
      bold: () => this.editor.commands.toggleBold(),
      italic: () => this.editor.commands.toggleItalic(),
      strike: () => this.editor.commands.toggleStrike(),
      highlight: () => this.editor.commands.toggleMark('highlight'),
      code: () => this.editor.commands.toggleCode(),
      heading1: () => this.editor.commands.toggleHeading({ level: 1 }),
      heading2: () => this.editor.commands.toggleHeading({ level: 2 }),
      heading3: () => this.editor.commands.toggleHeading({ level: 3 }),
      paragraph: () => {
        this.editor.commands.setParagraph();
        return true;
      },
      codeBlock: () => this.editor.commands.toggleCodeBlock(),
      bulletList: () => this.editor.commands.toggleBulletList(),
      orderedList: () => this.editor.commands.toggleOrderedList(),
      blockquote: () => this.editor.commands.toggleBlockquote(),
      horizontalRule: () => this.editor.commands.setHorizontalRule(),
      diagram: () => this.editor.commands.insertMermaid(),
      wikilink: () => {
        const { state } = this.editor;
        const { from, to, empty } = state.selection;
        if (!empty) {
          return this.editor.commands.insertWikilink(state.doc.textBetween(from, to, ' '));
        }
        return this.editor
          .chain()
          .insertContent({ type: 'text', text: '[[]]' })
          .setTextSelection(from + 2)
          .run();
      },
      link: () => emit('link'),
      table: () => emit('table'),
      image: () => emit('image'),
    };

    const bindings: Record<string, () => boolean> = {};
    for (const s of SHORTCUTS) {
      const action = actions[s.id];
      if (action) bindings[tiptapKey(s)] = action;
    }
    return bindings;
  },
});
