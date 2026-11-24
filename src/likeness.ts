/**
 * Whether two pictures are the same frame at different sizes.
 *
 * The exact fingerprint in `image.ts` hashes pixels and size together, which is
 * right for "is this the upload I already sent" and wrong for the commonest
 * case of seeing a picture twice: a feed shows a thumbnail, a click opens the
 * original, and the two share no address, no size and no byte. Lens answers in
 * fractions of the picture, so an answer for one draws correctly on the other.
 *
 * Two tests, and the danger is not missing a match but inventing one: the
 * same meme template under a different caption, handed the other caption's
 * translation, is worse than asking again.
 *
 * - **The picture**: a 64x64 grey copy, the same proportions, and almost no
 *   cell off by much. A coarse 8x8 hash only nominates candidates. This
 *   catches a different crop, a different photograph and a large caption -
 *   and it cannot see small lettering at all, measured: two captions 1.5% of
 *   the picture tall differ in 0.1% of the cells, and resampling a thumbnail
 *   moves 1-2%. A finer copy does not help, since the resampling grows with it.
 * - **The text**: so the decision is made where the answer says the text is,
 *   line by line, at a resolution where letters are letters (`linesAgree`).
 *
 * Pure arithmetic over pixel data, so it runs in tests without a canvas.
 */

/** The side of the grey copy. 4 kB a picture, which the store keeps beside the answer. */
export const FACE_SIZE = 64;

export interface Face {
  /** FACE_SIZE squared grey levels, row by row. */
  gray: Uint8Array;
  /** An 8x8 average hash as two 32-bit halves: a cheap way to find candidates. */
  coarse: [number, number];
  /** Width over height of the picture itself, not of the grey copy. */
  aspect: number;
}

/**
 * A face from a square RGBA buffer, the picture squeezed into it.
 *
 * The buffer's side must be a multiple of FACE_SIZE; each grey cell is the mean
 * of the block it covers, which is an exact area average and so does not alias
 * the way sampling a large picture straight down to 64 pixels would.
 */
export function faceOf(rgba: Uint8ClampedArray | Uint8Array, side: number, width: number, height: number, size = FACE_SIZE): Face | null {
  if (side % size !== 0 || rgba.length < side * side * 4 || !(width > 0) || !(height > 0)) return null;
  const block = side / size;
  const sums = new Float64Array(size * size);
  for (let y = 0; y < side; y += 1) {
    const row = Math.floor(y / block) * size;
    for (let x = 0; x < side; x += 1) {
      const i = (y * side + x) * 4;
      // Rec. 601 luma; the weights only have to be the same every time.
      sums[row + Math.floor(x / block)]! += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    }
  }
  const gray = new Uint8Array(size * size);
  const area = block * block;
  for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(sums[i]! / area);
  return { gray, coarse: coarseHash(gray, size), aspect: width / height };
}

function coarseHash(gray: Uint8Array, size: number): [number, number] {
  const cell = size / 8;
  const means: number[] = [];
  for (let by = 0; by < 8; by += 1) {
    for (let bx = 0; bx < 8; bx += 1) {
      let sum = 0;
      for (let y = 0; y < cell; y += 1) {
        for (let x = 0; x < cell; x += 1) sum += gray[(by * cell + y) * size + bx * cell + x]!;
      }
      means.push(sum);
    }
  }
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 64; i += 1) {
    if (means[i]! <= mean) continue;
    if (i < 32) lo |= 1 << i;
    else hi |= 1 << (i - 32);
  }
  return [lo >>> 0, hi >>> 0];
}

const bits = (n: number): number => {
  let v = n >>> 0;
  let count = 0;
  while (v) {
    v &= v - 1;
    count += 1;
  }
  return count;
};

export const coarseDistance = (a: readonly [number, number], b: readonly [number, number]): number =>
  bits(a[0] ^ b[0]) + bits(a[1] ^ b[1]);

/** Proportions further apart than this are a different crop, not a different size. */
export const ASPECT_TOLERANCE = 0.02;
/** Of 64 coarse bits; only decides what is worth comparing properly. */
export const COARSE_MAX = 10;
/** A cell this many grey levels off is a disagreement, not resampling. */
export const CELL_DIFFERENCE = 24;
/**
 * The share of disagreeing cells beyond which the pictures differ.
 *
 * The lines decide whether the text that was read is the text that is there;
 * this is what stands between a stored answer and text it never saw. A copy
 * with a small caption added keeps every stored line and gains one, and only
 * the picture as a whole can notice - so this is as tight as resampling
 * allows. The same frame JPEG'd at a fifth of its size moved 0.07% of the
 * cells on a manga page; a 900x380 screenshot squeezed below the copy's own
 * size moved 1-4.6%, and is asked about again, which is the cheap mistake.
 * What it lets through is an addition under about 1% of the picture.
 */
export const CELLS_MAX = 0.01;
/** And the mean difference, for a picture that changed everywhere a little. */
export const MEAN_MAX = 5;

export function similarAspect(a: number, b: number): boolean {
  return Math.abs(a - b) <= ASPECT_TOLERANCE * Math.max(a, b);
}

/** Worth reading the other's grey copy for: same proportions, close coarse hash. */
export function candidate(
  a: Pick<Face, 'coarse' | 'aspect'>,
  b: Pick<Face, 'coarse' | 'aspect'>
): boolean {
  return similarAspect(a.aspect, b.aspect) && coarseDistance(a.coarse, b.coarse) <= COARSE_MAX;
}

