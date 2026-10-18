import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { blobToBase64, MAX_RECORDING_MS, pickMimeType, VoiceRecorder, microphoneErrorMessage } from './recorder';

class FakeMediaRecorder {
  static supported = new Set<string>();
  static isTypeSupported = (t: string) => FakeMediaRecorder.supported.has(t);
  static last: FakeMediaRecorder | undefined;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  options: unknown;
  constructor(public stream: unknown, options?: { mimeType?: string }) {
    this.options = options;
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.last = this;
  }
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
    this.onstop?.();
  });
}

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] };
const analyser = {
  fftSize: 0,
  getByteTimeDomainData: vi.fn((buf: Uint8Array) => buf.fill(128)),
};
const closeCtx = vi.fn(async () => {});
class FakeAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return analyser;
  }
  close = closeCtx;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus']);
  FakeMediaRecorder.last = undefined;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pickMimeType', () => {
  it('prefers mp4 (WKWebView) and falls back to webm/opus (WebView2)', () => {
    expect(pickMimeType(() => true)).toBe('audio/mp4');
    expect(pickMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickMimeType(() => false)).toBe('');
  });
});

describe('VoiceRecorder', () => {
  it('asks for the microphone, records with the supported container and reports elapsed time', async () => {
    const rec = await VoiceRecorder.start();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeMediaRecorder.last?.mimeType).toBe('audio/webm;codecs=opus');
    expect(FakeMediaRecorder.last?.start).toHaveBeenCalled();
    vi.advanceTimersByTime(3200);
    expect(rec.elapsedMs()).toBe(3200);
  });

  it('stop resolves with the audio, its mime type and duration, and releases the microphone', async () => {
    const rec = await VoiceRecorder.start();
    vi.advanceTimersByTime(5000);
    const out = await rec.stop();
    expect(out.mime).toBe('audio/webm;codecs=opus');
    expect(out.durationMs).toBe(5000);
    vi.useRealTimers(); // jsdom's FileReader needs real timers
    expect(await blobToBase64(out.blob)).toBe(btoa('abc'));
    expect(track.stop).toHaveBeenCalled();
    expect(closeCtx).toHaveBeenCalled();
  });

  it('cancel discards everything and releases the microphone', async () => {
    const rec = await VoiceRecorder.start();
    rec.cancel();
    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.last?.stop).toHaveBeenCalled();
    rec.cancel(); // idempotent
  });

  it('reports the input level between 0 and 1', async () => {
    const rec = await VoiceRecorder.start();
    expect(rec.level()).toBe(0);
    analyser.getByteTimeDomainData.mockImplementationOnce((buf: Uint8Array) => buf.fill(255));
    expect(rec.level()).toBeGreaterThan(0.9);
    expect(rec.level()).toBeLessThanOrEqual(1);
    rec.cancel();
  });

  it('the recording limit is thirty minutes', () => {
    expect(MAX_RECORDING_MS).toBe(30 * 60 * 1000);
  });

  it('propagates a denied microphone', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
    await expect(VoiceRecorder.start()).rejects.toBe(err);
  });
});

describe('microphoneErrorMessage', () => {
  it('explains permission, missing device and unsupported cases in Spanish', () => {
    expect(microphoneErrorMessage(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toMatch(/permiso/i);
    expect(microphoneErrorMessage(Object.assign(new Error('x'), { name: 'NotFoundError' }))).toMatch(/micrófono/i);
    expect(microphoneErrorMessage(new Error('otro'))).toMatch(/no se pudo grabar/i);
  });
});
