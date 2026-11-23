/**
 * The parts of translating the interface that are arithmetic on strings.
 *
 * Nothing here knows where a locale comes from or where it is kept; that is
 * ./index.ts. This is what the tests and `bun run locales:check` run against
 * the files in `locales/`, and what the script runs against whatever GitHub
 * actually sent - which is somebody else's file by the time it arrives, and is
 * treated as one.
 */

/** The languages `locales/` holds a file for. English is built in. */
export const LOCALES = ['ru', 'uk', 'de', 'es', 'fr', 'pt-BR', 'ja', 'zh-CN', 'ko', 'tr'] as const;

export type Dictionary = Readonly<Record<string, string>>;

/** The `{names}` a string expects, sorted, each once. */
export function placeholdersOf(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

/** Fill in the `{names}`; one with no value is left as written. */
export function format(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  );
}

export interface LocaleReport {
  /** What may be shown: known keys, strings, placeholders intact. */
  strings: Record<string, string>;
  /** Keys English has and this does not; they stay English. */
  missing: string[];
  /** Keys English does not have; dropped. */
  unknown: string[];
  /** Keys whose value is not usable - not a string, empty, or with the wrong placeholders. */
  invalid: string[];
}

/**
 * Keep what can be shown and say what could not.
 *
 * A translation that lost a `{host}` would print the message without the host,
 * and one that gained a `{hots}` would print the braces; either way English is
 * the better string, so that key falls back. Null when the file is not an
 * object at all.
 */
export function validateLocale(raw: unknown, english: Dictionary): LocaleReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const report: LocaleReport = { strings: {}, missing: [], unknown: [], invalid: [] };
  const given = raw as Record<string, unknown>;

  for (const [key, value] of Object.entries(given)) {
    const source = Object.hasOwn(english, key) ? english[key] : undefined;
    if (source === undefined) {
      report.unknown.push(key);
      continue;
    }
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      placeholdersOf(value).join() !== placeholdersOf(source).join()
    ) {
      report.invalid.push(key);
      continue;
    }
    report.strings[key] = value;
  }
  for (const key of Object.keys(english)) {
    if (!Object.hasOwn(given, key)) report.missing.push(key);
  }
  return report;
}

/** Names that are the same in every language; a translation that lost one translated it. */
const KEPT = ['Lens', 'GitHub', 'Chromium', 'GM_xmlhttpRequest', 'googleapis'];

/**
 * Everything wrong with a file in `locales/`, as lines to print.
 *
 * Stricter than what the script does with a downloaded file, on purpose: at
 * run time a missing key is English and that is fine, but in the repository it
 * is a string nobody translated and nobody was told about.
 */
export function localeProblems(code: string, raw: unknown, english: Dictionary): string[] {
  const report = validateLocale(raw, english);
  if (!report) return [`${code}: not an object of strings`];
  const problems: string[] = [];
  for (const key of report.missing) problems.push(`${code}: missing ${key}`);
  for (const key of report.unknown) problems.push(`${code}: unknown key ${key}`);
  for (const key of report.invalid) problems.push(`${code}: ${key} is empty or its {placeholders} differ`);
  for (const [key, value] of Object.entries(report.strings)) {
    const source = english[key] ?? '';
    for (const name of KEPT) {
      if (source.includes(name) && !value.includes(name)) problems.push(`${code}: ${key} lost "${name}"`);
    }
  }
  return problems;
}

/**
 * The locale to use for a list of preferred language tags, most wanted first.
 *
 * An exact tag wins, then the same language under another region (`pt` or
 * `pt-PT` reads `pt-BR` better than English). A preference nothing matches is
 * skipped, not the end of the search: a browser set to `["be", "ru"]` should
 * get Russian. English does end it, because someone who lists English ahead of
 * a language there is a file for has said which one they would rather read.
 */
