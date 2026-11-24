import type { Source } from './image.js';

/**
 * Whether a picture could have text in it, decided without asking anyone.
 *
 * Translating as you scroll uploads every picture that comes into view, and a
 * feed is mostly photographs. This is a filter in front of that, and it is
 * built to be wrong in one direction only: a picture it turns away is never
 * translated, a picture it lets through costs one request. So it refuses only
 * what is plainly bare - a smooth photograph, a flat graphic, a sky - and lets
 * anything with fine high-contrast detail through, a textured photograph
 * included. It is not a text detector, and should not be tuned into one
 * without pictures to measure it against: a missed caption is the worse error.
 *
 * Where the browser has a real one (\`TextDetector\`, the Shape Detection API,
 * behind a flag in Chrome), that is asked instead, and its answer is final.
 *
 * Lettering makes cells with many strong edges in both directions and a wide
 * range of grey, side by side along a line. A cell is 8 pixels of the picture
 * at 1024 on its long side, and sixteen such cells, each with a like neighbour
 * along a row or a column, are the test. A page of text has hundreds.
 *
 * Measured on JPEG'd pictures: manga pages and screenshots pass; so does a
 * meme caption down to 2% of the picture's height and dark print on a sky down
 * to 1.2% (about 11 pixels on a 900-pixel picture); a plain sky and field is
 * refused. At 256 on the long side, the first version, a caption under 3% was
 * lost - the resolution was the limit, and a share of the picture as the
 * threshold made the finer analysis worse rather than better, since the same
 * caption is a smaller share of more cells. A sharp-featured portrait and any
 * foliage pass, which is the price of the direction it errs in.
 */

export interface Tuning {
  /** The analysis runs at this long side. */
  side: number;
  cell: number;
  /** A step in grey this large between neighbours is an edge. */
  edge: number;
  /** Edges per cell in each direction. */
  edgesX: number;
  edgesY: number;
  /** The grey range inside a cell: ink against paper, not shading. */
  range: number;
  /** Cells with a like neighbour needed to say yes. */
  cells: number;
}

export const TUNING: Readonly<Tuning> = {
  side: 1024,
  cell: 8,
  edge: 40,
  edgesX: 6,
  edgesY: 3,
  range: 70,
  cells: 16,
};

/** The verdict on a grey picture, `width` by `height`, row by row. */
export function looksLikeText(gray: Uint8Array, width: number, height: number, tuning: Tuning = TUNING): boolean {
  const { cell: CELL, edge: EDGE, edgesX: MIN_EDGES_X, edgesY: MIN_EDGES_Y, range: MIN_RANGE } = tuning;
  const cols = Math.floor(width / CELL);
  const rows = Math.floor(height / CELL);
  if (cols < 2 || rows < 1) return false;
  const lettered = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      let ex = 0;
      let ey = 0;
      let lo = 255;
      let hi = 0;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y += 1) {
        for (let x = cx * CELL; x < (cx + 1) * CELL; x += 1) {
          const v = gray[y * width + x]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          if (x + 1 < width && Math.abs(v - gray[y * width + x + 1]!) > EDGE) ex += 1;
          if (y + 1 < height && Math.abs(v - gray[(y + 1) * width + x]!) > EDGE) ey += 1;
        }
      }
      if (hi - lo >= MIN_RANGE && ex >= MIN_EDGES_X && ey >= MIN_EDGES_Y) lettered[cy * cols + cx] = 1;
    }
  }
  // A lettered cell alone is a twig or an eye; text runs along a line.
  let joined = 0;
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      if (!lettered[cy * cols + cx]) continue;
      const beside =
        (cx > 0 && lettered[cy * cols + cx - 1]) ||
        (cx + 1 < cols && lettered[cy * cols + cx + 1]) ||
        (cy > 0 && lettered[(cy - 1) * cols + cx]) ||
        (cy + 1 < rows && lettered[(cy + 1) * cols + cx]);
      if (beside) joined += 1;
    }
  }
  return joined >= tuning.cells;
}

interface DetectedText {
  boundingBox: DOMRectReadOnly;
}
interface TextDetectorLike {
  detect(source: Source): Promise<DetectedText[]>;
}

let native: TextDetectorLike | null | undefined;

function nativeDetector(): TextDetectorLike | null {
  if (native !== undefined) return native;
  native = null;
  try {
    const Ctor = (globalThis as { TextDetector?: new () => TextDetectorLike }).TextDetector;
    if (typeof Ctor === 'function') native = new Ctor();
  } catch {
    // Declared but not usable here (no OS support behind it): use our own.
  }
  return native;
}

/**
 * The question for a picture in hand. Never throws: a picture whose pixels
 * cannot be read is let through, since refusing it is the error that costs a
 * translation rather than a request.
 */
export async function mayHaveText(
  source: Source,
  width: number,
  height: number,
  tuning: Tuning = TUNING
): Promise<boolean> {
  const detector = tuning === TUNING ? nativeDetector() : null;
  if (detector) {
    try {
      return (await detector.detect(source)).length > 0;
    } catch {
      // Some platforms declare it and then fail every call; fall through.
      native = null;
    }
  }
  const scale = Math.min(1, tuning.side / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i += 1) {
      gray[i] = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!);
    }
    return looksLikeText(gray, w, h, tuning);
  } catch {
    return true;
  }
}
