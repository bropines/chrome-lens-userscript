/**
 * Whether the browser has translated this page, and into what (pure).
 *
 * No browser tells a page, or an extension, that its own translator ran. What
 * it does is change the page: Chrome puts `translated-ltr` or `translated-rtl`
 * on `<html>` and sets its `lang` to the language it translated into, and takes
 * both back on "Show original". Other browsers are less settled, but the ones
 * that mark anything mark the `lang`, so a `lang` that differs from the one the
 * page arrived with counts too. A page that switches its own language at run
 * time looks the same, and translating its pictures into that language is the
 * right answer there as well.
 */

import { LANGUAGES } from './languages.js';

/** What the page's root element says, and what it said when we first looked. */
export interface PageMarks {
  className: string;
  lang: string;
  initialLang: string;
}

/**
 * null when the page is as it arrived; otherwise the language it was
 * translated into, as one of ours, or '' when it cannot be told.
 */
export function browserTranslation(marks: PageMarks): string | null {
  const marked = /(^|\s)translated-(ltr|rtl)(\s|$)/.test(marks.className);
  const now = lensLanguage(marks.lang);
  const before = lensLanguage(marks.initialLang);
  if (marked) return now ?? '';
  // Only a change to a language we can name: an attribute that went from
  // nothing to nothing, or between two spellings of one language, is not news.
  if (now && now !== before) return now;
  return null;
}

/** Where a browser's or a page's code differs from the one Lens is asked in. */
const ALIASES: Record<string, string> = {
  iw: 'he',
  in: 'id',
  jw: 'jv',
  tl: 'fil',
  nb: 'no',
  nn: 'no',
  zh: 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
};

/** A BCP 47 tag as one of the codes in LANGUAGES, or null. */
export function lensLanguage(tag: string | null | undefined): string | null {
  const clean = (tag ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!clean) return null;
  const parts = clean.split('-');
  const primary = parts[0] ?? '';
  // Script or region decides Chinese; for everything else the primary subtag does.
  const script = parts.find((part) => part === 'hans' || part === 'hant');
  const candidates = [clean, script ? `${primary}-${script}` : '', primary].filter(Boolean);
  for (const candidate of candidates) {
    const alias = ALIASES[candidate];
    if (alias) return alias;
    if (LANGUAGES.includes(candidate)) return candidate;
  }
  return null;
}
