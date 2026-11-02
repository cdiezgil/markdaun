import type { GitHubClient } from '../github/client';
import { TREE_KEY, type Db } from '../store/db';

export interface RefreshResult {
  changed: string[];
  removed: string[];
  skipped: boolean;
}

const isNotePath = (p: string) => /\.md$/i.test(p) && !p.split('/').some((s) => s.startsWith('.'));

export async function refresh(client: GitHubClient, db: Db): Promise<RefreshResult> {
  const tree = await client.getTree();
  const prev = await db.get('tree', TREE_KEY);
  if (prev && prev.sha === tree.sha) return { changed: [], removed: [], skipped: true };

  const wanted = new Map<string, string>();
  for (const e of tree.entries) {
    if (e.type === 'blob' && isNotePath(e.path)) wanted.set(e.path, e.sha);
  }
  const existing = new Map((await db.getAll('notes')).map((n) => [n.path, n.sha]));
  const toFetch = [...wanted].filter(([p, sha]) => existing.get(p) !== sha).map(([path, sha]) => ({ path, sha }));
  const removed = [...existing.keys()].filter((p) => !wanted.has(p));

  // Fetch everything first: a failure here must leave the stored tree untouched.
  const texts = toFetch.length ? await client.fetchTexts(toFetch) : new Map<string, string>();
  const fetched = toFetch.filter((i) => texts.has(i.path));
  if (fetched.length !== toFetch.length) throw new Error('Missing note text in fetch result');

  const tx = db.transaction(['notes', 'tree', 'meta'], 'readwrite');
  for (const i of fetched) tx.objectStore('notes').put({ path: i.path, sha: i.sha, text: texts.get(i.path) as string });
  for (const p of removed) tx.objectStore('notes').delete(p);
  tx.objectStore('tree').put({ sha: tree.sha, entries: tree.entries }, TREE_KEY);
  tx.objectStore('meta').put(Date.now(), 'lastRefresh');
  await tx.done;

  return { changed: fetched.map((i) => i.path), removed, skipped: false };
}
