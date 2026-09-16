import type { LensResult, Settings, TranslationBlock } from './types.js';

/**
 * Remember what Lens said about an image.
 *
 * Toggling a translation off and back on, or coming back to a post further up
 * the feed, used to mean a fresh upload and a fresh round trip - slow, and it
 * spends quota on an answer we already had. Only the *response* is cached;
 * re-rendering from it is local work measured in milliseconds, so changing a
 * render setting still takes effect without invalidating anything.
 *
 * Entries are evicted by total size rather than by count, because the weight is
 * almost entirely the inpainted WebP patches and those vary hugely between a
 * two-word sign and a page of manga.
 */

interface Entry {
  result: LensResult;
  bytes: number;
  used: number;
}

/** Roughly the weight of one entry: the patches dominate, the strings do not. */
function weigh(blocks: TranslationBlock[]): number {
  let bytes = 0;
  for (const block of blocks) {
    bytes += block.translation.length * 2;
    for (const line of block.lines) bytes += line.background?.bytes.byteLength ?? 0;
  }
  return bytes;
}

const entries = new Map<string, Entry>();
let totalBytes = 0;
let clock = 0;

/**
 * What the answer depends on. Render-time settings are deliberately absent:
 * they change how it is drawn, not what came back.
 */
export function cacheKey(url: string, settings: Settings): string {
  return [url, settings.targetLang, settings.sourceLang, settings.ocrLang].join('\u0000');
}

export function getCached(key: string, settings: Settings): LensResult | null {
  if (settings.cacheBytes <= 0) return null;
  const entry = entries.get(key);
  if (!entry) return null;
  entry.used = ++clock;
  return entry.result;
}

export function putCached(key: string, result: LensResult, settings: Settings): void {
  const limit = settings.cacheBytes;
  if (limit <= 0) return;

  const bytes = weigh(result.blocks);
  // A single oversized page should not evict everything else to land, and then
  // be evicted itself on the next insert.
  if (bytes > limit) return;

  const existing = entries.get(key);
  if (existing) totalBytes -= existing.bytes;
  entries.set(key, { result, bytes, used: ++clock });
  totalBytes += bytes;

  while (totalBytes > limit && entries.size > 1) {
    let oldestKey: string | null = null;
    let oldestUsed = Infinity;
    for (const [candidate, entry] of entries) {
      if (entry.used < oldestUsed) {
        oldestUsed = entry.used;
        oldestKey = candidate;
      }
    }
    if (oldestKey === null) break;
    totalBytes -= entries.get(oldestKey)?.bytes ?? 0;
    entries.delete(oldestKey);
  }
}

export function clearCache(): { entries: number; bytes: number } {
  const stats = { entries: entries.size, bytes: totalBytes };
  entries.clear();
  totalBytes = 0;
  return stats;
}

export const cacheStats = (): { entries: number; bytes: number } => ({
  entries: entries.size,
  bytes: totalBytes,
});
