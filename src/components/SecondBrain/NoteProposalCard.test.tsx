import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { NoteProposalCard } from './NoteProposalCard';

const mockInvoke = vi.mocked(invoke);

function backend(opts: { exists?: boolean; tail?: string; writeError?: string } = {}) {
  mockInvoke.mockImplementation((async (cmd: string) => {
    if (cmd === 'note_exists') return opts.exists ?? false;
    if (cmd === 'read_note_tail') return opts.tail ?? '';
    if (cmd === 'chat_write_note') {
      if (opts.writeError) throw opts.writeError;
      return '/vault/Folder/new.md';
    }
    return undefined;
  }) as never);
}

const create = { path: 'Folder/new.md', mode: 'create' as const, content: '# New\nbody' };
const append = { path: 'old.md', mode: 'append' as const, content: 'more text' };

function setup(proposal = create, over: Partial<React.ComponentProps<typeof NoteProposalCard>> = {}) {
  const onOpen = vi.fn();
  const onWritten = vi.fn();
  render(
    <NoteProposalCard proposal={proposal} vaultPath="/vault" onOpen={onOpen} onWritten={onWritten} {...over} />,
  );
  return { onOpen, onWritten };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('NoteProposalCard', () => {
  it('create: shows editable path, preview, and creates on click', async () => {
    backend();
    const { onWritten, onOpen } = setup();
    expect(screen.getByTestId('proposal-path')).toHaveValue('Folder/new.md');
    expect(screen.getByTestId('proposal-preview')).toHaveTextContent('# New');
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('note_exists', { path: 'Folder/new.md', vaultPath: '/vault' }));
    fireEvent.click(screen.getByTestId('proposal-accept'));
    await waitFor(() => expect(screen.getByTestId('proposal-done')).toHaveTextContent('Created'));
    expect(mockInvoke).toHaveBeenCalledWith('chat_write_note', {
      path: 'Folder/new.md', content: '# New\nbody', mode: 'create', vaultPath: '/vault',
    });
    expect(onWritten).toHaveBeenCalledWith('/vault/Folder/new.md', 'create');
    fireEvent.click(screen.getByText('Open'));
    expect(onOpen).toHaveBeenCalledWith('/vault/Folder/new.md');
  });

  it('create uses the edited path', async () => {
    backend();
    setup();
    fireEvent.change(screen.getByTestId('proposal-path'), { target: { value: 'Other/x.md' } });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('note_exists', { path: 'Other/x.md', vaultPath: '/vault' }));
    fireEvent.click(screen.getByTestId('proposal-accept'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('chat_write_note', expect.objectContaining({ path: 'Other/x.md' })),
    );
  });

  it('create: disables Create for a non-.md path', async () => {
    backend();
    setup();
    fireEvent.change(screen.getByTestId('proposal-path'), { target: { value: 'x.txt' } });
    expect(screen.getByTestId('proposal-accept')).toBeDisabled();
  });

  it('create when the file exists: shows Already exists and offers Append instead', async () => {
    backend({ exists: true, tail: 'last line' });
    setup();
    expect(await screen.findByText('Already exists')).toBeInTheDocument();
    expect(screen.queryByTestId('proposal-accept')).not.toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Append instead'));
    expect(await screen.findByTestId('proposal-tail')).toHaveTextContent('last line');
    expect(screen.getByTestId('proposal-accept')).toHaveTextContent('Append');
  });

  it('append: shows the tail muted and the new content highlighted', async () => {
    backend({ exists: true, tail: 'line 7\nline 8' });
    setup(append);
    expect(await screen.findByTestId('proposal-tail')).toHaveTextContent('line 8');
    expect(mockInvoke).toHaveBeenCalledWith('read_note_tail', { path: 'old.md', vaultPath: '/vault', lines: 8 });
    expect(screen.getByTestId('proposal-preview').style.background).toBe('var(--mark)');
    fireEvent.click(screen.getByTestId('proposal-accept'));
    await waitFor(() => expect(screen.getByTestId('proposal-done')).toHaveTextContent('Appended'));
    expect(mockInvoke).toHaveBeenCalledWith('chat_write_note', {
      path: 'old.md', content: 'more text', mode: 'append', vaultPath: '/vault',
    });
  });

  it('append to a missing note offers Create instead', async () => {
    backend({ exists: false });
    setup(append);
    fireEvent.click(await screen.findByText('Create instead'));
    expect(screen.getByTestId('proposal-accept')).toHaveTextContent('Create');
  });

  it('discard collapses the card', async () => {
    backend();
    setup();
    fireEvent.click(screen.getByTestId('proposal-discard'));
    expect(screen.getByTestId('proposal-done')).toHaveTextContent('Discarded');
    expect(mockInvoke).not.toHaveBeenCalledWith('chat_write_note', expect.anything());
  });

  it('shows write errors inline and stays actionable', async () => {
    backend({ writeError: 'already_exists' });
    setup();
    fireEvent.click(screen.getByTestId('proposal-accept'));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByTestId('proposal-accept')).toBeInTheDocument();
  });
});
