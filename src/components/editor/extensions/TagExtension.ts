import { Node, mergeAttributes, InputRule } from '@tiptap/core';

/**
 * TagExtension — TC-13
 *
 * Recognises #tag syntax (inline atom node).
 * Renders as a chip: background var(--sap), text var(--on-sap), radius var(--radius-sm).
 * Does NOT navigate.
 * Serialisation: tiptap-markdown emits #tag via the atom's raw text.
 */
export const TagExtension = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      tag: { default: '' },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        // Matches #word at the end of typed input (preceded by start or whitespace)
        find: /(?:^|\s)(#\w+)$/,
        handler: ({ state, range, match }) => {
          const tag = match[1] ?? '';
          const nodeType = state.schema.nodes['tag'];
          if (!nodeType) return;
          const tagNode = nodeType.create({ tag });
          state.tr.replaceWith(range.from, range.to, tagNode);
        },
      }),
    ];
  },

  parseHTML() {
    return [{ tag: 'span[data-tag]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const tag = node.attrs['tag'] as string;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-tag': tag,
        contenteditable: 'false',
        style:
          'background:var(--sap);color:var(--on-sap);border-radius:var(--radius-sm);padding:0 4px;cursor:default',
      }),
      tag,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const tag = node.attrs['tag'] as string;

      const dom = document.createElement('span');
      dom.dataset['tag'] = tag;
      dom.textContent = tag;
      dom.setAttribute('contenteditable', 'false');
      dom.style.cssText =
        'background:var(--sap);color:var(--on-sap);border-radius:var(--radius-sm);padding:0 4px;cursor:default';

      return { dom };
    };
  },
});
