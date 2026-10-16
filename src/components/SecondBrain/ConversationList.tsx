import React, { useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useBrainStore } from '../../store/brainStore';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';

interface ConversationListProps {
  vaultPath: string;
}

export function ConversationList({ vaultPath }: ConversationListProps): JSX.Element {
  const conversations = useBrainStore((s) => s.filteredConversations());
  const currentConversationId = useBrainStore((s) => s.currentConversationId);
  const filterQuery = useBrainStore((s) => s.filterQuery);
  const selectConversation = useBrainStore((s) => s.selectConversation);
  const startNewConversation = useBrainStore((s) => s.startNewConversation);
  const deleteConversation = useBrainStore((s) => s.deleteConversation);
  const setFilterQuery = useBrainStore((s) => s.setFilterQuery);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (deleteTargetId) {
      await deleteConversation(deleteTargetId);
      setDeleteTargetId(null);
    }
  };

  return (
    <>
      <div
        data-testid="conversation-list"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Header: New conversation button */}
        <div style={{ padding: 'var(--space-2)' }}>
          <button
            data-testid="new-conversation-btn"
            onClick={startNewConversation}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              width: '100%',
              padding: 'var(--space-2) var(--space-3)',
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--sans)',
              fontSize: '0.875rem',
              color: 'var(--ink)',
              cursor: 'pointer',
            }}
          >
            <Plus size={16} strokeWidth={1.5} />
            Nueva conversación
          </button>
        </div>

        {/* Search input */}
        <div
          style={{
            padding: '0 var(--space-2) var(--space-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            margin: '0 var(--space-2) var(--space-2)',
          }}
        >
          <Search size={14} strokeWidth={1.5} color="var(--ink-muted)" />
          <input
            data-testid="conv-search-input"
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Buscar conversaciones…"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontFamily: 'var(--sans)',
              fontSize: '0.8125rem',
              color: 'var(--ink)',
              outline: 'none',
              padding: 'var(--space-1) 0',
            }}
          />
        </div>

        {/* Conversation list */}
        <ul
          style={{
            flex: 1,
            overflowY: 'auto',
            margin: 0,
            padding: '0 var(--space-2)',
            listStyle: 'none',
          }}
        >
          {conversations.map((conv) => (
            <li
              key={conv.id}
              data-testid={`conv-item-${conv.id}`}
              onClick={() => selectConversation(conv.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-2) var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: conv.id === currentConversationId ? 'var(--surface)' : 'transparent',
                marginBottom: 'var(--space-1)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: '0.8125rem',
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {conv.title}
              </span>
              <button
                data-testid={`conv-delete-${conv.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTargetId(conv.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 'var(--space-1)',
                  color: 'var(--ink-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
                aria-label="Eliminar conversación"
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Eliminar conversación"
        description="Esta acción no se puede deshacer. Se eliminará la conversación y todos sus mensajes."
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </>
  );
}
