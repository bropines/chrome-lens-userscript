import { Alignment, WritingDirection } from '../types.js';
import type {
  Bytes,
  Geometry,
  RenderOptions,
  TranslatedLine,
  TranslationBlock,
} from '../types.js';

/**
 * The picture the settings window translates to show what a setting does, as
 * plain data: where its text stands, what Lens would have said about it, and
 * which settings change the drawing.
 *
 * It is an answer of the shape `lens/response.ts` produces, written by hand, so
 * the preview goes through the real renderer with nothing asked of anybody. The
 * three paragraphs are the three cases the appearance settings exist for: a
 * speech bubble whose translation does not fit line by line, a vertical column,
 * and a caption over a background that is not one flat colour.
 *
 * Everything here is arithmetic - the canvas work is in ./preview.ts - so the
 * tests can hold it to what the renderer expects of a real answer.
 */

/** The sample's own size in pixels; every coordinate below is in these. */
export const SAMPLE_W = 400;
export const SAMPLE_H = 220;

export interface SampleLine {
  /** The "source" lettering painted into the picture. */
  source: string;
  /** The detected box, by its centre, in the sample's pixels. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface SampleParagraph {
  id: 'bubble' | 'column' | 'caption';
  direction: WritingDirection;
  alignment: Alignment;
  /** Height of the source lettering, in pixels. */
  size: number;
  /** aRGB, as the server reports them. */
  textColor: number;
  bgColor: number;
  /**
   * The inpainted patch's padding, as fractions of the line box's height - the
   * server's own convention, and its own values: about 0.4 for a horizontal
   * line and 0.05 for a column, whose height is its long side.
   */
  hPad: number;
  vPad: number;
  lines: SampleLine[];
}

export interface SampleEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** The two bubbles, in the order of the paragraphs that stand in them. */
export const SAMPLE_BUBBLES: readonly SampleEllipse[] = [
  { cx: 104, cy: 84, rx: 84, ry: 66 },
  { cx: 301, cy: 82, rx: 58, ry: 68 },
];

/** Where the caption's band starts; it runs to the bottom of the picture. */
export const SAMPLE_BAND_TOP = 164;

const BLACK = 0xff111111;
const WHITE = 0xffffffff;
const BAND = 0xff2a2a4a;

/** A horizontal line of full-width glyphs: as wide as it has characters. */
function row(source: string, cx: number, cy: number, size: number): SampleLine {
  // A detected box hugs the glyphs; a pixel of slack is all a real one has.
  return { source, cx, cy, w: [...source].length * size, h: size + 1 };
}

/** The same line from its left edge, for text that is not centred. */
function rowFrom(source: string, left: number, cy: number, size: number): SampleLine {
  const w = [...source].length * size;
  return { source, cx: left + w / 2, cy, w, h: size + 1 };
}

/** A column of upright glyphs: as tall as it has characters. */
function column(source: string, cx: number, top: number, size: number): SampleLine {
  const h = [...source].length * size;
  return { source, cx, cy: top + h / 2, w: size + 1, h };
}

export const SAMPLE: readonly SampleParagraph[] = [
  {
    id: 'bubble',
    direction: WritingDirection.LeftToRight,
    alignment: Alignment.Center,
    size: 15,
    textColor: BLACK,
    bgColor: WHITE,
    hPad: 0.4,
    vPad: 0.4,
    lines: [row('どうして', 104, 62, 15), row('ここに', 104, 84, 15), row('いるの？', 104, 106, 15)],
  },
  {
    id: 'column',
    direction: WritingDirection.TopToBottom,
    alignment: Alignment.Center,
    size: 15,
    textColor: BLACK,
    bgColor: WHITE,
    hPad: 0.05,
    vPad: 0.05,
    // Right to left, as a vertical page is read.
    lines: [column('まさか君が', 312, 46, 15), column('来るとは', 290, 46, 15)],
  },
  {
    id: 'caption',
    direction: WritingDirection.LeftToRight,
    alignment: Alignment.Left,
    size: 17,
    textColor: WHITE,
    bgColor: BAND,
    hPad: 0.4,
    vPad: 0.4,
    lines: [rowFrom('この先は関係者以外', 16, 181, 17), rowFrom('立入禁止です', 16, 204, 17)],
  },
];

/**
 * What each line "translates" to, per script. A sample of a script and not a
 * message, like the outline's: nothing can be asked of Lens here, so a target
 * language outside this list is shown the English one.
 */
interface SampleText {
  /** What joins two lines of one paragraph: a space, or nothing where none is written. */
  glue: string;
  bubble: readonly string[];
  column: readonly string[];
  caption: readonly string[];
}

const TEXTS: Readonly<Record<string, SampleText>> = {
  en: {
    glue: ' ',
    bubble: ['What are you', 'doing here', 'so late?'],
    column: ['I never thought', "you'd come"],
    caption: ['Staff only', 'No entry'],
  },
  ru: {
    glue: ' ',
    bubble: ['Что ты здесь', 'делаешь', 'так поздно?'],
    column: ['Не думал,', 'что ты придёшь'],
    caption: ['Только персонал', 'Вход запрещён'],
  },
  ja: {
    glue: '',
    bubble: ['どうして', 'ここに', 'いるの？'],
    column: ['まさか君が', '来るとは'],
    caption: ['この先は関係者以外', '立入禁止です'],
  },
  zh: {
    glue: '',
    bubble: ['你怎么', '会在', '这里？'],
    column: ['没想到', '你会来'],
    caption: ['非工作人员', '禁止入内'],
  },
  ko: {
    glue: ' ',
    bubble: ['너 왜', '여기', '있어?'],
    column: ['네가 올 줄은', '몰랐어'],
    caption: ['관계자 외', '출입 금지'],
  },
};

