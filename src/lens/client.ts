import { getBinary, hostName, postBinary } from '../gm.js';
import { buildRequest } from './request.js';
import { parseResponse } from './response.js';
import type { LensResult, PreparedImage, Settings } from '../types.js';

export const LENS_ENDPOINT = 'https://lensfrontend-pa.googleapis.com/v1/crupload';

/** Image fetches are the rare path, but a dead host must not hang forever. */
const IMAGE_TIMEOUT_MS = 30_000;

/**
 * Send one image to Lens.
 *
 * GM_xmlhttpRequest runs outside the page's origin and is not subject to CORS,
 * which is the whole reason this script needs no server of its own. What it
 * does with a binary body and a binary response varies by host, so it is
 * reached through `gm.ts` rather than called directly.
 */
export async function callLens(image: PreparedImage, settings: Settings): Promise<LensResult> {
  const response = await postBinary({
    url: LENS_ENDPOINT,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'X-Goog-Api-Key': settings.apiKey,
    },
    body: buildRequest(image, settings),
    timeoutMs: settings.timeoutMs,
  });

  try {
    return parseResponse(response.bytes);
  } catch (e) {
    throw new Error(`Could not parse the Lens response: ${(e as Error).message}`);
  }
}

/**
 * Fetch image bytes through GM_xmlhttpRequest rather than reading the <img>.
 *
 * A cross-origin image without CORS headers taints the canvas, and toBlob then
 * throws SecurityError. Fetching the bytes ourselves sidesteps that entirely.
 */
export async function fetchImageBlob(url: string): Promise<Blob> {
  let response;
  try {
    response = await getBinary(url, IMAGE_TIMEOUT_MS);
  } catch (error) {
    // Tampermonkey blocks a domain permanently once refused, and it is the one
    // host with a specific place to undo that. Everywhere else the transport's
    // own words are more use than anything this could invent.
    const hint =
      hostName() === 'Tampermonkey'
        ? ' If Tampermonkey blocked this domain, clear it under Settings > Security > Blocked domains.'
        : '';
    throw new Error(`Could not fetch the image (${(error as Error).message}).${hint}`);
  }
  // The type comes from the response headers rather than the request, because a
  // Blob assembled from raw bytes has none of its own and createImageBitmap is
  // happier with one.
  return new Blob([response.bytes], { type: response.contentType });
}
