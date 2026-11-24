import { describe, expect, test } from 'bun:test';
import { cleanEdit, cleanEdits, editsTag, resets } from '../src/render/edits.js';

describe('edits as data', () => {
  test('what is no change is not an edit', () => {
    expect(cleanEdit({})).toBeNull();
    expect(cleanEdit({ scale: 1, dx: 0, dy: 0.0001, color: 'nonsense' })).toBeNull();
    expect(cleanEdit({ text: undefined, hidden: false })).toBeNull();
  });

  test('values are brought into range', () => {
    expect(cleanEdit({ scale: 10, dx: -5, color: '#AABBCC' })).toEqual({ scale: 3, dx: -1, color: '#aabbcc' });
    expect(cleanEdit({ scale: 0.01 })).toEqual({ scale: 0.3 });
  });

  test('an empty text is a text: the paragraph is written as nothing', () => {
    expect(cleanEdit({ text: '' })).toEqual({ text: '' });
  });

  test('the original wins over everything else', () => {
    expect(cleanEdit({ original: true, text: 'x', scale: 2 })).toEqual({ original: true });
  });

  test('only paragraphs that exist keep their edits', () => {
    expect(cleanEdits({ 0: { scale: 2 }, 3: { hidden: true }, x: { hidden: true } }, 2)).toEqual({ 0: { scale: 2 } });
    expect(cleanEdits({ 1: { scale: 1 } }, 2)).toBeUndefined();
    expect(cleanEdits('nonsense', 2)).toBeUndefined();
  });

  test('re-set only for what the line ranges cannot carry', () => {
    expect(resets({ color: '#000000' })).toBe(false);
    expect(resets({ hidden: true })).toBe(false);
    expect(resets({ text: 'a' })).toBe(true);
    expect(resets({ scale: 1.2 })).toBe(true);
    expect(resets({ dx: 0.1 })).toBe(true);
  });

  test('the cache key gains nothing without edits, and is stable with them', () => {
    expect(editsTag(undefined)).toBe('');
    expect(editsTag({})).toBe('');
    const a = editsTag({ 2: { scale: 2 }, 0: { text: 'x' } });
    const b = editsTag({ 0: { text: 'x' }, 2: { scale: 2 } });
    expect(a).toBe(b);
    expect(a).not.toBe(editsTag({ 0: { text: 'y' }, 2: { scale: 2 } }));
  });
});
