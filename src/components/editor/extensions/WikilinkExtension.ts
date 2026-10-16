import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import type { VaultEntry } from '../../../lib/tauri';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (label: string, exists: boolean) => ReturnType;
    };
  }
}

/**
 * WikilinkExtension — TC-11, TC-12
 *
 * Recognises [[note-name]] syntax (inline atom node).
 * - Existing note → var(--daun) colour, solid underline, clickable (calls openNote).
 * - Missing note  → var(--amber) colour, dashed underline, no navigation.
 *
 * The node is atom (no editable content). tiptap-markdown serialises it via
 * the `renderText` fallback which outputs the atom's text content.
 */
export function createWikilinkExtension(vaultTree: VaultEntry[]) {
  return Node.create({
    name: 'wikilink',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
      return {
        label: { default: '' },
        exists: { default: false },
      };
    },

    addCommands() {
      return {
        insertWikilink:
          (label: string, exists: boolean) =>
          ({ commands }) => {
            return commands.insertContent({
              type: this.name,
              attrs: { label, exists },
            });
          },
      };
    },

    addInputRules() {
      return [
        new InputRule({
          find: /(?:^|\s)\[\[([^\]]+)\]\]$/,
          handler: ({ state, range, match }) => {
            const label = match[1] ?? '';
            const exists = findInTree(vaultTree, label) !== null;
            const nodeType = state.schema.nodes['wikilink'];
            if (!nodeType) return;
            const wikilinkNode = nodeType.create({ label, exists });
            state.tr.replaceWith(range.from, range.to, wikilinkNode);
          },
        }),
      ];
    },

    parseHTML() {
      return [{ tag: 'span[data-wikilink]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
      const label = node.attrs['label'] as string;
      const exists = node.attrs['exists'] as boolean;

      const style = exists
        ? 'color:var(--daun);text-decoration:underline;cursor:pointer'
        : 'color:var(--amber);text-decoration:underline dashed;cursor:default';

      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-wikilink': label,
          'data-exists': exists ? 'true' : 'false',
          style,
          contenteditable: 'false',
        }),
        `[[${label}]]`,
      ];
    },

    addNodeView() {
      return ({ node }) => {
        const label = node.attrs['label'] as string;
        const exists = node.attrs['exists'] as boolean;

        const dom = document.createElement('span');
        dom.dataset['wikilink'] = label;
        dom.dataset['exists'] = exists ? 'true' : 'false';
        dom.textContent = `[[${label}]]`;
        dom.setAttribute('contenteditable', 'false');

        if (exists) {
          dom.style.cssText =
            'color:var(--daun);text-decoration:underline;cursor:pointer';
          dom.addEventListener('click', () => {
            import('../../../store/editorStore')
              .then(({ useEditorStore }) => {
                const match = findInTree(
                  useEditorStore.getState().vaultTree,
                  label,
                );
                if (match) {
                  useEditorStore.getState().openNote(match.path).catch(console.error);
                }
              })
              .catch(console.error);
          });
        } else {
          dom.style.cssText =
            'color:var(--amber);text-decoration:underline dashed;cursor:default';
        }

        return { dom };
      };
    },
  });
}

// ── Helpers (exported for testing) ───────────────────────────────────────────

/** DFS search of the vault tree for a .md entry whose stem matches `label`. */
export function findInTree(tree: VaultEntry[], label: string): VaultEntry | null {
  for (const entry of tree) {
    if (entry.kind === 'file' && entry.file_type === 'md') {
      const stem = entry.name.replace(/\.md$/i, '');
      if (stem === label) return entry;
    }
    if (entry.children) {
      const found = findInTree(entry.children, label);
      if (found) return found;
    }
  }
  return null;
}
