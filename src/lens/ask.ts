import { encodeForUpload, encodeRect, sourceSize } from '../image.js';
import type { Source } from '../image.js';
import { callLens } from './client.js';
import { mergeTiles, planTiles } from './tiles.js';
import type { LensOptions, LensResult } from '../types.js';

/**
 * Tiles in flight at once, after the first.
 *
 * Two halves the wait without looking like a burst from one client; the key
 * is Chromium's own and shared with everyone using it.
 */
const TILE_PARALLEL = 2;

/**
 * Whether asking again could plausibly go differently.
 *
 * A status in the 400s is the other end's considered answer - a bad key, a
 * refused request - and repeating it spends a request to hear it twice. A
 * timeout has already cost the whole wait, and the transport does not pay
 * that twice either. What is left is the kind of failure that does pass: a
 * dropped connection, a 5xx, an answer cut short. 408 and 429 are in the 400s
 * and mean "later", not "no".
 */
export function looksTransient(error: unknown): boolean {
  if ((error as Error | null)?.name === 'TimeoutError') return false;
  const status = /\bHTTP (\d{3})\b/.exec(String((error as Error | null)?.message ?? ''))?.[1];
  if (!status) return true;
  return status === '408' || status === '429' || !status.startsWith('4');
}

/**
 * Ask Lens about a picture, whatever that takes.
 *
 * For nearly every picture that is one upload, made exactly as it always was.
 * A long strip is sent as its tiles instead (see tiles.ts) and the answers come
 * back as one, in the whole picture's coordinates, so the caller caches, stores
 * and draws it without knowing.
 *
 * A tile that fails fails the translation, after one more try if that could
 * help: a strip with a silent hole in it looks finished and is not, and the
 * person reading it has no way to tell. The first tile goes alone, so a
 * request that was never going to work - a bad key - costs one request rather
 * than a round of them.
 */
export async function askLens(source: Source, options: LensOptions): Promise<LensResult> {
  const { width, height } = sourceSize(source);
  const plan = planTiles(width, height, options);
  if (!plan) return callLens(await encodeForUpload(source, options), options);

  const total = plan.tiles.length;
  const results: LensResult[] = new Array<LensResult>(total);

  const ask = async (index: number): Promise<void> => {
    const tile = plan.tiles[index];
    if (!tile) return;
    const once = async (): Promise<LensResult> => {
      const encoded = await encodeRect(source, tile, options);
      return callLens(
        { imageBytes: encoded.bytes, width: encoded.width, height: encoded.height },
        options
      );
    };
    try {
      try {
        results[index] = await once();
      } catch (error) {
        if (!looksTransient(error)) throw error;
        results[index] = await once();
      }
    } catch (error) {
      throw new Error(`part ${index + 1} of ${total} of a long picture: ${(error as Error).message}`);
    }
  };

  await ask(0);

  let next = 1;
  let failure: Error | null = null;
  const worker = async (): Promise<void> => {
    // Once one has failed nothing new is started: the answer is already lost.
    while (!failure && next < total) {
      const index = next;
      next += 1;
      try {
        await ask(index);
      } catch (error) {
        failure ??= error as Error;
      }
    }
  };
  await Promise.all(Array.from({ length: TILE_PARALLEL }, worker));
  if (failure) throw failure as Error;

  return mergeTiles(plan, results);
}
