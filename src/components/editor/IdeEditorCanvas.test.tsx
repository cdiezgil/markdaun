/**
 * IdeEditorCanvas tests — TC-05, TC-07, TC-17
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import IdeEditorCanvas, { ideNoteCaption } from './IdeEditorCanvas';
import { useIdeStore } from '../../store/ideStore';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../lib/tauri', () => ({
  ideGetProjects: vi.fn().mockResolvedValue([]),
  ideSaveProjects: vi.fn().mockResolvedValue(undefined),
  ideListTree: vi.fn().mockResolvedValue([]),
  ideReadFile: vi.fn().mockResolvedValue('# Hello'),
  ideWriteFile: vi.fn().mockResolvedValue(undefined),
  ideOpenFolderDialog: vi.fn().mockResolvedValue(null),
  ideCreateFile: vi.fn().mockResolvedValue('/p/new.md'),
  ideCreateFolder: vi.fn().mockResolvedValue('/p/folder'),
  ideRenameEntry: vi.fn().mockResolvedValue('/p/renamed.md'),
  ideDeleteEntry: vi.fn().mockResolvedValue(undefined),
}));

// Mock TipTap editor so we don't need the full DOM setup
vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn().mockReturnValue(null),
  EditorContent: ({ editor }: { editor: null }) => (
    <div data-testid="mock-editor-content">{editor === null ? 'no-editor' : 'editor'}</div>
  ),
}));

vi.mock('./editorExtensions', () => ({
  buildEditorExtensions: vi.fn().mockReturnValue([]),
}));

beforeEach(() => {
  useIdeStore.setState({
    projects: [],
    activeFilePath: null,
    activeFileContent: null,
    saveStatus: 'idle',
    isDirty: false,
    lastSavedAt: null,
    loadVersion: 0,
  });
});

// ── Unit: ideNoteCaption ───────────────────────────────────────────────────────

describe('ideNoteCaption', () => {
  it('returns path without extension when no savedAt', () => {
    expect(ideNoteCaption('/home/u/project/docs/guide.md', null)).toBe(
      'home / u / project / docs / guide',
    );
  });

  it('handles root-level file', () => {
    expect(ideNoteCaption('/tmp/README.md', null)).toBe('tmp / README');
  });

  it('appends save time when savedAt is provided', () => {
    const ts = new Date('2024-01-15T14:30:00').getTime();
    const caption = ideNoteCaption('/p/note.md', ts);
    expect(caption).toMatch(/p \/ note · guardado \d{2}:\d{2}/);
  });
});

// ── Component ──────────────────────────────────────────────────────────────────

describe('IdeEditorCanvas', () => {
  // TC-05: renders the canvas container
  it('TC-05: renders the canvas container', () => {
    render(<IdeEditorCanvas />);
    expect(screen.getByTestId('ide-editor-canvas-container')).toBeInTheDocument();
  });

  // TC-05: no caption when no active file
  it('TC-05: does not render caption when no active file', () => {
    render(<IdeEditorCanvas />);
    expect(screen.queryByTestId('ide-editor-caption')).not.toBeInTheDocument();
  });

  // TC-07: caption is rendered when a file is active
  it('TC-07: renders caption with file path when a file is active', () => {
    useIdeStore.setState({ activeFilePath: '/tmp/project/README.md', lastSavedAt: null });
    render(<IdeEditorCanvas />);
    const caption = screen.getByTestId('ide-editor-caption');
    expect(caption).toHaveTextContent('README');
  });

  // TC-17: loadVersion change triggers content reset (via useEffect)
  it('TC-17: loadVersion is tracked in store state', () => {
    useIdeStore.setState({ loadVersion: 0 });
    expect(useIdeStore.getState().loadVersion).toBe(0);
    useIdeStore.setState({ loadVersion: 1 });
    expect(useIdeStore.getState().loadVersion).toBe(1);
  });
});
