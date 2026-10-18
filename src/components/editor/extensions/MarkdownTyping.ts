import { Extension } from '@tiptap/core';

export const MarkdownTyping = Extension.create<{ resolveImageSrc: (path: string) => string }>({
  name: 'markdownTyping',
  addOptions() {
    return { resolveImageSrc: (p: string) => p };
  },
});
