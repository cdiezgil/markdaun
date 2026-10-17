import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rasterizeImage } from './rasterize';

interface FakeImg {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
}

let lastImg: FakeImg;
let canvasSize: { width: number; height: number };
const drawImage = vi.fn();

beforeEach(() => {
  canvasSize = { width: 0, height: 0 };
  drawImage.mockClear();
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 200;
      private _src = '';
      constructor() {
        lastImg = this as unknown as FakeImg;
      }
      set src(v: string) {
        this._src = v;
        queueMicrotask(() => this.onload?.());
      }
      get src() {
        return this._src;
      }
    },
  );
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    const c = {
      set width(v: number) {
        canvasSize.width = v;
      },
      get width() {
        return canvasSize.width;
      },
      set height(v: number) {
        canvasSize.height = v;
      },
      get height() {
        return canvasSize.height;
      },
      getContext: () => ({ drawImage, fillStyle: '', fillRect: vi.fn() }),
      toDataURL: (type: string) => `data:${type};base64,QUJD`,
    };
    return c as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rasterizeImage', () => {
  it('draws the image on a canvas and returns PNG base64', async () => {
    const r = await rasterizeImage('asset:///v/d.svg');
    expect(lastImg.src).toBe('asset:///v/d.svg');
    expect(r).toEqual({ mediaType: 'image/png', dataB64: 'QUJD' });
    expect(canvasSize).toEqual({ width: 400, height: 200 });
    expect(drawImage).toHaveBeenCalled();
  });

  it('downscales so the longest side is at most 1568', async () => {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 3136;
        naturalHeight = 1568;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    await rasterizeImage('asset:///v/big.svg');
    expect(canvasSize).toEqual({ width: 1568, height: 784 });
  });

  it('uses a default size for SVGs without intrinsic dimensions', async () => {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 0;
        naturalHeight = 0;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    await rasterizeImage('asset:///v/flat.svg');
    expect(canvasSize.width).toBe(1024);
    expect(canvasSize.height).toBe(1024);
  });

  it('rejects when the image cannot be loaded', async () => {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(rasterizeImage('asset:///v/x.svg')).rejects.toThrow(/cargar/);
  });
});
