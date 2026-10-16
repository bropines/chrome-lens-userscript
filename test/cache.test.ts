import { beforeEach, describe, expect, test } from 'bun:test';
import {
  cacheKey,
  cacheStats,
  clearCache,
  getCached,
  getRender,
  normalizeUrl,
  putCached,
  putRender,
  renderKey,
  sameShape,
} from '../src/cache.js';
import type { CacheOptions, LensOptions, LensResult, RenderOptions } from '../src/types.js';

const lens = { targetLang: 'ru', sourceLang: '', ocrLang: '' } as LensOptions;
const budget = (cacheBytes: number): CacheOptions => ({ cacheBytes, persistCache: false });

/** An answer that weighs exactly `bytes`: the patch is what the cache counts. */
function weighing(bytes: number): LensResult {
  return {
    contentLanguage: 'ja',
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

describe('normalizeUrl', () => {
  test('twitter renditions of one photo are one picture', () => {
    const base = 'https://pbs.twimg.com/media/abc.jpg';
    const keys = ['small', 'medium', 'large', 'orig', '900x900'].map((name) =>
      normalizeUrl(`${base}?format=jpg&name=${name}`)
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(base);
  });

  test('a different crop of the same path is a different picture', () => {
    // These used to be dropped, so the second crop was shown the first one's
    // translation, laid out for a different frame.
    const base = 'https://cdn.example.com/p/1.jpg';
    for (const query of ['w=300', 'h=200', 'crop=10,10,200,200', 'fit=cover', 's=100', 'resize=50']) {
      expect(normalizeUrl(`${base}?${query}`)).not.toBe(normalizeUrl(base));
    }
    expect(normalizeUrl(`${base}?crop=0,0,10,10`)).not.toBe(normalizeUrl(`${base}?crop=5,5,10,10`));
  });

  test('quality, density and format never change what the picture is', () => {
    const base = 'https://img.example.com/a.jpg';
    expect(normalizeUrl(`${base}?q=80&dpr=2&fm=webp&auto=format,compress`)).toBe(base);
    expect(normalizeUrl(`${base}?quality=40&format=avif`)).toBe(base);
  });

  test('a parameter is only dropped when its value looks like a rendition', () => {
    // `name` on another CDN is a filename, and dropping it merges two pictures.
    expect(normalizeUrl('https://cdn.example.com/get?name=cover-art.png')).toBe(
      'https://cdn.example.com/get?name=cover-art.png'
    );
    expect(normalizeUrl('https://cdn.example.com/get?q=best')).toBe(
      'https://cdn.example.com/get?q=best'
    );
  });

  test('parameters that identify the picture survive, in their own order', () => {
    expect(normalizeUrl('https://cdn.example.com/view?id=42&name=small&page=3')).toBe(
      'https://cdn.example.com/view?id=42&page=3'
    );
  });

  test('the fragment is not part of the identity', () => {
    expect(normalizeUrl('https://example.com/a.png#zoom')).toBe('https://example.com/a.png');
  });

  test('data and blob URLs are their own identity', () => {
    expect(normalizeUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(normalizeUrl('blob:https://example.com/1234')).toBe('blob:https://example.com/1234');
    expect(normalizeUrl('')).toBe('');
  });

  test('a relative address is resolved against the page', () => {
    expect(normalizeUrl('../img/a.png?w=1')).toBe('https://example.com/img/a.png?w=1');
  });

  test('something that is not a URL comes back unchanged', () => {
    expect(normalizeUrl('http://[bad')).toBe('http://[bad');
  });
});

describe('cacheKey', () => {
  test('depends on the languages, not just the address', () => {
    const url = 'https://example.com/a.png';
    const ru = cacheKey(url, lens);
    expect(cacheKey(url, { ...lens, targetLang: 'en' })).not.toBe(ru);
    expect(cacheKey(url, { ...lens, sourceLang: 'ja' })).not.toBe(ru);
    expect(cacheKey(url, { ...lens, ocrLang: 'ja' })).not.toBe(ru);
    expect(cacheKey(`${url}#x`, lens)).toBe(ru);
  });
});

describe('sameShape', () => {
  test('different resolutions of one frame match', () => {
    expect(sameShape({ width: 680, height: 452 }, { width: 340, height: 226 })).toBe(true);
    // A CDN rounds the short side.
    expect(sameShape({ width: 1000, height: 667 }, { width: 300, height: 200 })).toBe(true);
  });

  test('a different crop does not', () => {
    expect(sameShape({ width: 1000, height: 1000 }, { width: 1000, height: 500 })).toBe(false);
    expect(sameShape({ width: 600, height: 800 }, { width: 800, height: 600 })).toBe(false);
  });

  test('not knowing a size is not a mismatch', () => {
    expect(sameShape(undefined, { width: 1, height: 1 })).toBe(true);
    expect(sameShape({ width: 1, height: 1 }, undefined)).toBe(true);
    expect(sameShape({ width: 0, height: 0 }, { width: 5, height: 9 })).toBe(true);
  });
});

describe('the response cache', () => {
  beforeEach(() => {
    clearCache();
  });

  test('a hit returns what was stored', () => {
    const result = weighing(100);
    putCached('k', result, budget(1000));
    expect(getCached('k', budget(1000))).toBe(result);
    expect(getCached('other', budget(1000))).toBeNull();
  });

  test('a cache of zero bytes stores and returns nothing', () => {
    putCached('k', weighing(10), budget(0));
    expect(getCached('k', budget(0))).toBeNull();
    expect(cacheStats().entries).toBe(0);
  });

  test('a hit on the wrong frame is a miss', () => {
    putCached('k', weighing(10), budget(1000), { width: 800, height: 600 });
    expect(getCached('k', budget(1000), { width: 400, height: 300 })).not.toBeNull();
    expect(getCached('k', budget(1000), { width: 800, height: 800 })).toBeNull();
    // No size to compare is no reason to refuse.
    expect(getCached('k', budget(1000))).not.toBeNull();
  });

  test('evicts the least recently used first', () => {
    const limit = budget(250);
    putCached('a', weighing(100), limit);
    putCached('b', weighing(100), limit);
    getCached('a', limit);
    putCached('c', weighing(100), limit);
    expect(getCached('b', limit)).toBeNull();
    expect(getCached('a', limit)).not.toBeNull();
    expect(getCached('c', limit)).not.toBeNull();
  });

  test('an entry bigger than the whole budget is not kept, and evicts nothing', () => {
    putCached('small', weighing(10), budget(100));
    putCached('huge', weighing(500), budget(100));
    expect(getCached('huge', budget(100))).toBeNull();
    expect(getCached('small', budget(100))).not.toBeNull();
  });

  test('replacing an entry replaces its weight too', () => {
    putCached('k', weighing(100), budget(1000));
    putCached('k', weighing(30), budget(1000));
    expect(cacheStats()).toEqual({ entries: 1, bytes: 30 });
  });
});

describe('responses and renderings share one budget', () => {
  beforeEach(() => {
    clearCache();
  });

  const blob = (bytes: number): Blob => new Blob([new Uint8Array(bytes)]);

  test('together they stay under it', () => {
    const limit = budget(250);
    putCached('r1', weighing(100), limit);
    putRender('p1', blob(100), limit);
    putRender('p2', blob(100), limit);
    // Each map alone was under 250 here; together they were not.
    expect(cacheStats().bytes).toBeLessThanOrEqual(250);
    expect(cacheStats().entries).toBe(2);
  });

  test('whichever was used longest ago goes first, from either map', () => {
    const limit = budget(250);
    putRender('old', blob(100), limit);
    putCached('response', weighing(100), limit);
    putRender('new', blob(100), limit);
    expect(getRender('old', limit)).toBeNull();
    expect(getCached('response', limit)).not.toBeNull();
    expect(getRender('new', limit)).not.toBeNull();
  });

  test('the byte count survives a mixed history', () => {
    const limit = budget(1000);
    putCached('a', weighing(100), limit);
    putRender('b', blob(200), limit);
    putRender('b', blob(50), limit);
    expect(cacheStats()).toEqual({ entries: 2, bytes: 150 });
    expect(clearCache()).toEqual({ entries: 2, bytes: 150 });
    expect(cacheStats()).toEqual({ entries: 0, bytes: 0 });
  });

  test('a rendering of the wrong frame is a miss too', () => {
    putRender('p', blob(10), budget(1000), { width: 100, height: 100 });
    expect(getRender('p', budget(1000), { width: 100, height: 50 })).toBeNull();
    expect(getRender('p', budget(1000), { width: 50, height: 50 })).not.toBeNull();
  });
});

describe('renderKey', () => {
  const drawn = {
    fontFamily: '',
    drawBackground: true,
    verticalText: 'auto',
    minReadablePx: 12,
    supersample: 2,
    mangaMode: false,
    mangaBoxGrowth: 1.45,
    outlineScale: 1,
    eraseMode: 'patch',
    hullPadding: 0.45,
    reflowHorizontal: false,
    fitToBox: true,
    lineSpacing: 1.25,
    textAlign: 'auto',
  } as RenderOptions;

  test('every drawing setting changes the key', () => {
    const base = renderKey('k', drawn, 400);
    for (const name of Object.keys(drawn) as Array<keyof RenderOptions>) {
      const value = drawn[name];
      const changed = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : `${value}x`;
      expect(renderKey('k', { ...drawn, [name]: changed }, 400)).not.toBe(base);
    }
  });

  test('a few pixels of layout jitter do not, but a different size does', () => {
    expect(renderKey('k', drawn, 402)).toBe(renderKey('k', drawn, 410));
    expect(renderKey('k', drawn, 400)).not.toBe(renderKey('k', drawn, 700));
  });
});
