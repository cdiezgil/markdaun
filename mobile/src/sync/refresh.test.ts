import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import type { GitHubClient, TreeEntry } from '../github/client';
import { openDb, type Db } from '../store/db';
import { refresh } from './refresh';

const DB = 'markdaun-refresh-test';

function fakeClient(initial: TreeEntry[], texts: Record<string, string>) {
  let sha = 'root1';
  let entries = initial;
  let failFetch = false;
  const fetched: string[] = [];
  const client: GitHubClient = {
    checkAccess: async () => {},
    getTree: async () => ({ sha, entries }),
    fetchTexts: vi.fn(async (items: { path: string; sha: string }[]) => {
      if (failFetch) throw new Error('boom');
      const out = new Map<string, string>();
      for (const i of items) {
        fetched.push(i.path);
        out.set(i.path, texts[i.path] ?? '');
      }
      return out;
    }),
    getRaw: async () => new Blob([]),
    putNewFile: async () => 'created',
  };
  return {
    client,
    fetched,
    set: (s: string, e: TreeEntry[]) => {
      sha = s;
      entries = e;
    },
    fail: (v: boolean) => {
      failFetch = v;
    },
  };
}

const blob = (path: string, sha: string): TreeEntry => ({ path, sha, type: 'blob' });

describe('refresh', () => {
  let db: Db;
  beforeEach(async () => {
    await deleteDB(DB);
    db = await openDb(DB);
  });

  afterEach(() => db.close());

  it('first refresh stores every md', async () => {
    const f = fakeClient([blob('a.md', 's1'), blob('dir/b.md', 's2')], { 'a.md': 'A', 'dir/b.md': 'B' });
    const r = await refresh(f.client, db);
    expect(r.skipped).toBe(false);
    expect(r.changed.sort()).toEqual(['a.md', 'dir/b.md']);
    expect(r.removed).toEqual([]);
    expect(await db.get('notes', 'a.md')).toEqual({ path: 'a.md', sha: 's1', text: 'A' });
    expect((await db.get('tree', 'current'))?.sha).toBe('root1');
    expect(await db.get('meta', 'lastRefresh')).toBeTypeOf('number');
  });

  it('second refresh with same sha is skipped', async () => {
    const f = fakeClient([blob('a.md', 's1')], { 'a.md': 'A' });
    await refresh(f.client, db);
    const r = await refresh(f.client, db);
    expect(r).toEqual({ changed: [], removed: [], skipped: true });
    expect(f.client.fetchTexts).toHaveBeenCalledTimes(1);
  });

  it('changed sha refetches only that note', async () => {
    const f = fakeClient([blob('a.md', 's1'), blob('b.md', 's2')], { 'a.md': 'A', 'b.md': 'B' });
    await refresh(f.client, db);
    f.fetched.length = 0;
    f.set('root2', [blob('a.md', 's1'), blob('b.md', 's3')]);
    const r = await refresh(f.client, db);
    expect(r.changed).toEqual(['b.md']);
    expect(f.fetched).toEqual(['b.md']);
    expect((await db.get('notes', 'b.md'))?.sha).toBe('s3');
  });

  it('removed path is deleted locally', async () => {
    const f = fakeClient([blob('a.md', 's1'), blob('b.md', 's2')], { 'a.md': 'A', 'b.md': 'B' });
    await refresh(f.client, db);
    f.set('root2', [blob('a.md', 's1')]);
    const r = await refresh(f.client, db);
    expect(r.removed).toEqual(['b.md']);
    expect(await db.get('notes', 'b.md')).toBeUndefined();
    expect(await db.getAll('notes')).toHaveLength(1);
  });

  it('ignores dot paths and non-md for notes but keeps them in the tree', async () => {
    const entries = [
      blob('a.md', 's1'),
      blob('.obsidian/x.md', 's2'),
      blob('dir/.hidden.md', 's3'),
      blob('img.png', 's4'),
      { path: 'dir', sha: 's5', type: 'tree' as const },
    ];
    const f = fakeClient(entries, { 'a.md': 'A' });
    const r = await refresh(f.client, db);
    expect(r.changed).toEqual(['a.md']);
    expect((await db.getAll('notes')).map((n) => n.path)).toEqual(['a.md']);
    expect((await db.get('tree', 'current'))?.entries).toEqual(entries);
  });

  it('a failed fetch leaves the previous tree sha so the next refresh retries', async () => {
    const f = fakeClient([blob('a.md', 's1')], { 'a.md': 'A' });
    await refresh(f.client, db);
    f.set('root2', [blob('a.md', 's9')]);
    f.fail(true);
    await expect(refresh(f.client, db)).rejects.toThrow('boom');
    expect((await db.get('tree', 'current'))?.sha).toBe('root1');
    f.fail(false);
    const r = await refresh(f.client, db);
    expect(r.skipped).toBe(false);
    expect(r.changed).toEqual(['a.md']);
    expect((await db.get('notes', 'a.md'))?.text).toBe('A');
  });
});
