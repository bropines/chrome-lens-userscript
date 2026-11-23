/**
 * Which controls sit over a picture, and in what order - as plain data.
 *
 * One string holds it: every button's id in order, with a trailing `*` on the
 * ones shown in the row. A string because that is the only thing a userscript
 * host is promised to store (see `writeStored`), and one list rather than two
 * because order and visibility are edited together and must not drift apart.
 *
 * The same order is the menu's order, so there is one list to arrange.
 * Nothing here touches the page; the panel edits it and main.ts draws it.
 */

export const BUTTON_IDS = [
  'translate',
  'search',
  'ask',
  'area',
  'objects',
  'text',
  'copy',
  'settings',
  'menu',
] as const;

export type ButtonId = (typeof BUTTON_IDS)[number];

export interface ButtonEntry {
  id: ButtonId;
  /** Shown in the row over the picture, not only in the menu. */
  pinned: boolean;
}

/**
 * The row every build before this had: the main button in the corner, then
 * settings, then the menu - and the menu's own order as it always was.
 */
export const DEFAULT_BUTTONS = 'translate*,search,ask,area,objects,text,copy,settings*,menu*';

const isButtonId = (value: string): value is ButtonId =>
  (BUTTON_IDS as readonly string[]).includes(value);

/**
 * Read a stored list, whatever state it is in.
 *
 * Unknown ids are dropped and missing ones appended unpinned, so a list
 * written by an older or a newer version still yields every button exactly
 * once - a button that fell out of the list would be one nobody could get
 * back without resetting.
 */
export function parseButtons(raw: unknown): ButtonEntry[] {
  const out: ButtonEntry[] = [];
  const seen = new Set<ButtonId>();
  for (const part of typeof raw === 'string' ? raw.split(',') : []) {
    const token = part.trim();
    const pinned = token.endsWith('*');
    const id = pinned ? token.slice(0, -1) : token;
    if (!isButtonId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, pinned });
  }
  for (const id of BUTTON_IDS) {
    if (!seen.has(id)) out.push({ id, pinned: false });
  }
  return out;
}

export function serializeButtons(list: readonly ButtonEntry[]): string {
  return list.map((entry) => (entry.pinned ? `${entry.id}*` : entry.id)).join(',');
}

/** Move one button by `delta` places; past either end it stops at the end. */
export function moveButton(list: readonly ButtonEntry[], id: ButtonId, delta: number): ButtonEntry[] {
  const from = list.findIndex((entry) => entry.id === id);
  if (from < 0) return [...list];
  return placeButton(list, id, from + delta);
}

/** Put one button at an index of the list as it will be once it has moved. */
export function placeButton(list: readonly ButtonEntry[], id: ButtonId, index: number): ButtonEntry[] {
  const moving = list.find((entry) => entry.id === id);
  if (!moving) return [...list];
  const rest = list.filter((entry) => entry.id !== id);
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

export function togglePinned(list: readonly ButtonEntry[], id: ButtonId): ButtonEntry[] {
  return list.map((entry) => (entry.id === id ? { ...entry, pinned: !entry.pinned } : entry));
}

/**
 * The row as drawn, corner-first: the main button, then the pinned ones in
 * the order of the list.
 *
 * The main action's button is shown whether or not it is pinned - a row whose
 * main button was unticked would be a row with nothing to press - and it is
 * always first, in the corner: it is the one that arrives alone, a beat before
 * the rest, and arriving alone in the middle of an empty row reads as a
 * glitch. "Open menu" as the main action makes the menu button the main one,
 * so there are not two of them.
 */
export function rowOf(list: readonly ButtonEntry[], main: ButtonId): ButtonId[] {
  return [main, ...list.filter((entry) => entry.pinned && entry.id !== main).map((entry) => entry.id)];
}
