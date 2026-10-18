import React, { useCallback, useEffect, useState } from 'react';
import { useVaultStore } from '../../store/vaultStore';
import { trashDelete, trashList, trashRestore, type TrashItem } from '../../lib/tauri';
import { formatDate, formatSize } from '../../lib/inbox';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';

const SMALL: React.CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)' };

const BUTTON: React.CSSProperties = {
  height: 28,
  padding: '0 var(--space-3)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  cursor: 'pointer',
};

/** Settings → Papelera: items discarded from the inbox, restorable. */
export function Trash(): JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<TrashItem | null>(null);

  const reload = useCallback(async () => {
    if (!vaultPath) return;
    try {
      setItems((await trashList(vaultPath)) ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [vaultPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const restore = async (item: TrashItem) => {
    if (!vaultPath) return;
    try {
      await trashRestore(item.id, vaultPath);
      await useVaultStore.getState().refreshTree();
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (item: TrashItem) => {
    setConfirm(null);
    if (!vaultPath) return;
    try {
      await trashDelete(item.id, vaultPath);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section data-testid="trash-section" style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-2)' }}>Papelera</h2>
      <p style={{ ...SMALL, margin: '0 0 var(--space-4)' }}>
        Lo que descartas de la Entrada se guarda aquí, fuera del árbol y del índice, hasta que lo restaures o lo elimines.
      </p>
      {error && (
        <p role="alert" style={{ ...SMALL, color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p style={{ ...SMALL, margin: 0 }}>La papelera está vacía.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--line)' }}>
          {items.map((it) => (
            <li
              key={it.id}
              data-testid={`trash-item-${it.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                <div style={SMALL}>
                  {it.original_path} · {formatSize(it.size)} · {formatDate(it.deleted_ms)}
                </div>
              </div>
              <button data-testid={`restore-${it.id}`} style={BUTTON} onClick={() => void restore(it)}>
                Restaurar
              </button>
              <button
                data-testid={`delete-${it.id}`}
                style={{ ...BUTTON, color: 'var(--danger)' }}
                onClick={() => setConfirm(it)}
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title="Eliminar definitivamente"
        message={confirm ? `«${confirm.name}» se borrará del disco y no se podrá recuperar.` : ''}
        confirmLabel="Eliminar definitivamente"
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
