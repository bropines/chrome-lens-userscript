import { fetchImageBlob } from './lens/client.js';
import type { Bytes, PreparedImage, Settings } from './types.js';

/**
 * Chromium's rule: shrink only when the image is both large in area and
 * oversized on a side. A 1600x900 screenshot is left alone, which is exactly
 * where downscaling would cost OCR accuracy for nothing.
 *
 * lens::ShouldDownscaleSize, components/lens/lens_bitmap_processing.cc
 */
export function targetSize(
  width: number,
  height: number,
  { maxArea, maxSide }: Pick<Settings, 'maxArea' | 'maxSide'>
): { width: number; height: number } {
  if (width * height <= maxArea || (width <= maxSide && height <= maxSide)) {
    return { width, height };
  }
  const scale = Math.min(maxSide / width, maxSide / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type Source = HTMLImageElement | ImageBitmap;

function sourceSize(source: Source): { width: number; height: number } {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

/** Draw, then JPEG-encode at Chromium's quality. Throws if the canvas is tainted. */
async function encode(source: Source, settings: Settings): Promise<PreparedImage> {
  const natural = sourceSize(source);
  const { width, height } = targetSize(natural.width, natural.height, settings);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2d canvas context');

  // JPEG has no alpha; white is what a browser would have shown behind it.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  // toBlob reports a tainted canvas asynchronously as a null blob in some
  // engines and as a throw in others, so both are treated as "re-fetch".
  const jpeg = await new Promise<Blob | null>((resolve, reject) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', settings.jpegQuality);
    } catch (e) {
      reject(e as Error);
    }
  });
  if (!jpeg) throw new Error('Canvas is tainted');

  return { imageBytes: new Uint8Array(await jpeg.arrayBuffer()) as Bytes, width, height };
}

/**
 * Get the image into Chromium's upload shape.
 *
 * The element is tried first: the browser has already downloaded and decoded
 * it, so this costs no network at all and, more usefully, needs no @connect
 * permission for the image's host. Only a cross-origin image served without
 * CORS headers taints the canvas, and only then do the bytes get re-fetched
 * through GM_xmlhttpRequest.
 */
export async function prepareImage(
  img: HTMLImageElement,
  settings: Settings
): Promise<PreparedImage> {
  if (img.naturalWidth && img.naturalHeight) {
    try {
      return await encode(img, settings);
    } catch {
      // Tainted canvas; fall through to fetching the bytes ourselves.
    }
  }

  const url = img.currentSrc || img.src;
  if (!url) throw new Error('This image has no source to read');

  const blob = await fetchImageBlob(url);
  const bitmap = await createImageBitmap(blob);
  try {
    return await encode(bitmap, settings);
  } finally {
    bitmap.close();
  }
}
