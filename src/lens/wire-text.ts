import { PLATFORM_WEB, RENDERING_ENV_LENS_OVERLAY, SURFACE_CHROMIUM, randomUuid } from './request.js';
import type { TextAlternative, TextRequest } from '../transport.js';
import type { Bytes, LensOptions, PreparedImage } from '../types.js';

/**
 * The Lens request as text both ways (see `TextAlternative`).
 *
 * The endpoint takes the proto3 JSON form of the same message - field names,
 * the picture as base64 - and `$alt=proto` with
 * `X-Goog-Encode-Response-If-Executable: base64` answers with the usual binary
 * response, base64-encoded as `text/plain`. So nothing changes but the
 * envelope, and the response parser is the one every other request uses.
 * JSPB (`application/json+protobuf`) is refused for this service; plain JSON
 * is not. Measured against the live endpoint.
 *
 * The names here are the JSON names of the fields `buildRequest` writes by
 * number; test/wire-text.test.ts holds the two to the same message.
 */

const FILTER_TRANSLATE = 2;
const FILTER_AUTO = 7;

/** The objects request, under the JSON names the protos give its fields. */
export function jsonRequest(imageBase64: string, width: number, height: number, settings: LensOptions): string {
  const translate = Boolean(settings.targetLang);
  // Empty strings are left out, as the binary writer leaves them out.
  const compact = (fields: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
  return JSON.stringify({
    objectsRequest: {
      requestContext: {
        requestId: { uuid: randomUuid().toString(), sequenceId: 1, imageSequenceId: 1 },
        clientContext: {
          platform: PLATFORM_WEB,
          surface: SURFACE_CHROMIUM,
          localeContext: compact({
            language: settings.ocrLang || settings.targetLang,
            region: settings.region,
            timeZone: settings.timeZone,
          }),
          clientFilters: {
            filter: [
              translate
                ? {
                    filterType: FILTER_TRANSLATE,
                    translate: compact({ targetLanguage: settings.targetLang, sourceLanguage: settings.sourceLang }),
                  }
                : { filterType: FILTER_AUTO },
            ],
          },
          renderingContext: { renderingEnvironment: RENDERING_ENV_LENS_OVERLAY },
        },
      },
      imageData: { payload: { imageBytes: imageBase64 }, imageMetadata: { width, height } },
    },
  });
}

export function toBase64(bytes: Bytes): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out as Bytes;
}

/** Whether an answer is the base64 text this request asked for. */
export function isBase64Text(bytes: Bytes): boolean {
  const head = bytes.subarray(0, 256);
  if (!head.length) return false;
  for (const byte of head) {
    const ok =
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2b || byte === 0x2f || byte === 0x3d || byte === 0x2d || byte === 0x5f ||
      byte === 0x0a || byte === 0x0d;
    if (!ok) return false;
  }
  return true;
}

/** The same JPEG, smaller: scaled by `scale` and encoded at `quality`. */
async function reencode(
  jpeg: Bytes,
  width: number,
  height: number,
  scale: number,
  quality: number
): Promise<{ bytes: Bytes; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
  try {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2d canvas context');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode the smaller picture');
    return { bytes: new Uint8Array(await blob.arrayBuffer()) as Bytes, width: w, height: h };
  } finally {
    bitmap.close();
  }
}

/**
 * Quality first, then size: lettering survives a lower JPEG quality better
 * than fewer pixels. Each step is tried until the request fits.
 */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0.7],
  [1, 0.55],
  [0.85, 0.55],
  [0.72, 0.55],
  [0.6, 0.5],
  [0.5, 0.5],
  [0.4, 0.45],
  [0.3, 0.4],
];

export function textAlternative(
  image: Pick<PreparedImage, 'imageBytes' | 'width' | 'height'>,
  settings: LensOptions,
  url: string
): TextAlternative {
  return {
    async build(fits): Promise<TextRequest> {
      const wrap = (body: string): TextRequest => ({
        url: `${url}?%24alt=proto`,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': settings.apiKey,
          'X-Goog-Encode-Response-If-Executable': 'base64',
        },
        body,
      });
      const first = jsonRequest(toBase64(image.imageBytes), image.width, image.height, settings);
      if (fits(first)) return wrap(first);
      for (const [scale, quality] of STEPS) {
        const smaller = await reencode(image.imageBytes, image.width, image.height, scale, quality);
        const body = jsonRequest(toBase64(smaller.bytes), smaller.width, smaller.height, settings);
        if (fits(body)) return wrap(body);
      }
      throw new Error('The picture does not fit what this userscript host can send, even made small');
    },
    decode(bytes) {
      // Base64 arrives as ASCII; anything else is already the binary answer.
      return isBase64Text(bytes) ? fromBase64(new TextDecoder().decode(bytes)) : bytes;
    },
  };
}
