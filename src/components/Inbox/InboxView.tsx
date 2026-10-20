import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { File, FileText, Image, Inbox, Link2, Mic, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { useVaultStore } from '../../store/vaultStore';
import { useInboxStore } from '../../store/inboxStore';
import { useBrainStore } from '../../store/brainStore';
import { useLlmStore } from '../../store/llmStore';
import { formatDate, formatSize, isBatchable, inboxErrorMessage, kindLabel, pluralize, voiceStatusText } from '../../lib/inbox';
import { AreaMenu } from './AreaMenu';
import { DestinationPicker } from './DestinationPicker';
import type { ClipSummary, InboxItem } from '../../lib/tauri';

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
  if (kind === 'audio') return <Mic {...props} />;
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
  const clipUrl = useInboxStore((s) => s.clipUrl);
  const pickFiles = useInboxStore((s) => s.pickFiles);
  const clipping = useInboxStore((s) => s.clipping);
  const areas = useInboxStore((s) => s.areas);
  const lastArea = useInboxStore((s) => s.lastArea);
  const loadAreas = useInboxStore((s) => s.loadAreas);
  const rememberArea = useInboxStore((s) => s.rememberArea);
  const retryVoice = useInboxStore((s) => s.retryVoice);
  const importOffice = useInboxStore((s) => s.importOffice);
  const importing = useInboxStore((s) => s.importing);
  const allFolders = useInboxStore((s) => s.allFolders);
  const loadAllFolders = useInboxStore((s) => s.loadAllFolders);
  const llmLoaded = useLlmStore((s) => s.loaded);
  const llmActive = useLlmStore((s) => s.active);
  const loadLlm = useLlmStore((s) => s.load);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [lastClip, setLastClip] = useState<ClipSummary | null>(null);
  const [lastImport, setLastImport] = useState<{ stem: string; count: number; destPath: string } | null>(null);
  /** Items waiting for the user to pick an area; `anchor` is the row that opened the menu. */
  const [choosing, setChoosing] = useState<{ list: InboxItem[]; anchor: string } | null>(null);
  /** Item waiting for the user to pick a destination folder before importing. */
  const [destinationFor, setDestinationFor] = useState<InboxItem | null>(null);

  useEffect(() => {
    void loadLlm();
  }, [loadLlm]);

  useEffect(() => {
    if (vaultPath) {
      void load(vaultPath);
      void loadAreas(vaultPath);
      void loadAllFolders(vaultPath);
    }
  }, [vaultPath, load, loadAreas, loadAllFolders]);

  const noConnection = llmLoaded && !llmActive;

  const askArea = (list: InboxItem[], anchor: string) => {
    if (!vaultPath || list.length === 0 || noConnection) return;
    setChoosing({ list, anchor });
  };

  const digestIn = (area: string) => {
    if (!vaultPath || !choosing) return;
    const { list } = choosing;
    setChoosing(null);
    void rememberArea(vaultPath, area);
    void useBrainStore.getState().digest(list, vaultPath, area);
    clearSelection();
    navigate('/brain');
  };

  const menu = (anchor: string) =>
    choosing?.anchor === anchor ? (
      <AreaMenu
        areas={areas}
        lastArea={lastArea}
        count={choosing.list.length}
        onChoose={digestIn}
        onClose={() => setChoosing(null)}
      />
    ) : null;

  const submitUrl = async () => {
    const value = url.trim();
    if (!vaultPath || !value || clipping) return;
    setLastClip(null);
    const summary = await clipUrl(value, vaultPath);
    if (summary) {
      setLastClip(summary);
      setUrl('');
    }
  };

  const supported = items.filter(isBatchable);
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
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <button
            data-testid="add-files"
            onClick={() => vaultPath && void pickFiles(vaultPath)}
            style={BUTTON}
          >
            <File size={14} strokeWidth={1.5} /> Añadir archivo(s)
          </button>
          <button data-testid="add-url" onClick={() => setAdding((v) => !v)} style={BUTTON}>
            <Link2 size={14} strokeWidth={1.5} /> Añadir URL
          </button>
          {chosen.length > 0 && (
            <button
              data-testid="digest-selected"
              onClick={() => askArea(chosen, 'selected')}
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
          {menu('selected')}
        </div>
      </div>
      <p style={{ ...SMALL, margin: 'var(--space-2) 0 var(--space-4)' }}>
        Todo lo que llega sin carpeta aterriza aquí. Digiérelo para convertirlo en notas enlazadas.
      </p>

      {adding && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', margin: '0 0 var(--space-3)' }}>
          <input
            data-testid="clip-url-input"
            aria-label="Dirección de la página"
            placeholder="https://…"
            value={url}
            disabled={clipping}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitUrl();
            }}
            style={{
              flex: 1,
              height: 28,
              padding: '0 var(--space-3)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
            }}
          />
          <button
            data-testid="clip-url-submit"
            onClick={() => void submitUrl()}
            disabled={clipping || url.trim() === ''}
            style={{
              ...BUTTON,
              border: 'none',
              background: 'var(--daun)',
              color: 'var(--on-daun)',
              opacity: clipping || url.trim() === '' ? 0.5 : 1,
            }}
          >
            {clipping ? 'Recortando…' : 'Recortar'}
          </button>
        </div>
      )}
      {lastClip && (
        <p data-testid="clip-result" role="status" style={{ ...SMALL, color: lastClip.clipped ? 'var(--ink-muted)' : 'var(--amber)' }}>
          {lastClip.clipped
            ? `Recortado: «${lastClip.title}» (${pluralize(lastClip.words, 'palabra', 'palabras')}, ${pluralize(lastClip.images_downloaded, 'imagen', 'imágenes')}).`
            : `No se pudo recortar: ${lastClip.failure ?? 'motivo desconocido'}. Guardé el enlace en la entrada para que no se pierda.`}
        </p>
      )}
      {lastImport && (
        <p data-testid="import-result" role="status" style={SMALL}>
          {`Importado: ${pluralize(lastImport.count, 'nota', 'notas')} en ${
            lastImport.destPath ? `${lastImport.destPath}/${lastImport.stem}` : lastImport.stem
          }/.`}
        </p>
      )}

      {noConnection && (
        <p role="status" style={{ ...SMALL, color: 'var(--amber)' }}>
          Para digerir necesitas una conexión de IA activa. Configúrala en Ajustes → Conexiones de IA.
        </p>
      )}
      {error && (
        <p role="alert" style={{ ...SMALL, color: 'var(--danger)' }}>
          {inboxErrorMessage(error)}
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
          <span>La entrada está vacía. Usa «Añadir archivo(s)» o arrastra archivos al panel lateral.</span>
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
                  disabled={!isBatchable(it)}
                  onChange={() => toggle(it.rel_path)}
                />
                <KindIcon kind={it.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                  <div style={SMALL}>
                    {kindLabel(it.kind)} · {formatSize(it.size)} · {formatDate(it.added_ms)}
                    {!it.supported && it.kind !== 'audio' && ' · formato no soportado todavía'}
                  </div>
                  {it.voice && (
                    <div
                      data-testid={`voice-status-${it.name}`}
                      role="status"
                      style={{ ...SMALL, color: it.voice.state === 'error' ? 'var(--danger)' : 'var(--ink-muted)' }}
                    >
                      {voiceStatusText(it.voice)}
                    </div>
                  )}
                </div>
                {(it.kind === 'docx' || it.kind === 'pptx') && (
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <button
                      data-testid={`import-${it.name}`}
                      onClick={() => {
                        if (!vaultPath || importing) return;
                        setDestinationFor(it);
                      }}
                      disabled={importing}
                      style={{ ...BUTTON, opacity: importing ? 0.5 : 1 }}
                    >
                      Importar
                    </button>
                    {destinationFor?.rel_path === it.rel_path && (
                      <DestinationPicker
                        folders={allFolders}
                        onConfirm={async (destPath) => {
                          setDestinationFor(null);
                          if (!vaultPath) return;
                          const r = await importOffice(it, vaultPath, destPath);
                          if (r) setLastImport(r);
                        }}
                        onClose={() => setDestinationFor(null)}
                      />
                    )}
                  </span>
                )}
                {isBatchable(it) && (
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <button
                      data-testid={`digest-${it.name}`}
                      onClick={() => askArea([it], it.rel_path)}
                      disabled={noConnection}
                      style={{ ...BUTTON, opacity: noConnection ? 0.5 : 1 }}
                    >
                      <Sparkles size={14} strokeWidth={1.5} color="var(--daun)" /> Digerir
                    </button>
                    {menu(it.rel_path)}
                  </span>
                )}
                {it.voice?.state === 'error' && (
                  <button
                    data-testid={`retry-${it.name}`}
                    onClick={() => vaultPath && void retryVoice(it, vaultPath)}
                    style={BUTTON}
                  >
                    <RotateCw size={14} strokeWidth={1.5} color="var(--daun)" /> Reintentar
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
