import { useState, type FormEvent } from 'react';
import { useApp } from '../store/appStore';
import { navigate } from '../router';
import { inputStyle, Page, primaryBtn, secondaryBtn } from '../components/ui';

export function Setup() {
  const connect = useApp((s) => s.connect);
  const config = useApp((s) => s.config);
  const [repo, setRepo] = useState(config ? `${config.owner}/${config.repo}` : '');
  const [branch, setBranch] = useState(config?.branch ?? 'main');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = /^\s*([\w.-]+)\/([\w.-]+)\s*$/.exec(repo);
    if (!m) {
      setError('Escribe el repositorio como usuario/nombre');
      return;
    }
    if (!token.trim()) {
      setError('Pega el token de GitHub');
      return;
    }
    setBusy(true);
    setError('');
    const err = await connect({ owner: m[1], repo: m[2], branch: branch.trim() || 'main' }, token.trim());
    setBusy(false);
    if (err) setError(err);
    else navigate('#/');
  };

  return (
    <Page>
      <h1>Conecta tu repositorio</h1>
      <form onSubmit={submit} className="stack">
        <label>
          Repositorio (usuario/nombre)
          <input style={inputStyle} value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="none" autoCorrect="off" />
        </label>
        <label>
          Rama
          <input style={inputStyle} value={branch} onChange={(e) => setBranch(e.target.value)} autoCapitalize="none" autoCorrect="off" />
        </label>
        <label>
          Token de GitHub
          <input style={inputStyle} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </label>
        <p className="muted">
          Crea un token de acceso fine-grained limitado solo a este repositorio, con el permiso{' '}
          <em>Contents: Read and write</em>. Se guarda únicamente en este móvil.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" style={primaryBtn} disabled={busy}>
          Conectar
        </button>
        {config && (
          <button type="button" style={secondaryBtn} onClick={() => navigate('#/settings')}>
            Cancelar
          </button>
        )}
      </form>
    </Page>
  );
}
