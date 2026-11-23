/**
 * The language list for the settings dropdowns.
 *
 * Only the codes are held here; the labels come from Intl.DisplayNames, so each
 * user sees language names in their own language without this file shipping a
 * translation table.
 */

import { currentLocale } from './i18n/index.js';

export const LANGUAGES: readonly string[] = [
  'af', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'gu', 'he',
  'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn',
  'ko', 'ky', 'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne', 'nl',
  'no', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'si', 'sk', 'sl', 'sq', 'sr', 'sv',
  'sw', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zh-CN', 'zh-TW', 'zu',
];

let displayNames: Intl.DisplayNames | null = null;
let namedIn = '';

/**
 * Names in the interface's language first, so the list reads like the rest of
 * the window; the browser's own is next, for a locale that has not arrived.
 */
function labeller(): Intl.DisplayNames | null {
  const locale = currentLocale();
  if (displayNames && namedIn === locale) return displayNames;
  namedIn = locale;
  try {
    const wanted = locale === 'en' ? [navigator.language, 'en'] : [locale, navigator.language, 'en'];
    displayNames = new Intl.DisplayNames(wanted, { type: 'language' });
  } catch {
    displayNames = null;
  }
  return displayNames;
}

export function languageLabel(code: string): string {
  const name = labeller()?.of(code);
  return name && name !== code ? `${name} (${code})` : code;
}

/** Options for a `<select>`, sorted by the label the user will actually read. */
export function languageOptions(blankLabel?: string): Array<readonly [string, string]> {
  const options = LANGUAGES.map((code) => [code, languageLabel(code)] as const).sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  return blankLabel ? [['', blankLabel] as const, ...options] : [...options];
}
