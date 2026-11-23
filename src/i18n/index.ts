import { gmTransport, readStored, writeStored } from '../gm.js';
import { VERSION } from '../version.js';
import { EN } from './en.js';
import type { Key } from './en.js';
import { LOCALES, fetchLocale, format, localeUrls, pickLocale, recentMiss, storedLocale, MISS_TTL_MS, UNREACHABLE_TTL_MS } from './locale.js';
import type { LocaleMiss, StoredLocale } from './locale.js';

export type { Key };

/**
 * The interface in the reader's language.
 *
 * English is in the bundle. Every other language is a JSON file in the
 * repository, fetched once per version and language and then kept by the
 * userscript host - ten languages inlined would be ten languages parsed on
 * every page load by people who read one of them.
 *
 * It goes out through the host's privileged request and not a page `fetch`:
 * a page's own Content-Security-Policy decides what `fetch` may reach, and
 * `raw.githubusercontent.com` is on nobody's list. Without cookies and without
 * a referrer - the file is public, and GitHub has no need to know who asks or
 * from which page.
 *
 * Nothing waits for it. Until a locale is in hand every string is English, and
 * when it lands the listeners redraw whatever is open. A request that fails -
 * offline, the domain blocked, the file not there - leaves English in place
 * and says nothing. It is remembered for a few hours (`MISS_KEY`): where
 * GitHub is blocked, asking on every page load meant waiting out the timeout
 * on every page load.
 */

/** Where the last fetched locale is kept: `{ version, code, strings }`. */
export const LOCALE_KEY = 'lens-translate:locale';

/** The last locale that could not be fetched, so it is not asked for on every load. */
export const MISS_KEY = 'lens-translate:locale-miss';

/** Every key this module reads, for a host that has to be asked for them ahead of time. */
export const LOCALE_KEYS: string[] = [LOCALE_KEY, MISS_KEY];

const FETCH_TIMEOUT_MS = 15_000;

let code = 'en';
let strings: Record<string, string> = {};
/** Bumped by every choice of language, so a slow answer to an old one is dropped. */
let generation = 0;
/** The language last asked for: in use, or on its way. */
let requested = 'en';
const listeners = new Set<() => void>();

export function t(key: Key, params?: Readonly<Record<string, string | number>>): string {
  return format(strings[key] ?? EN[key], params);
}

/** For a key assembled at run time (`set.<field>.hint`); undefined when there is none. */
export function tMaybe(key: string): string | undefined {
  if (!Object.hasOwn(EN, key)) return undefined;
  return t(key as Key);
}

/** The locale in use right now: 'en' until another one has actually arrived. */
export const currentLocale = (): string => code;

/** Be told when the strings change. Returns the way to stop being told. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function adopt(next: string, dictionary: Record<string, string>): void {
  code = next;
  strings = dictionary;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One listener's broken redraw must not leave the others in the old language.
    }
  }
}

/** What the setting means: a code we have a file for, or 'en'. */
export function resolveLanguage(setting: string): string {
  if (setting && setting !== 'auto') {
    return (LOCALES as readonly string[]).includes(setting) ? setting : 'en';
  }
  const preferred =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  return pickLocale(preferred);
}

const cached = (wanted: string): Record<string, string> | null =>
  storedLocale(readStored(LOCALE_KEY), VERSION, wanted, EN);

// The host's request and nothing else: the page-fetch rung behind it would
// send this site's Origin to GitHub, and a page's CSP blocks it anyway.
async function download(wanted: string): Promise<{ strings: Record<string, string> | null; answered: boolean }> {
  const outcome = { answered: false };
  const strings = await fetchLocale(
    localeUrls(VERSION, wanted),
    (url) => gmTransport.get(url, FETCH_TIMEOUT_MS, { anonymous: true, noFetchFallback: true }),
    EN,
    outcome
  );
  return { strings, answered: outcome.answered };
}

/**
 * Switch to the language a setting asks for.
 *
 * Synchronous when it can be: English needs nothing, and a locale already
 * fetched for this version is in the host's store. Only a first use of a
 * language on a version goes to the network, and then the interface is English
 * for as long as that takes.
 */
export function useLanguage(setting: string): void {
  const wanted = resolveLanguage(setting);
  // Already in use, or already on its way: asking again would only throw the
  // answer in flight away and send the same request a second time.
  if (wanted === requested) return;
  requested = wanted;
  generation += 1;
  const mine = generation;
  if (wanted === code) return;
  if (wanted === 'en') {
    adopt('en', {});
    return;
  }
  const held = cached(wanted);
  if (held) {
    adopt(wanted, held);
    return;
  }
  if (recentMiss(readStored(MISS_KEY), VERSION, wanted, Date.now())) {
    requested = code;
    return;
  }
  void download(wanted).then(({ strings: fetched, answered }) => {
    if (!fetched) {
      const miss: LocaleMiss = {
        version: VERSION,
        code: wanted,
        at: Date.now(),
        ttl: answered ? MISS_TTL_MS : UNREACHABLE_TTL_MS,
      };
      writeStored(MISS_KEY, miss);
    } else {
      const entry: StoredLocale = { version: VERSION, code: wanted, strings: fetched };
      writeStored(LOCALE_KEY, entry);
    }
    if (mine !== generation) return;
    if (fetched) adopt(wanted, fetched);
    else requested = code;
  });
}
