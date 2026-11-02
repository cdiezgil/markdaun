import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import type { GitHubClient } from './github/client';
import { AppError } from './github/errors';
import { App } from './App';
import { DB_NAME, resetAppForTests, useApp } from './store/appStore';
import { openDb } from './store/db';
import * as queue from './capture/queue';

const fake = vi.hoisted(() => ({
  client: null as unknown as GitHubClient,
}));
vi.mock('./github/client', async (orig) => ({
  ...(await orig<typeof import('./github/client')>()),
  createClient: () => fake.client,
}));
vi.mock('./capture/Recorder', () => ({
  Recorder: ({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) => (
    <div>
      <button onClick={onSaved}>fake-saved</button>
      <button onClick={onClose}>fake-close</button>
    </div>
  ),
}));

const NOTES: Record<string, string> = {
  'Cocina/Pasta.md': '# Pasta\n\nHerve la pasta con [[Salsa]] y unas _gambas_ al ajillo.\n',
  'Cocina/Salsa.md': '# Salsa\n\nTomate y albahaca.\n',
  'Inicio.md': '# Inicio\n\nHola mundo\n',
  '.hidden/x.md': 'secreto',
};

function makeClient(over: Partial<GitHubClient> = {}): GitHubClient {
  const entries = Object.keys(NOTES).map((path) => ({ path, sha: `sha-${path}`, type: 'blob' as const }));
  return {
    checkAccess: async () => {},
    getTree: async () => ({ sha: 'tree1', entries }),
    fetchTexts: async (items) => new Map(items.map((i) => [i.path, NOTES[i.path]])),
    getRaw: async () => new Blob([]),
    putNewFile: async () => 'created',
    ...over,
  };
}

async function seedConfig() {
  const db = await openDb(DB_NAME);
  await db.put('meta', { owner: 'o', repo: 'r', branch: 'main', token: 'tok' }, 'config');
  db.close();
}

beforeEach(async () => {
  await deleteDB(DB_NAME);
  localStorage.clear();
  window.location.hash = '';
  document.documentElement.removeAttribute('data-theme');
  resetAppForTests();
  fake.client = makeClient();
});
afterEach(async () => {
  cleanup();
  // Let background refresh/drain settle before the database goes away.
  await waitFor(() => expect(useApp.getState().status).not.toBe('refreshing'));
  await new Promise((r) => setTimeout(r, 30));
  useApp.getState().db?.close();
  vi.restoreAllMocks();
});

describe('Setup', () => {
  it('setup validates then shows home', async () => {
    const user = userEvent.setup();
    const check = vi.fn(async () => {});
    fake.client = makeClient({ checkAccess: check });
    render(<App />);
    await user.type(await screen.findByLabelText('Repositorio (usuario/nombre)'), 'o/r');
    await user.type(screen.getByLabelText('Token de GitHub'), 'tok');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByPlaceholderText('Buscar en tus notas')).toBeInTheDocument();
    expect(check).toHaveBeenCalled();
    const db = useApp.getState().db!;
    expect(await db.get('meta', 'config')).toEqual({ owner: 'o', repo: 'r', branch: 'main', token: 'tok' });
    expect(localStorage.length).toBe(0); // the token never reaches localStorage
  });

  it('setup shows NotFound message', async () => {
    const user = userEvent.setup();
    fake.client = makeClient({
      checkAccess: async () => {
        throw new AppError('NotFound');
      },
    });
    render(<App />);
    await user.type(await screen.findByLabelText('Repositorio (usuario/nombre)'), 'o/r');
    await user.type(screen.getByLabelText('Token de GitHub'), 'tok');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No encuentro el repositorio o la rama');
    expect(await useApp.getState().db!.get('meta', 'config')).toBeUndefined();
  });

  it('rejects malformed input without calling GitHub', async () => {
    const user = userEvent.setup();
    const check = vi.fn(async () => {});
    fake.client = makeClient({ checkAccess: check });
    render(<App />);
    await user.type(await screen.findByLabelText('Repositorio (usuario/nombre)'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('usuario/nombre');
    await user.clear(screen.getByLabelText('Repositorio (usuario/nombre)'));
    await user.type(screen.getByLabelText('Repositorio (usuario/nombre)'), 'o/r');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pega el token');
    expect(check).not.toHaveBeenCalled();
  });
});

describe('Home and notes', () => {
  beforeEach(seedConfig);

  it('home search lists results and opens a note', async () => {
    const user = userEvent.setup();
    render(<App />);
    const box = await screen.findByPlaceholderText('Buscar en tus notas');
    await screen.findByText('Actualizado hace un momento');
    await user.type(box, 'gambas');
    const hit = await screen.findByRole('link', { name: /Pasta/ });
    expect(hit.querySelector('mark')).not.toBeNull();
    await user.click(hit);
    expect(await screen.findByText(/Herve la pasta/)).toBeInTheDocument();
    expect(window.location.hash).toContain('#/note/Cocina/Pasta.md?q=gambas');
  });

  it('wikilink tap navigates', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/note/Cocina/Pasta.md';
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Salsa' }));
    expect(await screen.findByText('Tomate y albahaca.')).toBeInTheDocument();
  });

  it('shows a missing note message', async () => {
    window.location.hash = '#/note/Nada.md';
    render(<App />);
    expect(await screen.findByText('No encuentro esta nota.')).toBeInTheDocument();
  });

  it('lists folders first and hides dot paths', async () => {
    const user = userEvent.setup();
    render(<App />);
    const root = await screen.findByRole('list');
    await waitFor(() => expect(within(root).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Cocina', 'Inicio']));
    await user.click(within(root).getByRole('link', { name: /Cocina/ }));
    expect(await screen.findByRole('link', { name: /Pasta/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByPlaceholderText('Buscar en tus notas')).toBeInTheDocument();
  });

  it('unauthorized keeps notes', async () => {
    // First a good refresh so notes are stored, then a 401.
    render(<App />);
    await screen.findByRole('link', { name: /Inicio/ });
    cleanup();
    useApp.getState().db?.close();
    resetAppForTests();
    fake.client = makeClient({
      getTree: async () => {
        throw new AppError('Unauthorized');
      },
    });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Token no válido o caducado');
    expect(screen.getByRole('link', { name: 'Abrir ajustes' })).toHaveAttribute('href', '#/settings');
    expect(screen.getByRole('link', { name: /Inicio/ })).toBeInTheDocument();
  });

  it('shows offline status and keeps notes', async () => {
    fake.client = makeClient({
      getTree: async () => {
        throw new AppError('Offline');
      },
    });
    render(<App />);
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
  });

  it('manual refresh button refreshes', async () => {
    const user = userEvent.setup();
    const getTree = vi.fn(makeClient().getTree);
    fake.client = makeClient({ getTree });
    render(<App />);
    await screen.findByText('Actualizado hace un momento');
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(getTree.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('pending count updates after recording', async () => {
    const user = userEvent.setup();
    const putNewFile = vi.fn(async () => 'created' as const);
    fake.client = makeClient({ putNewFile });
    render(<App />);
    await screen.findByText('Actualizado hace un momento');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30)); // let the initial refresh/drain settle
    });
    const db = useApp.getState().db!;
    await queue.enqueue(db, new Blob([new Uint8Array([1])]), 'audio/webm', new Date());
    const drainSpy = vi.spyOn(queue, 'drainQueue').mockResolvedValue({ uploaded: 0 });
    await user.click(screen.getByRole('button', { name: 'Dictar nota' }));
    const saved = await screen.findByRole('button', { name: 'fake-saved' });
    await act(async () => {
      fireEvent.click(saved);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(await screen.findByText('1 nota pendiente de subir')).toBeInTheDocument();
    expect(screen.getByText('Nota guardada; se subirá a Entrada')).toBeInTheDocument();
    expect(drainSpy).toHaveBeenCalled();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  it('pull-to-refresh at the top triggers a refresh; a short pull does not', async () => {
    const getTree = vi.fn(makeClient().getTree);
    fake.client = makeClient({ getTree });
    const { container } = render(<App />);
    await screen.findByText('Actualizado hace un momento');
    const n = getTree.mock.calls.length;
    const area = container.querySelector('main > div') as HTMLElement;
    fireEvent.touchStart(area, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientY: 130 }] });
    await act(async () => {});
    expect(getTree.mock.calls.length).toBe(n);
    fireEvent.touchStart(area, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientY: 200 }] });
    await waitFor(() => expect(getTree.mock.calls.length).toBeGreaterThan(n));
  });

  it('pull-to-refresh is ignored when the page is scrolled', async () => {
    const getTree = vi.fn(makeClient().getTree);
    fake.client = makeClient({ getTree });
    const { container } = render(<App />);
    await screen.findByText('Actualizado hace un momento');
    const n = getTree.mock.calls.length;
    const area = container.querySelector('main > div') as HTMLElement;
    Object.defineProperty(window, 'scrollY', { value: 50, configurable: true });
    fireEvent.touchStart(area, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientY: 300 }] });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    await act(async () => {});
    expect(getTree.mock.calls.length).toBe(n);
  });

  it('the saved notice disappears after leaving Home', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Actualizado hace un momento');
    act(() => useApp.getState().setNotice('Nota guardada; se subirá a Entrada'));
    expect(screen.getByText('Nota guardada; se subirá a Entrada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajustes' }));
    await screen.findByText('Apariencia');
    expect(useApp.getState().notice).toBeUndefined();
  });

  it('the saved notice clears itself after about 4 seconds', async () => {
    render(<App />);
    await screen.findByText('Actualizado hace un momento');
    vi.useFakeTimers();
    act(() => useApp.getState().setNotice('hola'));
    expect(useApp.getState().notice).toBe('hola');
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(useApp.getState().notice).toBeUndefined();
    vi.useRealTimers();
  });

  it('record close returns home', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/record';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'fake-close' }));
    expect(await screen.findByPlaceholderText('Buscar en tus notas')).toBeInTheDocument();
  });

  it('refreshes when the page becomes visible or goes online', async () => {
    const getTree = vi.fn(makeClient().getTree);
    fake.client = makeClient({ getTree });
    render(<App />);
    await screen.findByText('Actualizado hace un momento');
    const n = getTree.mock.calls.length;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(getTree.mock.calls.length).toBeGreaterThan(n));
    const m = getTree.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(getTree.mock.calls.length).toBeGreaterThan(m));
  });
});

