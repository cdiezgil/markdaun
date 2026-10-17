import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SaveAsNoteDialog, slugify } from './SaveAsNoteDialog';

const mockInvoke = vi.mocked(invoke);

function setup(over: Partial<React.ComponentProps<typeof SaveAsNoteDialog>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <SaveAsNoteDialog
      open
      content="Answer body"
      conversationTitle="Mi Conversación Útil"
      folders={['', 'Ideas', 'Ideas/Deep']}
      sources={['Notes/a.md', 'b.md']}
      vaultPath="/vault"
      onClose={onClose}
      onSaved={onSaved}
      {...over}
    />,
  );
  return { onClose, onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((async (cmd: string) => {
    if (cmd === 'chat_write_note') return '/vault/x.md';
    return undefined;
  }) as never);
});

describe('slugify', () => {
  it('lowercases, strips accents and non-alphanumerics', () => {
    expect(slugify('Mi Conversación Útil!')).toBe('mi-conversacion-util');
    expect(slugify('   ')).toBe('nota');
  });
});

describe('SaveAsNoteDialog', () => {
  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('defaults the name to the slugified title with .md', () => {
    setup();
    expect(screen.getByTestId('save-note-name')).toHaveValue('mi-conversacion-util.md');
  });

  it('saves to the chosen folder with create mode', async () => {
    const { onSaved } = setup();
    fireEvent.change(screen.getByTestId('save-note-folder'), { target: { value: 'Ideas' } });
    fireEvent.click(screen.getByTestId('save-note-submit'));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('chat_write_note', {
      path: 'Ideas/mi-conversacion-util.md', content: 'Answer body', mode: 'create', vaultPath: '/vault',
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('/vault/x.md'));
  });

  it('appends .md when the name lacks it', async () => {
    setup();
    fireEvent.change(screen.getByTestId('save-note-name'), { target: { value: 'plain' } });
    fireEvent.click(screen.getByTestId('save-note-submit'));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('chat_write_note',
      expect.objectContaining({ path: 'plain.md' })));
  });

  it('includes a Sources section of wikilinks when checked', async () => {
    setup();
    fireEvent.click(screen.getByTestId('save-note-sources'));
    fireEvent.click(screen.getByTestId('save-note-submit'));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('chat_write_note',
      expect.objectContaining({ content: 'Answer body\n\n## Fuentes\n\n- [[a]]\n- [[b]]\n' })));
  });

  it('on already_exists shows an inline error and Append instead', async () => {
    const { onSaved } = setup();
    mockInvoke.mockImplementation((async (_c: string, args: { mode: string }) => {
      if (args.mode === 'create') throw 'already_exists';
      return '/vault/mi-conversacion-util.md';
    }) as never);
    fireEvent.click(screen.getByTestId('save-note-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe');
    fireEvent.click(screen.getByText('Añadir al final en su lugar'));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('chat_write_note',
      expect.objectContaining({ mode: 'append' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('cancel and Escape close', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId('save-note-cancel'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
