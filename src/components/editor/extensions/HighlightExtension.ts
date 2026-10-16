import { Mark, markInputRule, mergeAttributes } from '@tiptap/core';

/**
 * HighlightExtension — TC-19
 *
 * Recognises ==text== syntax and wraps it in a <mark> element with
 * the design-system token colours.
 *
 * Input rule: typing ==text== at the end of a line applies the mark.
 * Serialisation: tiptap-markdown serialises as ==text== via the marks
 * configuration (see EditorCanvas for the Markdown extension config).
 */
export const HighlightExtension = Mark.create({
  name: 'highlight',

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
