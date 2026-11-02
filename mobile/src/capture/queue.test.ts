import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import type { GitHubClient } from '../github/client';
import { AppError } from '../github/errors';
import { openDb, type Db } from '../store/db';
import { deviceName, drainQueue, enqueue, pendingCount, recordingName } from './queue';

const DB = 'markdaun-queue-test';

function fakeClient(impl: (path: string, content: Blob, message: string) => Promise<'created' | 'exists'>) {
  const putNewFile = vi.fn(impl);
  const client: GitHubClient = {
    checkAccess: async () => {},
    getTree: async () => ({ sha: 'x', entries: [] }),
    fetchTexts: async () => new Map(),
    getRaw: async () => new Blob([]),
    putNewFile,
  };
  return { client, putNewFile };
}

let db: Db;
beforeEach(async () => {
  await deleteDB(DB);
  db = await openDb(DB);
});
afterEach(async () => {
  db.close();
  await deleteDB(DB);
});

const at = (s: string) => new Date(s); // local time, no offset

describe('recordingName', () => {
  it('names match the desktop format', () => {
    const d = at('2026-11-02T09:05');
    expect(recordingName(d, 'audio/webm;codecs=opus', 1)).toBe('Entrada/Nota de voz 2026-11-02 09-05.webm');
    expect(recordingName(d, 'audio/mp4', 1)).toBe('Entrada/Nota de voz 2026-11-02 09-05.m4a');
    expect(recordingName(d, 'AUDIO/MP4; x=y', 1)).toBe('Entrada/Nota de voz 2026-11-02 09-05.m4a');
    expect(recordingName(d, 'audio/webm', 2)).toBe('Entrada/Nota de voz 2026-11-02 09-05 2.webm');
  });

  it('rejects unknown mime types', () => {
    expect(() => recordingName(at('2026-11-02T09:05'), 'text/plain', 1)).toThrow(AppError);
  });
});

describe('deviceName', () => {
  it('detects the device', () => {
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe('Android');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('iPad');
    expect(deviceName('Mozilla/5.0 (X11; Linux)')).toBe('Móvil');
  });
});

