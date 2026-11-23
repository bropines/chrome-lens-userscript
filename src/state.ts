import { readStored, writeStored } from './gm.js';

/**
 * The little this script remembers that nobody set.
 *
 * Settings are what a person chose; this is what they last did - which action
 * they picked from the menu, what they last asked. It lives under its own key
 * so that saving the settings window never writes it back stale, and so an
 * exported settings file does not carry somebody's last question with it.
 */

export const STATE_KEY = 'lens-translate:state';

export interface State {
  /** The menu action last used, for a main button set to repeat it. */
  lastAction: string;
  /** The last question typed into "ask AI". */
  lastQuestion: string;
}

const EMPTY: State = { lastAction: '', lastQuestion: '' };

let cache: State | null = null;

export function getState(): State {
  if (cache) return cache;
  cache = { ...EMPTY };
  try {
    const raw = readStored(STATE_KEY);
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const held = parsed as Record<string, unknown>;
      if (typeof held['lastAction'] === 'string') cache.lastAction = held['lastAction'];
      if (typeof held['lastQuestion'] === 'string') cache.lastQuestion = held['lastQuestion'];
    }
  } catch {
    // Nothing remembered is a state too.
  }
  return cache;
}

/** Read the store again, after a host that loads it by promise has delivered. */
export function reloadState(): void {
  cache = null;
}

export function setState(patch: Partial<State>): void {
  const next = { ...getState(), ...patch };
  // Most presses repeat the last one; do not write what is already there.
  if (next.lastAction === cache?.lastAction && next.lastQuestion === cache?.lastQuestion) return;
  cache = next;
  writeStored(STATE_KEY, next);
}
