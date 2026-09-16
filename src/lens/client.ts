import { GM_xmlhttpRequest } from '$';
import { buildRequest } from './request.js';
import { parseResponse } from './response.js';
import type { Bytes, LensResult, PreparedImage, Settings } from '../types.js';

export const LENS_ENDPOINT = 'https://lensfrontend-pa.googleapis.com/v1/crupload';

/**
 * Send one image to Lens.
 *
 * GM_xmlhttpRequest runs in the extension's context and is not subject to CORS,
 * which is the whole reason this script needs no server of its own.
 */
export function callLens(image: PreparedImage, settings: Settings): Promise<LensResult> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'POST',
      url: LENS_ENDPOINT,
      headers: {
        'Content-Type': 'application/x-protobuf',
        'X-Goog-Api-Key': settings.apiKey,
      },
      data: buildRequest(image, settings),
      binary: true,
      responseType: 'arraybuffer',
      timeout: settings.timeoutMs,
      onload: (response) => {
        if (response.status !== 200) {
          reject(new Error(`Lens returned HTTP ${response.status}`));
          return;
        }
        try {
          resolve(parseResponse(new Uint8Array(response.response as ArrayBuffer) as Bytes));
        } catch (e) {
          reject(new Error(`Could not parse the Lens response: ${(e as Error).message}`));
        }
      },
      onerror: () => reject(new Error('Network error talking to Lens')),
      ontimeout: () => reject(new Error('Lens timed out')),
    });
  });
}

/**
 * Fetch image bytes through GM_xmlhttpRequest rather than reading the <img>.
 *
 * A cross-origin image without CORS headers taints the canvas, and toBlob then
 * throws SecurityError. Fetching the bytes ourselves sidesteps that entirely.
 */
export function fetchImageBlob(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      responseType: 'blob',
      onload: (response) => {
        if (response.status && response.status >= 400) {
          reject(new Error(`Image fetch returned HTTP ${response.status}`));
          return;
        }
        resolve(response.response as Blob);
      },
      onerror: () => reject(new Error('Could not fetch the image')),
    });
  });
}
