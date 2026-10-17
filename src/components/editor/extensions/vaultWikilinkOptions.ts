import { useEditorStore } from '../../../store/editorStore';
import type { WikilinkOptions } from './WikilinkExtension';

/**
 * WikilinkOptions wired to the app's vault store: live tree, re-render when
 * the tree changes, click opens the note. Use it for any view (editor, Brain
 * read-only rendering) that should behave like the editor.
 */
export const vaultStoreWikilinkOptions: WikilinkOptions = {
  getVaultTree: () => useEditorStore.getState().vaultTree,
  subscribe: (listener) => {
    let prev = useEditorStore.getState().vaultTree;
    return useEditorStore.subscribe((state) => {
      if (state.vaultTree !== prev) {
        prev = state.vaultTree;
        listener();
      }
    });
  },
  onOpen: (entry) => {
    useEditorStore.getState().openNote(entry.path).catch(console.error);
  },
};
