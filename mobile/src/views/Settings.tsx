import { useApp, type Theme } from '../store/appStore';
import { navigate } from '../router';
import { BackBar, Page, secondaryBtn } from '../components/ui';

const THEMES: [Theme, string][] = [
  ['system', 'Sistema'],
  ['light', 'Claro'],
  ['dark', 'Oscuro'],
];

export function Settings() {
  const { config, theme, setTheme, signOut } = useApp();

  const out = async () => {
    if (!window.confirm('¿Cerrar sesión? Se borrarán las notas guardadas en este móvil.')) return;
    await signOut();
    navigate('#/');
  };

  return (
    <Page>
      <BackBar title="Ajustes" to="#/" />
      {config && (
        <p>
          {config.owner}/{config.repo} · {config.branch}
        </p>
      )}
      <div className="stack">
        <button type="button" style={secondaryBtn} onClick={() => navigate('#/setup')}>
          Cambiar repositorio
        </button>
        <fieldset className="theme">
          <legend>Apariencia</legend>
          {THEMES.map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="theme" checked={theme === value} onChange={() => setTheme(value)} /> {label}
            </label>
          ))}
        </fieldset>
        <button type="button" style={{ ...secondaryBtn, color: 'var(--danger)' }} onClick={() => void out()}>
          Cerrar sesión
        </button>
      </div>
    </Page>
  );
}
