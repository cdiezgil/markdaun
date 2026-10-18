import React, { useState } from 'react';
import { Plus, Search, Settings, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useVaultStore } from '../../store/vaultStore';
import { countVaultEntries, formatVaultCounts } from '../../lib/vaultCounts';
import { groupByDay, timeLabel } from '../../lib/chat/groupByDay';
import './brain.css';
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
  const tree = useVaultStore((s) => s.tree);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (deleteTargetId) {
      await deleteConversation(deleteTargetId);
      setDeleteTargetId(null);
    }
  };

  const groups = groupByDay(conversations);
  const counts = formatVaultCounts(countVaultEntries(tree));

  return (
    <>
      <div
        data-testid="conversation-list"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          background: 'var(--surface-sunken)',
        }}
      >
        <div style={{ padding: 'var(--space-4) var(--space-2) 0' }}>
          <button
            data-testid="new-conversation-btn"
            onClick={startNewConversation}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              width: '100%',
              height: 36,
              marginBottom: 'var(--space-3)',
              background: 'var(--daun)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              lineHeight: '18px',
              fontWeight: 500,
              color: 'var(--on-daun)',
              cursor: 'pointer',
            }}
          >
            <Plus size={16} strokeWidth={1.5} />
            Nueva conversación
          </button>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              height: 32,
              padding: '0 10px',
              marginBottom: 'var(--space-4)',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <Search size={15} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
            <input
              data-testid="conv-search-input"
              type="text"
              aria-label="Buscar conversaciones"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Buscar conversaciones"
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                background: 'transparent',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                lineHeight: '18px',
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
          </label>
        </div>

        <div className="brain-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-2)' }}>
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} style={{ marginBottom: 'var(--space-4)' }}>
              <div
                style={{
                  padding: '0 10px 6px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  lineHeight: '16px',
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-muted)',
                }}
              >
                {group.label}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.items.map((conv) => {
                  const active = conv.id === currentConversationId;
                  return (
                    <li
                      key={conv.id}
                      data-testid={`conv-item-${conv.id}`}
                      className="conv-item"
                      onClick={() => selectConversation(conv.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--space-2)',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        background: active ? 'var(--bg)' : 'transparent',
                        color: active ? 'var(--daun)' : 'var(--ink)',
                        fontWeight: active ? 500 : 400,
                      }}
                    >
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontSize: 14,
                            lineHeight: '20px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {conv.title}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontSize: 12,
                            lineHeight: '16px',
                            fontWeight: 400,
                            color: 'var(--ink-muted)',
                          }}
                        >
                          {timeLabel(conv.created_at)}
                        </span>
                      </span>
                      <button
                        data-testid={`conv-delete-${conv.id}`}
                        className="conv-del"
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
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div
          data-testid="vault-footer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            margin: '0 var(--space-2)',
            padding: 'var(--space-2) var(--space-1) var(--space-2) var(--space-2)',
            borderTop: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)' }}>
            {counts}
          </span>
          <Link
            to="/settings"
            title="Ajustes"
            aria-label="Ajustes"
            data-testid="settings-link"
            className="md-hover"
            style={{
              width: 32,
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--ink-muted)',
            }}
          >
            <Settings size={18} strokeWidth={1.5} />
          </Link>
        </div>
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
