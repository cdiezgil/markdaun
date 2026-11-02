import { useMemo, useState } from 'react';
import { Mic, RefreshCw, Settings as Cog } from 'lucide-react';
import { errorMessage, relativeTime, useApp } from '../store/appStore';
import { navigate, noteHref } from '../router';
import { Page, primaryBtn } from '../components/ui';
import { inputStyle } from '../components/ui';
import { FolderList } from './Folders';

export function Home() {
  const { index, status, lastRefresh, error, pending, notice, refreshNow } = useApp();
  const [q, setQ] = useState('');
  const hits = useMemo(() => index.search(q), [index, q]);

  const statusText =
    status === 'refreshing'
      ? 'Actualizando…'
      : status === 'offline'
        ? 'Sin conexión'
        : lastRefresh
          ? `Actualizado ${relativeTime(lastRefresh)}`
          : '';

  return (
    <Page>
      <header className="bar">
        <strong style={{ flex: 1 }}>MarkDaun</strong>
        <button type="button" className="icon-btn" aria-label="Actualizar" onClick={() => void refreshNow()}>
          <RefreshCw size={20} strokeWidth={1.5} />
        </button>
        <button type="button" className="icon-btn" aria-label="Ajustes" onClick={() => navigate('#/settings')}>
          <Cog size={20} strokeWidth={1.5} />
        </button>
      </header>
      <input
        type="search"
        style={inputStyle}
        placeholder="Buscar en tus notas"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="muted" role="status">
        {statusText}
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {errorMessage(error)}{' '}
          {error.kind === 'Unauthorized' && <a href="#/settings">Abrir ajustes</a>}
        </p>
      )}
      {pending > 0 && (
        <p className="muted">{pending === 1 ? '1 nota pendiente de subir' : `${pending} notas pendientes de subir`}</p>
      )}
      <button type="button" style={{ ...primaryBtn, width: '100%' }} onClick={() => navigate('#/record')}>
        <Mic size={20} strokeWidth={1.5} aria-hidden style={{ verticalAlign: 'middle', marginRight: 8 }} />
        Dictar nota
      </button>
      {q.trim() ? (
        hits.length ? (
          <ul className="list">
            {hits.map((h) => (
              <li key={h.path}>
                <a href={noteHref(h.path, q.trim())}>
                  <strong>{h.title}</strong>
                  {h.folder && <span className="muted"> · {h.folder}</span>}
                  <span className="snippet" dangerouslySetInnerHTML={{ __html: h.snippet }} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Sin resultados</p>
        )
      ) : (
        <FolderList path="" />
      )}
    </Page>
  );
}
