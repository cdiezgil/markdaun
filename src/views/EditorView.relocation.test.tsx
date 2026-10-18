import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/editorStore';
import { EditorView } from './EditorView';

vi.mock('../components/editor/EditorToolbar', () => ({ default: () => <div /> }));
vi.mock('../components/editor/EditorCanvas', () => ({ default: () => <div data-testid="editor-canvas" /> }));

const mockInvoke = vi.mocked(invoke);

function Where() {
  return <div data-testid="where">{decodeURIComponent(useLocation().pathname)}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeNotePath: '/vault/Sin título.md',
    activeNoteContent: '# x',
    vaultPath: '/vault',
    relocation: null,
  });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[`/editor/${encodeURIComponent(path)}`]}>
      <Where />
      <Routes>
        <Route path="/editor/:encodedPath" element={<EditorView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EditorView follows renames of the open note', () => {
  it('updates the URL to the new path without reopening the note', async () => {
    renderAt('/vault/Sin título.md');
    act(() =>
      useEditorStore.setState({
        activeNotePath: '/vault/Idea.md',
        relocation: { from: '/vault/Sin título.md', to: '/vault/Idea.md' },
      }),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/editor//vault/Idea.md');
    expect(mockInvoke).not.toHaveBeenCalledWith('read_note', expect.anything());
  });

  it('ignores relocations that do not concern the URL', () => {
    renderAt('/vault/Sin título.md');
    act(() =>
      useEditorStore.setState({ relocation: { from: '/vault/otra.md', to: '/vault/otra2.md' } }),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/editor//vault/Sin título.md');
  });
});