describe('Settings', () => {
  beforeEach(seedConfig);

  it('sign out wipes data', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.location.hash = '#/settings';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(confirm).toHaveBeenCalledWith('¿Cerrar sesión? Se borrarán las notas guardadas en este móvil.');
    expect(await screen.findByText('Conecta tu repositorio')).toBeInTheDocument();
    const db = await openDb(DB_NAME);
    expect(await db.get('meta', 'config')).toBeUndefined();
    expect(await db.count('notes')).toBe(0);
    db.close();
  });

  it('sign out cancelled keeps data', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.location.hash = '#/settings';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(screen.getByText('Apariencia')).toBeInTheDocument();
    expect(useApp.getState().config).not.toBeNull();
  });

  it('theme persists', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/settings';
    render(<App />);
    await user.click(await screen.findByLabelText('Oscuro'));
    expect(localStorage.getItem('markdaun:theme')).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByLabelText('Sistema'));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('change repository opens the setup form and drops old notes', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/settings';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Cambiar repositorio' }));
    const repo = await screen.findByLabelText('Repositorio (usuario/nombre)');
    expect(repo).toHaveValue('o/r');
    await user.clear(repo);
    await user.type(repo, 'o/otro');
    await user.type(screen.getByLabelText('Token de GitHub'), 'tok2');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByPlaceholderText('Buscar en tus notas')).toBeInTheDocument();
    expect(useApp.getState().config?.repo).toBe('otro');
  });
});

