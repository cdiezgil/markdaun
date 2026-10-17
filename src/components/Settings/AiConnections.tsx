import React, { useEffect, useState } from 'react';
import { useLlmStore } from '../../store/llmStore';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import type { Connection } from '../../lib/llm/types';

const button: React.CSSProperties = {
  background: 'var(--surface)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-1) var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

/** Settings section: list, edit, duplicate and delete AI connections. */
export function AiConnections(): JSX.Element {
  const connections = useLlmStore((s) => s.connections);
  const active = useLlmStore((s) => s.active);
  const load = useLlmStore((s) => s.load);
  const openWizard = useLlmStore((s) => s.openWizard);
  const deleteConnection = useLlmStore((s) => s.deleteConnection);
  const error = useLlmStore((s) => s.error);
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section data-testid="ai-connections" style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-4)' }}>Conexiones de IA</h2>

      {connections.length === 0 ? (
        <p data-testid="ai-connections-empty" style={{ fontSize: 14, color: 'var(--ink-muted)', margin: 0 }}>
          Aún no hay ninguna conexión.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {connections.map((c) => (
            <li
              key={c.id}
              data-testid={`ai-connection-${c.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {c.name}
                  {active?.connectionId === c.id && (
                    <span style={{ marginLeft: 'var(--space-2)', fontSize: 12, color: 'var(--daun)' }}>activa</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{c.models.join(', ')}</div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button data-testid={`ai-edit-${c.id}`} style={button} onClick={() => openWizard(c)}>
                  Editar
                </button>
                <button
                  data-testid={`ai-duplicate-${c.id}`}
                  style={button}
                  onClick={() => openWizard({ ...c, id: '', name: `${c.name} (copia)` })}
                >
                  Duplicar
                </button>
                <button
                  data-testid={`ai-delete-${c.id}`}
                  style={{ ...button, color: 'var(--danger)' }}
                  onClick={() => setPendingDelete(c)}
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>}

      <button
        data-testid="ai-add"
        onClick={() => openWizard()}
        style={{
          marginTop: 'var(--space-3)',
          background: 'var(--daun)',
          color: 'var(--on-daun)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-2) var(--space-4)',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Añadir conexión
      </button>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar conexión"
        description={`Se borrará «${pendingDelete?.name ?? ''}» y su clave del llavero.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          const id = pendingDelete?.id;
          setPendingDelete(null);
          if (id) await deleteConnection(id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
