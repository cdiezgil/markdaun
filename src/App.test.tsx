import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { App } from './App';
import { useVaultStore } from './store/vaultStore';
import React from 'react';

const mockInvoke = vi.mocked(invoke);
const mockGetCurrentWindow = vi.mocked(getCurrentWindow);
const mockListen = vi.mocked(listen);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentWindow.mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof getCurrentWindow>);
  useVaultStore.setState({ vaultPath: null, tree: [], isLoading: false, error: null });
});

describe('TC-01: App renders without crash', () => {
  it('TC-01: renders_without_crash — mounts App without throwing', () => {
    mockInvoke.mockResolvedValue(null);
    expect(() => render(<App />)).not.toThrow();
  });

  it('TC-01: calls initVault (get_active_vault) on mount', async () => {
    mockInvoke.mockResolvedValue(null); // get_active_vault (called twice: loadVault + initVault)
    render(<App />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('get_active_vault'),
    );
  });
});

describe('TC-03: App', () => {
  it('TC-03: llama a loadVault al montar', async () => {
    mockInvoke.mockResolvedValueOnce(null); // get_active_vault
    render(<App />);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('get_active_vault'),
    );
  });

  it('loads the saved GitHub sync config on startup', async () => {
    mockInvoke.mockResolvedValue(null);
    render(<App />);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('github_get_config'),
    );
  });

  it('reloads the GitHub sync config when the active vault changes', async () => {
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('github_get_config'));
    const before = mockInvoke.mock.calls.filter((c) => c[0] === 'github_get_config').length;
    act(() => {
      useVaultStore.setState({ vaultPath: '/other-vault' });
    });
    await waitFor(() =>
      expect(mockInvoke.mock.calls.filter((c) => c[0] === 'github_get_config').length).toBeGreaterThan(before),
    );
  });

  it('TC-03: VaultTree está en el DOM', () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(<App />);
    // VaultEmpty is shown when no vault
    expect(screen.getByText(/nada por aquí todavía/i)).toBeInTheDocument();
  });
});

describe('shell layout', () => {
  it('renders top bar, 264px sidebar, main and status bar filling the viewport', () => {
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    const aside = screen.getByRole('complementary');
    expect(aside.style.width).toBe('var(--sidebar-width)');
    expect(aside.style.borderRight).toBe('1px solid var(--line)');
    expect(aside.style.background).toBe('var(--surface-sunken)');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell').style.height).toBe('100%');
  });

  it('no longer renders the old sidebar Files/Graph/Brain nav', () => {
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
    expect(screen.queryByText('Graph')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notas' })).toBeInTheDocument();
  });
});

describe('Brain sidebar', () => {
  it('shows the conversation list instead of the vault tree on /brain', () => {
    mockInvoke.mockResolvedValue(null);
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    window.history.pushState({}, '', '/brain');
    render(<App />);
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.queryByTestId('vault-tree')).toBeNull();
    window.history.pushState({}, '', '/');
  });
});

