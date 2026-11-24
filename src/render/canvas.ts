import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  OUTLINE_RATIO,
  ROTATED_PUNCT,
  argbToCss,
  CORNER_PUNCT,
  buildLineText,
  fitFontSize,
  fitInside,
  fitTextBlock,
  fontOf,
  isRtl,
  justification,
  rectOf,
  roomFor,
  shouldStayVertical,
  verticalRuns,
  wrapText,
  wrapsPerCharacter,
} from './layout.js';
import type { Rect } from './layout.js';
import {
  bubbleMask,
  collidesAtFloor,
  crowdsAtFloor,
  ellipseShape,
  fitShaped,
  isBubbleColumn,
  maskShape,
  reflowMode,
} from './bubble.js';
import type { Mask, Shape } from './bubble.js';
import { boxCorners, convexHull, fillHull } from './hull.js';
import type { Point } from './hull.js';
import { resets } from './edits.js';
import type { Edits, RenderOptions, TranslatedLine, TranslationBlock } from '../types.js';

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

interface DrawContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  fontFamily: string;
  fontWeight: number;
  /**
   * Smallest font size, in canvas pixels, that will still be readable once the
   * page scales this canvas down to its displayed size. Zero disables the floor.
   */
  minFontPx: number;
  /**
   * Largest font size, in canvas pixels.
   *
   * Chromium's 150 is a cap on a size in the picture's own pixels, and this
   * canvas is the picture times the supersample factor. Applying 150 to canvas
   * pixels capped a big headline at 75 natural pixels on a 2x render, and
   * silently, since the text just came out smaller than its box.
   */
  maxFontPx: number;
}

/**
 * Draw the outline behind a piece of text.
 *
 * Chromium does this with a four-offset text-shadow, because CSS has no
 * portable text stroke. Canvas does, and the difference matters: four diagonal
 * copies only read as an outline while the offset is small, and past a couple
 * of pixels they separate into four ghosts with gaps between them - which is
 * exactly what the slider exposed at its upper end.
 *
 * strokeText straddles the glyph outline, so the visible thickness is half the
 * line width; round joins keep sharp corners from spiking.
 */
