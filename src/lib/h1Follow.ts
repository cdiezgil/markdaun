import { invoke } from '@tauri-apps/api/core';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../store/editorStore';
import { useVaultStore } from '../store/vaultStore';

interface TitleRename {
  following: boolean;
  path: string;
  rewritten: string[];
}

/**
 * Renames the active note after `title` (its H1) when it still follows its
 * H1. Resolves true while the note keeps following, false once it does not.
 */
export async function followH1Title(title: string): Promise<boolean> {
  const { activeNotePath, vaultPath } = useEditorStore.getState();
  if (!activeNotePath || !vaultPath) return false;

  const out = await useEditorStore
    .getState()
    .runRelocation(() =>
      invoke<TitleRename>('rename_note_from_title', { path: activeNotePath, title, vaultPath }),
    );
  if (out.path !== activeNotePath) {
    await useVaultStore.getState().refreshTree();
    await useEditorStore.getState().applyRelocation(activeNotePath, out.path, out.rewritten ?? []);
  }
  return out.following;
}

/** Text of the first H1 and whether the cursor sits inside an H1. */
export function readH1(editor: Pick<Editor, 'state'>): { inH1: boolean; title: string } {
  const { doc, selection } = editor.state;
  const parent = selection.$from.parent;
  const inH1 = parent.type.name === 'heading' && parent.attrs['level'] === 1;
  let title = '';
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'heading' && node.attrs['level'] === 1) {
      found = true;
      title = node.textBetween(0, node.content.size, '', (leaf) => {
        const attrs = leaf.attrs as { alias?: string | null; label?: string };
        return attrs.alias ?? attrs.label ?? '';
      });
      return false;
    }
    return true;
  });
  return { inH1, title };
}

/** Document position at the end of the first H1's content, or null without one. */
export function firstH1ContentEnd(editor: Pick<Editor, 'state'>): number | null {
  let end: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (end !== null) return false;
    if (node.type.name === 'heading' && node.attrs['level'] === 1) {
      end = pos + 1 + node.content.size;
      return false;
    }
    return true;
  });
  return end;
}