describe('presencia en la barra de menús y guarda de salida', () => {
  const handlers = new Map<string, (e: { payload?: unknown }) => void>();

  beforeEach(() => {
    handlers.clear();
    mockListen.mockImplementation((async (name: string, cb: (e: { payload?: unknown }) => void) => {
      handlers.set(name, cb);
      return () => {};
    }) as never);
  });

  async function setSync(connected: boolean) {
    const { useSyncStore } = await import('./store/syncStore');
    useSyncStore.setState({
      config: { repoUrl: 'https://github.com/x/y', isConnected: connected },
      // These tests are about the quit flow: keep the connected state they set
      // instead of reloading it from the (mocked) backend on mount.
      loadConfig: vi.fn().mockResolvedValue(undefined),
      loadState: vi.fn().mockResolvedValue(undefined),
    });
    const { useEditorStore } = await import('./store/editorStore');
    useEditorStore.setState({
      isDirty: false,
      saveBlockedPath: null,
      deferredWrites: {},
      saveHolds: 0,
      activeNotePath: null,
    });
  }

  const requestQuit = async () => {
    await waitFor(() => expect(handlers.has('request-quit')).toBe(true));
    await act(async () => handlers.get('request-quit')!({}));
  };

  const calls = () => mockInvoke.mock.calls.map((c) => c[0]);

  it('ya no intercepta el cierre desde JS: ocultar la ventana lo hace el backend', async () => {
    mockInvoke.mockResolvedValue(null);
    const onCloseRequested = vi.fn().mockResolvedValue(() => {});
    mockGetCurrentWindow.mockReturnValue({
      onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
      onCloseRequested,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    render(<App />);
    await waitFor(() => expect(handlers.has('request-quit')).toBe(true));
    expect(onCloseRequested).not.toHaveBeenCalled();
  });

  it('quit awaits syncBeforeQuit then quits', async () => {
    await setSync(true);
    let finishSync: () => void = () => {};
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'sync_before_quit') return new Promise<void>((r) => (finishSync = r));
      return null;
    }) as never);
    render(<App />);
    await requestQuit();
    expect(await screen.findByText('Sincronizando antes de salir…')).toBeInTheDocument();
    await waitFor(() => expect(calls()).toContain('sync_before_quit'));
    expect(calls()).not.toContain('quit_app');
    await act(async () => finishSync());
    await waitFor(() => expect(calls()).toContain('quit_app'));
    expect(calls().indexOf('sync_before_quit')).toBeLessThan(calls().indexOf('quit_app'));
  });

  it('quits even when syncBeforeQuit fails', async () => {
    await setSync(true);
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'sync_before_quit') throw new Error('boom');
      return null;
    }) as never);
    render(<App />);
    await requestQuit();
    await waitFor(() => expect(calls()).toContain('quit_app'));
  });

  it('quits after the 40 s bound when syncBeforeQuit never answers', async () => {
    await setSync(true);
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'sync_before_quit') return new Promise<void>(() => {});
      return null;
    }) as never);
    render(<App />);
    await waitFor(() => expect(handlers.has('request-quit')).toBe(true));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => handlers.get('request-quit')!({}));
      await act(async () => { await vi.advanceTimersByTimeAsync(39_000); });
      expect(calls()).not.toContain('quit_app');
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(calls()).toContain('quit_app');
    } finally {
      vi.useRealTimers();
    }
  });

  it('without sync connected, quits without calling syncBeforeQuit', async () => {
    await setSync(false);
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    await waitFor(() => expect(calls()).toContain('quit_app'));
    expect(calls()).not.toContain('sync_before_quit');
  });

  it('the editor is read-only from the quit request until the quit is cancelled', async () => {
    await setSync(true);
    const { useEditorStore } = await import('./store/editorStore');
    useEditorStore.setState({ activeNotePath: '/v/a.md', saveBlockedPath: '/v/a.md', isDirty: true });
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    expect(useEditorStore.getState().editLocked).toBe(false);
    await requestQuit();
    expect(useEditorStore.getState().editLocked).toBe(true);
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(useEditorStore.getState().editLocked).toBe(false);
  });

  it('edits that cannot be written ask first; Cancelar aborts without syncing', async () => {
    await setSync(true);
    const { useEditorStore } = await import('./store/editorStore');
    useEditorStore.setState({ activeNotePath: '/v/a.md', saveBlockedPath: '/v/a.md', isDirty: true });
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    expect(
      await screen.findByText('Hay cambios que no se han podido guardar. ¿Salir igualmente?'),
    ).toBeInTheDocument();
    expect(calls()).not.toContain('sync_before_quit');
    expect(calls()).not.toContain('quit_app');
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(calls()).not.toContain('sync_before_quit');
    expect(calls()).not.toContain('quit_app');
    // The quit can be asked again afterwards.
    await requestQuit();
    expect(
      await screen.findByText('Hay cambios que no se han podido guardar. ¿Salir igualmente?'),
    ).toBeInTheDocument();
  });

  it('a hung save asks after 15 s instead of hanging on the notice', async () => {
    await setSync(true);
    const { useEditorStore } = await import('./store/editorStore');
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await waitFor(() => expect(handlers.has('request-quit')).toBe(true));
    const realSaveNow = useEditorStore.getState().saveNow;
    useEditorStore.setState({ saveNow: () => new Promise<void>(() => {}) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => handlers.get('request-quit')!({}));
      expect(screen.getByText('Sincronizando antes de salir…')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      expect(
        screen.getByText('Hay cambios que no se han podido guardar. ¿Salir igualmente?'),
      ).toBeInTheDocument();
      expect(calls()).not.toContain('sync_before_quit');
      expect(calls()).not.toContain('quit_app');
    } finally {
      vi.useRealTimers();
      useEditorStore.setState({ saveNow: realSaveNow });
    }
  });

  it('a failing quit_app after confirming does not leave the app stuck', async () => {
    await setSync(true);
    const { useEditorStore } = await import('./store/editorStore');
    useEditorStore.setState({
      deferredWrites: { '/v/b.md': { content: 'x', vault: '/v', base: null, blocked: true } },
    });
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'quit_app') throw new Error('nope');
      return null;
    }) as never);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);
    await requestQuit();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(screen.queryByTestId('quit-notice')).toBeNull());
    expect(errors).toHaveBeenCalledWith('quit failed:', expect.any(Error));
    // A new quit request is accepted again.
    await requestQuit();
    expect(
      await screen.findByText('Hay cambios que no se han podido guardar. ¿Salir igualmente?'),
    ).toBeInTheDocument();
    errors.mockRestore();
  });

  it('confirming "Salir" syncs and quits despite unwritten edits', async () => {
    await setSync(true);
    const { useEditorStore } = await import('./store/editorStore');
    useEditorStore.setState({
      deferredWrites: { '/v/b.md': { content: 'x', vault: '/v', base: null, blocked: true } },
    });
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(calls()).toContain('quit_app'));
    expect(calls().indexOf('sync_before_quit')).toBeLessThan(calls().indexOf('quit_app'));
  });
});

