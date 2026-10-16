import type { Geometry, TranslationBlock, VerticalTextMode } from '../types.js';
import { Alignment, WritingDirection } from '../types.js';

/**
 * The parts of Chromium's translated-text layout that are pure computation.
 * chrome/browser/resources/lens/overlay/text_layer.ts
 */

export const MIN_FONT_SIZE = 3;
export const MAX_FONT_SIZE = 150;
export const OUTLINE_RATIO = 0.02;

export const RTL_LANGS: ReadonlySet<string> = new Set([
  'ar', 'bal', 'ckb', 'dv', 'fa', 'he', 'iw', 'ji', 'ks', 'ps', 'sd', 'ug', 'ur', 'yi',
]);
export const CJK_LANGS: ReadonlySet<string> = new Set(['ja', 'zh', 'ko', 'yue']);

const DEG = Math.PI / 180;

/**
 * The context text is measured with, made on first use.
 *
 * This used to be created when the module loaded, which meant importing the
 * layout maths needed a DOM - and the layout maths is exactly the part worth
 * testing without one.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;

function measurer(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

const baseLang = (tag: string): string => tag.split('-')[0]?.toLowerCase() ?? '';

/**
 * calculateFontSizePixels(): the largest size at which the line still fits.
 *
 * Two details matter. The height test uses the font's bounding box
 * (`fontBoundingBoxAscent + fontBoundingBoxDescent`), not the ink extents of
 * these particular glyphs. And Chromium never wraps a translated line - it
 * scales the text down instead, so wrapping here would never match.
 */
export function fitFontSize(
  str: string,
  boxWidth: number,
  boxHeight: number,
  fontFamily: string,
  maxSize = MAX_FONT_SIZE
): number {
  const ctx = measurer();
  if (!ctx) return MIN_FONT_SIZE;
  let low = MIN_FONT_SIZE;
  let high = maxSize;
  while (low <= high) {
    const mid = (low + high) >> 1;
    ctx.font = `${mid}px ${fontFamily}`;
    const metrics = ctx.measureText(str);
    const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    if (metrics.width >= boxWidth || height >= boxHeight) high = mid - 1;
    else low = mid + 1;
  }
  return Math.max(MIN_FONT_SIZE, Math.min(low - 1, maxSize));
}

/**
 * Reassemble one rendered line from the paragraph-wide translation.
 *
 * Word offsets index the string by UTF-16 code unit, which is what
 * icu::UnicodeString uses on the server - and also how JavaScript indexes
 * strings, so `slice` is already correct here. The separator after a word is
 * the gap up to the next one, crossing into the following line for the last.
 */
export function buildLineText(
  translation: string,
  line: Pick<TranslationBlock['lines'][number], 'words'>,
  nextLine: Pick<TranslationBlock['lines'][number], 'words'> | undefined
): string {
  let out = '';
  line.words.forEach(([start, end], i) => {
    out += translation.slice(start, end);
    const next = line.words[i + 1];
    if (next) out += translation.slice(end, next[0]);
    else if (nextLine?.words[0]) out += translation.slice(end, nextLine.words[0][0]);
  });
  return out;
}