describe('queue', () => {
  it('uploads sequentially oldest first', async () => {
    await enqueue(db, new Blob(['b']), 'audio/webm', at('2026-11-02T09:06'));
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    expect(await pendingCount(db)).toBe(2);
    let active = 0;
    let maxActive = 0;
    const { client, putNewFile } = fakeClient(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 'created';
    });
    const res = await drainQueue(db, client, 'Android');
    expect(res).toEqual({ uploaded: 2, lastError: undefined });
    expect(maxActive).toBe(1);
    // Insertion order (oldest enqueued first): 09-06 was enqueued first.
    expect(putNewFile.mock.calls.map((c) => c[0])).toEqual([
      'Entrada/Nota de voz 2026-11-02 09-06.webm',
      'Entrada/Nota de voz 2026-11-02 09-05.webm',
    ]);
    expect(await pendingCount(db)).toBe(0);
  });

  it('exists moves to next number', async () => {
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    const taken = new Set(['Entrada/Nota de voz 2026-11-02 09-05.webm', 'Entrada/Nota de voz 2026-11-02 09-05 2.webm']);
    const { client, putNewFile } = fakeClient(async (p) => (taken.has(p) ? 'exists' : 'created'));
    const res = await drainQueue(db, client, 'Android');
    expect(res.uploaded).toBe(1);
    expect(putNewFile.mock.calls.map((c) => c[0])).toEqual([
      'Entrada/Nota de voz 2026-11-02 09-05.webm',
      'Entrada/Nota de voz 2026-11-02 09-05 2.webm',
      'Entrada/Nota de voz 2026-11-02 09-05 3.webm',
    ]);
    expect(await pendingCount(db)).toBe(0);
  });

  it('persists the next number so a failure does not retry taken names', async () => {
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    let calls = 0;
    const first = fakeClient(async () => {
      if (++calls === 1) return 'exists';
      throw new AppError('Offline');
    });
    const res = await drainQueue(db, first.client, 'Android');
    expect(res.lastError?.kind).toBe('Offline');
    const second = fakeClient(async () => 'created');
    await drainQueue(db, second.client, 'Android');
    expect(second.putNewFile.mock.calls[0][0]).toBe('Entrada/Nota de voz 2026-11-02 09-05 2.webm');
  });

  it('gives up after 50 collisions and keeps the entry', async () => {
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    const { client, putNewFile } = fakeClient(async () => 'exists');
    const res = await drainQueue(db, client, 'Android');
    expect(res.uploaded).toBe(0);
    expect(res.lastError).toBeInstanceOf(AppError);
    expect(putNewFile).toHaveBeenCalledTimes(50);
    expect(await pendingCount(db)).toBe(1);
  });

  it('keeps entry on failure and stops at the first error', async () => {
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    await enqueue(db, new Blob(['b']), 'audio/webm', at('2026-11-02T09:06'));
    const { client, putNewFile } = fakeClient(async () => {
      throw new AppError('Offline');
    });
    const res = await drainQueue(db, client, 'Android');
    expect(res.uploaded).toBe(0);
    expect(res.lastError?.kind).toBe('Offline');
    expect(putNewFile).toHaveBeenCalledTimes(1);
    expect(await pendingCount(db)).toBe(2);
  });

  it('wraps non-AppError failures as Unknown', async () => {
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    const { client } = fakeClient(async () => {
      throw new Error('boom');
    });
    const res = await drainQueue(db, client, 'Android');
    expect(res.lastError?.kind).toBe('Unknown');
    expect(await pendingCount(db)).toBe(1);
  });

  it('survives reload and uploads once', async () => {
    await enqueue(db, new Blob(['hello']), 'audio/webm;codecs=opus', at('2026-11-02T09:05'));
    db.close();
    db = await openDb(DB);
    expect(await pendingCount(db)).toBe(1);
    const bodies: Blob[] = [];
    const { client, putNewFile } = fakeClient(async (_p, content) => {
      bodies.push(content);
      await new Promise((r) => setTimeout(r, 5));
      return 'created';
    });
    const [a, b] = await Promise.all([drainQueue(db, client, 'Android'), drainQueue(db, client, 'Android')]);
    expect(putNewFile).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.uploaded).toBe(1);
    expect(bodies[0].size).toBe(5);
    expect(bodies[0].type).toBe('audio/webm;codecs=opus');
    expect(await pendingCount(db)).toBe(0);
  });

  it('allows a new drain after the previous finished', async () => {
    const { client, putNewFile } = fakeClient(async () => 'created');
    await drainQueue(db, client, 'Android');
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    await drainQueue(db, client, 'Android');
    expect(putNewFile).toHaveBeenCalledTimes(1);
  });

  it('commit message format', async () => {
    await enqueue(db, new Blob(['a']), 'audio/webm', at('2026-11-02T09:05'));
    const { client, putNewFile } = fakeClient(async () => 'created');
    await drainQueue(db, client, 'iPhone');
    expect(putNewFile.mock.calls[0][2]).toMatch(
      /^MarkDaun mobile \(iPhone\) — \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/,
    );
  });
});

describe('drainQueue after the database was replaced', () => {
  it('does not join a run on a closed database', async () => {
    await enqueue(db, new Blob([new Uint8Array([1])]), 'audio/webm', new Date());
    let release!: (v: 'created') => void;
    const stuck = fakeClient(() => new Promise((r) => (release = r)));
    const dead = drainQueue(db, stuck.client, 'T');
    await new Promise((r) => setTimeout(r, 10));
    db.close();
    const db2 = await openDb(DB);
    await enqueue(db2, new Blob([new Uint8Array([2])]), 'audio/webm', new Date());
    const ok = fakeClient(async () => 'created');
    const res = await drainQueue(db2, ok.client, 'T');
    expect(res.uploaded).toBe(2); // the record from before the swap is still in the same store
    expect(ok.putNewFile).toHaveBeenCalledTimes(2);
    release('created');
    await dead;
    db = db2; // afterEach closes and deletes it
  });
});