/** The language the sample is written in for a target: its own, or English. */
export function sampleLanguage(targetLang: string): string {
  const base = (targetLang.split('-')[0] ?? '').toLowerCase();
  return Object.hasOwn(TEXTS, base) ? base : 'en';
}

const geometryOf = (box: { cx: number; cy: number; w: number; h: number }): Geometry => ({
  cx: box.cx / SAMPLE_W,
  cy: box.cy / SAMPLE_H,
  w: box.w / SAMPLE_W,
  h: box.h / SAMPLE_H,
  angle: 0,
});

/** The box round every line of a paragraph, which is what Lens reports for one. */
export function paragraphBox(paragraph: SampleParagraph): { cx: number; cy: number; w: number; h: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const line of paragraph.lines) {
    left = Math.min(left, line.cx - line.w / 2);
    right = Math.max(right, line.cx + line.w / 2);
    top = Math.min(top, line.cy - line.h / 2);
    bottom = Math.max(bottom, line.cy + line.h / 2);
  }
  return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top };
}

/**
 * The rectangle of the picture a line's inpainted patch covers, in pixels.
 *
 * The renderer draws a patch over the box grown by `pad * box height` in each
 * direction (see drawLine in render/canvas.ts), so a patch cut from exactly
 * that rectangle lands on the pixels it was cut from.
 */
export function patchRect(
  paragraph: SampleParagraph,
  line: SampleLine
): { x: number; y: number; w: number; h: number } {
  const w = line.w + paragraph.hPad * line.h;
  const h = line.h + paragraph.vPad * line.h;
  return { x: line.cx - w / 2, y: line.cy - h / 2, w, h };
}

/**
 * The sample as Lens would have answered it.
 *
 * `patches` are the inpainted backgrounds, one per line in the order the lines
 * are listed across `SAMPLE`; a missing one leaves the line without, and the
 * renderer then fills its box flat, as it does for a patch that will not decode.
 *
 * The blocks claim the language the text is actually in, not the one asked
 * for: wrapping and direction are decided from it, and English shaped as
 * Arabic would be a picture of a bug that does not exist.
 */
export function sampleBlocks(
  targetLang: string,
  patches: ReadonlyArray<Bytes | null> = []
): TranslationBlock[] {
  const language = sampleLanguage(targetLang);
  const text = TEXTS[language] as SampleText;
  let at = 0;

  return SAMPLE.map((paragraph) => {
    const parts = text[paragraph.id];
    let translation = '';
    const lines: TranslatedLine[] = paragraph.lines.map((line, index) => {
      const part = parts[index] ?? '';
      if (index > 0) translation += text.glue;
      const words: Array<[number, number]> = [];
      // Offsets are UTF-16 code units, which is how a string is indexed here.
      for (const match of part.matchAll(/\S+/g)) {
        const start = translation.length + match.index;
        words.push([start, start + match[0].length]);
      }
      translation += part;
      const bytes = patches[at] ?? null;
      at += 1;
      return {
        words,
        textColor: paragraph.textColor,
        bgColor: paragraph.bgColor,
        geometry: geometryOf(line),
        background: bytes ? { bytes, hPad: paragraph.hPad, vPad: paragraph.vPad } : null,
      };
    });
    return {
      translation,
      geometry: geometryOf(paragraphBox(paragraph)),
      sourceLang: 'ja',
      targetLang: language,
      writingDirection: paragraph.direction,
      alignment: paragraph.alignment,
      lines,
    };
  });
}

/**
 * Every setting the renderer reads, so the preview is redrawn for exactly
 * those. Written against the type, as the render cache's own list is: a field
 * added to `RenderOptions` fails the build until it is listed here too.
 */
const DRAWN = Object.keys({
  fontFamily: 0,
  fontWeight: 0,
  textColor: 0,
  outlineColor: 0,
  fillColor: 0,
  drawBackground: 0,
  patchPadding: 0,
  verticalText: 0,
  minReadablePx: 0,
  supersample: 0,
  maxCanvasSide: 0,
  mangaMinPx: 0,
  mangaMode: 0,
  mangaBoxGrowth: 0,
  outlineScale: 0,
  eraseMode: 0,
  hullPadding: 0,
  reflowHorizontal: 0,
  bubbleShape: 0,
  fitToBox: 0,
  lineSpacing: 0,
  textAlign: 0,
} satisfies Record<keyof RenderOptions, 0>) as Array<keyof RenderOptions>;

/** What the preview is drawn from: the renderer's options and the two the window adds. */
export type PreviewOptions = RenderOptions & { targetLang: string; coverOpacity: number };

/**
 * Everything that decides what the preview looks like, as one string: two
 * calls that agree would draw the same picture, so the second is not drawn.
 *
 * The width is in it because the readable-size floor is measured in displayed
 * pixels - the same sample drawn for a narrower display asks for larger type.
 */
export function previewSignature(settings: PreviewOptions, displayedWidth: number): string {
  const parts = DRAWN.map((name) => `${name}=${String(settings[name])}`);
  parts.push(`lang=${sampleLanguage(settings.targetLang)}`);
  parts.push(`opacity=${settings.coverOpacity}`);
  parts.push(`w=${Math.round(displayedWidth)}`);
  return parts.join('\u0001');
}
