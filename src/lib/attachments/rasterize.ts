import { MAX_IMAGE_SIDE, type DerivedImage } from './types';

const FALLBACK_SIDE = 1024;

/** Loads `src` (an asset URL) in an <img> and re-encodes it as PNG on a canvas. */
export async function rasterizeImage(src: string): Promise<DerivedImage> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('No se pudo cargar la imagen para convertirla.'));
    el.src = src;
  });
  let w = img.naturalWidth || FALLBACK_SIDE;
  let h = img.naturalHeight || FALLBACK_SIDE;
  const longest = Math.max(w, h);
  if (longest > MAX_IMAGE_SIDE) {
    const k = MAX_IMAGE_SIDE / longest;
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo convertir la imagen.');
  // Transparent SVGs read badly for models on black; paint them on white.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const url = canvas.toDataURL('image/png');
  return { mediaType: 'image/png', dataB64: url.slice(url.indexOf(',') + 1) };
}
