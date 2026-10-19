/**
 * IdeView tests — TC-05, TC-07
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { IdeView } from './IdeView';
import { useIdeStore } from '../store/ideStore';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../lib/tauri', () => ({
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

vi.mock('../components/editor/EditorToolbar', () => ({
  default: () => <div data-testid="mock-editor-toolbar" />,
}));

vi.mock('../components/editor/IdeEditorCanvas', () => ({
  default: () => <div data-testid="mock-ide-editor-canvas" />,
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ide" element={<IdeView />} />
        <Route path="/ide/editor/:encodedPath" element={<IdeView />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IdeView', () => {
  // TC-05: empty state when no active file
  it('TC-05: renders empty state when no active file', () => {
    renderAt('/ide');
    expect(screen.getByTestId('ide-editor-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('ide-view')).not.toBeInTheDocument();
  });

  // TC-05: renders editor view when a file is active
  it('TC-05: renders editor layout when active file is set', () => {
    useIdeStore.setState({ activeFilePath: '/tmp/project/README.md' });
    renderAt('/ide');
    expect(screen.getByTestId('ide-view')).toBeInTheDocument();
    expect(screen.getByTestId('mock-editor-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('mock-ide-editor-canvas')).toBeInTheDocument();
  });

  // TC-07: opening file via URL param calls openFile
  it('TC-07: calls openFile when encodedPath URL param is present', async () => {
    const openFile = vi
      .spyOn(useIdeStore.getState(), 'openFile')
      .mockResolvedValue(undefined);
    renderAt(`/ide/editor/${encodeURIComponent('/tmp/project/README.md')}`);
    // openFile should have been called with the decoded path
    await vi.waitFor(() => {
      expect(openFile).toHaveBeenCalledWith('/tmp/project/README.md');
    });
  });

  // TC-07: does not re-open file if it is already active
  it('TC-07: does not call openFile if the path is already active', async () => {
    useIdeStore.setState({ activeFilePath: '/tmp/project/README.md' });
    const openFile = vi
      .spyOn(useIdeStore.getState(), 'openFile')
      .mockResolvedValue(undefined);
    renderAt(`/ide/editor/${encodeURIComponent('/tmp/project/README.md')}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(openFile).not.toHaveBeenCalled();
  });
});
