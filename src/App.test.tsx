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

  async function setSync(hasChanges: boolean) {
    const { useSyncStore } = await import('./store/syncStore');
    useSyncStore.setState({
      config: { repoUrl: 'https://github.com/x/y', isConnected: true },
      status: { hasChanges },
    });
  }

  const requestQuit = async () => {
    await waitFor(() => expect(handlers.has('request-quit')).toBe(true));
    await act(async () => handlers.get('request-quit')!({}));
  };

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

  it('Salir con sync conectado y cambios pendientes muestra el diálogo y no sale todavía', async () => {
    await setSync(true);
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith('quit_app');
  });

  it('"Salir sin sincronizar" sale de verdad', async () => {
    await setSync(true);
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(await screen.findByRole('button', { name: /salir sin sincronizar/i }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quit_app'));
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
  });

  it('"Cancelar" cierra el diálogo y la app sigue viva', async () => {
    await setSync(true);
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(await screen.findByRole('button', { name: /cancelar/i }));
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalledWith('quit_app');
  });

  it('sin cambios pendientes, Salir sale directamente', async () => {
    await setSync(false);
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quit_app'));
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
  });

  it('sin sync conectado, Salir sale directamente', async () => {
    const { useSyncStore } = await import('./store/syncStore');
    useSyncStore.setState({ config: { repoUrl: '', isConnected: false }, status: { hasChanges: true } });
    mockInvoke.mockResolvedValue(null);
    render(<App />);
    await requestQuit();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quit_app'));
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