export function pickLocale(preferred: readonly string[], available: readonly string[] = LOCALES): string {
  const base = (tag: string): string => tag.toLowerCase().split('-')[0] ?? '';
  for (const tag of preferred) {
    if (!tag) continue;
    if (base(tag) === 'en') return 'en';
    const exact = available.find((code) => code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const sameLanguage = available.find((code) => base(code) === base(tag));
    if (sameLanguage) return sameLanguage;
  }
  return 'en';
}

const RAW = 'https://raw.githubusercontent.com/bropines/chrome-lens-userscript';

/**
 * Where a locale is asked for, in order.
 *
 * The tag first, so a release reads the strings written for it and not
 * whatever `main` has moved on to. A beta has no tag - CI only tags a version
 * it has not seen on a push to `main` - so its request is answered 404 and the
 * branch is asked instead.
 */
export function localeUrls(version: string, code: string): string[] {
  const file = `locales/${encodeURIComponent(code)}.json`;
  return [`${RAW}/v${encodeURIComponent(version)}/${file}`, `${RAW}/main/${file}`];
}

/** What a request for a locale came back with; any transport's answer reduces to this. */
export interface LocaleResponse {
  status: number;
  bytes: Uint8Array;
}

/**
 * Ask each address in turn and keep the first usable answer.
 *
 * Anything but a 200 holding a JSON object moves on to the next address: a 404
 * for a tag that does not exist, an HTML error page, a file cut short. Null
 * when none worked, which the caller treats as "English, and ask again next
 * time" - nothing here throws.
 */
export async function fetchLocale(
  urls: readonly string[],
  get: (url: string) => Promise<LocaleResponse>,
  english: Dictionary,
  outcome: { answered: boolean } = { answered: false }
): Promise<Record<string, string> | null> {
  for (const url of urls) {
    try {
      const response = await get(url);
      outcome.answered = true;
      if (response.status !== 200) continue;
      const parsed: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
      const report = validateLocale(parsed, english);
      if (report) return report.strings;
    } catch (error) {
      // A transport that turns a status into an error still heard the server.
      if (/\bHTTP \d{3}\b/.test((error as Error)?.message ?? '')) outcome.answered = true;
    }
  }
  return null;
}

/** What is kept between page loads: one locale, for one version. */
export interface StoredLocale {
  version: string;
  code: string;
  strings: Record<string, string>;
}

/**
 * The strings a stored entry holds for this version and language, or null.
 *
 * `raw` is whatever the host's store returned - a JSON string, an object from
 * a host that keeps objects, or nothing. A locale kept by another version is
 * not used: its keys are that version's, and the tag it came from is not ours.
 * Validated again on the way out, because the store is the host's and what one
 * build wrote there is only probably what it reads back.
 */
export function storedLocale(
  raw: unknown,
  version: string,
  code: string,
  english: Dictionary
): Record<string, string> | null {
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = parsed as Partial<StoredLocale>;
    if (entry.version !== version || entry.code !== code) return null;
    return validateLocale(entry.strings, english)?.strings ?? null;
  } catch {
    return null;
  }
}

/** A language's name in that language, for a list people pick their own from. */
export function ownName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // An engine without Intl.DisplayNames, or a code it does not know.
  }
  return code;
}

/**
 * How long a locale that could not be fetched is not asked for again.
 *
 * Two different misses. GitHub answering and having no such file is a fact
 * about this version, and asking again soon would get the same answer. Not
 * reaching GitHub at all is as often a page opened offline or a flaky phone
 * connection as a block, and holding a language back for hours over one bad
 * load would be the wrong trade; a short wait is still enough to stop a
 * blocked host from paying the timeout on every page.
 */
export const MISS_TTL_MS = 6 * 60 * 60 * 1000;
export const UNREACHABLE_TTL_MS = 15 * 60 * 1000;

/** A locale that could not be had: which, for which version, when, and for how long. */
export interface LocaleMiss {
  version: string;
  code: string;
  at: number;
  ttl?: number;
}

/**
 * Whether a stored miss still stands for this version and language.
 *
 * Where GitHub is blocked every page load used to ask again and wait out the
 * timeout. A miss in the future is a clock that moved; it is not trusted to
 * hold for longer than the window.
 */
export function recentMiss(raw: unknown, version: string, code: string, now: number, ttl = MISS_TTL_MS): boolean {
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return false;
    const miss = parsed as Partial<LocaleMiss>;
    if (miss.version !== version || miss.code !== code || typeof miss.at !== 'number') return false;
    const window =
      typeof miss.ttl === 'number' && miss.ttl > 0 && miss.ttl <= ttl ? miss.ttl : ttl;
    const age = now - miss.at;
    return age >= 0 && age < window;
  } catch {
    return false;
  }
}