describe('capturas rápidas', () => {
  const handlers = new Map<string, (e: { payload?: unknown }) => void>();
  beforeEach(() => {
    handlers.clear();
    mockListen.mockImplementation((async (name: string, cb: (e: { payload?: unknown }) => void) => {
      handlers.set(name, cb);
      return () => {};
    }) as never);
  });

  it('muestra "Guardado en Entrada" y refresca la entrada cuando llega una captura', async () => {
    mockInvoke.mockResolvedValue([] as never);
    useVaultStore.setState({ vaultPath: '/v', tree: [], isLoading: false, error: null });
    render(<App />);
    await waitFor(() => expect(handlers.has('inbox-captured')).toBe(true));
    await act(async () =>
      handlers.get('inbox-captured')!({ payload: { kind: 'note', rel_path: 'Entrada/C.md', clipped: null, failure: null } }),
    );
    expect(await screen.findByTestId('toast')).toHaveTextContent('Guardado en Entrada');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_list', { vaultPath: '/v' });
  });

  it('confirma una nota de voz y recarga la entrada cuando cambia la transcripción', async () => {
    mockInvoke.mockResolvedValue([] as never);
    useVaultStore.setState({ vaultPath: '/v', tree: [], isLoading: false, error: null });
    render(<App />);
    await waitFor(() => expect(handlers.has('voice-changed')).toBe(true));
    await act(async () =>
      handlers.get('inbox-captured')!({ payload: { kind: 'voice', rel_path: 'Entrada/N.m4a', clipped: null, failure: null } }),
    );
    expect(await screen.findByTestId('toast')).toHaveTextContent('Transcribiendo');
    mockInvoke.mockClear();
    useVaultStore.setState({ vaultPath: '/v' }); // the mount-time init may have replaced it
    await act(async () => handlers.get('voice-changed')!({}));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('inbox_list', { vaultPath: '/v' }));
  });

  it('avisa cuando solo se pudo guardar el enlace', async () => {
    mockInvoke.mockResolvedValue([] as never);
    render(<App />);
    await waitFor(() => expect(handlers.has('inbox-captured')).toBe(true));
    await act(async () =>
      handlers.get('inbox-captured')!({ payload: { kind: 'clip', rel_path: 'Entrada/h.md', clipped: false, failure: 'HTTP 404' } }),
    );
    expect(await screen.findByTestId('toast')).toHaveTextContent('enlace');
  });
});
