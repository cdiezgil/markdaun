import { Extension, InputRule } from '@tiptap/core';

export interface MarkdownTypingOptions {
  /** Maps the path typed in `![alt](path)` to the `src` the editor displays. */
  resolveImageSrc: (path: string) => string;
}

const LINK_RULE = /(^|[^!])\[([^[\]]+)\]\(([^\s)]+)\)$/;
const IMAGE_RULE = /!\[([^[\]]*)\]\(([^\s)]+)\)$/;
const ALLOWED_HREF = /^(https?:\/\/|mailto:)/i;

/**
 * Markdown typing rules that StarterKit and the other extensions do not cover:
 * `[text](url)` becomes a link and `![alt](path)` an image. Neither fires
 * inside code (code blocks are skipped by TipTap; inline code is checked here).
 */
export const MarkdownTyping = Extension.create<MarkdownTypingOptions>({
  name: 'markdownTyping',

  addOptions() {
    return { resolveImageSrc: (p: string) => p };
  },

  addInputRules() {
    const resolveImageSrc = this.options.resolveImageSrc;
    return [
      new InputRule({
        find: IMAGE_RULE,
        handler: ({ state, range, match }) => {
          const image = state.schema.nodes['image'];
          const code = state.schema.marks['code'];
          if (!image) return null;
          if (code && (state.doc.rangeHasMark(range.from, range.to, code) || hasStoredCode(state))) {
            return null;
          }
          const alt = match[1] ?? '';
          const path = match[2] ?? '';
          const src = /^https?:\/\//i.test(path) ? path : resolveImageSrc(path);
          state.tr.replaceWith(range.from, range.to, image.create({ src, alt }));
          return undefined;
        },
      }),
      new InputRule({
        find: LINK_RULE,
        handler: ({ state, range, match }) => {
          const link = state.schema.marks['link'];
          const code = state.schema.marks['code'];
          if (!link) return null;
          if (code && (state.doc.rangeHasMark(range.from, range.to, code) || hasStoredCode(state))) {
            return null;
          }
          const href = match[3] ?? '';
          if (!ALLOWED_HREF.test(href)) return null;
          const lead = (match[1] ?? '').length;
          const text = state.schema.text(match[2] ?? '', [link.create({ href })]);
          state.tr.replaceWith(range.from + lead, range.to, text).removeStoredMark(link);
          return undefined;
        },
      }),
    ];
  },
});

function hasStoredCode(state: { storedMarks: readonly { type: { name: string } }[] | null }): boolean {
  return !!state.storedMarks?.some((m) => m.type.name === 'code');
}
