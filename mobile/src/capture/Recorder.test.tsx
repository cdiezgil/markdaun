import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { openDb, type Db } from '../store/db';
import { Recorder } from './Recorder';
import * as queue from './queue';

const DB = 'markdaun-recorder-test';

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  static isTypeSupported = (t: string) => FakeRecorder.supported.includes(t);
  mimeType: string;
  state: 'inactive' | 'recording' = 'inactive';
  timeslice: number | undefined;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? 'audio/x-fallback';
    FakeRecorder.instances.push(this);
  }
  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

const track = { stop: vi.fn() };
const release = vi.fn(() => Promise.resolve());
let getUserMedia: ReturnType<typeof vi.fn<[], Promise<unknown>>>;
let db: Db;

beforeEach(async () => {
  FakeRecorder.instances = [];
  FakeRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  track.stop.mockClear();
  release.mockClear();
  getUserMedia = vi.fn<[], Promise<unknown>>(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: vi.fn(async () => ({ release })) },
    configurable: true,
  });
  db = await openDb(DB);
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
  await deleteDB(DB);
});

describe('Recorder', () => {
  it('records and enqueues', async () => {
    const onSaved = vi.fn();
    render(<Recorder db={db} onSaved={onSaved} />);
    expect(await screen.findByText('Grabando…')).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
    const rec = FakeRecorder.instances[0];
    expect(rec.mimeType).toBe('audio/webm;codecs=opus');
    expect(rec.timeslice).toBe(1000);

    await userEvent.click(screen.getByRole('button', { name: 'Detener' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(await queue.pendingCount(db)).toBe(1);
    const [item] = await db.getAll('queue');
    expect(item.mime).toBe('audio/webm;codecs=opus');
    expect(item.data.byteLength).toBe(3);
    expect(track.stop).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('falls back to audio/mp4 when webm is unsupported', async () => {
    FakeRecorder.supported = ['audio/mp4'];
    render(<Recorder db={db} onSaved={() => {}} />);
    await screen.findByText('Grabando…');
    expect(FakeRecorder.instances[0].mimeType).toBe('audio/mp4');
  });

  it('mic denied shows explanation', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    render(<Recorder db={db} onSaved={() => {}} />);
    expect(await screen.findByText(/Permite el micrófono en los ajustes del navegador/)).toBeInTheDocument();
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it('auto-stops at 30 minutes', async () => {
    // Only the clock: fake-indexeddb needs the real scheduler.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const onSaved = vi.fn();
    render(<Recorder db={db} onSaved={onSaved} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Grabando…')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 10);
    });
    expect(FakeRecorder.instances[0].state).toBe('inactive');
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(await queue.pendingCount(db)).toBe(1);
  });

  it('releases tracks on unmount', async () => {
    const { unmount } = render(<Recorder db={db} onSaved={() => {}} />);
    await screen.findByText('Grabando…');
    unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(FakeRecorder.instances[0].state).toBe('inactive');
  });

  it('keeps the view and shows an error when enqueue fails', async () => {
    vi.spyOn(queue, 'enqueue').mockRejectedValue(new Error('quota'));
    const onSaved = vi.fn();
    render(<Recorder db={db} onSaved={onSaved} />);
    await screen.findByText('Grabando…');
    await userEvent.click(screen.getByRole('button', { name: 'Detener' }));
    expect(await screen.findByText('No se pudo guardar la grabación')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
