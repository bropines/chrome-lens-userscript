import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EN } from '../src/i18n/en.js';
import {
  LOCALES,
  fetchLocale,
  format,
  localeProblems,
  localeUrls,
  MISS_TTL_MS,
  pickLocale,
  recentMiss,
  placeholdersOf,
  storedLocale,
  validateLocale,
} from '../src/i18n/locale.js';
import type { LocaleResponse } from '../src/i18n/locale.js';

/**
 * The interface's translations, without a host or a network.
 *
 * Two things are being held here. The files in `locales/` are held to English
 * key for key, so drift is a failed test and not a string somebody notices in
 * production. And what the script does with a file it was *sent* - which is
 * somebody else's by the time it arrives - is held to "show what can be shown,
 * and English for the rest".
 */

const english = { hello: 'Hello {name}', plain: 'Plain', two: '{a} of {b}' };

describe('placeholders and formatting', () => {
  test('names are found once each, sorted', () => {
    expect(placeholdersOf('{b} and {a}, then {b} again')).toEqual(['a', 'b']);
    expect(placeholdersOf('none here, not even { this } or {1x}')).toEqual([]);
  });

  test('values fill their names, and a name with no value is left as written', () => {
    expect(format('{shown} of {total}', { shown: 2, total: 5 })).toBe('2 of 5');
    expect(format('on {host}', {})).toBe('on {host}');
    expect(format('no names')).toBe('no names');
  });

  test('a value is text, never a template: braces in it are not expanded again', () => {
    expect(format('{a}', { a: '{b}', b: 'no' })).toBe('{b}');
  });
});

describe('validating a locale that arrived', () => {
  test('known keys with intact placeholders are kept', () => {
    const report = validateLocale({ hello: 'Привет, {name}', plain: 'Просто', two: '{a} из {b}' }, english);
    expect(report?.strings).toEqual({ hello: 'Привет, {name}', plain: 'Просто', two: '{a} из {b}' });
    expect(report?.missing).toEqual([]);
  });

  test('an unknown key is dropped and reported', () => {
    const report = validateLocale({ plain: 'x', extra: 'y' }, english);
    expect(report?.strings).toEqual({ plain: 'x' });
    expect(report?.unknown).toEqual(['extra']);
  });

  test('a lost, renamed or added placeholder sends that key back to English', () => {
    const report = validateLocale(
      { hello: 'Привет', two: '{a} из {c}', plain: 'Просто {oops}' },
      english
    );
    expect(report?.strings).toEqual({});
    expect(report?.invalid.sort()).toEqual(['hello', 'plain', 'two']);
  });

  test('placeholders may come in another order, as grammar needs', () => {
    expect(validateLocale({ two: '{b} 中的 {a}' }, english)?.strings).toEqual({ two: '{b} 中的 {a}' });
  });

  test('a value that is not a string, or is blank, is not a translation', () => {
    const report = validateLocale({ plain: 3, hello: '   ', two: null }, english);
    expect(report?.strings).toEqual({});
    expect(report?.invalid.sort()).toEqual(['hello', 'plain', 'two']);
  });

  test('what English has and the file does not is reported as missing', () => {
    expect(validateLocale({ plain: 'x' }, english)?.missing.sort()).toEqual(['hello', 'two']);
  });

  test('anything that is not an object of keys is refused whole', () => {
    for (const raw of [null, 'text', 3, ['a'], undefined]) expect(validateLocale(raw, english)).toBeNull();
  });

  test('a key named like something on Object.prototype is not mistaken for a known one', () => {
    const report = validateLocale({ toString: 'x', constructor: 'y' }, english);
    expect(report?.strings).toEqual({});
    expect(report?.unknown.sort()).toEqual(['constructor', 'toString']);
  });
});

describe('choosing a locale', () => {
  test('an exact tag wins, whatever its case', () => {
    expect(pickLocale(['pt-br'])).toBe('pt-BR');
    expect(pickLocale(['zh-CN'])).toBe('zh-CN');
    expect(pickLocale(['ru'])).toBe('ru');
  });

  test('a regional tag falls to the language, and a bare language to its one region', () => {
    expect(pickLocale(['ru-RU'])).toBe('ru');
    expect(pickLocale(['pt', 'en'])).toBe('pt-BR');
    expect(pickLocale(['de-AT'])).toBe('de');
  });

  test('a preference nothing matches is skipped, not the end of the search', () => {
    expect(pickLocale(['be', 'ru', 'en'])).toBe('ru');
  });

  test('English ahead of a language we have is English', () => {
    expect(pickLocale(['en-GB', 'ru'])).toBe('en');
    expect(pickLocale([])).toBe('en');
    expect(pickLocale(['xx', ''])).toBe('en');
  });
});

