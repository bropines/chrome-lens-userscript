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
 * cache, and the same photo on another site is asked about again. That is also
 * a privacy fact worth knowing: what was translated on a site is stored under
 * that site's origin, where the site's own scripts can read it.
 *
 * The budget (`cacheBytes`) is a separate allowance from the in-memory one: that
 * is RAM, this is disk, and each is held to the same number on its own.
 */

const DB_NAME = 'lens-translate';
/**
 * 2: responses are keyed by picture *and* the languages asked for, and recency
 * lives in a store of its own. Version 1 keyed on the picture alone, so
 * translating to a second language overwrote the first, and kept `used` on the
 * records themselves, which meant rewriting a whole answer - megabytes of
 * patches - to say it had been read.
 */
const DB_VERSION = 2;
const RESPONSES = 'responses';
const META = 'meta';

interface StoredEntry {
  /** `hash`, a separator, then the languages: what the answer is an answer to. */
  key: string;
  hash: string;
  languages: string;
  result: LensResult;
  bytes: number;
}

/**
 * Everything eviction needs to know about an entry, without the entry.
 *
 * A few dozen bytes each, so counting what is stored and finding the oldest
 * never has to read an answer - which used to mean `getAll()` of every response
 * on every write, tens of megabytes cloned out of the database to read two
 * numbers from each.
 */
interface Meta {
  key: string;
  used: number;
  bytes: number;
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
      // Whatever an older version left is keyed the wrong way round and cannot
      // be migrated into the new key without the languages it was asked in;
      // the worst this costs is asking Lens again.
      if (db.objectStoreNames.contains(RESPONSES)) db.deleteObjectStore(RESPONSES);
      if (db.objectStoreNames.contains(META)) db.deleteObjectStore(META);
      db.createObjectStore(RESPONSES, { keyPath: 'key' });
      db.createObjectStore(META, { keyPath: 'key' }).createIndex('used', 'used');
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading would otherwise wait on this one for ever.
      db.onversionchange = () => {
        db.close();
        open = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    // A blocked upgrade would hang this promise and every caller with it.
    request.onblocked = () => resolve(null);
  });
  return open;
}

/**
 * Run one transaction over some stores; resolve true once it has committed.
 *
 * Every failure - no database, a thrown request, an abort, a quota error - is
 * `false` rather than an exception, so a page with storage blocked simply has
 * no persistent cache instead of a broken translate button.
 */
function transact(
  mode: IDBTransactionMode,
  stores: string[],
  body: (tx: IDBTransaction) => void
): Promise<boolean> {
  return database().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        if (!db) {
          resolve(false);
          return;
        }
        try {
          const tx = db.transaction(stores, mode);
          tx.oncomplete = () => resolve(true);
          tx.onabort = () => resolve(false);
          tx.onerror = () => resolve(false);
          body(tx);
        } catch {
          resolve(false);
        }
      })
  );
}

/** The languages the answer was given in; a different set is a different answer. */
const languagesOf = (settings: LensOptions): string =>
  [settings.targetLang, settings.sourceLang, settings.ocrLang].join('|');

/**
 * The key an answer is stored under.
 *
 * Both halves matter. The picture alone was the key once, and asking for a
 * second target language replaced the first answer instead of sitting beside it.
 */
export const entryKey = (hash: string, settings: LensOptions): string =>
  `${hash}\u0000${languagesOf(settings)}`;

/** Roughly the weight of an answer: the inpainted patches, and little else. */
function weigh(result: LensResult): number {
  let bytes = 0;
  for (const block of result.blocks) {
    bytes += block.translation.length * 2;
    for (const line of block.lines) bytes += line.background?.bytes.byteLength ?? 0;
  }
  return bytes;
}

/**
 * How long a read is remembered as recent before another is worth writing.
 *
 * Recency only has to rank entries against each other, and a page being read
 * touches the same few over and over; once a minute is as good as every time.
 */
const TOUCH_INTERVAL_MS = 60_000;
const lastTouched = new Map<string, number>();

