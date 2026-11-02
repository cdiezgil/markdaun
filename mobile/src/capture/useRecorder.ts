import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError } from '../github/errors';

export const MAX_RECORDING_MS = 30 * 60 * 1000;
const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export interface RecordingResult {
  blob: Blob;
  mime: string;
  at: Date;
}

export type RecorderState = 'idle' | 'recording' | 'saving';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

function pickMime(): string | undefined {
  return PREFERRED.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Records microphone audio. `onAutoStop` receives the result when the 30-minute
 * limit ends the recording (a manual `stop()` returns it instead).
 */
export function useRecorder(onAutoStop?: (result: RecordingResult | null) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<AppError | undefined>();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lockRef = useRef<WakeLockSentinelLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef<Date>(new Date());
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const genRef = useRef(0);
  const autoStopRef = useRef(onAutoStop);
  autoStopRef.current = onAutoStop;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const lock = lockRef.current;
    lockRef.current = null;
    if (lock) void lock.release().catch(() => {});
  }, []);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return null;
    recorderRef.current = null;
    if (mountedRef.current) setState('saving');
    if (recorder.state !== 'inactive') {
      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => resolve();
      });
      try {
        recorder.stop();
      } catch {
        // Already stopped: fall through with the chunks collected so far.
        recorder.onstop?.(new Event('stop'));
      }
      await done;
    }
    cleanup();
    const mime = recorder.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    return { blob, mime, at: startedRef.current };
  }, [cleanup]);

  const start = useCallback(async () => {
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    const gen = genRef.current;
    setError(undefined);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (gen !== genRef.current) return;
      startingRef.current = false;
      const name = e instanceof DOMException || e instanceof Error ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setError(new AppError('MicDenied'));
      else if (name === 'NotFoundError') setError(new AppError('Unknown', 'No se encontró un micrófono'));
      else setError(new AppError('Unknown', 'No se pudo acceder al micrófono'));
      return;
    }
    if (gen !== genRef.current) {
      // Superseded (unmounted or restarted while waiting): never keep this mic open.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    startingRef.current = false;
    streamRef.current = stream;
    const mimeType = pickMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    const startedAt = Date.now();
    startedRef.current = new Date(startedAt);
    setElapsedMs(0);
    setState('recording');
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(Math.min(elapsed, MAX_RECORDING_MS));
      if (elapsed >= MAX_RECORDING_MS) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        void stop().then((r) => autoStopRef.current?.(r));
      }
    }, 250);
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    }).wakeLock;
    if (wakeLock) {
      try {
        const lock = await wakeLock.request('screen');
        if (recorderRef.current) lockRef.current = lock;
        else void lock.release().catch(() => {});
      } catch {
        // Wake Lock is a nicety; recording works without it.
      }
    }
  }, [stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
      startingRef.current = false;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      cleanup();
    };
  }, [cleanup]);

  const reset = useCallback(() => setState('idle'), []);

  return { state, elapsedMs, error, start, stop, reset };
}
