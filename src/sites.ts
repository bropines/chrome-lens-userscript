import { readStored, writeStored } from './gm.js';

/**
 * What this script does on each site.
 *
 * Settings are global, and a script that runs on every page needs one thing the
 * settings cannot say: *not here*. A banking page, an app that already has its
 * own image viewer, a site where a hover button is simply in the way. And at
 * the other end, a reader where every page is a picture, which is better served
 * by translating each one as it scrolls into view than by clicking it forty
 * times.
 *
 * So each hostname can be switched off, or put on auto-translate, and the
 * default is neither - nothing is stored for a site nobody has said anything
 * about. The choice is per hostname (without a leading `www.`, which is the
 * same site) and lives in the host's own storage, so it follows the person and
 * not whichever origin's localStorage happened to be nearest.
 */

export type SiteMode = 'default' | 'off' | 'auto';

/** The key every site's rule is kept under, as one JSON object. */
export const SITES_KEY = 'lens-translate:sites';

export const hostOf = (hostname: string = window.location.hostname): string =>
  hostname.toLowerCase().replace(/^www\./, '');

let rules: Record<string, SiteMode> | null = null;

function load(): Record<string, SiteMode> {
  if (rules) return rules;
  rules = {};
  try {
    const raw = readStored(SITES_KEY);
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      for (const [host, mode] of Object.entries(parsed)) {
        if (mode === 'off' || mode === 'auto') rules[host] = mode;
      }
    }
  } catch {
    // A rule that cannot be read is no rule: the site behaves as the default.
  }
  return rules;
}

/** Read the store again, after a host that loads it by promise has delivered. */
export function reloadSites(): void {
  rules = null;
}

export function siteMode(host: string = hostOf()): SiteMode {
  return load()[host] ?? 'default';
}

/** `default` removes the rule, so the store only holds sites somebody chose for. */
export function setSiteMode(mode: SiteMode, host: string = hostOf()): void {
  const next = { ...load() };
  if (mode === 'default') delete next[host];
  else next[host] = mode;
  rules = next;
  writeStored(SITES_KEY, next);
}
