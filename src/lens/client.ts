import { getTransport } from '../transport.js';
import { buildRequest } from './request.js';
import { parseResponse } from './response.js';
import type { LensOptions, LensResult, PreparedImage } from '../types.js';

export const LENS_ENDPOINT = 'https://lensfrontend-pa.googleapis.com/v1/crupload';

/** Image fetches are the rare path, but a dead host must not hang forever. */
const IMAGE_TIMEOUT_MS = 30_000;

/**
 * Send one image to Lens.
 *
 * The request goes out through whatever transport the front end installed: in
 * a userscript that is `GM_xmlhttpRequest`, which runs outside the page's
 * origin and is not subject to CORS - the whole reason this needs no server of
 * its own. What a host does with a binary body and a binary response varies
 * enough that none of it belongs here.
 */
export async function callLens(image: PreparedImage, settings: LensOptions): Promise<LensResult> {
  const response = await getTransport().post({
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
 * Fetch the image bytes through the transport rather than reading the <img>.
 *
 * A cross-origin image without CORS headers taints the canvas, and toBlob then
 * throws SecurityError. Fetching the bytes ourselves sidesteps that entirely.
 */
export async function fetchImageBlob(url: string): Promise<Blob> {
  const transport = getTransport();
  let response;
  try {
    response = await transport.get(url, IMAGE_TIMEOUT_MS);
  } catch (error) {
    // Whatever the host wants to add - a blocked domain is worth naming, and
    // only the host knows where to undo one. Everywhere else the transport's
    // own words are more use than anything this could invent.
    const hint = transport.hint?.() ?? '';
    throw new Error(`Could not fetch the image (${(error as Error).message}).${hint}`);
  }
  // The type comes from the response headers rather than the request, because a
  // Blob assembled from raw bytes has none of its own and createImageBitmap is
  // happier with one.
  return new Blob([response.bytes], { type: response.contentType });
}
