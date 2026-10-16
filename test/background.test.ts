import { describe, expect, test } from 'bun:test';
import {
  knownPaintedSize,
  mayBePicture,
  paintRect,
  parseBackground,
  splitList,
  tilesVisibly,
  urlOf,
} from '../src/render/background.js';
import type { BackgroundSpec, RawBackground } from '../src/render/background.js';

/** Computed values as Chrome reports them for `background: url(a) no-repeat`. */
const raw = (over: Partial<RawBackground> = {}): RawBackground => ({
  image: 'url("https://example.com/hero.png")',
  size: 'auto',
  positionX: '0%',
  positionY: '0%',
  repeat: 'no-repeat',
  origin: 'padding-box',
  clip: 'border-box',
  attachment: 'scroll',
  ...over,
});

const specOf = (over: Partial<RawBackground> = {}): BackgroundSpec => {
  const parsed = parseBackground(raw(over));
  if (!parsed) throw new Error('expected a picture');
  return parsed.spec;
};

describe('reading the computed style', () => {
  test('lists split on top-level commas only', () => {
    expect(splitList('url(a,b), linear-gradient(red, blue)')).toEqual([
      'url(a,b)',
      'linear-gradient(red, blue)',
    ]);
    expect(splitList('url("a,b"), none')).toEqual(['url("a,b")', 'none']);
    expect(splitList('50%')).toEqual(['50%']);
  });

  test('the address comes out of url() quoted or not', () => {
    expect(urlOf('url("https://e.com/a.png")')).toBe('https://e.com/a.png');
    expect(urlOf("url('https://e.com/a.png')")).toBe('https://e.com/a.png');
    expect(urlOf('url(https://e.com/a.png)')).toBe('https://e.com/a.png');
    expect(urlOf('linear-gradient(red, blue)')).toBe('');
  });

  test('a gradient, no image, and a paint-server reference are not pictures', () => {
    expect(parseBackground(raw({ image: 'none' }))).toBeNull();
    expect(parseBackground(raw({ image: 'linear-gradient(red, blue)' }))).toBeNull();
    expect(parseBackground(raw({ image: 'url("#pattern")' }))).toBeNull();
  });

  test('the picture layer is found among others, and its own values are used', () => {
    const parsed = parseBackground(
      raw({
        image: 'linear-gradient(red, blue), url("https://e.com/a.png")',
        size: 'auto, cover',
        positionX: '0%, 100%',
        positionY: '0%, 100%',
        repeat: 'repeat, no-repeat',
      })
    );
    expect(parsed?.url).toBe('https://e.com/a.png');
    expect(parsed?.spec.size).toEqual({ kind: 'cover' });
    expect(parsed?.spec.x).toEqual({ pct: 100, px: 0 });
    expect(parsed?.spec.repeatX).toBe(false);
  });

  test('a shorter list repeats, as CSS says', () => {
    const parsed = parseBackground(
      raw({ image: 'url("a.png"), url("b.png")', size: 'contain', repeat: 'no-repeat' })
    );
    expect(parsed?.url).toBe('a.png');
    expect(parsed?.spec.size).toEqual({ kind: 'contain' });
  });

  test('sizes', () => {
    expect(specOf({ size: 'cover' }).size).toEqual({ kind: 'cover' });
    expect(specOf({ size: '100px 50%' }).size).toEqual({
      kind: 'lengths',
      width: { px: 100 },
      height: { pct: 50 },
    });
    expect(specOf({ size: 'auto 80px' }).size).toEqual({
      kind: 'lengths',
      width: 'auto',
      height: { px: 80 },
    });
    expect(parseBackground(raw({ size: 'calc(100% - 4px) auto' }))).toBeNull();
  });

  test('positions, including the calc() a right-hand offset computes to', () => {
    expect(specOf({ positionX: '50%', positionY: '10px' }).x).toEqual({ pct: 50, px: 0 });
    expect(specOf({ positionX: '50%', positionY: '10px' }).y).toEqual({ pct: 0, px: 10 });
    expect(specOf({ positionX: 'calc(100% - 12px)' }).x).toEqual({ pct: 100, px: -12 });
    expect(specOf({ positionX: 'calc(4px + 25%)' }).x).toEqual({ pct: 25, px: 4 });
    expect(parseBackground(raw({ positionX: 'wat' }))).toBeNull();
  });

  test('repeat keywords name one axis or both', () => {
    expect(specOf({ repeat: 'repeat' })).toMatchObject({ repeatX: true, repeatY: true });
    expect(specOf({ repeat: 'no-repeat' })).toMatchObject({ repeatX: false, repeatY: false });
    expect(specOf({ repeat: 'repeat-x' })).toMatchObject({ repeatX: true, repeatY: false });
    expect(specOf({ repeat: 'repeat-y' })).toMatchObject({ repeatX: false, repeatY: true });
    expect(specOf({ repeat: 'repeat no-repeat' })).toMatchObject({ repeatX: true, repeatY: false });
  });

  test('what this does not model is refused rather than guessed at', () => {
    expect(parseBackground(raw({ attachment: 'fixed' }))).toBeNull();
    expect(parseBackground(raw({ clip: 'text' }))).toBeNull();
    expect(parseBackground(raw({ repeat: 'space' }))).toBeNull();
    expect(parseBackground(raw({ repeat: 'round no-repeat' }))).toBeNull();
  });

  test('origin and clip default to CSS defaults', () => {
    expect(specOf({ origin: 'content-box', clip: 'padding-box' })).toMatchObject({
      origin: 'content-box',
      clip: 'padding-box',
    });
    expect(specOf({ origin: '', clip: '' })).toMatchObject({
      origin: 'padding-box',
      clip: 'border-box',
    });
  });
});