describe('fetching a locale', () => {
  const body = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  const urls = localeUrls('2.13.0-beta.3', 'ru');

  test('the tag is asked first, then the main branch', () => {
    expect(urls).toEqual([
      'https://raw.githubusercontent.com/bropines/chrome-lens-userscript/v2.13.0-beta.3/locales/ru.json',
      'https://raw.githubusercontent.com/bropines/chrome-lens-userscript/main/locales/ru.json',
    ]);
  });

  test('a tag that answers is the only request made', async () => {
    const asked: string[] = [];
    const strings = await fetchLocale(
      urls,
      async (url) => {
        asked.push(url);
        return { status: 200, bytes: body({ plain: 'Просто' }) };
      },
      english
    );
    expect(strings).toEqual({ plain: 'Просто' });
    expect(asked).toEqual([urls[0] as string]);
  });

  test('a beta has no tag: the 404 falls back to main', async () => {
    const asked: string[] = [];
    const strings = await fetchLocale(
      urls,
      async (url): Promise<LocaleResponse> => {
        asked.push(url);
        return url.includes('/main/')
          ? { status: 200, bytes: body({ hello: 'Привет, {name}', junk: 'x' }) }
          : { status: 404, bytes: new TextEncoder().encode('404: Not Found') };
      },
      english
    );
    expect(asked).toEqual([...urls]);
    // Validated on the way in: the unknown key did not come along.
    expect(strings).toEqual({ hello: 'Привет, {name}' });
  });

  test('offline, blocked or garbage: null, and nothing thrown', async () => {
    expect(
      await fetchLocale(urls, async () => Promise.reject(new Error('network error')), english)
    ).toBeNull();
    expect(
      await fetchLocale(urls, async () => ({ status: 200, bytes: new TextEncoder().encode('<html>') }), english)
    ).toBeNull();
    expect(await fetchLocale(urls, async () => ({ status: 200, bytes: body(['not', 'an', 'object']) }), english)).toBeNull();
    const offline = { answered: false };
    await fetchLocale(urls, async () => Promise.reject(new Error('network error')), english, offline);
    expect(offline.answered).toBe(false);
    const absent = { answered: false };
    await fetchLocale(urls, async () => Promise.reject(new Error('HTTP 404')), english, absent);
    expect(absent.answered).toBe(true);
  });
});

describe('a locale kept from an earlier page load', () => {
  const entry = { version: '1.0.0', code: 'ru', strings: { plain: 'Просто', gone: 'x' } };

  test('is used for the same version and language, as a string or as an object', () => {
    expect(storedLocale(JSON.stringify(entry), '1.0.0', 'ru', english)).toEqual({ plain: 'Просто' });
    expect(storedLocale(entry, '1.0.0', 'ru', english)).toEqual({ plain: 'Просто' });
  });

  test('is not used for another version or another language', () => {
    expect(storedLocale(JSON.stringify(entry), '1.0.1', 'ru', english)).toBeNull();
    expect(storedLocale(JSON.stringify(entry), '1.0.0', 'uk', english)).toBeNull();
  });

  test('nothing stored, or something unreadable, is nothing', () => {
    for (const raw of [null, undefined, '', '{not json', 'null', 7]) {
      expect(storedLocale(raw, '1.0.0', 'ru', english)).toBeNull();
    }
  });
});

describe('the files in locales/', () => {
  const dir = resolve(import.meta.dirname, '..', 'locales');
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();

  test('there is exactly one file per listed language', () => {
    expect(files).toEqual([...LOCALES].map((code) => `${code}.json`).sort());
  });

  for (const code of LOCALES) {
    test(`${code}: exactly the English keys, placeholders intact`, () => {
      const raw = JSON.parse(readFileSync(resolve(dir, `${code}.json`), 'utf8')) as Record<string, unknown>;
      expect(Object.keys(raw).sort()).toEqual(Object.keys(EN).sort());
      for (const [key, source] of Object.entries(EN)) {
        expect(`${key}: ${placeholdersOf(String(raw[key])).join()}`).toBe(`${key}: ${placeholdersOf(source).join()}`);
      }
      expect(localeProblems(code, raw, EN)).toEqual([]);
    });
  }

  test('(control) the check can fail: a dropped key and a mangled placeholder are both caught', () => {
    const broken: Record<string, string> = { ...EN, 'toast.siteOff': 'no host here' };
    delete broken['menu.translate'];
    const problems = localeProblems('xx', broken, EN);
    expect(problems).toContain('xx: missing menu.translate');
    expect(problems.some((line) => line.startsWith('xx: toast.siteOff'))).toBe(true);
  });
});

describe('the English dictionary', () => {
  test('no value is empty, and none carries markup', () => {
    for (const [key, value] of Object.entries(EN)) {
      expect(`${key}:${value.trim().length > 0}`).toBe(`${key}:true`);
      expect(`${key}:${/<[a-z]/i.test(value)}`).toBe(`${key}:false`);
    }
  });
});

describe('remembering a locale that could not be had', () => {
  const now = 1_700_000_000_000;
  const miss = { version: '2.13.0', code: 'ru', at: now - 60_000 };

  test('a recent miss for this version and language stands, as stored text or an object', () => {
    expect(recentMiss(JSON.stringify(miss), '2.13.0', 'ru', now)).toBe(true);
    expect(recentMiss(miss, '2.13.0', 'ru', now)).toBe(true);
  });

  test('it is for one version and one language only', () => {
    expect(recentMiss(miss, '2.13.1', 'ru', now)).toBe(false);
    // A miss that never reached GitHub holds only for its own, shorter window.
    const offline = { ...miss, ttl: 15 * 60 * 1000 };
    expect(recentMiss(offline, '2.13.0', 'ru', miss.at + 10 * 60 * 1000)).toBe(true);
    expect(recentMiss(offline, '2.13.0', 'ru', miss.at + 20 * 60 * 1000)).toBe(false);
    expect(recentMiss(miss, '2.13.0', 'de', now)).toBe(false);
  });

  test('it expires after the window, and a time in the future is not trusted', () => {
    expect(recentMiss(miss, '2.13.0', 'ru', miss.at + MISS_TTL_MS - 1)).toBe(true);
    expect(recentMiss(miss, '2.13.0', 'ru', miss.at + MISS_TTL_MS)).toBe(false);
    expect(recentMiss(miss, '2.13.0', 'ru', miss.at - 1)).toBe(false);
    expect(MISS_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  test('nothing, or something that is not a miss, is no miss', () => {
    for (const raw of [null, undefined, '', '{', '"x"', 5, { version: '2.13.0', code: 'ru' }, { ...miss, at: 'soon' }]) {
      expect(recentMiss(raw, '2.13.0', 'ru', now)).toBe(false);
    }
  });
});
