import type { Bytes } from './types.js';

/**
 * The one thing the engine cannot do for itself.
 *
 * Everything else here is arithmetic and canvas work, which runs anywhere. The
 * Lens endpoint is not: it answers a cross-origin POST only through a
 * privileged request, which in a userscript means `GM_xmlhttpRequest` and in
 * anything else means something else entirely. So the engine declares what it
 * needs and the front end supplies it, rather than importing a userscript host
 * and dragging `vite-plugin-monkey` in behind it.
 *
 * `src/gm.ts` is this script's implementation, and it is where every difference
 * between userscript hosts lives - the encoding retry, the response
 * normalisation, the fallback to a plain fetch. None of that is the engine's
 * business, and none of it is portable.
 */

/** A response reduced to the three things this engine ever reads. */
export interface BinaryResponse {
  status: number;
  bytes: Bytes;
  contentType: string;
}

export interface BinaryRequest {
  url: string;
  headers: Record<string, string>;
  body: Bytes;
  timeoutMs: number;
}

export interface Transport {
  post(request: BinaryRequest): Promise<BinaryResponse>;
  get(url: string, timeoutMs: number): Promise<BinaryResponse>;
  /**
   * Anything the host wants appended when a request fails.
   *
   * Tampermonkey blocks a domain permanently once the user refuses it, and it
   * is the one host with a specific place to undo that - which is worth saying
   * out loud, and is not something the engine could know.
   */
  hint?(): string;
}

let installed: Transport | null = null;

export function setTransport(transport: Transport): void {
  installed = transport;
}

export function getTransport(): Transport {
  if (!installed) {
    throw new Error('No transport is installed: call setTransport() before translating');
  }
  return installed;
}
