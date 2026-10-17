import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { App } from './App';
import { useVaultStore } from './store/vaultStore';
import React from 'react';

const mockInvoke = vi.mocked(invoke);
const mockGetCurrentWindow = vi.mocked(getCurrentWindow);

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

describe('guarda de cierre de ventana', () => {
  let closeHandler: ((event: { preventDefault(): void }) => void) | undefined;
  const mockClose = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    closeHandler = undefined;
    mockGetCurrentWindow.mockReturnValue({
      onCloseRequested: vi.fn((cb: (event: { preventDefault(): void }) => void) => {
        closeHandler = cb;
        return Promise.resolve(() => {});
      }),
      close: mockClose,
    } as unknown as ReturnType<typeof getCurrentWindow>);
  });

  function triggerClose() {
    const event = { preventDefault: vi.fn() };
    closeHandler!(event);
    return event;
  }

  it('con sync conectado y cambios pendientes, el cierre se intercepta y muestra el diálogo', async () => {
    const { useSyncStore } = await import('./store/syncStore');
    useSyncStore.setState({
      config: { repoUrl: 'https://github.com/x/y', isConnected: true },
      status: { hasChanges: true },
    });
    mockInvoke.mockResolvedValue(null);
    render(<App />);

    await waitFor(() => expect(closeHandler).toBeDefined());
    const event = triggerClose();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
  });

  it('"Salir sin sincronizar" cierra la ventana sin re-interceptar el cierre', async () => {
    const { useSyncStore } = await import('./store/syncStore');
    useSyncStore.setState({
      config: { repoUrl: 'https://github.com/x/y', isConnected: true },
      status: { hasChanges: true },
    });
    mockInvoke.mockResolvedValue(null);
    render(<App />);

    await waitFor(() => expect(closeHandler).toBeDefined());
    triggerClose();
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const quitButton = await screen.findByRole('button', { name: /salir sin sincronizar/i });
    await user.click(quitButton);

    await waitFor(() => expect(mockClose).toHaveBeenCalled());
    // La segunda pasada por el guarda (la de window.close()) no debe re-abrir el diálogo
    triggerClose();
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
  });

  it('sin cambios pendientes, el cierre no se intercepta', async () => {
    const { useSyncStore } = await import('./store/syncStore');
    useSyncStore.setState({
      config: { repoUrl: 'https://github.com/x/y', isConnected: true },
      status: { hasChanges: false },
    });
    mockInvoke.mockResolvedValue(null);
    render(<App />);

    await waitFor(() => expect(closeHandler).toBeDefined());
    const event = triggerClose();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
  });
});
