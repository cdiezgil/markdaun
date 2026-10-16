import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/editorStore';
import { EditorView } from './EditorView';

// ── Component mocks ───────────────────────────────────────────────────────────
vi.mock('../components/editor/EditorToolbar', () => ({
  default: ({ editor }: { editor: unknown }) => (
    <div data-testid="editor-toolbar" data-has-editor={editor ? 'true' : 'false'} />
  ),
}));

vi.mock('../components/editor/EditorCanvas', () => ({
  // Minimal mock: does not call onEditorReady to avoid setState-in-render loops
  default: (_props: { onEditorReady?: (e: unknown) => void }) => (
    <div data-testid="editor-canvas" />
  ),
}));

vi.mock('../components/editor/SaveIndicator', () => ({
  default: () => <div data-testid="save-indicator" />,
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeNotePath: null,
    activeNoteContent: null,
    vaultPath: '/vault',
    vaultTree: [],
    saveStatus: 'idle',
  });
});

function renderEditorView(path?: string) {
  const route = path ? `/editor/${encodeURIComponent(path)}` : '/';
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/editor/:encodedPath" element={<EditorView />} />
        <Route path="/" element={<EditorView />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── TC-01: renders empty state when no note active ────────────────────────────
describe('TC-01: EditorView — no active note', () => {
  it('TC-01: renders empty state div when activeNotePath is null', () => {
    renderEditorView();
    expect(screen.getByTestId('editor-empty')).toBeDefined();
  });

  it('TC-01: empty state has bg token background', () => {
    renderEditorView();
    const el = screen.getByTestId('editor-empty');
    expect(el.style.background).toBe('var(--bg)');
  });
});

// ── TC-01: renders full layout when note is active ───────────────────────────
describe('TC-01: EditorView — active note', () => {
  beforeEach(() => {
    useEditorStore.setState({ activeNotePath: '/vault/note.md' });
  });

  it('TC-01: renders toolbar', () => {
    renderEditorView('/vault/note.md');
    expect(screen.getByTestId('editor-toolbar')).toBeDefined();
  });

  it('TC-01: renders canvas', () => {
    renderEditorView('/vault/note.md');
    expect(screen.getByTestId('editor-canvas')).toBeDefined();
  });

  it('TC-03: renders save indicator', () => {
    renderEditorView('/vault/note.md');
    expect(screen.getByTestId('save-indicator')).toBeDefined();
  });

  it('TC-01: layout wrapper is flex column', () => {
    renderEditorView('/vault/note.md');
    const wrapper = screen.getByTestId('editor-view');
    expect(wrapper.style.flexDirection).toBe('column');
  });
});

// ── TC-21: openNote called when URL param changes ─────────────────────────────
describe('TC-21: EditorView — openNote from URL param', () => {
  it('TC-21: calls openNote when filePath param is present', async () => {
    mockInvoke.mockResolvedValueOnce('# Content');
    renderEditorView('/vault/nota.md');

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('read_note', {
        path: '/vault/nota.md',
        vaultPath: '/vault',
      });
    });
  });
});

// ── TC-21: switching notes ─────────────────────────────────────────────────────
describe('TC-21: switching active note', () => {
  it('TC-21: activeNotePath updates after openNote', async () => {
    useEditorStore.setState({ activeNotePath: '/vault/nota-a.md' });
    mockInvoke.mockResolvedValueOnce('# B contenido');

    await useEditorStore.getState().openNote('/vault/nota-b.md');

    expect(useEditorStore.getState().activeNotePath).toBe('/vault/nota-b.md');
  });
});
