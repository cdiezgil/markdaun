import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useIdeStore } from './ideStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the store to initial state
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

// ── TC-01: loadProjects restores from ConfigDb ─────────────────────────────────

describe('TC-02: loadProjects', () => {
  it('TC-02: loads projects from ConfigDb and builds trees', async () => {
    const entries = [
      { name: 'README.md', path: '/tmp/p1/README.md', kind: 'file', file_type: 'md', children: null },
    ];
    // ide_get_projects → ide_list_tree
    mockInvoke
      .mockResolvedValueOnce(['/tmp/p1']) // ide_get_projects
      .mockResolvedValueOnce(entries);   // ide_list_tree('/tmp/p1')

    await useIdeStore.getState().loadProjects();
    const { projects } = useIdeStore.getState();
    expect(projects).toHaveLength(1);
    expect(projects[0].rootPath).toBe('/tmp/p1');
    expect(projects[0].name).toBe('p1');
    expect(projects[0].tree).toEqual(entries);
  });

  it('TC-02: returns empty list when no projects stored', async () => {
    mockInvoke.mockResolvedValueOnce([]); // ide_get_projects
    await useIdeStore.getState().loadProjects();
    expect(useIdeStore.getState().projects).toHaveLength(0);
  });

  it('TC-02: handles missing directory gracefully (empty tree)', async () => {
    mockInvoke
      .mockResolvedValueOnce(['/nonexistent/path']) // ide_get_projects
      .mockRejectedValueOnce('path_not_found');    // ide_list_tree
    await useIdeStore.getState().loadProjects();
    const { projects } = useIdeStore.getState();
    expect(projects).toHaveLength(1);
    expect(projects[0].tree).toHaveLength(0);
  });
});

// ── TC-01: addProject ──────────────────────────────────────────────────────────

describe('TC-01: addProject', () => {
  it('TC-01: adds project to the list and persists', async () => {
    const entries = [
      { name: 'README.md', path: '/tmp/my-project/README.md', kind: 'file', file_type: 'md', children: null },
    ];
    mockInvoke
      .mockResolvedValueOnce(entries)    // ide_list_tree
      .mockResolvedValueOnce(undefined); // ide_save_projects

    await useIdeStore.getState().addProject('/tmp/my-project');
    const { projects } = useIdeStore.getState();
    expect(projects).toHaveLength(1);
    expect(projects[0].rootPath).toBe('/tmp/my-project');
    expect(projects[0].name).toBe('my-project');
    expect(mockInvoke).toHaveBeenCalledWith('ide_save_projects', {
      projects: ['/tmp/my-project'],
    });
  });
});

// ── TC-04: multiple projects ────────────────────────────────────────────────────

describe('TC-04: multiple projects', () => {
  it('TC-04: can add two projects and both appear in the store', async () => {
    mockInvoke
      .mockResolvedValueOnce([]) // ide_list_tree for p1
      .mockResolvedValueOnce(undefined) // ide_save_projects after p1
      .mockResolvedValueOnce([]) // ide_list_tree for p2
      .mockResolvedValueOnce(undefined); // ide_save_projects after p2

    await useIdeStore.getState().addProject('/tmp/p1');
    await useIdeStore.getState().addProject('/tmp/p2');
    const { projects } = useIdeStore.getState();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.rootPath)).toEqual(['/tmp/p1', '/tmp/p2']);
  });
});

// ── TC-03: removeProject ───────────────────────────────────────────────────────

describe('TC-03: removeProject', () => {
  it('TC-03: removes project from list and persists', async () => {
    // Setup: one project already in state
    useIdeStore.setState({
      projects: [
        { rootPath: '/tmp/p1', name: 'p1', tree: [] },
        { rootPath: '/tmp/p2', name: 'p2', tree: [] },
      ],
    });
    mockInvoke.mockResolvedValueOnce(undefined); // ide_save_projects

    await useIdeStore.getState().removeProject('/tmp/p1');
    const { projects } = useIdeStore.getState();
    expect(projects).toHaveLength(1);
    expect(projects[0].rootPath).toBe('/tmp/p2');
  });

  it('TC-03: clears active file if it belonged to removed project', async () => {
    useIdeStore.setState({
      projects: [{ rootPath: '/tmp/p1', name: 'p1', tree: [] }],
      activeFilePath: '/tmp/p1/README.md',
      activeFileContent: '# Hello',
    });
    mockInvoke.mockResolvedValueOnce(undefined); // ide_save_projects

    await useIdeStore.getState().removeProject('/tmp/p1');
    const { activeFilePath, activeFileContent } = useIdeStore.getState();
    expect(activeFilePath).toBeNull();
    expect(activeFileContent).toBeNull();
  });
});

// ── TC-05: openFile ────────────────────────────────────────────────────────────

describe('TC-05: openFile', () => {
  it('TC-05: reads file and updates store state', async () => {
    mockInvoke.mockResolvedValueOnce('# Hola\n'); // ide_read_file

    const prevVersion = useIdeStore.getState().loadVersion;
    await useIdeStore.getState().openFile('/tmp/p1/README.md');
    const state = useIdeStore.getState();
    expect(state.activeFilePath).toBe('/tmp/p1/README.md');
    expect(state.activeFileContent).toBe('# Hola\n');
    expect(state.loadVersion).toBe(prevVersion + 1);
    expect(state.isDirty).toBe(false);
    expect(state.saveStatus).toBe('idle');
  });
});

