import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Leaf } from 'lucide-react';
import { useBrainStore } from '../../store/brainStore';
import { plural } from '../../lib/shell';
import type { GraphNodeData } from '../../store/graphStore';

interface GraphNoteCardProps {
  node: GraphNodeData;
}

const strong: React.CSSProperties = { color: 'var(--ink)', fontWeight: 600 };

/** Top-right card for the selected node: path, title, excerpt, counters, actions. */
export function GraphNoteCard({ node }: GraphNoteCardProps) {
  const navigate = useNavigate();
  const askWithAttachments = useBrainStore((s) => s.askWithAttachments);
  const isNote = node.kind === 'md';

  const open = () => {
    const route = isNote ? 'editor' : 'preview';
    navigate(`/${route}/${encodeURIComponent(node.path)}`);
  };
  const ask = () => {
    askWithAttachments([], { text: `Háblame de [[${node.label}]]`, send: false });
    navigate('/brain');
  };

  return (
    <aside
      aria-label="Nota seleccionada"
      data-testid="graph-note-card"
      style={{
        position: 'absolute',
        top: 'var(--space-6)',
        right: 'var(--space-6)',
        zIndex: 10,
        width: 300,
        boxSizing: 'border-box',
        padding: 'calc(var(--space-4) + var(--space-1))',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-pop)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ fontSize: '12px', lineHeight: '16px', color: 'var(--ink-muted)' }}>
        {node.folder || 'Bóveda'}
      </div>
      <h2
        data-testid="graph-note-title"
        style={{
          margin: 'var(--space-2) 0',
          fontFamily: 'var(--font-display)',
          fontSize: '28px',
          lineHeight: '34px',
          fontWeight: 400,
          color: 'var(--ink)',
        }}
      >
        {node.label}
      </h2>
      {node.excerpt && (
        <p
          data-testid="graph-note-excerpt"
          style={{
            margin: '0 0 var(--space-4)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            lineHeight: '20px',
            color: 'var(--ink-muted)',
          }}
        >
          {node.excerpt}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          fontSize: '12px',
          lineHeight: '16px',
          color: 'var(--ink-muted)',
        }}
      >
        <span>
          <strong style={strong}>{node.links}</strong> {plural(node.links, 'enlace', 'enlaces')}
        </span>
        <span>
          <strong style={strong}>{node.backlinks}</strong>{' '}
          {plural(node.backlinks, 'backlink', 'backlinks')}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          data-testid="graph-note-open"
          onClick={open}
          style={{
            height: 34,
            padding: '0 var(--space-3)',
            border: 0,
            borderRadius: 'var(--radius-md)',
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {isNote ? 'Abrir nota' : 'Abrir'}
        </button>
        {isNote && (
          <button
            type="button"
            data-testid="graph-note-ask"
            onClick={ask}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              height: 34,
              padding: '0 var(--space-3)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <Leaf size={14} strokeWidth={1.5} color="var(--daun)" aria-hidden="true" />
            Preguntar
          </button>
        )}
      </div>
    </aside>
  );
}
