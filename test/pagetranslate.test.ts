import { describe, expect, test } from 'bun:test';
import { browserTranslation, lensLanguage } from '../src/pagetranslate.js';

describe('the browser translating the page', () => {
  test("Chrome's mark, with the language it went into", () => {
    expect(browserTranslation({ className: 'translated-ltr', lang: 'ru', initialLang: 'en' })).toBe('ru');
    expect(browserTranslation({ className: 'js no-touch translated-rtl', lang: 'iw', initialLang: 'en' })).toBe('he');
  });

  test('the mark without a language we know is still translated', () => {
    expect(browserTranslation({ className: 'translated-ltr', lang: '', initialLang: 'en' })).toBe('');
  });

  test('as it arrived is not translated', () => {
    expect(browserTranslation({ className: 'dark', lang: 'en', initialLang: 'en' })).toBeNull();
    expect(browserTranslation({ className: '', lang: '', initialLang: '' })).toBeNull();
    // Another spelling of the same language is not a change.
    expect(browserTranslation({ className: '', lang: 'en-GB', initialLang: 'en' })).toBeNull();
    // A class that only contains the word.
    expect(browserTranslation({ className: 'untranslated-ltrx', lang: 'en', initialLang: 'en' })).toBeNull();
  });

  test('a language changed without the mark counts', () => {
    expect(browserTranslation({ className: '', lang: 'de', initialLang: 'ja' })).toBe('de');
    expect(browserTranslation({ className: '', lang: 'ru', initialLang: '' })).toBe('ru');
  });

  test('codes come out as the ones Lens is asked in', () => {
    expect(lensLanguage('pt-BR')).toBe('pt');
    expect(lensLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(lensLanguage('zh-Hant')).toBe('zh-TW');
    expect(lensLanguage('zh_TW')).toBe('zh-TW');
    expect(lensLanguage('nb')).toBe('no');
    expect(lensLanguage('fil')).toBe('fil');
    expect(lensLanguage('xx')).toBeNull();
    expect(lensLanguage(undefined)).toBeNull();
  });
});
