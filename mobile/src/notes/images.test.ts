import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import type { GitHubClient, TreeEntry } from '../github/client';
import { AppError } from '../github/errors';
import { openDb, TREE_KEY, type Db } from '../store/db';
import { loadImage } from './images';

const DB = 'markdaun-images-test';
let db: Db;
let counter = 0;

async function setTree(entries: TreeEntry[]) {
  await db.put('tree', { sha: 'root', entries }, TREE_KEY);
}

function clientWith(getRaw: (path: string) => Promise<Blob>): GitHubClient {
  return {
    checkAccess: async () => {},
    getTree: async () => ({ sha: 'root', entries: [] }),
    fetchTexts: async () => new Map(),
    getRaw: vi.fn(getRaw),
    putNewFile: async () => 'created',
  };
}

beforeEach(async () => {
  counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:fake-${++counter}`) }));
  db = await openDb(DB);
});

afterEach(async () => {
  db.close();
  await deleteDB(DB);
  vi.unstubAllGlobals();
});

describe('loadImage', () => {
  it('fetches once then serves from cache', async () => {
    await setTree([{ path: 'a.png', sha: 's1', type: 'blob' }]);
    const client = clientWith(async () => new Blob(['x']));
    const first = await loadImage('a.png', { db, client });
    const second = await loadImage('a.png', { db, client: null });
    expect(first).toMatch(/^blob:/);
    expect(second).toMatch(/^blob:/);
    expect(client.getRaw).toHaveBeenCalledTimes(1);
    expect(await db.get('images', 's1')).toBeDefined();
  });

  it('returns null offline when not cached', async () => {
    await setTree([{ path: 'a.png', sha: 's1', type: 'blob' }]);
    expect(await loadImage('a.png', { db, client: null })).toBeNull();
    const client = clientWith(async () => {
      throw new AppError('Offline');
    });
    expect(await loadImage('a.png', { db, client })).toBeNull();
    expect(await db.get('images', 's1')).toBeUndefined();
  });

  it('returns null for paths not in the tree without fetching', async () => {
    await setTree([]);
    const client = clientWith(async () => new Blob(['x']));
    expect(await loadImage('nope.png', { db, client })).toBeNull();
    expect(client.getRaw).not.toHaveBeenCalled();
  });

  it('returns null and caches nothing on other errors', async () => {
    await setTree([{ path: 'a.png', sha: 's1', type: 'blob' }]);
    const client = clientWith(async () => {
      throw new AppError('NotFound');
    });
    expect(await loadImage('a.png', { db, client })).toBeNull();
    expect(await db.get('images', 's1')).toBeUndefined();
  });

  it('refetches when sha changed', async () => {
    await setTree([{ path: 'a.png', sha: 's1', type: 'blob' }]);
    const client = clientWith(async () => new Blob(['x']));
    await loadImage('a.png', { db, client });
    await setTree([{ path: 'a.png', sha: 's2', type: 'blob' }]);
    await loadImage('a.png', { db, client });
    expect(client.getRaw).toHaveBeenCalledTimes(2);
    expect(await db.get('images', 's2')).toBeDefined();
  });

  it('dedupes concurrent loads of the same sha', async () => {
    await setTree([{ path: 'a.png', sha: 's1', type: 'blob' }]);
    const client = clientWith(async () => new Blob(['x']));
    await Promise.all([loadImage('a.png', { db, client }), loadImage('a.png', { db, client })]);
    expect(client.getRaw).toHaveBeenCalledTimes(1);
  });

  it('never fetches more than 4 at once', async () => {
    await setTree(Array.from({ length: 10 }, (_, i) => ({ path: `${i}.png`, sha: `s${i}`, type: 'blob' as const })));
    let active = 0;
    let peak = 0;
    const client = clientWith(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return new Blob(['x']);
    });
    const urls = await Promise.all(Array.from({ length: 10 }, (_, i) => loadImage(`${i}.png`, { db, client })));
    expect(urls.every((u) => u !== null)).toBe(true);
    expect(client.getRaw).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
