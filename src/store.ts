import type { CacheOptions, LensOptions, LensResult } from './types.js';

/**
 * What Lens said, kept across reloads.
 *
 * The in-memory cache in `cache.ts` dies with the page, so reopening a chapter
 * re-uploaded every picture and asked the same questions again - bytes to
 * Google, quota, and a wait, for an answer already given. This keeps the
 * *answer* and nothing else: rendering from it is local work measured in
 * milliseconds, so the picture is drawn again here rather than stored.
 *
 * IndexedDB rather than GM storage. The patches are binary and run to megabytes
 * a chapter, which is not what a settings store is for - and GM4 only promises
 * to keep strings anyway. The cost is that it is per-origin: a site gets its own
 * cache, and the same photo on another site is asked about again.
 */

const DB_NAME = 'lens-translate';
const DB_VERSION = 1;
const STORE = 'responses';

interface StoredEntry {
  hash: string;
  /** The answer depends on the languages asked for, not just the picture. */
  languages: string;
  result: LensResult;
  bytes: number;
  used: number;
}

let open: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (open) return open;
  open = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private mode, or a site whose storage is blocked outright.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'hash' }).createIndex('used', 'used');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A blocked upgrade would hang this promise and every caller with it.
    request.onblocked = () => resolve(null);
  });
  return open;
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return database().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE, mode);
          const request = body(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/** The languages the answer was given in; a different set is a different answer. */
const languagesOf = (settings: LensOptions): string =>
  [settings.targetLang, settings.sourceLang, settings.ocrLang].join('|');

/** Roughly the weight of an answer: the inpainted patches, and little else. */
function weigh(result: LensResult): number {
  let bytes = 0;
  for (const block of result.blocks) {
    bytes += block.translation.length * 2;
    for (const line of block.lines) bytes += line.background?.bytes.byteLength ?? 0;
  }
  return bytes;
}

export async function getStored(
  hash: string,
  settings: LensOptions & CacheOptions
): Promise<LensResult | null> {
  if (!hash || !settings.persistCache) return null;
  const entry = (await run<StoredEntry>('readonly', (store) => store.get(hash))) ?? null;
  if (!entry || entry.languages !== languagesOf(settings)) return null;

  // Touch it, so eviction takes the ones nobody comes back to. Nothing waits
  // on this: the answer is already in hand.
  void run('readwrite', (store) => store.put({ ...entry, used: Date.now() }));
  return entry.result;
}

export async function putStored(
  hash: string,
  result: LensResult,
  settings: LensOptions & CacheOptions
): Promise<void> {
  if (!hash || !settings.persistCache || settings.cacheBytes <= 0) return;
  const entry: StoredEntry = {
    hash,
    languages: languagesOf(settings),
    result,
    bytes: weigh(result),
    used: Date.now(),
  };
  await run('readwrite', (store) => store.put(entry));
  await evict(settings.cacheBytes);
}

/**
 * Keep the store under its budget, oldest use first.
 *
 * Counted rather than trusted to the quota: a browser that runs out evicts the
 * whole origin at once, which would take the settings of a site along with it.
 */
async function evict(budget: number): Promise<void> {
  const all = (await run<StoredEntry[]>('readonly', (store) => store.getAll())) ?? [];
  let total = all.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= budget) return;

  for (const entry of [...all].sort((a, b) => a.used - b.used)) {
    if (total <= budget) break;
    total -= entry.bytes;
    await run('readwrite', (store) => store.delete(entry.hash));
  }
}

export async function clearStored(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}

export async function storedStats(): Promise<{ entries: number; bytes: number }> {
  const all = (await run<StoredEntry[]>('readonly', (store) => store.getAll())) ?? [];
  return { entries: all.length, bytes: all.reduce((sum, entry) => sum + entry.bytes, 0) };
}
