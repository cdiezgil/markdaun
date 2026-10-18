import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { File, FileText, Image, Inbox, Sparkles, Trash2 } from 'lucide-react';
import { useVaultStore } from '../../store/vaultStore';
import { useInboxStore } from '../../store/inboxStore';
import { useBrainStore } from '../../store/brainStore';
import { useLlmStore } from '../../store/llmStore';
import { formatDate, formatSize, kindLabel } from '../../lib/inbox';
import type { InboxItem } from '../../lib/tauri';

const SMALL: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--ink-muted)',
};

const BUTTON: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  height: 28,
  padding: '0 var(--space-3)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  cursor: 'pointer',
};

function KindIcon({ kind }: { kind: InboxItem['kind'] }): JSX.Element {
  const props = { size: 16, strokeWidth: 1.5, color: 'var(--ink-muted)' };
  if (kind === 'md' || kind === 'txt' || kind === 'pdf' || kind === 'docx' || kind === 'pptx') return <FileText {...props} />;
  if (kind === 'image') return <Image {...props} />;
  return <File {...props} />;
}

export function InboxView(): JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const items = useInboxStore((s) => s.items);
  const selected = useInboxStore((s) => s.selected);
  const error = useInboxStore((s) => s.error);
  const load = useInboxStore((s) => s.load);
  const toggle = useInboxStore((s) => s.toggle);
  const selectAll = useInboxStore((s) => s.selectAll);
  const clearSelection = useInboxStore((s) => s.clearSelection);
  const discard = useInboxStore((s) => s.discard);
  const llmLoaded = useLlmStore((s) => s.loaded);
  const llmActive = useLlmStore((s) => s.active);
  const loadLlm = useLlmStore((s) => s.load);
  const navigate = useNavigate();

  useEffect(() => {
    void loadLlm();
  }, [loadLlm]);

  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, load]);

  const noConnection = llmLoaded && !llmActive;

  const digest = (list: InboxItem[]) => {
    if (!vaultPath || list.length === 0 || noConnection) return;
    void useBrainStore.getState().digest(list, vaultPath);
    clearSelection();
    navigate('/brain');
  };

  const supported = items.filter((i) => i.supported);
  const chosen = selected
    .map((rel) => items.find((i) => i.rel_path === rel))
    .filter((i): i is InboxItem => !!i);

  return (
    <div
      data-testid="inbox-view"
      style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-8)', fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>Entrada</h1>
        {chosen.length > 0 && (
          <button
            data-testid="digest-selected"
            onClick={() => digest(chosen)}
            disabled={noConnection}
            style={{
              ...BUTTON,
              border: 'none',
              background: 'var(--daun)',
              color: 'var(--on-daun)',
              opacity: noConnection ? 0.5 : 1,
            }}
          >
            <Sparkles size={14} strokeWidth={1.5} /> Digerir seleccionados ({chosen.length})
          </button>
        )}
      </div>
      <p style={{ ...SMALL, margin: 'var(--space-2) 0 var(--space-4)' }}>
        Todo lo que llega sin carpeta aterriza aquí. Digiérelo para convertirlo en notas enlazadas.
      </p>

      {noConnection && (
        <p role="status" style={{ ...SMALL, color: 'var(--amber)' }}>
          Para digerir necesitas una conexión de IA activa. Configúrala en Ajustes → Conexiones de IA.
        </p>
      )}
      {error && (
        <p role="alert" style={{ ...SMALL, color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-12) 0',
            color: 'var(--ink-muted)',
            textAlign: 'center',
          }}
        >
          <Inbox size={32} strokeWidth={1.5} />
          <span>La entrada está vacía. Arrastra archivos a la bóveda y llegarán aquí.</span>
        </div>
      ) : (
        <>
          {supported.length > 1 && (
            <button
              type="button"
              onClick={() => (selected.length === supported.length ? clearSelection() : selectAll())}
              style={{ ...SMALL, background: 'transparent', border: 'none', color: 'var(--daun)', cursor: 'pointer', padding: 0, marginBottom: 'var(--space-2)' }}
            >
              {selected.length === supported.length ? 'Quitar selección' : 'Seleccionar todo'}
            </button>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--line)' }}>
            {items.map((it) => (
              <li
                key={it.rel_path}
                data-testid={`inbox-item-${it.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) 0',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <input
                  type="checkbox"
                  data-testid={`select-${it.name}`}
                  aria-label={`Seleccionar ${it.name}`}
                  checked={selected.includes(it.rel_path)}
                  disabled={!it.supported}
                  onChange={() => toggle(it.rel_path)}
                />
                <KindIcon kind={it.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                  <div style={SMALL}>
                    {kindLabel(it.kind)} · {formatSize(it.size)} · {formatDate(it.added_ms)}
                    {!it.supported && ' · formato no soportado todavía'}
                  </div>
                </div>
                {it.supported && (
                  <button
                    data-testid={`digest-${it.name}`}
                    onClick={() => digest([it])}
                    disabled={noConnection}
                    style={{ ...BUTTON, opacity: noConnection ? 0.5 : 1 }}
                  >
                    <Sparkles size={14} strokeWidth={1.5} color="var(--daun)" /> Digerir
                  </button>
                )}
                <button
                  data-testid={`discard-${it.name}`}
                  onClick={() => vaultPath && void discard(it, vaultPath)}
                  aria-label={`Descartar ${it.name}`}
                  style={{ ...BUTTON, color: 'var(--ink-muted)' }}
                >
                  <Trash2 size={14} strokeWidth={1.5} /> Descartar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
