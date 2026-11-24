import { describe, expect, test } from 'bun:test';
import {
  CELLS_MAX,
  MARK_AGREE,
  correlation,
  linesAgree,
  markBoxes,
  markShape,
  FACE_SIZE,
  candidate,
  coarseDistance,
  difference,
  faceOf,
  reusable,
  sameFrame,
} from '../src/likeness.js';
import type { Box, Face } from '../src/likeness.js';

/** A deterministic pseudo-random stream, so a "picture" is the same every run. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A scene with smooth shading and a band of "lettering": dark blocks on white. */
type Scene = (x: number, y: number) => number;

function scene(captionSeed: number, photoSeed = 1): Scene {
  const r = rng(photoSeed);
  const blobs = Array.from({ length: 6 }, () => ({ x: r(), y: r(), s: 0.1 + r() * 0.3, v: r() }));
  const c = rng(captionSeed);
  // Glyphs: 22 per line, two lines, each a block of random ink.
  const glyphs = Array.from({ length: 44 }, () => [c(), c(), c(), c()] as const);
  return (x, y) => {
    if (y > 0.06 && y < 0.2 && x > 0.05 && x < 0.95) {
      const line = y < 0.13 ? 0 : 1;
      const gx = Math.floor(((x - 0.05) / 0.9) * 22);
      const g = glyphs[line * 22 + gx]!;
      const fx = (((x - 0.05) / 0.9) * 22) % 1;
      const fy = ((y - 0.06) / 0.07) % 1;
      // A glyph is a couple of strokes inside its cell.
      const ink = (Math.abs(fx - g[0]) < 0.12 && fy > 0.15 && fy < 0.85) || (Math.abs(fy - g[1]) < 0.12 && fx > g[2] * 0.4 && fx < 0.6 + g[3] * 0.4);
      return ink ? 0 : 255;
    }
    let v = 120;
    for (const b of blobs) v += 120 * b.v * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (b.s * b.s));
    return Math.min(255, v);
  };
}

/**
 * The picture at a given resolution, then squeezed to 128 the way `identify`
 * does: point-sampled at `size`, box-averaged down. Two sizes of one scene
 * differ only by that resampling - what a thumbnail and an original differ by.
 */
function faceAt(picture: Scene, width: number, height: number): Face {
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels[y * width + x] = picture((x + 0.5) / width, (y + 0.5) / height);
  }
  const side = 128;
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const x0 = Math.floor((x * width) / side);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / side));
      const y0 = Math.floor((y * height) / side);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / side));
      let sum = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) sum += pixels[yy * width + xx]!;
      const v = sum / ((x1 - x0) * (y1 - y0));
      const i = (y * side + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return faceOf(rgba, side, width, height)!;
}

describe('faces', () => {
  test('a face is a 64x64 grey copy and the proportions of the picture', () => {
    const face = faceAt(scene(1), 300, 200);
    expect(face.gray.length).toBe(FACE_SIZE * FACE_SIZE);
    expect(face.aspect).toBeCloseTo(1.5);
  });

  test('refuses a buffer it cannot divide evenly', () => {
    expect(faceOf(new Uint8ClampedArray(100 * 100 * 4), 100, 10, 10)).toBeNull();
    expect(faceOf(new Uint8ClampedArray(128 * 128 * 4), 128, 0, 10)).toBeNull();
  });
});

describe('the same frame at another size', () => {
  test('a thumbnail and its original match', () => {
    const original = faceAt(scene(7), 1200, 900);
    // Point-sampled, which aliases worse than any browser's downscale; at a
    // third of the size that alone moves more than the threshold allows.
    for (const [w, h] of [[600, 450], [800, 600], [1600, 1200]] as const) {
      expect(sameFrame(original, faceAt(scene(7), w, h))).toBe(true);
    }
  });

  test('the same template under a different caption does not', () => {
    const one = faceAt(scene(7), 1200, 900);
    const other = faceAt(scene(8), 1200, 900);
    // The coarse hash cannot tell them apart - that is why it only nominates.
    expect(candidate(one, other)).toBe(true);
    expect(difference(one.gray, other.gray).cells).toBeGreaterThan(CELLS_MAX);
    expect(sameFrame(one, other)).toBe(false);
    // Nor at different sizes, which is the case that would actually be looked up.
    expect(sameFrame(one, faceAt(scene(8), 400, 300))).toBe(false);
  });

  test('a different crop is a different picture', () => {
    const wide = faceAt(scene(7), 1200, 900);
    expect(sameFrame(wide, faceAt(scene(7), 1200, 800))).toBe(false);
  });

  test('a different photograph is not a candidate at all', () => {
    const one = faceAt(scene(7, 1), 800, 600);
    const other = faceAt(scene(7, 2), 800, 600);
    expect(coarseDistance(one.coarse, other.coarse)).toBeGreaterThan(10);
  });
});

