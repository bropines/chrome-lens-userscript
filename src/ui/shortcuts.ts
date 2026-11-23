/**
 * Key chords, as text that can be stored and compared.
 *
 * A chord is written `Alt+Shift+KeyT`: modifiers in a fixed order, then the
 * key by its `code`. The code and not the character, because Alt+Shift+T
 * produces a different character on every layout and on a Mac - the physical
 * key is the only thing that is the same key everywhere, and it is what the
 * one shortcut this script always had was already matched by.
 */

export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** A `KeyboardEvent.code`, e.g. `KeyT`, `Digit1`, `F2`, `Backquote`. */
  code: string;
}

/** The part of a key event a chord is read from; a real event satisfies it. */
export interface KeyLike {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string;
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;
const MODIFIER_NAMES = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

/** Read stored text; null for an empty, unknown or modifier-only chord. */
export function parseChord(raw: unknown): Chord | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  const code = parts.pop();
  // A `code` is capitalised - KeyT, Digit1, F2 - which is what tells one from a typo.
  if (!code || !/^[A-Z][A-Za-z0-9]*$/.test(code) || MODIFIER_CODES.test(code)) return null;
  if ((MODIFIER_NAMES as readonly string[]).includes(code)) return null;

  const chord: Chord = { ctrl: false, alt: false, shift: false, meta: false, code };
  for (const part of parts) {
    const name = part.toLowerCase();
    if (name === 'ctrl' || name === 'control') chord.ctrl = true;
    else if (name === 'alt' || name === 'option') chord.alt = true;
    else if (name === 'shift') chord.shift = true;
    else if (name === 'meta' || name === 'cmd' || name === 'win') chord.meta = true;
    else return null;
  }
  // Held to what a key press can record (see chordFromEvent): a file or an older
  // store can hold anything, and a bare letter bound from one fires on reading.
  return isBare(chord) ? null : chord;
}

/** No modifier that makes a key a command; Shift alone only makes a capital. */
function isBare(chord: Chord): boolean {
  return !chord.ctrl && !chord.alt && !chord.meta && !/^F\d{1,2}$/.test(chord.code);
}

export function serializeChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  if (chord.meta) parts.push('Meta');
  parts.push(chord.code);
  return parts.join('+');
}

/** Whatever was stored, in the one spelling this writes; '' when it is no chord. */
export function normalizeChord(raw: unknown): string {
  const chord = parseChord(raw);
  return chord ? serializeChord(chord) : '';
}

/**
 * The chord a key press makes, or null while only modifiers are down.
 *
 * A bare letter is refused: a shortcut with no modifier fires while someone is
 * reading with the keyboard, and a reader's own keys are single letters.
 * Function keys are the exception, being no use for anything else.
 */
export function chordFromEvent(event: KeyLike): Chord | null {
  if (!event.code || MODIFIER_CODES.test(event.code)) return null;
  const chord: Chord = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    code: event.code,
  };
  return isBare(chord) ? null : chord;
}

export function matchesChord(chord: Chord | null, event: KeyLike): boolean {
  return (
    chord !== null &&
    event.code === chord.code &&
    event.ctrlKey === chord.ctrl &&
    event.altKey === chord.alt &&
    event.shiftKey === chord.shift &&
    event.metaKey === chord.meta
  );
}

/** How a chord reads in a field: `Alt + Shift + T`. */
export function formatChord(raw: unknown): string {
  const chord = parseChord(raw);
  if (!chord) return '';
  const key = chord.code.replace(/^Key(?=[A-Z]$)/, '').replace(/^Digit(?=\d$)/, '');
  return [...serializeChord(chord).split('+').slice(0, -1), key].join(' + ');
}
