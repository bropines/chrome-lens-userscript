import type { TranslationBlock, VerticalTextMode } from '../types.js';
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

const measureCtx = document.createElement('canvas').getContext('2d');

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
  fontFamily: string
): number {
  if (!measureCtx) return MIN_FONT_SIZE;
  let low = MIN_FONT_SIZE;
  let high = MAX_FONT_SIZE;
  while (low <= high) {
    const mid = (low + high) >> 1;
    measureCtx.font = `${mid}px ${fontFamily}`;
    const metrics = measureCtx.measureText(str);
    const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    if (metrics.width >= boxWidth || height >= boxHeight) high = mid - 1;
    else low = mid + 1;
  }
  return Math.max(MIN_FONT_SIZE, Math.min(low - 1, MAX_FONT_SIZE));
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
  perCharacter = false
): { size: number; lines: string[] } {
  let low = MIN_FONT_SIZE;
  let high = MAX_FONT_SIZE;
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

  const size = Math.max(MIN_FONT_SIZE, Math.min(low - 1, MAX_FONT_SIZE));
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