// ── TC-07: setContent and saveNow ─────────────────────────────────────────────

describe('TC-07: setContent', () => {
  it('TC-07: marks store dirty and triggers debounce', () => {
    useIdeStore.setState({ activeFilePath: '/tmp/p1/f.md', activeFileContent: '# Hello' });
    useIdeStore.getState().setContent('# Updated');
    const { isDirty, saveStatus } = useIdeStore.getState();
    expect(isDirty).toBe(true);
    expect(saveStatus).toBe('saving');
  });
});

describe('TC-07: saveNow', () => {
  it('TC-07: writes file and sets saveStatus to saved', async () => {
    useIdeStore.setState({
      activeFilePath: '/tmp/p1/f.md',
      activeFileContent: '# Updated',
    });
    mockInvoke.mockResolvedValueOnce(undefined); // ide_write_file
    await useIdeStore.getState().saveNow();
    expect(mockInvoke).toHaveBeenCalledWith('ide_write_file', {
      path: '/tmp/p1/f.md',
      content: '# Updated',
    });
    expect(useIdeStore.getState().saveStatus).toBe('saved');
    expect(useIdeStore.getState().isDirty).toBe(false);
  });

  it('TC-07: no-ops when no active file', async () => {
    await useIdeStore.getState().saveNow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ── TC-08: createFile ─────────────────────────────────────────────────────────

describe('TC-08: createFile', () => {
  it('TC-08: creates file and refreshes tree', async () => {
    useIdeStore.setState({
      projects: [{ rootPath: '/tmp/p1', name: 'p1', tree: [] }],
    });
    mockInvoke
      .mockResolvedValueOnce('/tmp/p1/docs/nueva.md') // ide_create_file
      .mockResolvedValueOnce([]); // ide_list_tree (refreshTree)

    const path = await useIdeStore.getState().createFile('/tmp/p1/docs', 'nueva.md');
    expect(path).toBe('/tmp/p1/docs/nueva.md');
    expect(mockInvoke).toHaveBeenCalledWith('ide_create_file', {
      parentPath: '/tmp/p1/docs',
      name: 'nueva.md',
    });
  });
});

// ── TC-09: renameEntry ────────────────────────────────────────────────────────

describe('TC-09: renameEntry', () => {
  it('TC-09: renames and updates active path if needed', async () => {
    useIdeStore.setState({
      projects: [{ rootPath: '/tmp/p1', name: 'p1', tree: [] }],
      activeFilePath: '/tmp/p1/notes.md',
    });
    mockInvoke
      .mockResolvedValueOnce('/tmp/p1/apuntes.md') // ide_rename_entry
      .mockResolvedValueOnce([]); // ide_list_tree

    const newPath = await useIdeStore.getState().renameEntry('/tmp/p1/notes.md', 'apuntes.md');
    expect(newPath).toBe('/tmp/p1/apuntes.md');
    expect(useIdeStore.getState().activeFilePath).toBe('/tmp/p1/apuntes.md');
  });
});

// ── TC-10: deleteEntry ────────────────────────────────────────────────────────

describe('TC-10: deleteEntry', () => {
  it('TC-10: deletes and clears editor if active', async () => {
    useIdeStore.setState({
      projects: [{ rootPath: '/tmp/p1', name: 'p1', tree: [] }],
      activeFilePath: '/tmp/p1/old.md',
      activeFileContent: '# Old',
    });
    mockInvoke
      .mockResolvedValueOnce(undefined) // ide_delete_entry
      .mockResolvedValueOnce([]); // ide_list_tree

    await useIdeStore.getState().deleteEntry('/tmp/p1/old.md');
    expect(useIdeStore.getState().activeFilePath).toBeNull();
    expect(useIdeStore.getState().activeFileContent).toBeNull();
  });

  it('TC-10: does not clear editor if a different file is active', async () => {
    useIdeStore.setState({
      projects: [{ rootPath: '/tmp/p1', name: 'p1', tree: [] }],
      activeFilePath: '/tmp/p1/keep.md',
      activeFileContent: '# Keep',
    });
    mockInvoke
      .mockResolvedValueOnce(undefined) // ide_delete_entry
      .mockResolvedValueOnce([]); // ide_list_tree

    await useIdeStore.getState().deleteEntry('/tmp/p1/other.md');
    expect(useIdeStore.getState().activeFilePath).toBe('/tmp/p1/keep.md');
  });
});

// ── TC-17: opening file B while A is active ────────────────────────────────────

describe('TC-17: openFile replaces active file', () => {
  it('TC-17: opening a new file replaces the active state', async () => {
    useIdeStore.setState({
      activeFilePath: '/tmp/p1/A.md',
      activeFileContent: '# A',
    });
    mockInvoke.mockResolvedValueOnce('# B\n'); // ide_read_file
    await useIdeStore.getState().openFile('/tmp/p1/B.md');
    expect(useIdeStore.getState().activeFilePath).toBe('/tmp/p1/B.md');
    expect(useIdeStore.getState().activeFileContent).toBe('# B\n');
  });
});
