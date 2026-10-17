import { describe, it, expect } from 'vitest';
import {
  nodeDiameter,
  buildGraphModel,
  filterGraph,
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
