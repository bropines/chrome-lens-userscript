import { fetchImageBlob } from './lens/client.js';
import type { Target } from './detect.js';
import type { Bytes, LensOptions, PreparedImage } from './types.js';

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
  { maxArea, maxSide }: Pick<LensOptions, 'maxArea' | 'maxSide'>
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

export type Source = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap;

function sourceSize(source: Source): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  // A video's frame is videoWidth, not the box it is displayed in.
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * The pixels a target already has on the page, if it has any of its own.
 *
 * An `<img>` that has not decoded yet, and a background, have none - those go
 * round by URL instead. A canvas and a video always do, and there is no URL to
 * fall back on for either, so what they hold is all there will ever be.
 */
function ownPixels(target: Target): Source | null {
  if (target.kind === 'canvas') return target.element as HTMLCanvasElement;
  if (target.kind === 'video') {
    const video = target.element as HTMLVideoElement;
    return video.videoWidth && video.videoHeight ? video : null;
  }
  if (target.kind === 'img') {
    const img = target.element as HTMLImageElement;
    return img.naturalWidth && img.naturalHeight ? img : null;
  }
  return null;
}

/**
 * A short, stable name for what this picture *is*.
 *
 * Keyed on content rather than address, because the address is the unreliable
 * half: a CDN serves the same photo under a dozen URLs, a reader re-mints a
 * blob: URL on every load, and neither survives a reload. The same pixels,
 * wherever they came from, answer to the same name.
 *
 * Taken from a fixed 128x128 downscale, so the cost does not depend on the
 * image and no JPEG encode is needed - the encode is the expensive half of a
 * miss, and this runs before it. The natural size joins the hash because two
 * pictures that differ only in resolution are not the same upload.
 *
 * Downscaling is deterministic within a browser but not promised across
 * versions; the worst an upgrade can do is miss and ask Lens again.
 */
const FINGERPRINT_SIZE = 128;

export function fingerprint(source: Source, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = FINGERPRINT_SIZE;
  canvas.height = FINGERPRINT_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';

  try {
    ctx.drawImage(source, 0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE);
    const { data } = ctx.getImageData(0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE);
    // FNV-1a over two offset lanes: one 32-bit lane collides often enough to
    // matter across a few thousand pictures, two do not, and both are one pass.
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < data.length; i += 1) {
      a = Math.imul(a ^ (data[i] as number), 0x01000193);
      b = Math.imul(b + (data[i] as number) + i, 0x85ebca6b);
    }
    const lane = (n: number): string => (n >>> 0).toString(36);
    return `${lane(a)}.${lane(b)}.${width}x${height}`;
  } catch {
    // A tainted canvas has no readable pixels, so it has no fingerprint; the
    // caller falls back to the address.
    return '';
  }
}

/** Draw, then JPEG-encode at Chromium's quality. Throws if the canvas is tainted. */
export async function encodeForUpload(
  source: Source,
  settings: LensOptions,
  release: () => void = () => {}
): Promise<PreparedImage> {
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

  return {
    imageBytes: new Uint8Array(await jpeg.arrayBuffer()) as Bytes,
    width,
    height,
    source,
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    release,
  };
}

/**
 * Re-request the same URL with CORS so the canvas stays clean.
 *
 * Most image hosts - pbs.twimg.com among them - send
 * `Access-Control-Allow-Origin: *`, but a plain <img> in the page is not
 * *requested* with CORS, so drawing it taints the canvas anyway. Asking again
 * with crossOrigin set usually comes straight out of the HTTP cache and makes
 * the pixels readable, which avoids needing a GM request, and therefore avoids
 * needing permission for the image's host at all.
 */
function loadWithCors(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.decoding = 'sync';
    probe.onload = () => resolve(probe);
    probe.onerror = () => reject(new Error('CORS load failed'));
    probe.src = url;
  });
}

/**
 * Get the image into Chromium's upload shape.
 *
 * Three ways in, cheapest first: the element as it stands, the same URL
 * re-requested with CORS, and finally the raw bytes over GM_xmlhttpRequest.
 * Only the last needs permission for the image's host, and it is rarely
 * reached.
 */
export async function prepareImage(
  target: Target,
  settings: LensOptions
): Promise<PreparedImage> {
  const own = ownPixels(target);
  if (own) {
    try {
      return await encodeForUpload(own, settings);
    } catch {
      // Tainted canvas; fall through to fetching the bytes ourselves.
    }
  }

  const url = target.url;
  if (!url) throw new Error('There is nothing to read from this element');

  try {
    const cors = await loadWithCors(url);
    return await encodeForUpload(cors, settings);
  } catch {
    // Either the host sends no CORS headers, or it sends them but the canvas
    // still came out tainted. Fall through to fetching the bytes.
  }

  const blob = await fetchImageBlob(url);
  const bitmap = await createImageBitmap(blob);
  try {
    // The bitmap is kept alive for rendering; the caller releases it.
    return await encodeForUpload(bitmap, settings, () => bitmap.close());
  } catch (e) {
    bitmap.close();
    throw e;
  }
}


/**
 * Decoded pixels only, without the JPEG encode.
 *
 * On a cache hit the bytes are never uploaded, so encoding them is pure waste -
 * and the encode is the expensive half. The same three-step ladder applies:
 * the element as it stands, the URL re-requested with CORS, then the raw bytes.
 */
export async function acquireSource(
  target: Target
): Promise<{ source: Source; width: number; height: number; release(): void }> {
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;

  /** Cheap test for whether this source can be read back out of a canvas. */
  const readable = (candidate: Source): boolean => {
    try {
      const ctx = probe.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(candidate, 0, 0, 1, 1);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  };

  const own = ownPixels(target);
  if (own && readable(own)) {
    const size = sourceSize(own);
    return { source: own, ...size, release: () => {} };
  }

  const url = target.url;
  // A canvas or a video that cannot be read back has nowhere else to go: it
  // never had an address, so there is no request that would recover it.
  if (!url) {
    throw new Error(
      own
        ? 'This element is drawn from another origin and cannot be read'
        : 'There is nothing to read from this element'
    );
  }

  try {
    const cors = await loadWithCors(url);
    if (readable(cors)) {
      const size = sourceSize(cors);
      return { source: cors, ...size, release: () => {} };
    }
  } catch {
    // Falls through to fetching the bytes.
  }

  const blob = await fetchImageBlob(url);
  const bitmap = await createImageBitmap(blob);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => bitmap.close(),
  };
}