/**
 * Greedy wrap. Falls back to per-character when the script has no spaces,
 * which is how a ja/zh/ko translation arrives.
 */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
  perCharacter = false
): string[] {
  const lines: string[] = [];
  for (const hardLine of text.split('\n')) {
    if (!hardLine) {
      lines.push('');
      continue;
    }
    // Whether to break between characters is a property of the *language*, not
    // of this particular string. Deciding it from `includes(' ')` meant a short
    // Russian word with no space in it got split letter by letter.
    const tokens = perCharacter ? [...hardLine] : hardLine.split(/\s+/);
    const joiner = perCharacter ? '' : ' ';

    let current = '';
    for (const token of tokens) {
      const candidate = current ? `${current}${joiner}${token}` : token;
      if (measure(candidate) <= maxWidth || !current) current = candidate;
      else {
        lines.push(current);
        current = token;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Largest font at which `text` wraps to fit a box.
 *
 * Unlike the per-line fit, the text here genuinely has to be re-wrapped: the
 * source line boxes are tall columns that horizontal text cannot occupy, so the
 * paragraph box becomes one text area instead.
 */
export function fitTextBlock(
  setFont: (size: number) => void,
  measure: (s: string) => number,
  lineHeight: (size: number) => number,
  text: string,
  boxWidth: number,
  boxHeight: number,
  perCharacter = false,
  maxSize = MAX_FONT_SIZE
): { size: number; lines: string[] } {
  let low = MIN_FONT_SIZE;
  let high = maxSize;
  let best: string[] = [];

  while (low <= high) {
    const mid = (low + high) >> 1;
    setFont(mid);
    const lines = wrapText(measure, text, boxWidth, perCharacter);
    const widest = lines.reduce((max, line) => Math.max(max, measure(line)), 0);
    if (widest >= boxWidth || lines.length * lineHeight(mid) >= boxHeight) high = mid - 1;
    else {
      low = mid + 1;
      best = lines;
    }
  }

  const size = Math.max(MIN_FONT_SIZE, Math.min(low - 1, maxSize));
  if (!best.length) {
    setFont(size);
    best = wrapText(measure, text, boxWidth, perCharacter);
  }
  return { size, lines: best };
}

/** aRGB uint32 from the server into a CSS colour. */
export function argbToCss(value: number): string {
  const alpha = ((value >>> 24) & 255) / 255;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Whether a top-to-bottom source paragraph should stay vertical.
 *
 * Vertical Japanese translated into Russian and still set vertically is
 * faithful to the source and miserable to read, so "auto" keeps the column only
 * when the translation is itself a CJK language.
 */
export function shouldStayVertical(block: TranslationBlock, mode: VerticalTextMode): boolean {
  if (block.writingDirection !== WritingDirection.TopToBottom) return false;
  if (mode === 'keep') return true;
  if (mode === 'horizontal') return false;
  return CJK_LANGS.has(baseLang(block.targetLang));
}

/** ja, zh and ko wrap between characters; everything else wraps between words. */
export function wrapsPerCharacter(block: TranslationBlock): boolean {
  return CJK_LANGS.has(baseLang(block.targetLang));
}

export function isRtl(block: TranslationBlock): boolean {
  if (block.writingDirection === WritingDirection.RightToLeft) return true;
  return RTL_LANGS.has(baseLang(block.targetLang));
}

/**
 * Alignment enum to flex justification, with an override.
 *
 * Chromium always follows the source. Once text has been reflowed into a shape
 * the source never had, following it stops being obviously right, so the
 * setting can force a side.
 */
export function justification(
  alignment: Alignment,
  rtl: boolean,
  override: 'auto' | 'left' | 'center' | 'right' = 'auto'
): string {
  if (override !== 'auto') {
    return { left: 'flex-start', center: 'center', right: 'flex-end' }[override];
  }
  const map: Record<Alignment, string> = {
    [Alignment.Left]: 'flex-start',
    [Alignment.Right]: 'flex-end',
    [Alignment.Center]: 'center',
  };
  const value = map[alignment] ?? 'center';
  return rtl && value === 'flex-start' ? 'flex-end' : value;
}

// ---------------------------------------------------------------- vertical

/** Ranges CSS text-orientation: mixed keeps upright in vertical writing. */
const UPRIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], [0x2e80, 0x303f], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xfe10, 0xfe4f],
  [0xff00, 0xff60], [0xffe0, 0xffe6],
];

export const isUpright = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return UPRIGHT_RANGES.some(([low, high]) => code >= low && code <= high);
};

/** Small punctuation hangs in the upper right of its em square. */
export const CORNER_PUNCT = new Set('、。，．');

export function verticalRuns(text: string): Array<[boolean, string]> {
  const runs: Array<[boolean, string]> = [];
  for (const char of text) {
    let upright = isUpright(char);
    const last = runs[runs.length - 1];
    if (/\s/.test(char) && last) upright = last[0];
    if (last && last[0] === upright) last[1] += char;
    else runs.push([upright, char]);
  }
  return runs;
}

// ------------------------------------------------------------------- room

/**
 * Bring a box inside the image, by the cheapest means that works.
 *
 * The bound is the picture itself: nothing may be drawn where the canvas will
 * only clip it. There are two ways back in and they are not equal - moving the
 * box changes nothing about the text, while shrinking it costs a smaller font.
 * So shrink only by what no amount of moving could fix, then move.
 *
 * For a rotated box the bound is its axis-aligned extent, because that is the
 * shape the canvas actually clips against: `w * |cos| + h * |sin|` is how far a
 * rotated rectangle really reaches.
 */
export function fitInside(
  box: { cx: number; cy: number; w: number; h: number; angle: number },
  width: number,
  height: number
): { cx: number; cy: number; w: number; h: number } {
  const radians = box.angle * DEG;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  const spanX = box.w * cos + box.h * sin;
  const spanY = box.w * sin + box.h * cos;
  // Only as far as it takes to fit at all; a box that already fits is untouched.
  const scale = Math.min(1, width / spanX, height / spanY);
  const w = box.w * scale;
  const h = box.h * scale;

  const halfX = (w * cos + h * sin) / 2;
  const halfY = (w * sin + h * cos) / 2;
  const place = (centre: number, half: number, limit: number): number =>
    half * 2 >= limit ? limit / 2 : Math.min(Math.max(centre, half), limit - half);

  return { cx: place(box.cx, halfX, width), cy: place(box.cy, halfY, height), w, h };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const rectOf = (geometry: Geometry, width: number, height: number): Rect => ({
  left: (geometry.cx - geometry.w / 2) * width,
  right: (geometry.cx + geometry.w / 2) * width,
  top: (geometry.cy - geometry.h / 2) * height,
  bottom: (geometry.cy + geometry.h / 2) * height,
});

/** Never let two paragraphs share an edge; a pixel of daylight reads as one. */
const GAP = 2;

/**
 * How much room a paragraph actually has.
 *
 * The detected box hugs the glyphs, so it has to grow - a bubble is round and
 * has space the box does not describe. Growing by a fixed multiple is a guess
 * that is wrong in both directions at once: too little where a bubble is
 * generous, and too much where the next one is close, which is how a
 * translation ends up written across its neighbour.
 *
 * The real limit is the neighbours. Each side grows until it would reach
 * another paragraph, capped by the multiple and by the picture. Only a
 * paragraph that actually shares the band on the perpendicular axis can block a
 * side: one diagonally away is not in the way.
 *
 * Rotation is ignored here, deliberately. These are axis-aligned extents of
 * boxes that come back within a tenth of a degree of upright in practice, and
 * an approximation that errs towards less room cannot cause an overlap.
 */
export function roomFor(own: Rect, others: Rect[], growth: number, width: number, height: number): Rect {
  const growX = ((own.right - own.left) * (growth - 1)) / 2;
  const growY = ((own.bottom - own.top) * (growth - 1)) / 2;

  let left = Math.max(0, own.left - growX);
  let right = Math.min(width, own.right + growX);
  let top = Math.max(0, own.top - growY);
  let bottom = Math.min(height, own.bottom + growY);

  for (const other of others) {
    if (other.bottom > own.top && other.top < own.bottom) {
      if (other.right <= own.left) left = Math.max(left, other.right + GAP);
      if (other.left >= own.right) right = Math.min(right, other.left - GAP);
    }
    if (other.right > own.left && other.left < own.right) {
      if (other.bottom <= own.top) top = Math.max(top, other.bottom + GAP);
      if (other.top >= own.bottom) bottom = Math.min(bottom, other.top - GAP);
    }
  }

  // A neighbour closer than the box itself would invert it; the box wins.
  return {
    left: Math.min(left, own.left),
    right: Math.max(right, own.right),
    top: Math.min(top, own.top),
    bottom: Math.max(bottom, own.bottom),
  };
}
