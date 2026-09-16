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
/**
 * Query parameters that select a rendition rather than identify the picture.
 *
 * Twitter serves one photo as ?name=small / medium / large / orig, and React
 * rewrites `src` between them as the layout changes. Keying on the raw URL made
 * every such switch a miss, which is what "it requests again" turned out to be.
 * The path is the identity on essentially every image CDN; these are not.
 */
const RENDITION_PARAMS = new Set([
  'name', 'format', 'fm', 'w', 'width', 'h', 'height', 'size', 's',
  'q', 'quality', 'dpr', 'resize', 'fit', 'crop', 'auto',
]);

export function normalizeUrl(raw: string): string {
  // data: and blob: URLs are already their own identity and carry no query.
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  try {
    const url = new URL(raw, document.baseURI);
    for (const name of [...url.searchParams.keys()]) {
      if (RENDITION_PARAMS.has(name.toLowerCase())) url.searchParams.delete(name);
    }
    url.hash = '';
    const query = url.searchParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return raw;
  }
}

export function cacheKey(url: string, settings: Settings): string {
  return [normalizeUrl(url), settings.targetLang, settings.sourceLang, settings.ocrLang].join('\u0000');
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

/**
 * A rendered translation, keyed by everything that changes how it looks.
 *
 * Caching the response alone still left the pixels to fetch and the canvas to
 * paint on every toggle - which is the request that showed up in the network
 * panel. Keeping the finished bitmap means a repeat costs nothing at all.
 *
 * The displayed width is bucketed: it decides the readable-text floor, but a
 * few pixels of layout jitter should not throw the cache away.
 */
export function renderKey(key: string, settings: Settings, displayedWidth: number): string {
  return [
    key,
    settings.renderMode,
    settings.verticalText,
    settings.fontFamily,
    settings.drawBackground ? 1 : 0,
    settings.minReadablePx,
    settings.supersample,
    settings.mangaMode ? 1 : 0,
    settings.mangaBoxGrowth,
    settings.outlineScale,
    settings.eraseMode,
    settings.hullPadding,
    settings.textAlign,
    Math.round(displayedWidth / 50),
  ].join('');
}

const renders = new Map<string, { blob: Blob; used: number }>();
let renderBytes = 0;

export function getRender(key: string, settings: Settings): Blob | null {
  if (settings.cacheBytes <= 0) return null;
  const entry = renders.get(key);
  if (!entry) return null;
  entry.used = ++clock;
  return entry.blob;
}

export function putRender(key: string, blob: Blob, settings: Settings): void {
  const limit = settings.cacheBytes;
  if (limit <= 0 || blob.size > limit) return;

  const existing = renders.get(key);
  if (existing) renderBytes -= existing.blob.size;
  renders.set(key, { blob, used: ++clock });
  renderBytes += blob.size;

  while (renderBytes > limit && renders.size > 1) {
    let oldestKey: string | null = null;
    let oldestUsed = Infinity;
    for (const [candidate, entry] of renders) {
      if (entry.used < oldestUsed) {
        oldestUsed = entry.used;
        oldestKey = candidate;
      }
    }
    if (oldestKey === null) break;
    renderBytes -= renders.get(oldestKey)?.blob.size ?? 0;
    renders.delete(oldestKey);
  }
}

export function clearCache(): { entries: number; bytes: number } {
  const stats = { entries: entries.size + renders.size, bytes: totalBytes + renderBytes };
  entries.clear();
  renders.clear();
  totalBytes = 0;
  renderBytes = 0;
  return stats;
}

export const cacheStats = (): { entries: number; bytes: number } => ({
  entries: entries.size + renders.size,
  bytes: totalBytes + renderBytes,
});
