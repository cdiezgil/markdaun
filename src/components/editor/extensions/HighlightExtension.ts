import { Mark, markInputRule, mergeAttributes } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

const patched = new WeakSet<MarkdownIt>();

/** markdown-it inline rule: `==text==` -> <mark data-highlight>text</mark> (inner inline syntax kept). */
function installHighlightRule(md: MarkdownIt): void {
  if (patched.has(md)) return;
  patched.add(md);
  md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
    const { src, pos, posMax } = state;
    if (src.charCodeAt(pos) !== 0x3d || src.charCodeAt(pos + 1) !== 0x3d) return false;
    const start = pos + 2;
    if (start >= posMax || /\s|=/.test(src.charAt(start))) return false;
    let end = src.indexOf('==', start);
    while (end !== -1 && end < posMax && /[\s=]/.test(src.charAt(end - 1))) {
      end = src.indexOf('==', end + 2);
    }
    if (end === -1 || end >= posMax) return false;
    if (!silent) {
      state.push('html_inline', '', 0).content = '<mark data-highlight>';
      const oldMax = state.posMax;
      state.pos = start;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.push('html_inline', '', 0).content = '</mark>';
    }
    state.pos = end + 2;
    return true;
  });
}

/**
 * HighlightExtension — TC-19
 *
 * Recognises ==text== syntax and wraps it in a <mark> element with
 * the design-system token colours.
 *
 * Input rule: typing ==text== at the end of a line applies the mark.
 * Markdown: a markdown-it inline rule parses ==text== on load (not inside
 * code) and the mark serializer writes ==text== back.
 */
export const HighlightExtension = Mark.create({
  name: 'highlight',
  // Outermost mark, so `==**a** b==` serializes without being split around bold.
  priority: 1000,

  addStorage() {
    return {
      markdown: {
        serialize: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
        parse: { setup: installHighlightRule },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-highlight]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(HTMLAttributes, {
        'data-highlight': '',
        style: 'background:var(--mark);color:var(--ink)',
      }),
      0,
    ];
  },

  addInputRules() {
    return [
      markInputRule({
        // Matches ==content== at end of typed text; group 1 = content
        find: /==([^=\s][^=]*)==$/ as RegExp,
        type: this.type,
      }),
    ];
  },
});
