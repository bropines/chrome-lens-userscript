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

/** Fetch, downscale if needed, and encode as JPEG the way Chromium does. */
export async function prepareImage(url: string, settings: Settings): Promise<PreparedImage> {
  const blob = await fetchImageBlob(url);
  const bitmap = await createImageBitmap(blob);

  try {
    const { width, height } = targetSize(bitmap.width, bitmap.height, settings);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2d canvas context');

    // JPEG has no alpha; white is what a browser would have shown behind it.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', settings.jpegQuality)
    );
    if (!jpeg) throw new Error('The browser refused to encode this image');

    return { imageBytes: new Uint8Array(await jpeg.arrayBuffer()) as Bytes, width, height };
  } finally {
    bitmap.close();
  }
}
