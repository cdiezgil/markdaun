import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AttachmentChips } from './AttachmentChips';
import type { ChatAttachment } from '../../lib/attachments/types';

const a = (name: string, kind: 'image' | 'pdf'): ChatAttachment => ({
  vaultPath: name,
  absPath: `/v/${name}`,
  name,
  kind,
});

describe('AttachmentChips', () => {
  it('renders nothing without attachments', () => {
    const { container } = render(<AttachmentChips attachments={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a chip per attachment with its name and kind', () => {
    render(<AttachmentChips attachments={[a('flujo.png', 'image'), a('doc.pdf', 'pdf')]} onRemove={vi.fn()} />);
    expect(screen.getByText('flujo.png')).toBeInTheDocument();
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('chip-flujo.png')).toHaveAttribute('data-kind', 'image');
    expect(screen.getByTestId('chip-doc.pdf')).toHaveAttribute('data-kind', 'pdf');
  });

  it('removes with the ✕ button', async () => {
    const onRemove = vi.fn();
    render(<AttachmentChips attachments={[a('flujo.png', 'image')]} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar flujo.png' }));
    expect(onRemove).toHaveBeenCalledWith('flujo.png');
  });
});