export async function getStored(
  hash: string,
  settings: LensOptions & CacheOptions
): Promise<LensResult | null> {
  if (!hash || !settings.persistCache) return null;
  const key = entryKey(hash, settings);

  let entry: StoredEntry | undefined;
  await transact('readonly', [RESPONSES], (tx) => {
    const request = tx.objectStore(RESPONSES).get(key);
    request.onsuccess = () => {
      entry = request.result as StoredEntry | undefined;
    };
  });
  if (!entry) return null;

  // Touch it, so eviction takes the ones nobody comes back to. Only the small
  // record is rewritten, and nothing waits on it: the answer is in hand.
  const now = Date.now();
  if (now - (lastTouched.get(key) ?? 0) >= TOUCH_INTERVAL_MS) {
    lastTouched.set(key, now);
    const meta: Meta = { key, used: now, bytes: entry.bytes };
    void transact('readwrite', [META], (tx) => {
      tx.objectStore(META).put(meta);
    });
  }
  return entry.result;
}

/**
 * What the stored bytes add up to, when it is known.
 *
 * Counted once from the small records and then kept by arithmetic, so a write
 * does not have to re-read the store to find out whether it is over budget. It
 * is forgotten now and then, because another tab writes to the same database.
 */
let total: number | null = null;
let writesSinceCount = 0;
const RECOUNT_EVERY = 50;

async function stored(): Promise<Meta[]> {
  let all: Meta[] = [];
  await transact('readonly', [META], (tx) => {
    const request = tx.objectStore(META).getAll();
    request.onsuccess = () => {
      all = request.result as Meta[];
    };
  });
  return all;
}

export async function putStored(
  hash: string,
  result: LensResult,
  settings: LensOptions & CacheOptions
): Promise<void> {
  if (!hash || !settings.persistCache || settings.cacheBytes <= 0) return;

  const bytes = weigh(result);
  // As in memory: one oversized page should not evict everything else to land.
  if (bytes > settings.cacheBytes) return;

  const key = entryKey(hash, settings);
  const now = Date.now();
  const entry: StoredEntry = { key, hash, languages: languagesOf(settings), result, bytes };
  let delta = bytes;

  const written = await transact('readwrite', [RESPONSES, META], (tx) => {
    const metas = tx.objectStore(META);
    const previous = metas.get(key);
    previous.onsuccess = () => {
      // Replacing an entry replaces its weight, not adds to it.
      delta = bytes - ((previous.result as Meta | undefined)?.bytes ?? 0);
      tx.objectStore(RESPONSES).put(entry);
      const meta: Meta = { key, used: now, bytes };
      metas.put(meta);
    };
  });
  if (!written) return;

  lastTouched.set(key, now);
  writesSinceCount += 1;
  if (writesSinceCount >= RECOUNT_EVERY) total = null;
  if (total !== null) total += delta;
  await evict(settings.cacheBytes);
}

/**
 * Keep the store under its budget, oldest use first.
 *
 * Counted rather than trusted to the quota: a browser that runs out evicts the
 * whole origin at once, which would take the settings of a site along with it.
 *
 * Walks the `used` index with a cursor and deletes as it goes, so what is read
 * is exactly the entries that go and the answers themselves are never loaded.
 */
async function evict(budget: number): Promise<void> {
  if (total === null) {
    total = (await stored()).reduce((sum, meta) => sum + meta.bytes, 0);
    writesSinceCount = 0;
  }
  if (total <= budget) return;

  let remaining = total;
  const done = await transact('readwrite', [RESPONSES, META], (tx) => {
    const metas = tx.objectStore(META);
    const responses = tx.objectStore(RESPONSES);
    const cursor = metas.index('used').openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at || remaining <= budget) return;
      const meta = at.value as Meta;
      remaining -= meta.bytes;
      responses.delete(meta.key);
      lastTouched.delete(meta.key);
      at.delete();
      at.continue();
    };
  });
  // A transaction that did not commit deleted nothing, so the count is unknown
  // again rather than wrong.
  total = done ? remaining : null;
}

export async function clearStored(): Promise<void> {
  await transact('readwrite', [RESPONSES, META], (tx) => {
    tx.objectStore(RESPONSES).clear();
    tx.objectStore(META).clear();
  });
  lastTouched.clear();
  total = 0;
  writesSinceCount = 0;
}

export async function storedStats(): Promise<{ entries: number; bytes: number }> {
  const all = await stored();
  return { entries: all.length, bytes: all.reduce((sum, meta) => sum + meta.bytes, 0) };
}
