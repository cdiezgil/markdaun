import { useEffect } from 'react';
import { Recorder } from './capture/Recorder';
import { navigate, useRoute } from './router';
import { useApp } from './store/appStore';
import { Folders } from './views/Folders';
import { Home } from './views/Home';
import { NoteView } from './views/NoteView';
import { Settings } from './views/Settings';
import { Setup } from './views/Setup';

export function App() {
  const route = useRoute();
  const { ready, config, db, init, refreshNow, drain, recount, setNotice } = useApp();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!config) return;
    const sync = () => {
      void refreshNow().then(drain);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', sync);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', sync);
    };
  }, [config, refreshNow, drain]);

  if (!ready) return <main className="app" aria-busy="true" />;
  if (!config || route.name === 'setup') return <Setup />;

  switch (route.name) {
    case 'note':
      return <NoteView key={route.path} path={route.path} q={route.q} />;
    case 'folders':
      return <Folders path={route.path} />;
    case 'settings':
      return <Settings />;
    case 'record':
      if (!db) return null;
      return (
        <Recorder
          db={db}
          onClose={() => navigate('#/')}
          onSaved={() => {
            setNotice('Nota guardada; se subirá a Entrada');
            navigate('#/');
            void recount().then(drain);
          }}
        />
      );
    default:
      return <Home />;
  }
}
