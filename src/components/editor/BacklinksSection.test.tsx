import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';

import BacklinksSection from './BacklinksSection';

const mockInvoke = vi.mocked(invoke);
const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderSection() {
  return render(
    <MemoryRouter>
      <BacklinksSection notePath="/vault/a.md" vaultPath="/vault" />
    </MemoryRouter>,
  );
}

describe('BacklinksSection', () => {
  it('requests backlinks for the note and shows count and chips', async () => {
    mockInvoke.mockResolvedValueOnce([
      { path: '/vault/b.md', name: 'b' },
      { path: '/vault/c.md', name: 'c' },
    ]);
    renderSection();
    await waitFor(() => expect(screen.getByText('Enlazada desde')).toBeDefined());
    expect(mockInvoke).toHaveBeenCalledWith('get_backlinks', { path: '/vault/a.md', vaultPath: '/vault' });
    expect(screen.getByTestId('backlinks-count').textContent).toBe('2');
    expect(screen.getByText('b')).toBeDefined();
    expect(screen.getByText('c')).toBeDefined();
  });

  it('navigates to the linking note on click', async () => {
    mockInvoke.mockResolvedValueOnce([{ path: '/vault/b.md', name: 'b' }]);
    renderSection();
    fireEvent.click(await screen.findByText('b'));
    expect(navigate).toHaveBeenCalledWith(`/editor/${encodeURIComponent('/vault/b.md')}`);
  });

  it('renders nothing when there are no backlinks', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    renderSection();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(screen.queryByTestId('backlinks-section')).toBeNull();
  });

  it('renders nothing when the command fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    renderSection();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(screen.queryByTestId('backlinks-section')).toBeNull();
  });
});
