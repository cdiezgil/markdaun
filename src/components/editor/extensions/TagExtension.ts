import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

const TAG_BODY = /^#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/u;
const patched = new WeakSet<MarkdownIt>();

/** markdown-it inline rule: `#tag` (start of text or after whitespace) -> span[data-tag]. */
function installTagRule(md: MarkdownIt): void {
  if (patched.has(md)) return;
  patched.add(md);
  md.inline.ruler.before('text', 'mdtag', (state, silent) => {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== 0x23) return false;
    if (pos > 0 && !/\s/.test(src.charAt(pos - 1))) return false;
    const m = TAG_BODY.exec(src.slice(pos, state.posMax));
    // Needs a letter: "#1" is an issue number, not a tag.
    if (!m || !/\p{L}/u.test(m[0])) return false;
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      const esc = md.utils.escapeHtml(m[0]);
      token.content = `<span data-tag="${esc}">${esc}</span>`;
    }
    state.pos = pos + m[0].length;
    return true;
  });
}

/**
 * TagExtension — TC-13
 *
 * Recognises #tag syntax (inline atom node).
 * Renders as a chip: background var(--sap), text var(--on-sap), radius var(--radius-sm).
 * Does NOT navigate.
 * Markdown: a markdown-it inline rule turns `#tag` into a node on load and the
 * serializer writes the exact `#tag` back. Not applied inside code.
 * Reusable read-only: add it to any Editor's extensions alongside Markdown.
 */
export const TagExtension = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      tag: {
        default: '',
        rendered: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tag') ?? '',
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: Record<string, unknown> }) {
          state.write(node.attrs['tag'] as string);
        },
        parse: { setup: installTagRule },
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        // Fires when the space ending a #tag is typed, so the tag stays editable
        // while being typed. The space is kept.
        find: /(?:^|\s)(#[\p{L}\p{N}_][\p{L}\p{N}_/-]*)\s$/u,
        handler: ({ state, range, match }) => {
          const tag = match[1] ?? '';
          const nodeType = state.schema.nodes['tag'];
          if (!nodeType) return;
          if (!/\p{L}/u.test(tag)) return;
          const whole = match[0] ?? '';
          const lead = whole.length - whole.trimStart().length;
          // The typed space is not in the doc yet and the rule swallows it: re-add it.
          state.tr.replaceWith(range.from + lead, range.to, [
            nodeType.create({ tag }),
            state.schema.text(' '),
          ]);
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
