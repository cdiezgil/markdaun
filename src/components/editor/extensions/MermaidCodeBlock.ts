import CodeBlock from '@tiptap/extension-code-block';
import { ReactNodeViewRenderer } from '@tiptap/react';

import CodeBlockNodeView from '../MermaidView';

export const MERMAID_TEMPLATE = 'flowchart TD\n  A[Inicio] --> B[Fin]';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Insert a mermaid code block with a starter template and open it in edit mode. */
      insertMermaid: () => ReturnType;
    };
  }
}

export interface MermaidStorage {
  /** Set by `insertMermaid`; consumed by the next mermaid node view that mounts. */
  openNext: boolean;
}

/**
 * StarterKit's code block, with ```mermaid blocks rendered as diagrams.
 * Markdown (de)serialization is inherited unchanged, so files stay standard Markdown.
 */
export const MermaidCodeBlock = CodeBlock.extend<Record<string, never>, MermaidStorage>({
  addStorage() {
    return { openNext: false };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      insertMermaid:
        () =>
        ({ editor, commands }) => {
          (editor.storage as unknown as Record<string, MermaidStorage>)[this.name].openNext = true;
          return commands.insertContent({
            type: this.name,
            attrs: { language: 'mermaid' },
            content: [{ type: 'text', text: MERMAID_TEMPLATE }],
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});
