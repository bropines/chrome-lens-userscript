import { describe, expect, test } from 'bun:test';
import { looksLikeText } from '../src/textlike.js';

const W = 1024;
const H = 576;

/** A soft gradient with blurred blobs: a photograph with nothing sharp in it. */
function smooth(): Uint8Array {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const blob = 60 * Math.exp(-(((x - 600) / 180) ** 2 + ((y - 300) / 120) ** 2));
      gray[y * W + x] = Math.round(90 + (100 * y) / H + blob);
    }
  }
  return gray;
}

/** Dark strokes on light, in rows: what lettering looks like at this size. */
function lettering(on: Uint8Array, top: number, glyph: number, count: number): Uint8Array {
  const gray = on.slice();
  for (let i = 0; i < count; i += 1) {
    const left = 40 + i * glyph;
    for (let y = top; y < top + glyph; y += 1) {
      for (let x = left; x < left + glyph * 0.8; x += 1) {
        const fx = (x - left) / glyph;
        const fy = (y - top) / glyph;
        // A stem, a bar and a bowl's edge: strokes in both directions.
        const ink = fx < 0.15 || Math.abs(fy - 0.5) < 0.08 || (fx > 0.6 && fx < 0.72 && fy > 0.3);
        gray[y * W + x] = ink ? 20 : 235;
      }
    }
  }
  return gray;
}

describe('a picture that could have text in it', () => {
  test('a smooth photograph is turned away', () => {
    expect(looksLikeText(smooth(), W, H)).toBe(false);
  });

  test('a line of lettering is let through, down to small type', () => {
    expect(looksLikeText(lettering(smooth(), 100, 40, 20), W, H)).toBe(true);
    expect(looksLikeText(lettering(smooth(), 100, 14, 40), W, H)).toBe(true);
  });

  test('one sharp mark is not a line of text', () => {
    expect(looksLikeText(lettering(smooth(), 100, 14, 1), W, H)).toBe(false);
  });

  test('a picture too small to have cells says no rather than guessing', () => {
    expect(looksLikeText(new Uint8Array(4 * 4), 4, 4)).toBe(false);
  });
});
