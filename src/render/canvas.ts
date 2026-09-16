import {
  OUTLINE_RATIO,
  argbToCss,
  buildLineText,
  fitFontSize,
  fitTextBlock,
  isRtl,
  justification,
  shouldStayVertical,
} from './layout.js';
import type { Settings, TranslatedLine, TranslationBlock } from '../types.js';

/**
 * Bake the translation into a bitmap that replaces the image.
 *
 * The floating-overlay approach is faithful to Chromium and keeps text crisp,
 * but it only holds while the page stands still. On a virtualised feed the
 * <img> elements are recycled and moved constantly, and a separately positioned
 * layer drifts off them - which is exactly the smear this fixes.
 *
 * Painting into the image itself has nothing left to synchronise: it scrolls,
 * reflows and zooms with the page because it *is* the page.
 */

const DEG = Math.PI / 180;

/** Ranges CSS text-orientation: mixed keeps upright in vertical writing. */
const UPRIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], [0x2e80, 0x303f], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xfe10, 0xfe4f],
  [0xff00, 0xff60], [0xffe0, 0xffe6],
];

const isUpright = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return UPRIGHT_RANGES.some(([low, high]) => code >= low && code <= high);
};

/** Small punctuation hangs in the upper right of its em square. */
const CORNER_PUNCT = new Set('、。，．');

function verticalRuns(text: string): Array<[boolean, string]> {
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

interface DrawContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  fontFamily: string;
  /**
   * Smallest font size, in canvas pixels, that will still be readable once the
   * page scales this canvas down to its displayed size. Zero disables the floor.
   */
  minFontPx: number;
}

function strokeThenFill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  outline: number,
  outlineColor: string | null
): void {
  if (outline && outlineColor) {
    ctx.fillStyle = outlineColor;
    for (const [dx, dy] of [
      [-outline, outline], [outline, outline], [outline, -outline], [-outline, -outline],
    ] as const) {
      ctx.fillText(text, x + dx, y + dy);
    }
  }
}

function drawVertical(
  { ctx }: DrawContext,
  text: string,
  boxW: number,
  boxH: number,
  size: number,
  fill: string,
  outline: number,
  outlineColor: string | null
): void {
  const em = size * 1.16; // approximates ascent + descent for CJK faces
  let total = 0;
  for (const [upright, run] of verticalRuns(text)) {
    total += upright ? em * [...run].length : ctx.measureText(run).width;
  }

  let y = (boxH - total) / 2;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  for (const [upright, run] of verticalRuns(text)) {
    if (upright) {
      for (const char of run) {
        const advance = ctx.measureText(char).width;
        // Kuten and touten sit in the upper right rather than centred.
        const corner = CORNER_PUNCT.has(char);
        const x = (boxW - advance) / 2 + (corner ? advance * 0.45 : 0);
        const cy = y - (corner ? em * 0.4 : 0);
        strokeThenFill(ctx, char, x, cy, outline, outlineColor);
        ctx.fillStyle = fill;
        ctx.fillText(char, x, cy);
        y += em;
      }
    } else {
      // Latin runs lie on their side, rotated a quarter turn clockwise.
      const advance = ctx.measureText(run).width;
      ctx.save();
      ctx.translate(boxW / 2, y);
      ctx.rotate(90 * DEG);
      strokeThenFill(ctx, run, 0, -size / 2, outline, outlineColor);
      ctx.fillStyle = fill;
      ctx.fillText(run, 0, -size / 2);
      ctx.restore();
      y += advance;
    }
  }
}

/**
 * Lay a whole paragraph out horizontally inside its own box.
 *
 * A vertical source line box is a tall narrow column, which horizontal text
 * cannot sensibly occupy - fitting text to it yields something unreadable. When
 * the translation is not itself going to be set vertically, the paragraph box
 * becomes one text area and the text is re-wrapped into it.
 */
