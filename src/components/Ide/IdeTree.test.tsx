/**
 * IdeTree tests — TC-01, TC-03, TC-04, TC-05, TC-06, TC-08, TC-09, TC-10, TC-11, TC-12
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { IdeTree } from './IdeTree';
import { useIdeStore } from '../../store/ideStore';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../lib/tauri', async (importOriginal) => {
  const mod = (await importOriginal()) as object;
  return {
    ...mod,
    ideOpenFolderDialog: vi.fn().mockResolvedValue('/tmp/my-project'),
    ideListTree: vi.fn().mockResolvedValue([
      { name: 'README.md', path: '/tmp/my-project/README.md', kind: 'file', file_type: 'md', children: null },
      { name: 'main.rs', path: '/tmp/my-project/main.rs', kind: 'file', file_type: 'other', children: null },
      {
        name: 'docs',
        path: '/tmp/my-project/docs',
        kind: 'folder',
        file_type: null,
        children: [
          { name: 'guide.md', path: '/tmp/my-project/docs/guide.md', kind: 'file', file_type: 'md', children: null },
        ],
      },
    ]),
    ideGetProjects: vi.fn().mockResolvedValue([]),
    ideSaveProjects: vi.fn().mockResolvedValue(undefined),
    ideReadFile: vi.fn().mockResolvedValue('# Hello'),
    ideWriteFile: vi.fn().mockResolvedValue(undefined),
    ideCreateFile: vi.fn().mockResolvedValue('/tmp/my-project/Sin título.md'),
    ideCreateFolder: vi.fn().mockResolvedValue('/tmp/my-project/newfolder'),
    ideRenameEntry: vi.fn().mockResolvedValue('/tmp/my-project/renamed.md'),
    ideDeleteEntry: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = (await importOriginal()) as object;
  return { ...mod, useNavigate: () => vi.fn() };
});

function renderTree() {
  return render(
    <MemoryRouter>
      <IdeTree />
    </MemoryRouter>,
  );
}

function entry(
  name: string,
  path: string,
  kind: 'file',
  file_type: 'md' | 'other',
) {
  return { name, path, kind, file_type, children: null as null };
}

function folder(name: string, path: string, children: ReturnType<typeof entry>[] = []) {
  return { name, path, kind: 'folder' as const, file_type: null as null, children };
}

function seedStore(
  projects: Array<{ rootPath: string; name: string; tree: object[] }> = [
    {
      rootPath: '/tmp/my-project',
      name: 'my-project',
      tree: [
        entry('README.md', '/tmp/my-project/README.md', 'file', 'md'),
        entry('main.rs', '/tmp/my-project/main.rs', 'file', 'other'),
      ],
    },
  ],
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useIdeStore.setState({ projects: projects as any, activeFilePath: null, activeFileContent: null });
}

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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IdeTree', () => {
  // TC-01: Empty state shows open folder button
  it('TC-01: renders empty state with "Abrir carpeta" button when no projects', () => {
    renderTree();
    expect(screen.getByTestId('ide-tree')).toBeInTheDocument();
    expect(screen.getByTestId('ide-open-folder-btn')).toBeInTheDocument();
    expect(screen.getByTestId('ide-empty-state')).toBeInTheDocument();
  });

  // TC-01: After adding a project it appears in the tree
  it('TC-01: shows project in tree after adding it', () => {
    seedStore();
    renderTree();
    expect(screen.getByTestId('ide-project-my-project')).toBeInTheDocument();
    expect(screen.getByTestId('ide-project-header-my-project')).toBeInTheDocument();
  });

  // TC-03: Forget folder removes project from tree
  it('TC-03: clicking "Olvidar carpeta" removes the project', async () => {
    seedStore();
    renderTree();
    fireEvent.click(screen.getByTestId('ide-project-more'));
    expect(screen.getByTestId('ide-project-menu')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('ide-forget-folder'));
    });
    expect(screen.queryByTestId('ide-project-my-project')).not.toBeInTheDocument();
  });

  // TC-04: Multiple projects visible simultaneously
  it('TC-04: shows multiple projects simultaneously', () => {
    seedStore([
      { rootPath: '/tmp/p1', name: 'p1', tree: [] },
      { rootPath: '/tmp/p2', name: 'p2', tree: [] },
    ]);
    renderTree();
    expect(screen.getByTestId('ide-project-p1')).toBeInTheDocument();
    expect(screen.getByTestId('ide-project-p2')).toBeInTheDocument();
  });

  // TC-05: Clicking .md file opens it in the editor
  it('TC-05: clicking a .md file opens it', async () => {
    seedStore();
    renderTree();
    const openFile = vi.spyOn(useIdeStore.getState(), 'openFile').mockResolvedValue(undefined);
    await act(async () => {
      fireEvent.click(screen.getByTestId('ide-node-README.md'));
    });
    expect(openFile).toHaveBeenCalledWith('/tmp/my-project/README.md');
  });

  // TC-06: Non-.md file is gray and not clickable
  it('TC-06: non-.md files are disabled (cursor default, no click action)', async () => {
    seedStore();
    renderTree();
    const node = screen.getByTestId('ide-node-main.rs');
    expect(node).toHaveAttribute('data-file-type', 'other');
    expect(node.style.cursor).toBe('default');
    const openFile = vi.spyOn(useIdeStore.getState(), 'openFile').mockResolvedValue(undefined);
    fireEvent.click(node);
    expect(openFile).not.toHaveBeenCalled();
  });

  // TC-08: Create new note via context menu on folder
  it('TC-08: context menu on folder shows "Nueva nota" option', async () => {
    seedStore([
      {
        rootPath: '/tmp/my-project',
        name: 'my-project',
        tree: [folder('docs', '/tmp/my-project/docs')],
      },
    ]);
    renderTree();
    fireEvent.contextMenu(screen.getByTestId('ide-node-docs'));
    expect(screen.getByTestId('ide-context-new-note')).toBeInTheDocument();
  });

  // TC-09: Rename via context menu
  it('TC-09: rename shows inline rename input', async () => {
    seedStore();
    renderTree();
    fireEvent.contextMenu(screen.getByTestId('ide-node-README.md'));
    expect(screen.getByTestId('ide-context-rename')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ide-context-rename'));
    expect(screen.getByTestId('ide-rename-input')).toBeInTheDocument();
  });

  // TC-10: Delete via context menu shows confirm dialog
  it('TC-10: delete shows confirm dialog', async () => {
    seedStore();
    renderTree();
    fireEvent.contextMenu(screen.getByTestId('ide-node-README.md'));
    fireEvent.click(screen.getByTestId('ide-context-delete'));
    expect(screen.getByTestId('confirm-dialog-overlay')).toBeInTheDocument();
  });

  // TC-11: Create folder button in project header
  it('TC-11: "Nueva carpeta" button appears in project header', () => {
    seedStore();
    renderTree();
    expect(screen.getByTestId('ide-project-new-folder')).toBeInTheDocument();
  });

  // TC-12: Search filters .md files by name
  it('TC-12: search input filters files by name', () => {
    seedStore([
      {
        rootPath: '/tmp/my-project',
        name: 'my-project',
        tree: [
          entry('README.md', '/tmp/my-project/README.md', 'file', 'md'),
          entry('guide.md', '/tmp/my-project/guide.md', 'file', 'md'),
          entry('main.rs', '/tmp/my-project/main.rs', 'file', 'other'),
        ],
      },
    ]);
    renderTree();
    const searchInput = screen.getByTestId('ide-search-input');
    fireEvent.change(searchInput, { target: { value: 'guide' } });
    expect(screen.getByTestId('ide-search-result-guide.md')).toBeInTheDocument();
    expect(screen.queryByTestId('ide-search-result-README.md')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ide-search-result-main.rs')).not.toBeInTheDocument();
  });

  it('TC-12: shows "Sin resultados" when no match', () => {
    seedStore([
      {
        rootPath: '/tmp/my-project',
        name: 'my-project',
        tree: [entry('README.md', '/tmp/my-project/README.md', 'file', 'md')],
      },
    ]);
    renderTree();
    fireEvent.change(screen.getByTestId('ide-search-input'), { target: { value: 'zzznomatch' } });
    expect(screen.getByTestId('ide-search-empty')).toBeInTheDocument();
  });
});