describe('which answer will do', () => {
  test('a larger answer always serves a smaller picture', () => {
    expect(reusable(1600, 400)).toBe(true);
  });
  test('a smaller one serves down to half the detail', () => {
    expect(reusable(1200, 1600)).toBe(true);
    expect(reusable(800, 1600)).toBe(true);
    expect(reusable(680, 1600)).toBe(false);
  });
});

/** A box's strip in a picture of a given size: point-sampled there, then box-averaged. */
function stripAt(picture: Scene, box: Box, width: number, height: number): Uint8Array {
  const pw = box.w * width;
  const ph = box.h * height;
  const shape = markShape(pw, ph);
  const out = new Uint8Array(shape.w * shape.h);
  // The source pixels the box covers, at this picture's resolution.
  const x0 = Math.floor(box.x * width);
  const y0 = Math.floor(box.y * height);
  const cols = Math.max(1, Math.round(pw));
  const rows = Math.max(1, Math.round(ph));
  for (let sy = 0; sy < shape.h; sy += 1) {
    for (let sx = 0; sx < shape.w; sx += 1) {
      const c0 = Math.floor((sx * cols) / shape.w);
      const c1 = Math.max(c0 + 1, Math.floor(((sx + 1) * cols) / shape.w));
      const r0 = Math.floor((sy * rows) / shape.h);
      const r1 = Math.max(r0 + 1, Math.floor(((sy + 1) * rows) / shape.h));
      let sum = 0;
      for (let r = r0; r < r1; r += 1) {
        for (let c = c0; c < c1; c += 1) sum += picture((x0 + c + 0.5) / width, (y0 + r + 0.5) / height);
      }
      out[sy * shape.w + sx] = Math.round(sum / ((r1 - r0) * (c1 - c0)));
    }
  }
  return out;
}

const CAPTION: Box = { x: 0.05, y: 0.06, w: 0.9, h: 0.07 };

describe('the lines decide', () => {
  test('a strip is 12 across the short side, up to 16 times that along', () => {
    expect(markShape(300, 30)).toEqual({ w: 120, h: 12 });
    expect(markShape(30, 90)).toEqual({ w: 12, h: 36 });
    expect(markShape(3000, 10)).toEqual({ w: 192, h: 12 });
  });

  test('the boxes come from what OCR found, largest first, cut to the picture', () => {
    const boxes = markBoxes([
      {
        lines: [
          { geometry: { cx: 0.5, cy: 0.5, w: 0.2, h: 0.05 } },
          { geometry: { cx: 0.98, cy: 0.1, w: 0.1, h: 0.2 } },
          { geometry: null },
        ],
      },
    ]);
    expect(boxes.length).toBe(2);
    expect(boxes[0]!.w).toBeCloseTo(0.07);
    expect(boxes[0]!.x).toBeCloseTo(0.93);
    for (const [k, v] of Object.entries({ x: 0.4, y: 0.475, w: 0.2, h: 0.05 })) {
      expect(boxes[1]![k as keyof Box]).toBeCloseTo(v);
    }
  });

  test('two flat strips say nothing; one flat and one inked disagree', () => {
    const flat = new Uint8Array(24).fill(200);
    const inked = Uint8Array.from({ length: 24 }, (_, i) => (i % 3 ? 255 : 0));
    expect(Number.isNaN(correlation(flat, flat))).toBe(true);
    expect(correlation(flat, inked)).toBe(0);
    expect(correlation(inked, inked)).toBeCloseTo(1);
  });

  test('the same caption in a thumbnail agrees', () => {
    const big = stripAt(scene(7), CAPTION, 1200, 900);
    const small = stripAt(scene(7), CAPTION, 600, 450);
    expect(linesAgree([{ box: CAPTION, gray: big }], [small], { width: 600, height: 450 })).toBe(true);
  });

  test('another caption under the same picture does not', () => {
    const big = stripAt(scene(7), CAPTION, 1200, 900);
    const other = stripAt(scene(8), CAPTION, 600, 450);
    expect(correlation(big, other)).toBeLessThan(MARK_AGREE);
    expect(linesAgree([{ box: CAPTION, gray: big }], [other], { width: 600, height: 450 })).toBe(false);
  });

  test('a line too small to read in the smaller picture is not evidence either way', () => {
    const big = stripAt(scene(7), CAPTION, 1200, 900);
    const other = stripAt(scene(8), CAPTION, 120, 90);
    // 0.07 of 90 pixels is 6: nothing can be compared, so nothing is matched.
    expect(linesAgree([{ box: CAPTION, gray: big }], [other], { width: 120, height: 90 })).toBe(false);
  });

  test('a missing strip is a refusal', () => {
    const big = stripAt(scene(7), CAPTION, 1200, 900);
    expect(linesAgree([{ box: CAPTION, gray: big }], [], { width: 600, height: 450 })).toBe(false);
  });
});
