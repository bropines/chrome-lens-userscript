/**
 * The language list for the settings dropdowns.
 *
 * Only the codes are held here; the labels come from Intl.DisplayNames, so each
 * user sees language names in their own language without this file shipping a
 * translation table.
 */

export const LANGUAGES: readonly string[] = [
  'af', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'gu', 'he',
  'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn',
  'ko', 'ky', 'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne', 'nl',
  'no', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'si', 'sk', 'sl', 'sq', 'sr', 'sv',
  'sw', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zh-CN', 'zh-TW', 'zu',
];

let displayNames: Intl.DisplayNames | null = null;

function labeller(): Intl.DisplayNames | null {
  if (displayNames) return displayNames;
  try {
    displayNames = new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' });
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
