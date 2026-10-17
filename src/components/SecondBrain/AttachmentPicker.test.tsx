import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AttachmentPicker } from './AttachmentPicker';
import { useVaultStore, type VaultEntry } from '../../store/vaultStore';

const tree: VaultEntry[] = [
  { name: 'nota.md', path: '/v/nota.md', kind: 'file', file_type: 'md' },
  { name: 'flujo.png', path: '/v/diagramas/flujo.png', kind: 'file', file_type: 'image' },
  {
    name: 'docs',
    path: '/v/docs',
    kind: 'folder',
    children: [{ name: 'spec.pdf', path: '/v/docs/spec.pdf', kind: 'file', file_type: 'pdf' }],
  },
  { name: 'x.py', path: '/v/x.py', kind: 'file', file_type: 'other' },
];

beforeEach(() => {
  useVaultStore.setState({ vaultPath: '/v', tree });
});

describe('AttachmentPicker', () => {
  it('lists only images and PDFs, including nested ones', () => {
    render(<AttachmentPicker onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('diagramas/flujo.png')).toBeInTheDocument();
    expect(screen.getByText('docs/spec.pdf')).toBeInTheDocument();
    expect(screen.queryByText('nota.md')).not.toBeInTheDocument();
    expect(screen.queryByText('x.py')).not.toBeInTheDocument();
  });

  it('picks a file as a vault-relative chat attachment', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<AttachmentPicker onPick={onPick} onClose={onClose} />);
    await userEvent.click(screen.getByText('docs/spec.pdf'));
    expect(onPick).toHaveBeenCalledWith({
      vaultPath: 'docs/spec.pdf',
      absPath: '/v/docs/spec.pdf',
      name: 'spec.pdf',
      kind: 'pdf',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('explains when the vault has no images or PDFs', () => {
    useVaultStore.setState({ tree: [tree[0]] });
    render(<AttachmentPicker onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/No hay imágenes ni PDFs/)).toBeInTheDocument();
  });

  it('closes with Escape', async () => {
    const onClose = vi.fn();
    render(<AttachmentPicker onPick={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
