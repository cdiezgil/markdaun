import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Pencil } from 'lucide-react';

import { renderMermaid } from '../../lib/mermaid/render';
import type { MermaidStorage } from './extensions/MermaidCodeBlock';

const DEBOUNCE_MS = 300;

/** Bumps whenever the app theme changes (data-theme or the OS color scheme). */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mql = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    mql?.addEventListener?.('change', bump);
    return () => {
      observer.disconnect();
      mql?.removeEventListener?.('change', bump);
    };
  }, []);
  return version;
}

function MermaidBlock({ node, editor, getPos, extension }: NodeViewProps) {
  const storage = (editor.storage as unknown as Record<string, MermaidStorage>)[extension.name];
  const source = node.textContent;
  const [editing, setEditing] = useState<boolean>(() => storage.openNext);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const themeVersion = useThemeVersion();
  const hasSvg = useRef(false);

  const selectInside = useCallback(() => {
    const pos = getPos();
    if (typeof pos === 'number') editor.commands.setTextSelection(pos + 1);
  }, [editor, getPos]);

  // Consume the "open next" flag and put the cursor in a freshly inserted block.
  useEffect(() => {
    if (storage.openNext) {
      storage.openNext = false;
      selectInside();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render (debounced after the first successful render).
  useEffect(() => {
    if (source.trim() === '') {
      hasSvg.current = false;
      setSvg(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await renderMermaid(source);
      if (cancelled) return;
      if ('svg' in result) {
        hasSvg.current = true;
        setSvg(result.svg);
        setError(null);
      } else {
        setError(result.error);
      }
    }, hasSvg.current ? DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, themeVersion]);

  // Leave edit mode when the selection moves outside this block.
  useEffect(() => {
    if (!editing) return;
    const onSelection = () => {
      const pos = getPos();
      if (typeof pos !== 'number') return;
      const { from, to } = editor.state.selection;
      if (from < pos || to > pos + node.nodeSize) setEditing(false);
    };
    editor.on('selectionUpdate', onSelection);
    return () => {
      editor.off('selectionUpdate', onSelection);
    };
  }, [editing, editor, getPos, node.nodeSize]);

  const openEditor = () => {
    selectInside();
    setEditing(true);
  };

  // A block that never rendered (or is empty) can only be shown as source.
  const showSource = editing || svg === null;

  return (
    <NodeViewWrapper
      className="mermaid-block"
      data-testid="mermaid-block"
      data-editing={showSource ? 'true' : 'false'}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Escape') setEditing(false);
      }}
    >
      <div className="mermaid-diagram-row" contentEditable={false}>
        {svg !== null && (
          <div
            className="mermaid-diagram"
            onClick={openEditor}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        <button
          type="button"
          className="mermaid-edit-button"
          aria-label="Editar diagrama"
          title="Editar diagrama"
          data-active={editing ? 'true' : 'false'}
          onClick={openEditor}
        >
          <Pencil size={20} strokeWidth={1.5} />
        </button>
      </div>
      <pre className="mermaid-source" data-testid="mermaid-source" hidden={!showSource}>
        <NodeViewContent as="code" />
      </pre>
      {error !== null && (
        <div role="alert" className="mermaid-error" contentEditable={false}>
          {error}
        </div>
      )}
    </NodeViewWrapper>
  );
}

function PlainCodeBlock({ node }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  return (
    <NodeViewWrapper as="pre">
      <NodeViewContent as="code" className={language ? `language-${language}` : undefined} />
    </NodeViewWrapper>
  );
}

/** Node view for every code block: mermaid ones render as diagrams, the rest stay plain. */
export default function CodeBlockNodeView(props: NodeViewProps) {
  return props.node.attrs.language === 'mermaid' ? (
    <MermaidBlock {...props} />
  ) : (
    <PlainCodeBlock {...props} />
  );
}