describe('Repo changes and sign-out safety', () => {
  beforeEach(seedConfig);

  async function toSetup(user: ReturnType<typeof userEvent.setup>) {
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByText('Apariencia');
    await user.click(screen.getByRole('button', { name: 'Cambiar repositorio' }));
    return screen.findByLabelText('Repositorio (usuario/nombre)');
  }

  it('blocks changing repository while recordings are pending', async () => {
    const user = userEvent.setup();
    const check = vi.fn(async () => {});
    fake.client = makeClient({ checkAccess: check, putNewFile: () => new Promise(() => {}) });
    await seedPendingFirst();
    const repo = await toSetup(user);
    await user.clear(repo);
    await user.type(repo, 'o/otro');
    await user.type(screen.getByLabelText('Token de GitHub'), 'tok2');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Hay 1 nota de voz pendiente de subir al repositorio actual. Espera a que se suban antes de cambiar.',
    );
    expect(useApp.getState().config?.repo).toBe('r');
    expect(check).not.toHaveBeenCalled();
  });

  it('allows re-entering the same repository with a new token while pending', async () => {
    const user = userEvent.setup();
    fake.client = makeClient({ putNewFile: () => new Promise(() => {}) });
    await seedPendingFirst();
    await toSetup(user);
    await user.type(screen.getByLabelText('Token de GitHub'), 'nuevo');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByPlaceholderText('Buscar en tus notas')).toBeInTheDocument();
    expect(useApp.getState().config?.token).toBe('nuevo');
  });

  it('Cancelar returns from the setup form to settings', async () => {
    const user = userEvent.setup();
    await toSetup(user);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Apariencia')).toBeInTheDocument();
  });

  it('discards the result of a refresh that finishes after the repository changed', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = makeClient();
    // First client (old repo) is slow; the second (new repo) has other notes.
    const slow = makeClient({
      getTree: async () => {
        await gate;
        return real.getTree();
      },
    });
    const next = makeClient({
      getTree: async () => ({ sha: 'tree2', entries: [{ path: 'Nuevo.md', sha: 'n1', type: 'blob' as const }] }),
      fetchTexts: async () => new Map([['Nuevo.md', '# Nuevo\n']]),
    });
    fake.client = slow;
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => expect(useApp.getState().status).toBe('refreshing'));
    // The user switches repository while the old refresh is still in flight.
    fake.client = next;
    window.location.hash = '#/setup';
    const repo = await screen.findByLabelText('Repositorio (usuario/nombre)');
    await user.clear(repo);
    await user.type(repo, 'o/otro');
    await user.type(screen.getByLabelText('Token de GitHub'), 'tok2');
    const click = user.click(screen.getByRole('button', { name: 'Conectar' }));
    await new Promise((r) => setTimeout(r, 30));
    release();
    await click;
    await screen.findByRole('link', { name: /Nuevo/ });
    expect(screen.queryByRole('link', { name: /Inicio/ })).toBeNull();
    expect(useApp.getState().allPaths).toEqual(['Nuevo.md']);
  });

  it('sign-out confirm mentions unsent recordings', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fake.client = makeClient({ putNewFile: () => new Promise(() => {}) });
    await seedPendingFirst();
    window.location.hash = '#/settings';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(confirm).toHaveBeenCalledWith(
      '¿Cerrar sesión? Se borrarán las notas guardadas en este móvil y 1 nota de voz sin subir.',
    );
  });

  it('sign-out during an upload settles cleanly and a reconnect works', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finish!: (v: 'created') => void;
    fake.client = makeClient({ putNewFile: () => new Promise((r) => (finish = r)) });
    await seedPendingFirst();
    window.location.hash = '#/settings';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await screen.findByText('Conecta tu repositorio');
    finish('created'); // the dead upload resolves after sign-out: must not throw or touch state
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useApp.getState().config).toBeNull();
    expect(useApp.getState().error).toBeUndefined();
    fake.client = makeClient();
    await user.type(screen.getByLabelText('Repositorio (usuario/nombre)'), 'o/r');
    await user.type(screen.getByLabelText('Token de GitHub'), 'tok');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByPlaceholderText('Buscar en tus notas')).toBeInTheDocument();
  });
});

// Starts the app once so the db exists, queues one recording, then tears down so the test can render fresh.
async function seedPendingFirst() {
  const db = await openDb(DB_NAME);
  await queue.enqueue(db, new Blob([new Uint8Array([1])]), 'audio/webm', new Date());
  db.close();
}
