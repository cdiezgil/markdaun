import type { GitHubClient } from '../github/client';
import { AppError } from '../github/errors';
import { TREE_KEY, type Db } from '../store/db';

const MAX_CONCURRENT = 4;

let active = 0;
const waiting: (() => void)[] = [];
// Object URLs reused within the session, and in-flight fetches shared per sha.
const urls = new Map<string, string>();
const inflight = new Map<string, Promise<Blob | null>>();

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next(); // hand the slot over directly
  else active--;
}

async function fetchAndStore(path: string, sha: string, db: Db, client: GitHubClient): Promise<Blob | null> {
  await acquire();
  try {
    const blob = await client.getRaw(path);
    await db.put('images', blob, sha);
    return blob;
  } catch (e) {
    // Offline or any other failure: no placeholder cached, the UI shows its own.
    if (!(e instanceof AppError)) console.warn('image fetch failed', e);
    return null;
  } finally {
    release();
  }
}

export async function loadImage(
  path: string,
  deps: { db: Db; client: GitHubClient | null },
): Promise<string | null> {
  const { db, client } = deps;
  const tree = await db.get('tree', TREE_KEY);
  const sha = tree?.entries.find((e) => e.type === 'blob' && e.path === path)?.sha;
  if (!sha) return null;

  let blob: Blob | null | undefined = await db.get('images', sha);
  if (!blob) {
    if (!client) return null;
    let p = inflight.get(sha);
    if (!p) {
      p = fetchAndStore(path, sha, db, client).finally(() => inflight.delete(sha));
      inflight.set(sha, p);
    }
    blob = await p;
    if (!blob) return null;
  }
  let url = urls.get(sha);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(sha, url);
  }
  return url;
}
