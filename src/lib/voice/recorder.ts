/** Hard limit of one voice note: it stops and saves by itself. */
export const MAX_RECORDING_MS = 30 * 60 * 1000;

/** Speech needs little: keeps 30 minutes under ~8 MB. */
const AUDIO_BITS_PER_SECOND = 32_000;

/** WKWebView (macOS) records MP4/AAC; WebView2 (Windows) WebM/Opus. */
const CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export function pickMimeType(isSupported: (type: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string {
  return CANDIDATES.find((t) => isSupported(t)) ?? '';
}

export interface RecordedAudio {
  blob: Blob;
  /** Container the webview produced (`audio/mp4`, `audio/webm;codecs=opus`…). */
  mime: string;
  durationMs: number;
}

/** Base64 (no `data:` prefix) of a blob. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Spanish explanation for a failure to open the microphone. */
export function microphoneErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'MarkDaun no tiene permiso para usar el micrófono. Actívalo en Ajustes del Sistema → Privacidad y seguridad → Micrófono.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No se encontró ningún micrófono.';
  }
  return 'No se pudo grabar con el micrófono.';
}

/** One recording: microphone → `MediaRecorder`, plus an input level meter. */
export class VoiceRecorder {
  private done = false;
  private chunks: Blob[] = [];
  private readonly started = Date.now();
  private readonly levelBuffer: Uint8Array<ArrayBuffer>;

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly mime: string,
    private readonly analyser: AnalyserNode | null,
    private readonly context: AudioContext | null,
  ) {
    this.levelBuffer = new Uint8Array(new ArrayBuffer(analyser?.fftSize || 1024));
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
  }

  /** Opens the microphone and starts recording. Rejects if it cannot. */
  static async start(): Promise<VoiceRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      let context: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      try {
        context = new AudioContext();
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
      } catch {
        /* the level meter is optional */
      }
      const rec = new VoiceRecorder(stream, recorder, mime || recorder.mimeType, analyser, context);
      recorder.start(1000);
      return rec;
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }

  elapsedMs(): number {
    return Date.now() - this.started;
  }

  /** Input level 0..1 (RMS of the waveform). */
  level(): number {
    if (!this.analyser || this.done) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (const v of this.levelBuffer) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.levelBuffer.length) * 1.5);
  }

  /** Stops and returns the recording. */
  stop(): Promise<RecordedAudio> {
    const durationMs = this.elapsedMs();
    return new Promise((resolve, reject) => {
      if (this.done) {
        reject(new Error('already stopped'));
        return;
      }
      this.recorder.onstop = () => {
        const mime = this.recorder.mimeType || this.mime;
        this.release();
        resolve({ blob: new Blob(this.chunks, { type: mime }), mime, durationMs });
      };
      this.recorder.stop();
    });
  }

  /** Throws the recording away. Safe to call more than once. */
  cancel(): void {
    if (this.done) return;
    this.recorder.onstop = null;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.chunks = [];
    this.release();
  }

  private release(): void {
    this.done = true;
    this.stream.getTracks().forEach((t) => t.stop());
    void this.context?.close().catch(() => {});
  }
}