function strokeThenFill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  outline: number,
  outlineColor: string | null
): void {
  if (outline <= 0 || !outlineColor) return;
  ctx.save();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = outline * 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 2;
  ctx.strokeText(text, x, y);
  ctx.restore();
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
        if (ROTATED_PUNCT.has(char)) {
          // A quarter turn clockwise about the middle of its cell, as the
          // Python renderer does for the same characters.
          ctx.save();
          ctx.translate(boxW / 2, y + em / 2);
          ctx.rotate(90 * DEG);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          strokeThenFill(ctx, char, 0, 0, outline, outlineColor);
          ctx.fillStyle = fill;
          ctx.fillText(char, 0, 0);
          ctx.restore();
          y += em;
          continue;
        }
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
function drawReflowedParagraph(
  draw: DrawContext,
  block: TranslationBlock,
  settings: RenderOptions,
  room: Rect
): void {
  const geometry = block.geometry;
  if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;

  const { ctx, width, height, fontFamily, fontWeight } = draw;
  // The detected box hugs the glyphs. A speech bubble is round and has room
  // around them, so manga mode lays out wider than the box and lets the text
  // use it - otherwise a bubble's worth of Russian wraps into a thin column.
  // The room was measured against the neighbours; fitInside then answers for
  // the picture's own edges, which a rotated box can still cross.
  const box = fitInside(
    {
      cx: (room.left + room.right) / 2,
      cy: (room.top + room.bottom) / 2,
      w: room.right - room.left,
      h: room.bottom - room.top,
      angle: geometry.angle,
    },
    width,
    height
  );
  const boxW = box.w;
  const boxH = box.h;
  const style = block.lines[0];
  if (!style) return;

  const text = block.translation.trim();
  if (!text) return;

  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(geometry.angle * DEG);
  // drawLine sets this and this did not, so an Arabic paragraph that was
  // re-wrapped was shaped and ordered as if it were English.
  ctx.direction = isRtl(block) ? 'rtl' : 'ltr';

  // The same multiple has to reach both the fit and the draw: choosing a size
  // against one spacing and then painting at another overflows the box.
  const spacing = settings.lineSpacing > 0 ? settings.lineSpacing : 1.25;

  const perCharacter = wrapsPerCharacter(block);
  const measure = (candidate: string): number => ctx.measureText(candidate).width;
  const setFont = (px: number): void => {
    ctx.font = fontOf(px, fontFamily, fontWeight);
  };

  const { size } = fitTextBlock(
    setFont,
    measure,
    (px) => px * spacing,
    text,
    boxW,
    boxH,
    perCharacter,
    draw.maxFontPx
  );

  // The readable-size floor overrides what fits, and the wrap has to be redone
  // at the size actually drawn. Wrapping for one size and painting at another
  // is what sent whole lines off the picture: every line was measured against
  // the box at a font nobody used.
  let fontSize = Math.max(size, draw.minFontPx);
  setFont(fontSize);
  let lines = wrapText(measure, text, boxW, perCharacter);

  // wrapText keeps a token that cannot be broken even when it overruns, so the
  // box is not a guarantee yet. One proportional step down makes it one.
  const widest = lines.reduce((max: number, line: string) => Math.max(max, measure(line)), 0);
  if (widest > boxW && widest > 0) {
    fontSize = Math.max(MIN_FONT_SIZE, (fontSize * boxW) / widest);
    setFont(fontSize);
    lines = wrapText(measure, text, boxW, perCharacter);
  }

  // A paragraph taller than its room is one written across the next bubble, so
  // the readable-size floor gives way here rather than the layout. Repeated,
  // because a smaller font rewraps into fewer lines and may then fit outright.
  if (settings.fitToBox) {
    for (let pass = 0; pass < 3; pass += 1) {
      const needed = lines.length * fontSize * spacing;
      if (needed <= boxH || fontSize <= MIN_FONT_SIZE) break;
      fontSize = Math.max(MIN_FONT_SIZE, (fontSize * boxH) / needed);
      setFont(fontSize);
      lines = wrapText(measure, text, boxW, perCharacter);
    }
  }

  const lineHeight = fontSize * spacing;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const fill = settings.textColor || argbToCss(style.textColor);
  // Reflowed text had no outline at all, which is why it sat unprotected on top
  // of whatever the inpainting left behind. Same four-offset shadow Chromium
  // uses per line.
  const outline = Math.max(
    0,
    Math.round(fontSize * OUTLINE_RATIO * 2 * settings.outlineScale)
  );
  const outlineColor = settings.outlineColor || argbToCss(style.bgColor);
  const justify = justification(block.alignment, isRtl(block), settings.textAlign);

  let y = -Math.min(boxH, lines.length * lineHeight) / 2;
  for (const line of lines) {
    const advance = ctx.measureText(line).width;
    const x =
      justify === 'flex-start'
        ? -boxW / 2
        : justify === 'flex-end'
          ? boxW / 2 - advance
          : -advance / 2;
    strokeThenFill(ctx, line, x, y, outline, outlineColor);
    ctx.fillStyle = fill;
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  ctx.restore();
}

/**
 * How far past the paragraph the bubble is looked for, in multiples of the
 * paragraph's longer side, on each side. The bubbles this was measured on
 * reach 0.75 of it past the box; double that, because a window that is too
 * small reads a whole bubble as a leak and costs it its shape.
 */
const WINDOW_PAD = 1.5;
/**
 * The most pixels a bubble is read at. A window larger than this is scaled
 * down first, which is what keeps the cost to a few milliseconds whatever the
 * scan's resolution; an outline two pixels wide survives a threefold
 * reduction as a line the fill still cannot cross.
 */
const MASK_PIXELS = 120_000;
/** A "bubble" over half the picture is the page, not a bubble. */
const MAX_COVER = 0.5;
/** A mask is axis-aligned, so it is only trusted for text that is too. Degrees. */
const UPRIGHT = 1;
/**
 * Re-set text may be this many times the source's line height and no more.
 * The bubble is often far larger than what was said in it, and two words blown
 * up to fill one read as shouting the source never did.
 */
const MAX_UPSCALE = 1.6;

export interface BubbleArea {
  mask: Mask;
  /** Canvas position of the mask's first column and row, and the size of one cell. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Find the bubble a paragraph stands in, from the picture's own pixels.
 *
 * Rectangles are in canvas pixels; the picture is read from `source` at its
 * natural size or below, never from the canvas, because by the time the third
 * paragraph is drawn the canvas has two translations on it.
 *
 * The window is the paragraph's box padded on every side, cut back by whatever
 * `roomFor` says is in the way: the picture's edge, and a neighbour sharing
 * the band - which is how two paragraphs in one bubble each get their own half
 * of it. An edge the padding put there is "open", and a fill that reaches one
 * was not inside anything.
 */
export function findBubble(
  source: CanvasImageSource,
  canvasScale: number,
  width: number,
  height: number,
  own: Rect,
  lines: Rect[],
  others: Rect[]
): BubbleArea | null {
  const pad = Math.max(own.right - own.left, own.bottom - own.top) * WINDOW_PAD;
  if (!(pad > 0)) return null;
  const room = roomFor(own, others, 1e6, width, height);
  const open = {
    left: own.left - pad > room.left,
    top: own.top - pad > room.top,
    right: own.right + pad < room.right,
    bottom: own.bottom + pad < room.bottom,
  };
  // In the source's pixels, whole ones.
  const sx = Math.floor(Math.max(room.left, own.left - pad) / canvasScale);
  const sy = Math.floor(Math.max(room.top, own.top - pad) / canvasScale);
  const sw = Math.ceil(Math.min(room.right, own.right + pad) / canvasScale) - sx;
  const sh = Math.ceil(Math.min(room.bottom, own.bottom + pad) / canvasScale) - sy;
  if (sw < 2 || sh < 2) return null;

  const shrink = Math.min(1, Math.sqrt(MASK_PIXELS / (sw * sh)));
  const gw = Math.max(1, Math.round(sw * shrink));
  const gh = Math.max(1, Math.round(sh * shrink));
  const scaleX = (sw / gw) * canvasScale;
  const scaleY = (sh / gh) * canvasScale;
  const x = sx * canvasScale;
  const y = sy * canvasScale;

  let pixels: ImageData;
  try {
    const scratch = document.createElement('canvas');
    scratch.width = gw;
    scratch.height = gh;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // Transparent reads back as black, and black is the one colour an outline is.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, gw, gh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, gw, gh);
    pixels = ctx.getImageData(0, 0, gw, gh);
  } catch {
    // A source that cannot be read back is one whose shape is not known.
    return null;
  }

  const toGrid = (rect: Rect, grow = 0): Rect => ({
    left: (rect.left - grow - x) / scaleX,
    right: (rect.right + grow - x) / scaleX,
    top: (rect.top - grow - y) / scaleY,
    bottom: (rect.bottom + grow - y) / scaleY,
  });
  const mask = bubbleMask(
    pixels,
    lines.map((line) => toGrid(line)),
    // The same daylight roomFor keeps between two paragraphs.
    others.map((other) => toGrid(other, 2)),
    open,
    (MAX_COVER * width * height) / (scaleX * scaleY)
  );
  return mask ? { mask, x, y, scaleX, scaleY } : null;
}

/**
 * Set a paragraph inside a shape: each line as wide as the shape is there.
 *
 * False when nothing was drawn, and the rectangle is used instead: the text
 * does not fit at any size, or it fits only below the readable-size floor and
 * the floor has been told not to yield.
 */
function drawShapedParagraph(
  draw: DrawContext,
  block: TranslationBlock,
  settings: RenderOptions,
  shape: Shape,
  frame: { x: number; y: number; angle: number }
): boolean {
  const style = block.lines[0];
  const text = block.translation.trim();
  if (!style || !text) return false;

  const { ctx, fontFamily, fontWeight } = draw;
  const spacing = settings.lineSpacing > 0 ? settings.lineSpacing : 1.25;
  const measure = (candidate: string): number => ctx.measureText(candidate).width;
  const setFont = (px: number): void => {
    ctx.font = fontOf(px, fontFamily, fontWeight);
  };

  // A line box's short side is the height of the lettering, whichever way the
  // source ran.
  const heights = block.lines
    .flatMap((line) =>
      line.geometry ? [Math.min(line.geometry.w * draw.width, line.geometry.h * draw.height)] : []
    )
    .sort((a, b) => a - b);
  const sourceSize = heights[heights.length >> 1] ?? 0;
  const ceiling =
    sourceSize > 0
      ? Math.min(draw.maxFontPx, Math.max(sourceSize * MAX_UPSCALE, draw.minFontPx))
      : draw.maxFontPx;

  ctx.save();
  ctx.translate(frame.x, frame.y);
  ctx.rotate(frame.angle * DEG);
  ctx.direction = isRtl(block) ? 'rtl' : 'ltr';

  const fit = fitShaped(setFont, measure, text, shape, spacing, wrapsPerCharacter(block), ceiling);
  // Below the floor, the floor gives way rather than the shape - the same
  // choice fitToBox makes for a rectangle, and for the same reason: text that
  // shrinks is readable, text across the outline is not.
  if (!fit || (fit.size < draw.minFontPx && !settings.fitToBox)) {
    ctx.restore();
    return false;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const fill = settings.textColor || argbToCss(style.textColor);
  const outline = Math.max(0, Math.round(fit.size * OUTLINE_RATIO * 2 * settings.outlineScale));
  const outlineColor = settings.outlineColor || argbToCss(style.bgColor);

  for (const line of fit.lines) {
    const advance = measure(line.text);
    // A bubble is centred whatever the source's alignment says; only someone
    // who asked for a side gets one.
    const x =
      settings.textAlign === 'left'
        ? line.left
        : settings.textAlign === 'right'
          ? line.right - advance
          : (line.left + line.right - advance) / 2;
    strokeThenFill(ctx, line.text, x, line.y, outline, outlineColor);
    ctx.fillStyle = fill;
    ctx.fillText(line.text, x, line.y);
  }
  ctx.restore();
  return true;
}

/**
 * Cover the whole area the source text occupied, in one shape.
 *
 * Preferred over per-line patches when the inpainting's leftovers matter more
 * than fidelity - which is the case on a page of vertical text, where the
 * residue runs as streaks the full height of a bubble.
 */
function eraseTextArea(draw: DrawContext, block: TranslationBlock, settings: RenderOptions): void {
  const { ctx, width, height } = draw;
  const points: Point[] = [];
  let thinnest = Infinity;

  for (const line of block.lines) {
    if (!line.geometry) continue;
    points.push(...boxCorners(line.geometry, width, height));
    thinnest = Math.min(thinnest, line.geometry.w * width, line.geometry.h * height);
  }
  if (points.length < 3) return;

  const style = block.lines.find((line) => line.geometry) ?? block.lines[0];
  if (!style) return;

  // Padding in line heights, so it scales with the text rather than the image.
  const pad = Number.isFinite(thinnest) ? thinnest * settings.hullPadding : 0;
  fillHull(ctx, convexHull(points), settings.fillColor || argbToCss(style.bgColor), pad);
}

/**
 * Nudge a line back inside the image.
 *
 * Text is drawn centred on its own box, so a line the readable-size floor has
 * widened near an edge runs off the canvas and is simply clipped - half a
 * sentence gone, which is what it looks like on a phone, where the image is
 * displayed narrow and the floor therefore multiplies hardest. Shifting it back
 * in is not where the source sat, but a whole sentence a few pixels off its
 * bubble beats half a sentence in exactly the right place.
 *
 * The bounds are in canvas space and the context is in the line's rotated
 * frame, so the shift is worked out in the first and rotated into the second.
 * A box too big to fit at all is aligned to the start of the line rather than
 * centred, because the half that survives should be the half you read first.
 */
function nudgeInside(draw: DrawContext, box: { w: number; h: number }, line: LineFrame): void {
  const radians = line.angle * DEG;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  // Half-extents of the rotated box, measured along the canvas axes.
  const halfW = (box.w * cos + box.h * sin) / 2;
  const halfH = (box.w * sin + box.h * cos) / 2;

  const shift = (centre: number, half: number, limit: number, fromEnd: boolean): number => {
    if (half * 2 >= limit) return fromEnd ? limit - half - centre : half - centre;
    if (centre - half < 0) return half - centre;
    if (centre + half > limit) return limit - half - centre;
    return 0;
  };

  const dx = shift(line.cx, halfW, draw.width, line.rtl);
  const dy = shift(line.cy, halfH, draw.height, false);
  if (dx === 0 && dy === 0) return;

  const c = Math.cos(radians);
  const sn = Math.sin(radians);
  draw.ctx.translate(dx * c + dy * sn, dy * c - dx * sn);
}

interface LineFrame {
  cx: number;
  cy: number;
  angle: number;
  rtl: boolean;
}

async function drawLine(
  draw: DrawContext,
  block: TranslationBlock,
  line: TranslatedLine,
  nextLine: TranslatedLine | undefined,
  settings: RenderOptions,
  backgroundOnly = false,
  skipBackground = false
): Promise<void> {
  const geometry = line.geometry;
  if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;

  const { ctx, width, height, fontFamily, fontWeight } = draw;
  const flat = settings.fillColor || argbToCss(line.bgColor);
  const boxW = geometry.w * width;
  const boxH = geometry.h * height;
  const cx = geometry.cx * width;
  const cy = geometry.cy * height;
  const patch = settings.drawBackground && !skipBackground ? line.background : null;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(geometry.angle * DEG);

  if (patch) {
    // Chromium writes these as `hPad * box.h / aspect * W` and `vPad * box.h * H`;
    // since W/aspect === H, both are a fraction of the line's height in pixels.
    //
    // It is tempting to "fix" this for vertical columns, where the height is the
    // long axis rather than the thickness. Measured against a live response, the
    // server already adapts: a vertical line comes back with paddings around
    // 0.05 where a horizontal one gets 0.41, and the formula as written yields a
    // sane patch. Deriving the padding from the thickness instead under-covers
    // the text by roughly sevenfold.
    //
    // `patchPadding` scales the result and is 1 unless someone asked: the
    // formula above is the server's contract and stays as written.
    const padW = patch.hPad * boxH * settings.patchPadding;
    const padH = patch.vPad * boxH * settings.patchPadding;
    try {
      const bitmap = await createImageBitmap(new Blob([patch.bytes], { type: 'image/webp' }));
      ctx.drawImage(bitmap, -(boxW + padW) / 2, -(boxH + padH) / 2, boxW + padW, boxH + padH);
      bitmap.close();
    } catch {
      // Fall back to a flat fill if the patch will not decode.
      ctx.fillStyle = flat;
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    }
  } else if (settings.drawBackground && !skipBackground) {
    ctx.fillStyle = flat;
    ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  }

  const text = backgroundOnly ? '' : buildLineText(block.translation, line, nextLine);
  if (text.trim()) {
    const vertical = shouldStayVertical(block, settings.verticalText);
    const fitted = fitFontSize(
      text,
      vertical ? boxH : boxW,
      vertical ? boxW : boxH,
      fontFamily,
      draw.maxFontPx,
      fontWeight
    );
    // Lens sizes text to the original line box, so fine print on a large image
    // comes back at a few pixels once the page scales the image down. Raising
    // it past the box is the only way to make it legible; lines can then
    // overlap, which is why the floor is a setting.
    const size = Math.max(fitted, draw.minFontPx);
    ctx.font = fontOf(size, fontFamily, fontWeight);
    ctx.direction = isRtl(block) ? 'rtl' : 'ltr';

    const fill = settings.textColor || argbToCss(line.textColor);
    const outline = patch
      ? Math.max(1, Math.round(size * OUTLINE_RATIO * settings.outlineScale))
      : 0;
    const outlineColor = patch ? settings.outlineColor || argbToCss(line.bgColor) : null;

    // When the readable-size floor pushes the font past its box, the text needs
    // room the box does not have. Sizing that room by the *ratio* is what
    // painted bars across the page: a vertical column fitted at 3px and floored
    // at 24px grows eightfold, turning a 27x264 box into a 216x2112 rectangle on
    // a 760x560 image. Measure the text instead - it cannot run away.
    const enlarged = size > fitted;
    const advance = ctx.measureText(text).width;
    const drawW = enlarged ? Math.min(Math.max(boxW, advance + size * 0.4), width) : boxW;
    const drawH = enlarged ? Math.min(Math.max(boxH, size * 1.35), height) : boxH;
    // Before anything is painted, so the enlarged background travels with the
    // text it belongs to. The inpainted patch above stays put: it erases the
    // original, which has not moved.
    nudgeInside(draw, { w: drawW, h: drawH }, { cx, cy, angle: geometry.angle, rtl: isRtl(block) });
    if (enlarged && settings.drawBackground && !skipBackground) {
      ctx.fillStyle = flat;
      ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
    }

    ctx.translate(-drawW / 2, -drawH / 2);
    if (vertical) {
      drawVertical(draw, text, drawW, drawH, size, fill, outline, outlineColor);
    } else {
      const justify = justification(block.alignment, isRtl(block), settings.textAlign);
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
 *
 * `edits` are a person's corrections by paragraph (`render/edits.ts`). The
 * neighbours and the room are still measured from the answer as it came, so
 * correcting one paragraph does not move another.
 */
export async function renderToBlob(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  blocks: TranslationBlock[],
  settings: RenderOptions,
  displayedWidth = naturalWidth,
  edits?: Edits
): Promise<Blob> {
  // Supersampling: the canvas replaces the image, so rendering above natural
  // size is what keeps text sharp when the reader zooms in or opens it full
  // size. Capped so a large photo does not turn into a huge bitmap.
  const scale = Math.min(
    Math.max(1, Math.round(settings.supersample)),
    Math.max(1, Math.floor(settings.maxCanvasSide / Math.max(naturalWidth, naturalHeight)))
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
  // Manga is read at a glance; a floor that is fine for a shop sign is not.
  const floorCssPx = settings.mangaMode
    ? Math.max(settings.minReadablePx, settings.mangaMinPx)
    : settings.minReadablePx;
  const draw: DrawContext = {
    ctx,
    width,
    height,
    fontFamily,
    fontWeight: settings.fontWeight,
    minFontPx: floorCssPx > 0 ? floorCssPx * canvasPerCssPx : 0,
    maxFontPx: MAX_FONT_SIZE * scale,
  };

  const boxes = blocks.map((block) =>
    block.geometry ? rectOf(block.geometry, width, height) : null
  );
  const growth = settings.mangaMode ? Math.max(1, settings.mangaBoxGrowth) : 1;
  const mode = reflowMode(settings.reflowHorizontal);
  const base = settings;

  for (const [index, answered] of blocks.entries()) {
    const edit = edits?.[index];
    // Left as the picture has it: nothing erased, nothing written.
    if (edit?.original) continue;
    const block = edit?.text !== undefined ? { ...answered, translation: edit.text } : answered;
    const settings: RenderOptions =
      edit?.color || edit?.outline
        ? { ...base, textColor: edit.color || base.textColor, outlineColor: edit.outline || base.outlineColor }
        : base;
    // Set anew: the text is drawn apart from the patches, which stay put.
    const reset = resets(edit) && Boolean(block.geometry);
    const vertical = block.writingDirection === 2;
    // Manga mode never leaves a column standing: that is the whole point of it.
    const stayVertical =
      !settings.mangaMode && shouldStayVertical(block, settings.verticalText);
    // Manga mode implies hull erasing; the residue is the reason it exists.
    const hull = settings.drawBackground && (settings.eraseMode === 'hull' || settings.mangaMode);
    if (hull) eraseTextArea(draw, block, settings);
    if (edit?.hidden) {
      // Erased and left empty: the patches without the words.
      if (!hull) {
        for (const line of block.lines) await drawLine(draw, block, line, undefined, settings, true);
      }
      continue;
    }
    // Erase the source either way; only the text placement changes.
    //
    // A vertical column has to be re-wrapped or the translation cannot be set
    // in it at all. A horizontal paragraph does not have to be, and Chromium
    // never is - but keeping the server's lines is also what leaves the spacing
    // between them out of anyone's hands, so it is a setting.
    let reflow = reset || (Boolean(block.geometry) && !stayVertical && (vertical || mode === 'on'));
    // Manga mode says the page is bubbles; otherwise the paragraph has to.
    let bubble = settings.mangaMode;
    const own = boxes[index];
    const lineRects = block.lines.flatMap((line) =>
      line.geometry ? [rectOf(line.geometry, width, height)] : []
    );
    // A column of short centred lines whose translation only reaches a
    // readable size by leaving its boxes is a bubble being read as a list.
    // Two-line bubbles are common and so are two-line captions; only manga
    // mode knows which this page has.
    if (!reflow && !vertical && mode === 'auto' && own && lineRects.length >= 2 && draw.minFontPx > 0) {
      // Index for index with lineRects; a line with no text to draw cannot be
      // raised past anything, so it counts as fitting exactly.
      const fitted: number[] = [];
      const rects: Rect[] = [];
      for (const [i, line] of block.lines.entries()) {
        if (!line.geometry) continue;
        const text = buildLineText(block.translation, line, block.lines[i + 1]);
        rects.push(rectOf(line.geometry, width, height));
        fitted.push(
          text.trim()
            ? fitFontSize(
                text,
                line.geometry.w * width,
                line.geometry.h * height,
                fontFamily,
                draw.maxFontPx,
                settings.fontWeight
              )
            : draw.minFontPx
        );
      }
      if (isBubbleColumn(lineRects, own, settings.mangaMode ? 2 : undefined)) {
        reflow = bubble = crowdsAtFloor(fitted, draw.minFontPx);
      } else if (collidesAtFloor(rects, fitted, draw.minFontPx)) {
        reflow = true;
      }
    }

    for (let i = 0; i < block.lines.length; i += 1) {
      const line = block.lines[i];
      if (!line) continue;
      // With a hull already painted, the per-line patches would only put the
      // residue back.
      if (reflow) {
        if (!hull) await drawLine(draw, block, line, block.lines[i + 1], settings, true);
      } else await drawLine(draw, block, line, block.lines[i + 1], settings, false, hull);
    }
    // Moved and resized as a whole, about the paragraph's own centre - the
    // room and the bubble are still found where the source was.
    const shifted = reset && own && (edit?.scale !== undefined || edit?.dx || edit?.dy);
    if (shifted && own) {
      const cx = (own.left + own.right) / 2;
      const cy = (own.top + own.bottom) / 2;
      const scaleBy = edit?.scale ?? 1;
      ctx.save();
      ctx.translate(cx + (edit?.dx ?? 0) * width, cy + (edit?.dy ?? 0) * height);
      ctx.scale(scaleBy, scaleBy);
      ctx.translate(-cx, -cy);
    }
    if (reflow && own && block.geometry) {
      const others = boxes.filter((rect, at): rect is Rect => rect !== null && at !== index);
      let shaped = false;
      if (settings.bubbleShape) {
        const angle = block.geometry.angle;
        const found =
          Math.abs(angle) <= UPRIGHT
            ? findBubble(source, scale, width, height, own, lineRects, others)
            : null;
        if (found) {
          const shape = maskShape(found.mask, found.x, found.y, found.scaleX, found.scaleY);
          shaped = drawShapedParagraph(draw, block, settings, shape, { x: 0, y: 0, angle: 0 });
        } else if (bubble) {
          // No outline to be found, but a bubble all the same. The smallest
          // ellipse that still contains a box is the box grown by the square
          // root of two, so that much room is the least a bubble round this
          // text can have - and the neighbours still cap it.
          const room = roomFor(own, others, Math.max(growth, Math.SQRT2), width, height);
          const box = fitInside(
            {
              cx: (room.left + room.right) / 2,
              cy: (room.top + room.bottom) / 2,
              w: room.right - room.left,
              h: room.bottom - room.top,
              angle,
            },
            width,
            height
          );
          shaped = drawShapedParagraph(
            draw,
            block,
            settings,
            ellipseShape(0, 0, box.w / 2, box.h / 2),
            { x: box.cx, y: box.cy, angle }
          );
        }
      }
      if (!shaped) {
        drawReflowedParagraph(draw, block, settings, roomFor(own, others, growth, width, height));
      }
    }
    if (shifted) ctx.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the translated image');
  return blob;
}
