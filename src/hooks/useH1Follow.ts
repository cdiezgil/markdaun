import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { followH1Title, readH1 } from '../lib/h1Follow';
import { useEditorStore } from '../store/editorStore';

/** Idle time in the H1 before the file is renamed after it. */
export const H1_IDLE_MS = 1000;

/**
 * Renames the active note after its H1 when the H1 loses focus or after 1 s
 * without typing in it. The backend decides whether the note still follows
 * its H1; once it says no, this stops asking for that note.
 */
export function useH1Follow(editor: Editor | null): void {
  const loadVersion = useEditorStore((s) => s.loadVersion);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inH1 = false;
    const lastTitle = new Map<string, string>();
    const stopped = new Set<string>();

    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const fire = async () => {
      clear();
      const path = useEditorStore.getState().activeNotePath;
      if (!path || stopped.has(path)) return;
      const { title } = readH1(editor);
      if (title.trim() === '' || lastTitle.get(path) === title) return;
      lastTitle.set(path, title);
      try {
        const following = await followH1Title(title);
        const now = useEditorStore.getState().activeNotePath;
        if (!following) stopped.add(path);
        if (now) lastTitle.set(now, title);
      } catch (e) {
        console.error('H1 follow failed:', e);
      }
    };

    const onUpdate = () => {
      if (!readH1(editor).inH1) return;
      inH1 = true;
      clear();
      timer = setTimeout(() => void fire(), H1_IDLE_MS);
    };
    const onSelection = () => {
      const now = readH1(editor).inH1;
      if (inH1 && !now) {
        inH1 = false;
        void fire();
      } else if (now) {
        inH1 = true;
      }
    };
    const onBlur = () => {
      if (!inH1) return;
      inH1 = false;
      void fire();
    };

    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelection);
    editor.on('blur', onBlur);
    return () => {
      clear();
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelection);
      editor.off('blur', onBlur);
    };
    // A new note load resets everything (pending timers belong to the old note).
  }, [editor, loadVersion]);
}