describe('where the picture is painted', () => {
  const area = { width: 200, height: 100 };
  const natural = { width: 400, height: 300 };

  test('cover scales to fill and is centred by a 50% position', () => {
    const rect = paintRect(specOf({ size: 'cover', positionX: '50%', positionY: '50%' }), area, natural);
    // 0.5 fills the width; the 150 tall picture overhangs by 50 and is centred.
    expect(rect).toEqual({ x: 0, y: -25, width: 200, height: 150 });
  });

  test('contain fits inside and leaves the rest of the box empty', () => {
    const rect = paintRect(specOf({ size: 'contain', positionX: '50%', positionY: '0%' }), area, natural);
    // The height limits: 100/300, so 133.33 wide, centred in 200.
    expect(rect?.height).toBeCloseTo(100);
    expect(rect?.width).toBeCloseTo(133.333, 2);
    expect(rect?.x).toBeCloseTo(33.333, 2);
    expect(rect?.y).toBe(0);
  });

  test('auto is the picture as it is', () => {
    expect(paintRect(specOf({ size: 'auto' }), area, natural)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  test('one explicit side keeps the proportions', () => {
    expect(paintRect(specOf({ size: '200px auto' }), area, natural)).toMatchObject({
      width: 200,
      height: 150,
    });
    expect(paintRect(specOf({ size: 'auto 60px' }), area, natural)).toMatchObject({
      width: 80,
      height: 60,
    });
  });

  test('two explicit sides distort, as the browser does', () => {
    expect(paintRect(specOf({ size: '50% 100%' }), area, natural)).toMatchObject({
      width: 100,
      height: 100,
    });
  });

  test('a percentage position applies to the difference of the sizes', () => {
    const rect = paintRect(specOf({ size: '100px 50px', positionX: '100%', positionY: '50%' }), area, natural);
    expect(rect).toMatchObject({ x: 100, y: 25, width: 100, height: 50 });
  });

  test('an offset from the right edge', () => {
    const rect = paintRect(
      specOf({ size: '100px 50px', positionX: 'calc(100% - 10px)', positionY: '0%' }),
      area,
      natural
    );
    // 100% of the free space (100), less 10.
    expect(rect?.x).toBe(90);
  });

  test('a picture of no size has nowhere to be', () => {
    expect(paintRect(specOf(), area, { width: 0, height: 0 })).toBeNull();
  });
});

describe('telling a picture from a pattern', () => {
  const area = { width: 300, height: 200 };

  test('a tile that does not fill the box repeats visibly', () => {
    const spec = specOf({ repeat: 'repeat', size: '32px 32px' });
    const rect = paintRect(spec, area, { width: 32, height: 32 });
    expect(rect && tilesVisibly(spec, rect, area)).toBe(true);
  });

  test('a cover hero that happens to repeat does not', () => {
    // `background: url() center/cover` leaves repeat at its default.
    const spec = specOf({ repeat: 'repeat', size: 'cover', positionX: '50%', positionY: '50%' });
    const rect = paintRect(spec, area, { width: 1200, height: 800 });
    expect(rect && tilesVisibly(spec, rect, area)).toBe(false);
  });

  test('a cover hero pushed off by a position offset does', () => {
    const spec = specOf({ repeat: 'repeat', size: 'cover', positionX: '40px', positionY: '0%' });
    const rect = paintRect(spec, area, { width: 1200, height: 800 });
    expect(rect && tilesVisibly(spec, rect, area)).toBe(true);
  });

  test('without a repeat nothing tiles however small it is', () => {
    const spec = specOf({ repeat: 'no-repeat', size: '32px 32px' });
    const rect = paintRect(spec, area, { width: 32, height: 32 });
    expect(rect && tilesVisibly(spec, rect, area)).toBe(false);
  });

  test('only the repeating axis counts', () => {
    const spec = specOf({ repeat: 'repeat-x', size: '100% 40px' });
    const rect = paintRect(spec, area, { width: 100, height: 40 });
    expect(rect && tilesVisibly(spec, rect, area)).toBe(false);
  });

  test('from the style alone: a repeat with auto size is a pattern', () => {
    expect(mayBePicture(specOf({ repeat: 'repeat', size: 'auto' }), area)).toBe(false);
    expect(mayBePicture(specOf({ repeat: 'repeat', size: 'contain' }), area)).toBe(false);
    expect(mayBePicture(specOf({ repeat: 'repeat', size: '32px 32px' }), area)).toBe(false);
  });

  test('from the style alone: cover, a big explicit size and no repeat may be pictures', () => {
    expect(mayBePicture(specOf({ repeat: 'repeat', size: 'cover' }), area)).toBe(true);
    expect(mayBePicture(specOf({ repeat: 'repeat', size: '100% 100%' }), area)).toBe(true);
    expect(mayBePicture(specOf({ repeat: 'repeat', size: '400px 300px' }), area)).toBe(true);
    expect(mayBePicture(specOf({ repeat: 'no-repeat', size: 'auto' }), area)).toBe(true);
    expect(mayBePicture(specOf({ repeat: 'repeat-x', size: '100% 40px' }), area)).toBe(true);
  });

  test('a size the style settles is known; one that needs the picture is not', () => {
    expect(knownPaintedSize(specOf({ size: '24px 24px' }), area)).toEqual({ width: 24, height: 24 });
    expect(knownPaintedSize(specOf({ size: '50% 25%' }), area)).toEqual({ width: 150, height: 50 });
    expect(knownPaintedSize(specOf({ size: 'auto' }), area)).toBeNull();
    expect(knownPaintedSize(specOf({ size: 'cover' }), area)).toBeNull();
    expect(knownPaintedSize(specOf({ size: '24px auto' }), area)).toBeNull();
  });
});
