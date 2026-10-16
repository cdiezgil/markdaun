import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useFileNavigation } from './useFileNavigation';
import type { VaultEntry } from '../store/vaultStore';
import React from 'react';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(MemoryRouter, null, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TC-06: navegar a .md', () => {
  it('TC-06: navigateToFile de .md navega a /editor/<encodedPath>', () => {
    const { result } = renderHook(() => useFileNavigation(), { wrapper });
    const entry: VaultEntry = {
      name: 'nota.md',
      path: '/vault/nota.md',
      kind: 'file',
      file_type: 'md',
    };

    result.current.navigateToFile(entry);

    expect(mockNavigate).toHaveBeenCalledWith(
      `/editor/${encodeURIComponent('/vault/nota.md')}`,
    );
  });
});

describe('TC-07: navegar a imagen', () => {
  it('TC-07: navigateToFile de imagen navega a /preview/<encodedPath>', () => {
    const { result } = renderHook(() => useFileNavigation(), { wrapper });
    const entry: VaultEntry = {
      name: 'foto.png',
      path: '/vault/foto.png',
      kind: 'file',
      file_type: 'image',
    };

    result.current.navigateToFile(entry);

    expect(mockNavigate).toHaveBeenCalledWith(
      `/preview/${encodeURIComponent('/vault/foto.png')}`,
    );
  });
});

describe('TC-08: fichero other no navega', () => {
  it('TC-08: navigateToFile de fichero other no llama a navigate', () => {
    const { result } = renderHook(() => useFileNavigation(), { wrapper });
    const entry: VaultEntry = {
      name: 'script.py',
      path: '/vault/script.py',
      kind: 'file',
      file_type: 'other',
    };

    result.current.navigateToFile(entry);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
