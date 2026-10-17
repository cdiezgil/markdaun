import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { PreviewPanel } from './PreviewPanel';
import { useBrainStore } from '../../store/brainStore';
import { useVaultStore } from '../../store/vaultStore';
import { explainInNotePrompt } from '../../lib/attachments/prompts';

function renderPanel(filePath: string) {
  return render(
    <MemoryRouter initialEntries={['/preview/x']}>
      <Routes>
        <Route path="/preview/x" element={<PreviewPanel filePath={filePath} />} />
        <Route path="/brain" element={<div data-testid="brain-route" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVaultStore.setState({ vaultPath: '/vault' });
  useBrainStore.setState({ pendingAttachments: [], pendingPrompt: null, messages: [], currentConversationId: null });
});

describe('TC-07: PreviewPanel', () => {
  it('TC-07: .png renderiza un <img>', () => {
    const { container } = renderPanel('/vault/foto.png');
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe('asset:///vault/foto.png');
  });

  it('TC-07: .pdf renderiza un <iframe>', () => {
    const { container } = renderPanel('/vault/doc.pdf');
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute('src')).toBe('asset:///vault/doc.pdf');
  });

  it('TC-07: extensión desconocida devuelve null (nada renderizado)', () => {
    const { container } = renderPanel('/vault/script.py');
    expect(container.firstChild).toBeNull();
  });

  it('TC-07: extensión en mayúsculas (.PNG) funciona igual', () => {
    const { container } = renderPanel('/vault/foto.PNG');
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe('asset:///vault/foto.PNG');
  });
});

describe('AI actions', () => {
  it('«Preguntar a la IA» attaches the file, fills the prompt without sending and opens the chat', async () => {
    renderPanel('/vault/diagramas/flujo.png');
    await userEvent.click(screen.getByRole('button', { name: 'Preguntar a la IA' }));
    const s = useBrainStore.getState();
    expect(s.pendingAttachments).toEqual([
      { vaultPath: 'diagramas/flujo.png', absPath: '/vault/diagramas/flujo.png', name: 'flujo.png', kind: 'image' },
    ]);
    expect(s.pendingPrompt).toMatchObject({ text: '', send: false });
    expect(screen.getByTestId('brain-route')).toBeInTheDocument();
  });

  it('«Explicar en una nota» attaches the file and sends the predefined prompt', async () => {
    renderPanel('/vault/doc.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Explicar en una nota' }));
    const s = useBrainStore.getState();
    expect(s.pendingAttachments[0]).toMatchObject({ vaultPath: 'doc.pdf', kind: 'pdf' });
    expect(s.pendingPrompt).toMatchObject({ send: true });
    expect(s.pendingPrompt?.text).toBe(explainInNotePrompt(s.pendingAttachments[0]));
    expect(screen.getByTestId('brain-route')).toBeInTheDocument();
  });

  it('shows no AI actions for files outside the vault', () => {
    renderPanel('/elsewhere/foto.png');
    expect(screen.queryByRole('button', { name: 'Preguntar a la IA' })).not.toBeInTheDocument();
  });
});
