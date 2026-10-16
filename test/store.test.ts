import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { clearStored, entryKey, getStored, putStored, storedStats } from '../src/store.js';
import type { CacheOptions, LensOptions, LensResult } from '../src/types.js';

const lens = { targetLang: 'ru', sourceLang: '', ocrLang: '' } as LensOptions;
const settings = (over: Partial<LensOptions & CacheOptions> = {}): LensOptions & CacheOptions => ({
  ...lens,
  persistCache: true,
  cacheBytes: 10_000,
  ...over,
});

/** An answer that weighs `bytes` and says which one it is. */
function answer(label: string, bytes = 100): LensResult {
  return {
    contentLanguage: label,
    ocr: [],
    blocks: [
      {
        translation: '',
        geometry: null,
        sourceLang: 'ja',
        targetLang: 'ru',
        writingDirection: 0,
        alignment: 0,
        lines: [
          {
            words: [],
            textColor: 0,
            bgColor: 0,
            geometry: null,
            background: { bytes: new Uint8Array(bytes), vPad: 0, hPad: 0 },
          },
        ],
      },
    ],
  };
}

/** Straight at the database, to see what the module did rather than what it says. */
function raw<T>(store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('lens-translate');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => {
        db.close();
        resolve(request.result as T | undefined);
      };
    };
  });
}

interface Meta {
  key: string;
  used: number;
  bytes: number;
}

// This has to run before anything else touches the database: the module opens
// it on first use and keeps it, and an upgrade is only an upgrade once.
describe('upgrading from version 1', () => {
  test('drops the old layout and carries on', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('lens-translate', 1);
      open.onupgradeneeded = () => {
        open
          .result.createObjectStore('responses', { keyPath: 'hash' })
          .createIndex('used', 'used');
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('responses', 'readwrite');
        tx.objectStore('responses').put({ hash: 'old', languages: 'ru||', used: 1, bytes: 1 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      open.onerror = () => reject(open.error);
    });

    expect(await getStored('old', settings())).toBeNull();
    await putStored('new', answer('fresh'), settings());
    expect((await getStored('new', settings()))?.contentLanguage).toBe('fresh');
    expect(await storedStats()).toEqual({ entries: 1, bytes: 100 });
  });
});

describe('the persistent store', () => {
  beforeEach(async () => {
    await clearStored();
  });
  afterEach(() => {
    setSystemTime();
  });

  test('keeps an answer and gives it back', async () => {
    await putStored('h1', answer('one'), settings());
    expect((await getStored('h1', settings()))?.contentLanguage).toBe('one');
    expect(await getStored('h2', settings())).toBeNull();
  });

  test('does nothing when persistence is off or the budget is zero', async () => {
    await putStored('h1', answer('one'), settings({ persistCache: false }));
    await putStored('h1', answer('one'), settings({ cacheBytes: 0 }));
    expect(await storedStats()).toEqual({ entries: 0, bytes: 0 });
    await putStored('h1', answer('one'), settings());
    expect(await getStored('h1', settings({ persistCache: false }))).toBeNull();
    expect(await getStored('', settings())).toBeNull();
  });

  test('a second language sits beside the first instead of replacing it', async () => {
    // The picture alone was the key, so this overwrote.
    await putStored('h1', answer('russian'), settings({ targetLang: 'ru' }));
    await putStored('h1', answer('english'), settings({ targetLang: 'en' }));

    expect((await getStored('h1', settings({ targetLang: 'ru' })))?.contentLanguage).toBe('russian');
    expect((await getStored('h1', settings({ targetLang: 'en' })))?.contentLanguage).toBe('english');
    expect(await getStored('h1', settings({ targetLang: 'de' }))).toBeNull();
    expect((await storedStats()).entries).toBe(2);
  });

  test('the source and OCR languages are part of the answer too', async () => {
    await putStored('h1', answer('auto'), settings());
    expect(await getStored('h1', settings({ sourceLang: 'ja' }))).toBeNull();
    expect(await getStored('h1', settings({ ocrLang: 'ja' }))).toBeNull();
  });

  test('writing an entry again replaces its weight rather than adding to it', async () => {
    await putStored('h1', answer('a', 100), settings());
    await putStored('h1', answer('b', 40), settings());
    expect(await storedStats()).toEqual({ entries: 1, bytes: 40 });
  });

  test('an answer bigger than the whole budget is not kept, and evicts nothing', async () => {
    await putStored('small', answer('s', 10), settings({ cacheBytes: 100 }));
    await putStored('huge', answer('h', 500), settings({ cacheBytes: 100 }));
    expect(await getStored('huge', settings({ cacheBytes: 100 }))).toBeNull();
    expect(await getStored('small', settings({ cacheBytes: 100 }))).not.toBeNull();
  });

  test('evicts the oldest use first until it fits', async () => {
    const limit = settings({ cacheBytes: 250 });
    setSystemTime(new Date(1_000));
    await putStored('a', answer('a'), limit);
    setSystemTime(new Date(2_000));
    await putStored('b', answer('b'), limit);
    setSystemTime(new Date(3_000));
    await putStored('c', answer('c'), limit);

    expect(await getStored('a', limit)).toBeNull();
    expect(await getStored('b', limit)).not.toBeNull();
    expect(await getStored('c', limit)).not.toBeNull();
    expect(await storedStats()).toEqual({ entries: 2, bytes: 200 });
    // The answer and its record go together.
    expect(await raw('responses', entryKey('a', limit))).toBeUndefined();
    expect(await raw('meta', entryKey('a', limit))).toBeUndefined();
  });

  test('a read counts as use, so it is the unread one that goes', async () => {
    const limit = settings({ cacheBytes: 250 });
    setSystemTime(new Date(1_000));
    await putStored('a', answer('a'), limit);
    setSystemTime(new Date(2_000));
    await putStored('b', answer('b'), limit);

    setSystemTime(new Date(200_000));
    await getStored('a', limit);
    // The touch is not waited on; let it land.
    await storedStats();
    setSystemTime(new Date(300_000));
    await putStored('c', answer('c'), limit);

    expect(await getStored('b', limit)).toBeNull();
    expect(await getStored('a', limit)).not.toBeNull();
  });

  test('a read touches only the small record, and not on every read', async () => {
    const limit = settings();
    setSystemTime(new Date(1_000));
    await putStored('a', answer('a'), limit);
    const key = entryKey('a', limit);

    setSystemTime(new Date(1_000 + 5_000));
    await getStored('a', limit);
    await storedStats();
    // Inside the interval nothing is rewritten.
    expect((await raw<Meta>('meta', key))?.used).toBe(1_000);

    setSystemTime(new Date(1_000 + 120_000));
    await getStored('a', limit);
    await storedStats();
    expect((await raw<Meta>('meta', key))?.used).toBe(121_000);
    // And the answer itself is still the one that was written.
    expect((await raw<{ result: LensResult }>('responses', key))?.result.contentLanguage).toBe('a');
  });

  test('clearing empties both stores', async () => {
    await putStored('a', answer('a'), settings());
    await putStored('b', answer('b'), settings());
    await clearStored();
    expect(await storedStats()).toEqual({ entries: 0, bytes: 0 });
    expect(await getStored('a', settings())).toBeNull();
    expect(await raw('responses', entryKey('a', settings()))).toBeUndefined();
  });
});