/** How two grey copies disagree: the share of cells off by a lot, and the mean. */
export function difference(a: Uint8Array, b: Uint8Array): { cells: number; mean: number } {
  if (a.length !== b.length || !a.length) return { cells: 1, mean: 255 };
  let off = 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i]! - b[i]!);
    total += d;
    if (d > CELL_DIFFERENCE) off += 1;
  }
  return { cells: off / a.length, mean: total / a.length };
}

export function sameFrame(a: Face, b: Pick<Face, 'gray' | 'coarse' | 'aspect'>): boolean {
  if (!candidate(a, b)) return false;
  const { cells, mean } = difference(a.gray, b.gray);
  return cells <= CELLS_MAX && mean <= MEAN_MAX;
}

/**
 * Whether an answer made at one resolution will do for a picture at another.
 *
 * Larger for smaller always: the same words, patches with detail to spare.
 * Smaller for larger only down to half, measured in what Lens was actually sent
 * - an original goes up at 1600 on the long side at most, so a 1200 thumbnail
 * is three quarters of it and is reused, while a 400 preview would draw blurred
 * patches and may have lost the fine print, and is asked again; that better
 * answer then serves both.
 */
export const REUSE_DOWN_TO = 0.5;

export const reusable = (storedSize: number, wantedSize: number): boolean =>
  storedSize >= REUSE_DOWN_TO * wantedSize;

/**
 * The text itself, where the answer says it is.
 *
 * The grey copy cannot see small lettering: at 64 cells a line 1.5% of the
 * picture tall is a grey smear, and two captions of that size measure as one
 * picture - while resampling a thumbnail moves the copy by as much as a whole
 * caption does, so a finer copy does not help either. What separates them is
 * looking where the text is, at a resolution where letters are letters: each
 * line the answer found, squeezed to a strip 12 cells across its short side.
 *
 * Measured on real pictures, JPEG'd and scaled the way a CDN makes thumbnails:
 * the same line at half or a third the size correlates at 0.98 and over, a
 * different line at 0.3-0.45, and the same line with one word changed at
 * 0.88-0.90. A line under 10 pixels tall in either picture cannot be told
 * apart from noise and is not counted; if nothing can be counted, the match is
 * refused and Lens is asked, which is the cost of being wrong in the safe
 * direction.
 */
export interface Box {
  /** Left, top, width, height: fractions of the picture, unrotated. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Mark {
  box: Box;
  /** The strip's grey levels, row by row. */
  gray: Uint8Array;
}

export const MARK_SHORT = 12;
export const MARK_LONG_MAX = MARK_SHORT * 16;
/** The line's short side, in pixels of the smaller picture, below which it says nothing. */
export const MARK_MIN_PX = 10;
/** Every line that can be compared must correlate at least this well. */
export const MARK_AGREE = 0.94;
/** The largest lines are enough; a page of fine print need not all be stored twice. */
export const MARK_LINES = 24;

/** The strip a box is squeezed into: 12 across its short side, its proportions along the other. */
export function markShape(pixelW: number, pixelH: number): { w: number; h: number } {
  const along = (long: number, short: number): number =>
    Math.max(MARK_SHORT, Math.min(MARK_LONG_MAX, Math.round((MARK_SHORT * long) / Math.max(short, 1e-9))));
  return pixelW >= pixelH
    ? { w: along(pixelW, pixelH), h: MARK_SHORT }
    : { w: MARK_SHORT, h: along(pixelH, pixelW) };
}

interface Geometric {
  geometry: { cx: number; cy: number; w: number; h: number } | null;
}

/** The lines worth marking: what OCR found, largest first, inside the picture. */
export function markBoxes(paragraphs: ReadonlyArray<{ lines: ReadonlyArray<Geometric> }>): Box[] {
  const boxes: Box[] = [];
  for (const paragraph of paragraphs) {
    for (const line of paragraph.lines) {
      const g = line.geometry;
      if (!g || !(g.w > 0) || !(g.h > 0)) continue;
      const x = Math.max(0, g.cx - g.w / 2);
      const y = Math.max(0, g.cy - g.h / 2);
      const w = Math.min(1, g.cx + g.w / 2) - x;
      const h = Math.min(1, g.cy + g.h / 2) - y;
      if (w > 0 && h > 0) boxes.push({ x, y, w, h });
    }
  }
  return boxes.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MARK_LINES);
}

/** Zero-mean normalised correlation; NaN when both strips are flat, which says nothing. */
export function correlation(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || !a.length) return -1;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i += 1) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= a.length;
  mb /= b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  // Under about 4 grey levels of spread there is no lettering to compare.
  const flat = 16 * a.length;
  if (da < flat && db < flat) return Number.NaN;
  if (da < flat || db < flat) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * Whether the lines stored with an answer are the lines in this picture.
 *
 * `current[i]` is the strip of `stored[i].box` in the picture asked about;
 * `smaller` is the size of whichever of the two pictures is smaller, which is
 * what decides how tall a line is where it is least legible.
 */
export function linesAgree(
  stored: ReadonlyArray<Mark>,
  current: ReadonlyArray<Uint8Array>,
  smaller: { width: number; height: number }
): boolean {
  let compared = 0;
  for (const [i, mark] of stored.entries()) {
    const strip = current[i];
    if (!strip) return false;
    const short = Math.min(mark.box.w * smaller.width, mark.box.h * smaller.height);
    if (short < MARK_MIN_PX) continue;
    const r = correlation(mark.gray, strip);
    if (Number.isNaN(r)) continue;
    if (r < MARK_AGREE) return false;
    compared += 1;
  }
  return compared > 0;
}
