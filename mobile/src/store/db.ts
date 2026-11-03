import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TreeEntry } from '../github/client';

export interface NoteRecord {
  path: string;
  sha: string;
  text: string;
}

export interface TreeRecord {
  sha: string;
  entries: TreeEntry[];
}

export interface QueueRecord {
  id?: number;
  data: ArrayBuffer; // audio bytes (Blobs do not clone reliably through IndexedDB)
  mime: string;
  at: number; // ms since epoch
  n: number;
}

interface Schema extends DBSchema {
  notes: { key: string; value: NoteRecord };
  // Single record, always stored under TREE_KEY.
  tree: { key: string; value: TreeRecord };
  images: { key: string; value: Blob };
  queue: { key: number; value: QueueRecord };
  meta: { key: string; value: unknown };
}

export type Db = IDBPDatabase<Schema>;

export const TREE_KEY = 'current';

export function openDb(name = 'markdaun'): Promise<Db> {
  return openDB<Schema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('notes', { keyPath: 'path' });
      db.createObjectStore('tree');
      db.createObjectStore('images');
      db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('meta');
    },
  });
}
