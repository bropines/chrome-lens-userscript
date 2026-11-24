import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { clearStored, entryKey, getStored, putEdits, putStored, storedStats } from '../src/store.js';
import type { CacheOptions, LensOptions, LensResult } from '../src/types.js';
import type { Near } from '../src/store.js';
import type { Face } from '../src/likeness.js';

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

describe('the same frame at another size', () => {
  beforeEach(async () => {
    await clearStored();
  });

  /** A face: what matters here is that two calls with the same seed are the same picture. */
  const face = (seed: number, aspect = 1.5): Face => ({
    gray: Uint8Array.from({ length: 64 * 64 }, (_, i) => (i * seed * 2654435761) >>> 24),
    coarse: [seed * 0x9e3779b1 >>> 0, seed * 0x85ebca6b >>> 0],
    aspect,
  });
  /** A line's strip: inked, and different for a different text. */
  const strip = (text: number): Uint8Array =>
    Uint8Array.from({ length: 12 * 120 }, (_, i) => (((i * 7 + text * 13) >> 2) % 5 ? 255 : 0));
  /** An answer that read one line, 0.1 of the picture tall. */
  const read = (label: string): LensResult => ({
    ...answer(label),
    ocr: [{ writingDirection: 0, geometry: null, lines: [{ text: 'x', words: [], geometry: { cx: 0.5, cy: 0.2, w: 0.8, h: 0.1, angle: 0 } }] }],
  });
  const near = (o: { seed?: number; text?: number; width?: number; size?: number; tag?: string } = {}): Near => {
    const width = o.width ?? 1200;
    return {
      face: face(o.seed ?? 1),
      tag: o.tag ?? '',
      size: o.size ?? width,
      width,
      height: width / 1.5,
      sample: (boxes) => boxes.map(() => strip(o.text ?? 1)),
    };
  };

  test('a thumbnail finds the answer its original got', async () => {
    await putStored('original', read('big'), settings(), near({ width: 1200 }));
    const found = await getStored('thumbnail', settings(), near({ width: 680 }));
    expect(found?.contentLanguage).toBe('big');
  });

  test('and the original finds a thumbnail answer down to half its detail', async () => {
    await putStored('thumb', read('small'), settings(), near({ width: 900 }));
    expect((await getStored('orig', settings(), near({ width: 1600 })))?.contentLanguage).toBe('small');
    await clearStored();
    await putStored('thumb', read('small'), settings(), near({ width: 600 }));
    expect(await getStored('orig', settings(), near({ width: 1600 }))).toBeNull();
  });

  test('different text in the same picture is a miss', async () => {
    await putStored('a', read('caption one'), settings(), near({ text: 1 }));
    expect(await getStored('b', settings(), near({ text: 2, width: 800 }))).toBeNull();
  });

  test('a different picture, language or tiling is a miss', async () => {
    await putStored('a', read('x'), settings(), near());
    expect(await getStored('b', settings(), near({ seed: 2 }))).toBeNull();
    expect(await getStored('b', settings({ targetLang: 'de' }), near())).toBeNull();
    expect(await getStored('b', settings(), near({ tag: '.tiled' }))).toBeNull();
  });

  test('an answer with no lines is found only exactly: there is nothing to check it by', async () => {
    await putStored('empty', answer('nothing'), settings(), near());
    expect(await getStored('other', settings(), near())).toBeNull();
    expect((await getStored('empty', settings(), near()))?.contentLanguage).toBe('nothing');
  });

  test('what is kept for likeness counts against the budget, and goes with its answer', async () => {
    await putStored('a', read('x'), settings(), near());
    const { bytes } = await storedStats();
    expect(bytes).toBeGreaterThan(100 + 64 * 64);
    await putStored('b', read('y', ), settings({ cacheBytes: bytes + 50 }), near({ seed: 3 }));
    expect(await raw('faces', entryKey('a', settings()))).toBeUndefined();
  });
});

describe('edits', () => {
  beforeEach(async () => {
    await clearStored();
  });

  test('are written back to the record the answer came from, and read back', async () => {
    const options = settings({ cacheBytes: 100_000 });
    const first = answer('edited');
    await putStored('e1', first, options);
    first.edits = { 0: { text: 'by hand', scale: 1.5 } };
    expect(await putEdits(first)).toBe(true);

    const again = await getStored('e1', options);
    expect(again?.edits).toEqual({ 0: { text: 'by hand', scale: 1.5 } });

    // Taken out again, they are gone from storage too.
    delete again!.edits;
    expect(await putEdits(again!)).toBe(true);
    expect((await getStored('e1', options))?.edits).toBeUndefined();
  });

  test('an answer that was never stored keeps its edits in memory only', async () => {
    const loose = answer('loose');
    loose.edits = { 0: { hidden: true } };
    expect(await putEdits(loose)).toBe(false);
  });

  test('what storage hands back is cleaned: no edits for paragraphs that do not exist', async () => {
    const options = settings({ cacheBytes: 100_000 });
    const tampered = answer('tampered');
    tampered.edits = { 0: { scale: 99, color: 'red' }, 7: { text: 'nowhere' } } as never;
    await putStored('e2', tampered, options);
    expect((await getStored('e2', options))?.edits).toEqual({ 0: { scale: 3 } });
  });
});
