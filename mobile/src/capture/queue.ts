import { AppError } from '../github/errors';
import type { GitHubClient } from '../github/client';
import type { Db, QueueRecord } from '../store/db';

const MAX_NUMBER = 50;

// Same mapping as `audio_ext` in src-tauri/src/voice/save.rs.
const EXT: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'video/mp4': 'm4a',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
};

function extFor(mime: string): string {
  const ext = EXT[mime.split(';')[0].trim().toLowerCase()];
  if (!ext) throw new AppError('Unknown', `Unsupported audio type: ${mime}`);
  return ext;
}

const pad = (v: number) => String(v).padStart(2, '0');

export function recordingName(at: Date, mime: string, n: number): string {
  const ext = extFor(mime);
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
  return `Entrada/Nota de voz ${stamp}${n > 1 ? ` ${n}` : ''}.${ext}`;
}

export function deviceName(ua: string): string {
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  return 'Móvil';
}

// Local time with offset, e.g. 2026-11-02T09:05:00+01:00 (like chrono's rfc3339 on desktop).
function rfc3339(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// Blob.arrayBuffer is missing in some older WebViews (and jsdom); fall back to FileReader.
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

export async function enqueue(db: Db, blob: Blob, mime: string, at: Date): Promise<void> {
  extFor(mime); // refuse types the desktop could never ingest
  const data = await readBytes(blob);
  await db.add('queue', { data, mime, at: at.getTime(), n: 1 });
}

export function pendingCount(db: Db): Promise<number> {
  return db.count('queue');
}

function asAppError(e: unknown): AppError {
  return e instanceof AppError ? e : new AppError('Unknown', e instanceof Error ? e.message : String(e));
}

async function uploadOne(
  db: Db,
  client: GitHubClient,
  rec: QueueRecord & { id: number },
  device: string,
): Promise<void> {
  const content = new Blob([rec.data], { type: rec.mime });
  const at = new Date(rec.at);
  let n = rec.n;
  while (n <= MAX_NUMBER) {
    const message = `MarkDaun mobile (${device}) — ${rfc3339(new Date())}`;
    const result = await client.putNewFile(recordingName(at, rec.mime, n), content, message);
    if (result === 'created') {
      // Delete only now that GitHub confirmed the file exists.
      await db.delete('queue', rec.id);
      return;
    }
    n += 1;
    await db.put('queue', { ...rec, n }); // never retry a name known to be taken
  }
  throw new AppError('Unknown', 'No free name for the recording');
}

async function drain(
  db: Db,
  client: GitHubClient,
  device: string,
): Promise<{ uploaded: number; lastError?: AppError }> {
  let uploaded = 0;
  try {
    for (;;) {
      const all = (await db.getAll('queue')) as (QueueRecord & { id: number })[];
      if (all.length === 0) break;
      all.sort((a, b) => a.id - b.id); // oldest first
      await uploadOne(db, client, all[0], device);
      uploaded += 1;
    }
  } catch (e) {
    return { uploaded, lastError: asAppError(e) };
  }
  return { uploaded, lastError: undefined };
}

let inflight: Promise<{ uploaded: number; lastError?: AppError }> | null = null;

export function drainQueue(
  db: Db,
  client: GitHubClient,
  device: string,
): Promise<{ uploaded: number; lastError?: AppError }> {
  // A concurrent call joins the running drain instead of starting a parallel loop.
  if (inflight) return inflight;
  const run = drain(db, client, device).finally(() => {
    inflight = null;
  });
  inflight = run;
  return run;
}
