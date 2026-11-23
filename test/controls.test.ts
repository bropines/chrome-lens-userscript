import { describe, expect, test } from 'bun:test';
import {
  BUTTON_IDS,
  DEFAULT_BUTTONS,
  moveButton,
  parseButtons,
  placeButton,
  rowOf,
  serializeButtons,
  togglePinned,
} from '../src/ui/buttons.js';
import {
  chordFromEvent,
  formatChord,
  matchesChord,
  normalizeChord,
  parseChord,
  serializeChord,
} from '../src/ui/shortcuts.js';
import type { KeyLike } from '../src/ui/shortcuts.js';

/**
 * The two pieces of the controls that are plain data: which buttons sit over a
 * picture and in what order, and what counts as a key chord.
 */

const ids = (list: ReadonlyArray<{ id: string }>): string => list.map((entry) => entry.id).join(',');

describe('the button list', () => {
  test('the default is every button once, with the row every earlier version had', () => {
    const list = parseButtons(DEFAULT_BUTTONS);
    expect(list.map((entry) => entry.id).sort()).toEqual([...BUTTON_IDS].sort());
    // Corner-first: the main button, then settings, then the menu.
    expect(rowOf(list, 'translate')).toEqual(['translate', 'settings', 'menu']);
    expect(serializeButtons(list)).toBe(DEFAULT_BUTTONS);
  });

  test('a list in any state still yields every button exactly once', () => {
    const list = parseButtons(' copy* , nonsense, search,copy,,search* ');
    expect(list.slice(0, 2)).toEqual([
      { id: 'copy', pinned: true },
      { id: 'search', pinned: false },
    ]);
    expect(list.length).toBe(BUTTON_IDS.length);
    expect(new Set(list.map((entry) => entry.id)).size).toBe(BUTTON_IDS.length);
    // What the list did not mention is appended, and not shown in the row.
    expect(list.slice(2).every((entry) => !entry.pinned)).toBe(true);
  });

  test('something that is not a list is the full set, nothing pinned', () => {
    for (const raw of [undefined, null, 7, {}, '']) {
      const list = parseButtons(raw);
      expect(ids(list)).toBe(BUTTON_IDS.join(','));
      expect(list.some((entry) => entry.pinned)).toBe(false);
    }
  });

  test('moving one button leaves the others in order', () => {
    const list = parseButtons('translate,search,ask,area');
    expect(ids(moveButton(list, 'ask', -1)).startsWith('translate,ask,search,area')).toBe(true);
    expect(ids(moveButton(list, 'translate', 2)).startsWith('search,ask,translate,area')).toBe(true);
  });

  test('a move past either end stops at the end', () => {
    const list = parseButtons(DEFAULT_BUTTONS);
    expect(ids(moveButton(list, 'translate', -5))).toBe(ids(list));
    const last = moveButton(list, 'translate', 99);
    expect(last[last.length - 1]?.id).toBe('translate');
    expect(last.length).toBe(list.length);
  });

  test('placing by index is what a drag does', () => {
    const list = parseButtons('translate,search,ask,area');
    expect(ids(placeButton(list, 'area', 0)).startsWith('area,translate,search,ask')).toBe(true);
    expect(ids(placeButton(list, 'translate', 1)).startsWith('search,translate,ask,area')).toBe(true);
    // Onto its own place is no move at all.
    expect(ids(placeButton(list, 'search', 1))).toBe(ids(list));
  });

  test('the reducers return new lists and leave the old one alone', () => {
    const list = parseButtons(DEFAULT_BUTTONS);
    const before = serializeButtons(list);
    moveButton(list, 'copy', -3);
    placeButton(list, 'copy', 0);
    togglePinned(list, 'copy');
    expect(serializeButtons(list)).toBe(before);
  });

  test('pinning shows a button in the row, at its place in the order after the main one', () => {
    const list = togglePinned(parseButtons(DEFAULT_BUTTONS), 'search');
    expect(rowOf(list, 'translate')).toEqual(['translate', 'search', 'settings', 'menu']);
    expect(rowOf(togglePinned(list, 'settings'), 'translate')).toEqual(['translate', 'search', 'menu']);
  });

  test('the main action is in the row whether or not it is ticked', () => {
    const none = parseButtons('translate,search,ask,area,objects,text,copy,settings,menu');
    expect(rowOf(none, 'translate')).toEqual(['translate']);
    expect(rowOf(none, 'search')).toEqual(['search']);
    // "Open menu" as the main action is the menu button itself, not a second one.
    expect(rowOf(parseButtons(DEFAULT_BUTTONS), 'menu')).toEqual(['menu', 'translate', 'settings']);
  });

  test('the main button is first, in the corner, wherever its entry is in the list', () => {
    const list = parseButtons('translate*,search,ask*,copy*,settings*,menu*');
    expect(rowOf(list, 'ask')).toEqual(['ask', 'translate', 'copy', 'settings', 'menu']);
    expect(rowOf(list, 'copy')).toEqual(['copy', 'translate', 'ask', 'settings', 'menu']);
  });

  test('a round trip through the stored form changes nothing', () => {
    const list = togglePinned(moveButton(parseButtons(DEFAULT_BUTTONS), 'ask', -2), 'ask');
    expect(parseButtons(serializeButtons(list))).toEqual(list);
  });
});

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('key chords', () => {
  test('the stored spelling parses, in any modifier order and case', () => {
    expect(parseChord('Alt+Shift+KeyT')).toEqual({ ctrl: false, alt: true, shift: true, meta: false, code: 'KeyT' });
    expect(normalizeChord(' shift + ALT + KeyT ')).toBe('Alt+Shift+KeyT');
    expect(normalizeChord('cmd+control+Digit1')).toBe('Ctrl+Meta+Digit1');
    expect(normalizeChord('F2')).toBe('F2');
  });

  test('what is not a chord is no chord', () => {
    for (const raw of ['', 'Alt+', 'Alt', 'Shift+ControlLeft', 'Hyper+KeyT', 'Alt+Key T', 'Alt+<b>', null, 5]) {
      expect(parseChord(raw)).toBeNull();
      expect(normalizeChord(raw)).toBe('');
    }
  });

  test('stored text is held to what a key press could record: no bare keys', () => {
    // A hand-edited or imported file; the form would never have produced these.
    for (const raw of ['KeyT', 'Shift+KeyT', 'Digit1', 'Shift+Backquote', 'Space']) {
      expect(parseChord(raw)).toBeNull();
      expect(normalizeChord(raw)).toBe('');
    }
    expect(normalizeChord('Shift+F5')).toBe('Shift+F5');
    expect(normalizeChord('F12')).toBe('F12');
    expect(normalizeChord('Ctrl+KeyT')).toBe('Ctrl+KeyT');
    expect(normalizeChord('Meta+Shift+KeyT')).toBe('Shift+Meta+KeyT');
  });

  test('a chord matches the same keys and nothing else', () => {
    const chord = parseChord('Alt+Shift+KeyT');
    expect(matchesChord(chord, key('KeyT', { altKey: true, shiftKey: true }))).toBe(true);
    expect(matchesChord(chord, key('KeyT', { altKey: true }))).toBe(false);
    expect(matchesChord(chord, key('KeyT', { altKey: true, shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(matchesChord(chord, key('KeyY', { altKey: true, shiftKey: true }))).toBe(false);
    expect(matchesChord(null, key('KeyT'))).toBe(false);
  });

  test('it is the physical key that counts, not the character a layout makes of it', () => {
    // Option+Shift+T types a different character on a Mac; the code is the same.
    const event = { ...key('KeyT', { altKey: true, shiftKey: true }), key: 'ˇ' };
    expect(matchesChord(parseChord('Alt+Shift+KeyT'), event)).toBe(true);
  });

  test('recording: modifiers alone are not a chord yet', () => {
    expect(chordFromEvent(key('ShiftLeft', { shiftKey: true }))).toBeNull();
    expect(chordFromEvent(key('AltRight', { altKey: true }))).toBeNull();
    expect(chordFromEvent(key('MetaLeft', { metaKey: true }))).toBeNull();
  });

  test('recording: a bare key is refused, a function key is not', () => {
    expect(chordFromEvent(key('KeyT'))).toBeNull();
    expect(chordFromEvent(key('KeyT', { shiftKey: true }))).toBeNull();
    const f2 = chordFromEvent(key('F2'));
    expect(f2 && serializeChord(f2)).toBe('F2');
  });

  test('recording: what was pressed is what is stored and what later matches', () => {
    const pressed = key('KeyS', { altKey: true, ctrlKey: true });
    const chord = chordFromEvent(pressed);
    if (!chord) throw new Error('no chord');
    expect(serializeChord(chord)).toBe('Ctrl+Alt+KeyS');
    expect(matchesChord(parseChord(serializeChord(chord)), pressed)).toBe(true);
  });

  test('a chord reads the way it is pressed', () => {
    expect(formatChord('Alt+Shift+KeyT')).toBe('Alt + Shift + T');
    expect(formatChord('Ctrl+Digit1')).toBe('Ctrl + 1');
    expect(formatChord('Alt+Backquote')).toBe('Alt + Backquote');
    expect(formatChord('')).toBe('');
  });
});
