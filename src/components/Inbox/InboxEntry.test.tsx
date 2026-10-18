import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { InboxEntry } from './InboxEntry';
import { useVaultStore } from '../../store/vaultStore';
import { useInboxStore } from '../../store/inboxStore';
import type { InboxItem } from '../../lib/tauri';

const load = vi.fn();
const item = (n: string): InboxItem => ({
  name: n, path: `/v/Entrada/${n}`, rel_path: `Entrada/${n}`, kind: 'md', size: 1, added_ms: 1, supported: true,
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderEntry(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <InboxEntry />
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: '/v', tree: [] });
  useInboxStore.setState({ items: [], selected: [], loading: false, error: null, load });
});

describe('InboxEntry', () => {
  it('shows the counter next to the name', () => {
    useInboxStore.setState({ items: [item('a.md'), item('b.md'), item('c.md'), item('d.md')] });
    renderEntry();
    expect(screen.getByTestId('inbox-entry')).toHaveTextContent('Entrada · 4');
  });

  it('shows just the name when the inbox is empty', () => {
    renderEntry();
    expect(screen.getByTestId('inbox-entry')).toHaveTextContent(/^Entrada$/);
  });

  it('loads the items on mount and when the vault tree changes', () => {
    renderEntry();
    expect(load).toHaveBeenCalledWith('/v');
    load.mockClear();
    act(() => {
      useVaultStore.setState({ tree: [{ name: 'x.md', path: '/v/x.md', kind: 'file', file_type: 'md' }] });
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('opens the inbox view on click and is marked current there', () => {
    renderEntry();
    fireEvent.click(screen.getByTestId('inbox-entry'));
    expect(screen.getByTestId('where')).toHaveTextContent('/inbox');
    expect(screen.getByTestId('inbox-entry')).toHaveAttribute('aria-current', 'page');
  });
});
