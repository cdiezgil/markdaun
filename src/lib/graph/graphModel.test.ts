import { describe, it, expect } from 'vitest';
import {
  nodeDiameter,
  buildGraphModel,
  filterGraph,
  restrictToFolder,
  folderHalos,
  MIN_DIAMETER,
  MAX_DIAMETER,
  type BackendGraph,
} from './graphModel';

const V = '/vault';
const backend: BackendGraph = {
  nodes: [
    { path: '/vault/a.md', name: 'a.md', kind: 'md', x: null, y: null, tags: ['ideas'], excerpt: 'hola' },
    { path: '/vault/b.md', name: 'b.md', kind: 'md', x: 10, y: 20, tags: ['ideas', 'work'], excerpt: '' },
    { path: '/vault/Test/c.md', name: 'c.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
    { path: '/vault/orphan.md', name: 'orphan.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
    { path: '/vault/img.png', name: 'img.png', kind: 'image', x: null, y: null, tags: [], excerpt: '' },
    { path: '/vault/lonely.pdf', name: 'lonely.pdf', kind: 'pdf', x: null, y: null, tags: [], excerpt: '' },
  ],
  edges: [
    { source: '/vault/a.md', target: '/vault/b.md' },
    { source: '/vault/c.md'.replace('/c.md', '/Test/c.md'), target: '/vault/b.md' },
    { source: '/vault/a.md', target: '/vault/img.png' },
  ],
};

describe('nodeDiameter', () => {
  it('maps 0 backlinks to the minimum and the max to the maximum', () => {
    expect(nodeDiameter(0, 5)).toBe(MIN_DIAMETER);
    expect(nodeDiameter(5, 5)).toBe(MAX_DIAMETER);
  });
  it('is monotonic and bounded', () => {
    let prev = 0;
    for (let b = 0; b <= 9; b++) {
      const d = nodeDiameter(b, 9);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeGreaterThanOrEqual(MIN_DIAMETER);
      expect(d).toBeLessThanOrEqual(MAX_DIAMETER);
      prev = d;
    }
  });
  it('returns the minimum when nobody has backlinks', () => {
    expect(nodeDiameter(0, 0)).toBe(MIN_DIAMETER);
  });
});

describe('buildGraphModel', () => {
  const m = buildGraphModel(backend, V);
  const byPath = new Map(m.nodes.map((n) => [n.path, n]));

  it('computes backlinks, outgoing links and orphans', () => {
    expect(byPath.get('/vault/b.md')!.backlinks).toBe(2);
    expect(byPath.get('/vault/a.md')!.links).toBe(2);
    expect(byPath.get('/vault/orphan.md')!.isOrphan).toBe(true);
    expect(byPath.get('/vault/a.md')!.isOrphan).toBe(false);
  });
  it('strips the .md extension and keeps other names', () => {
    expect(byPath.get('/vault/a.md')!.label).toBe('a');
    expect(byPath.get('/vault/img.png')!.label).toBe('img.png');
  });
  it('drops unlinked attachments but keeps linked ones', () => {
    expect(byPath.has('/vault/lonely.pdf')).toBe(false);
    expect(byPath.has('/vault/img.png')).toBe(true);
  });
  it('derives the folder relative to the vault root', () => {
    expect(byPath.get('/vault/Test/c.md')!.folder).toBe('Test');
    expect(byPath.get('/vault/a.md')!.folder).toBe('');
  });
  it('keeps saved positions', () => {
    expect(byPath.get('/vault/b.md')!.saved).toEqual({ x: 10, y: 20 });
    expect(byPath.get('/vault/a.md')!.saved).toBeNull();
  });
  it('builds tag nodes with counts and tag edges', () => {
    const ideas = m.tagNodes.find((t) => t.id === 'tag:ideas')!;
    expect(ideas.count).toBe(2);
    expect(m.tagEdges).toContainEqual({ source: '/vault/a.md', target: 'tag:ideas' });
    expect(m.tagNodes).toHaveLength(2);
  });
  it('sizes nodes by backlinks', () => {
    expect(byPath.get('/vault/b.md')!.diameter).toBe(MAX_DIAMETER);
    expect(byPath.get('/vault/orphan.md')!.diameter).toBe(MIN_DIAMETER);
  });
});

describe('filterGraph', () => {
  const m = buildGraphModel(backend, V);
  const base = { showLinks: true, showTags: false, showOrphans: true, query: '' };

  it('shows everything by default (no tags)', () => {
    const f = filterGraph(m, base);
    expect(f.nodeIds.has('/vault/orphan.md')).toBe(true);
    expect(f.edges).toHaveLength(3);
    expect(f.tagNodes).toHaveLength(0);
    expect(f.matches).toBeNull();
  });
  it('hides link edges when Enlaces is off', () => {
    expect(filterGraph(m, { ...base, showLinks: false }).edges).toHaveLength(0);
  });
  it('hides orphans when Huérfanas is off', () => {
    const f = filterGraph(m, { ...base, showOrphans: false });
    expect(f.nodeIds.has('/vault/orphan.md')).toBe(false);
    expect(f.nodeIds.has('/vault/a.md')).toBe(true);
  });
  it('adds tag nodes and edges when Etiquetas is on', () => {
    const f = filterGraph(m, { ...base, showTags: true });
    expect(f.tagNodes).toHaveLength(2);
    expect(f.tagEdges).toHaveLength(3);
  });
  it('omits tag edges to hidden notes', () => {
    const f = filterGraph(
      buildGraphModel({ ...backend, nodes: [...backend.nodes, { path: '/vault/t.md', name: 't.md', kind: 'md', x: null, y: null, tags: ['solo'], excerpt: '' }] }, V),
      { ...base, showTags: true, showOrphans: false },
    );
    expect(f.tagNodes.find((t) => t.id === 'tag:solo')).toBeUndefined();
  });
  it('search matches label case-insensitively, tags included', () => {
    const f = filterGraph(m, { ...base, query: 'ORPH' });
    expect([...f.matches!]).toEqual(['/vault/orphan.md']);
    const t = filterGraph(m, { ...base, showTags: true, query: 'work' });
    expect(t.matches!.has('tag:work')).toBe(true);
  });
});

describe('folderHalos', () => {
  it('wraps the nodes of each named folder and ignores the root', () => {
    const halos = folderHalos([
      { folder: 'Test', x: 0, y: 0, radius: 10 },
      { folder: 'Test', x: 100, y: 40, radius: 10 },
      { folder: '', x: 500, y: 500, radius: 10 },
    ]);
    expect(halos).toHaveLength(1);
    const h = halos[0];
    expect(h.folder).toBe('Test');
    expect(h.x).toBeLessThan(-10);
    expect(h.x + h.width).toBeGreaterThan(110);
    expect(h.y).toBeLessThan(-10);
    expect(h.y + h.height).toBeGreaterThan(50);
  });
});

describe('restrictToFolder', () => {
  const g: BackendGraph = {
    nodes: [
      { path: '/vault/P/in1.md', name: 'in1.md', kind: 'md', x: null, y: null, tags: ['t1'], excerpt: '' },
      { path: '/vault/P/Sub/in2.md', name: 'in2.md', kind: 'md', x: null, y: null, tags: ['t2'], excerpt: '' },
      { path: '/vault/PP/near.md', name: 'near.md', kind: 'md', x: null, y: null, tags: ['t3'], excerpt: '' },
      { path: '/vault/out1.md', name: 'out1.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
      { path: '/vault/out2.md', name: 'out2.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
      { path: '/vault/far.md', name: 'far.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
    ],
    edges: [
      { source: '/vault/P/in1.md', target: '/vault/P/Sub/in2.md' },
      { source: '/vault/out1.md', target: '/vault/P/in1.md' },
      { source: '/vault/P/Sub/in2.md', target: '/vault/out2.md' },
      { source: '/vault/out1.md', target: '/vault/out2.md' },
      { source: '/vault/PP/near.md', target: '/vault/far.md' },
    ],
  };
  const full = buildGraphModel(g, V);
  const ids = (m: { nodes: { path: string }[] }) => m.nodes.map((n) => n.path).sort();

  it('Bóveda (empty folder) leaves the model untouched', () => {
    const m = restrictToFolder(full, '');
    expect(ids(m)).toEqual(ids(full));
    expect(m.outside.size).toBe(0);
  });
  it('keeps inside notes (subfolders included) and dims linked outside notes', () => {
    const m = restrictToFolder(full, 'P');
    expect(ids(m)).toEqual(
      ['/vault/P/in1.md', '/vault/P/Sub/in2.md', '/vault/out1.md', '/vault/out2.md'].sort(),
    );
    expect([...m.outside].sort()).toEqual(['/vault/out1.md', '/vault/out2.md']);
  });
  it('does not treat a sibling folder with the same prefix as inside', () => {
    const m = restrictToFolder(full, 'P');
    expect(ids(m)).not.toContain('/vault/PP/near.md');
  });
  it('hides notes with no link to the folder and edges between two outside notes', () => {
    const m = restrictToFolder(full, 'P');
    expect(ids(m)).not.toContain('/vault/far.md');
    expect(m.edges).toHaveLength(3);
    expect(m.edges.some((e) => e.source === '/vault/out1.md' && e.target === '/vault/out2.md')).toBe(false);
  });
  it('keeps orphan semantics vault-wide', () => {
    const m = restrictToFolder(full, 'P');
    expect(m.nodes.find((n) => n.path === '/vault/out1.md')!.isOrphan).toBe(false);
  });
  it('limits tag nodes to inside notes', () => {
    const m = restrictToFolder(full, 'P');
    expect(m.tagNodes.map((t) => t.id).sort()).toEqual(['tag:t1', 'tag:t2']);
    expect(m.tagEdges.every((e) => !e.source.includes('PP'))).toBe(true);
  });
  it('filterGraph exposes dimmed nodes/edges and hides them without links', () => {
    const m = restrictToFolder(full, 'P');
    const f = filterGraph(m, { showLinks: true, showTags: false, showOrphans: true, query: '' });
    expect([...f.dimmedIds].sort()).toEqual(['/vault/out1.md', '/vault/out2.md']);
    expect(f.dimmedEdges.size).toBe(2);
    const off = filterGraph(m, { showLinks: false, showTags: false, showOrphans: true, query: '' });
    expect(off.nodeIds.has('/vault/out1.md')).toBe(false);
  });
});