function drawReflowedParagraph(draw: DrawContext, block: TranslationBlock): void {
  const geometry = block.geometry;
  if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;

  const { ctx, width, height, fontFamily } = draw;
  const boxW = geometry.w * width;
  const boxH = geometry.h * height;
  const style = block.lines[0];
  if (!style) return;

  const text = block.translation.trim();
  if (!text) return;

  ctx.save();
  ctx.translate(geometry.cx * width, geometry.cy * height);
  ctx.rotate(geometry.angle * DEG);

  const { size, lines } = fitTextBlock(
    (px) => {
      ctx.font = `${px}px ${fontFamily}`;
    },
    (candidate) => ctx.measureText(candidate).width,
    (px) => px * 1.25,
    text,
    boxW,
    boxH
  );
  const fontSize = Math.max(size, draw.minFontPx);
  ctx.font = `${fontSize}px ${fontFamily}`;
  const lineHeight = fontSize * 1.25;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = argbToCss(style.textColor);

  let y = -Math.min(boxH, lines.length * lineHeight) / 2;
  for (const line of lines) {
    const advance = ctx.measureText(line).width;
    const justify = justification(block.alignment, isRtl(block));
    const x =
      justify === 'flex-start'
        ? -boxW / 2
        : justify === 'flex-end'
          ? boxW / 2 - advance
          : -advance / 2;
    ctx.fillStyle = argbToCss(style.textColor);
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  ctx.restore();
}

async function drawLine(
  draw: DrawContext,
  block: TranslationBlock,
  line: TranslatedLine,
  nextLine: TranslatedLine | undefined,
  settings: Settings,
  backgroundOnly = false
): Promise<void> {
  const geometry = line.geometry;
  if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;

  const { ctx, width, height, fontFamily } = draw;
  const boxW = geometry.w * width;
  const boxH = geometry.h * height;
  const cx = geometry.cx * width;
  const cy = geometry.cy * height;
  const patch = settings.drawBackground ? line.background : null;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(geometry.angle * DEG);

  if (patch) {
    // Chromium writes these as `hPad * box.h / aspect * W` and `vPad * box.h * H`,
    // and since W/aspect === H both reduce to a fraction of the line's height
    // *in pixels*. That works because a horizontal line's height is its
    // thickness - which stops being true for a vertical column, where the
    // thickness is the width. Using the wrong axis there inflated the patch
    // over sevenfold and painted black bars across the page.
    const thickness = Math.min(boxW, boxH);
    const padW = patch.hPad * thickness;
    const padH = patch.vPad * thickness;
    try {
      const bitmap = await createImageBitmap(new Blob([patch.bytes], { type: 'image/webp' }));
      ctx.drawImage(bitmap, -(boxW + padW) / 2, -(boxH + padH) / 2, boxW + padW, boxH + padH);
      bitmap.close();
    } catch {
      // Fall back to a flat fill if the patch will not decode.
      ctx.fillStyle = argbToCss(line.bgColor);
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    }
  } else if (settings.drawBackground) {
    ctx.fillStyle = argbToCss(line.bgColor);
    ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  }

  const text = backgroundOnly ? '' : buildLineText(block.translation, line, nextLine);
  if (text.trim()) {
    const vertical = shouldStayVertical(block, settings.verticalText);
    const fitted = fitFontSize(text, vertical ? boxH : boxW, vertical ? boxW : boxH, fontFamily);
    // Lens sizes text to the original line box, so fine print on a large image
    // comes back at a few pixels once the page scales the image down. Raising
    // it past the box is the only way to make it legible; lines can then
    // overlap, which is why the floor is a setting.
    const size = Math.max(fitted, draw.minFontPx);
    ctx.font = `${size}px ${fontFamily}`;
    ctx.direction = isRtl(block) ? 'rtl' : 'ltr';

    const fill = argbToCss(line.textColor);
    const outline = patch ? Math.max(1, Math.round(size * OUTLINE_RATIO)) : 0;
    const outlineColor = patch ? argbToCss(line.bgColor) : null;

    // When the text was enlarged past its box, give it the room it now needs
    // so the background still covers it.
    const grow = size / Math.max(1, fitted);
    const drawW = grow > 1 ? boxW * grow : boxW;
    const drawH = grow > 1 ? boxH * grow : boxH;
    if (grow > 1 && settings.drawBackground) {
      ctx.fillStyle = argbToCss(line.bgColor);
      ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
    }

    ctx.translate(-drawW / 2, -drawH / 2);
    if (vertical) {
      drawVertical(draw, text, drawW, drawH, size, fill, outline, outlineColor);
    } else {
      const justify = justification(block.alignment, isRtl(block));
      const advance = ctx.measureText(text).width;
      const x =
        justify === 'flex-start'
          ? 0
          : justify === 'flex-end'
            ? drawW - advance
            : (drawW - advance) / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      strokeThenFill(ctx, text, x, drawH / 2, outline, outlineColor);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, drawH / 2);
    }
  }
  ctx.restore();
}

/**
 * Paint `source` plus its translation onto a canvas and return it as a blob.
 *
 * A blob rather than an object URL, so the cache can hold it without owning a
 * URL whose lifetime is tied to whichever overlay happens to be showing.
 *
 * `source` is whatever was already decoded for the upload, so a cross-origin
 * image that tainted the element's own canvas still works here.
 */
export async function renderToBlob(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  blocks: TranslationBlock[],
  settings: Settings,
  displayedWidth = naturalWidth
): Promise<Blob> {
  // Supersampling: the canvas replaces the image, so rendering above natural
  // size is what keeps text sharp when the reader zooms in or opens it full
  // size. Capped so a large photo does not turn into a huge bitmap.
  const scale = Math.min(
    Math.max(1, Math.round(settings.supersample)),
    Math.max(1, Math.floor(8000 / Math.max(naturalWidth, naturalHeight)))
  );
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2d canvas context');

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);

  const fontFamily = settings.fontFamily || 'system-ui, -apple-system, sans-serif';
  // One displayed CSS pixel is this many canvas pixels.
  const canvasPerCssPx = width / Math.max(1, displayedWidth);
  const draw: DrawContext = {
    ctx,
    width,
    height,
    fontFamily,
    minFontPx: settings.minReadablePx > 0 ? settings.minReadablePx * canvasPerCssPx : 0,
  };

  for (const block of blocks) {
    const vertical = block.writingDirection === 2;
    const stayVertical = shouldStayVertical(block, settings.verticalText);
    // Erase the source either way; only the text placement changes.
    const reflow = vertical && !stayVertical && Boolean(block.geometry);

    for (let i = 0; i < block.lines.length; i += 1) {
      const line = block.lines[i];
      if (!line) continue;
      if (reflow) await drawLine(draw, block, line, block.lines[i + 1], settings, true);
      else await drawLine(draw, block, line, block.lines[i + 1], settings);
    }
    if (reflow) drawReflowedParagraph(draw, block);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the translated image');
  return blob;
}
