import {
  MIN_FONT_SIZE,
  OUTLINE_RATIO,
  argbToCss,
  buildLineText,
  fitFontSize,
  fitTextBlock,
  isRtl,
  justification,
  shouldStayVertical,
  wrapText,
  wrapsPerCharacter,
} from './layout.js';
import { boxCorners, convexHull, fillHull } from './hull.js';
import type { Point } from './hull.js';
import type { Geometry, Settings, TranslatedLine, TranslationBlock } from '../types.js';

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
function fitInside(
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

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const rectOf = (geometry: Geometry, width: number, height: number): Rect => ({
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
function roomFor(own: Rect, others: Rect[], growth: number, width: number, height: number): Rect {
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

function drawReflowedParagraph(
  draw: DrawContext,
  block: TranslationBlock,
  settings: Settings,
  room: Rect
): void {
  const geometry = block.geometry;
  if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;

  const { ctx, width, height, fontFamily } = draw;
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

  // The same multiple has to reach both the fit and the draw: choosing a size
  // against one spacing and then painting at another overflows the box.
  const spacing = settings.lineSpacing > 0 ? settings.lineSpacing : 1.25;

  const perCharacter = wrapsPerCharacter(block);
  const measure = (candidate: string): number => ctx.measureText(candidate).width;
  const setFont = (px: number): void => {
    ctx.font = `${px}px ${fontFamily}`;
  };

  const { size } = fitTextBlock(setFont, measure, (px) => px * spacing, text, boxW, boxH, perCharacter);

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

  const fill = argbToCss(style.textColor);
  // Reflowed text had no outline at all, which is why it sat unprotected on top
  // of whatever the inpainting left behind. Same four-offset shadow Chromium
  // uses per line.
  const outline = Math.max(
    0,
    Math.round(fontSize * OUTLINE_RATIO * 2 * settings.outlineScale)
  );
  const outlineColor = argbToCss(style.bgColor);
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
 * Cover the whole area the source text occupied, in one shape.
 *
 * Preferred over per-line patches when the inpainting's leftovers matter more
 * than fidelity - which is the case on a page of vertical text, where the
 * residue runs as streaks the full height of a bubble.
 */
function eraseTextArea(draw: DrawContext, block: TranslationBlock, settings: Settings): void {
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
  fillHull(ctx, convexHull(points), argbToCss(style.bgColor), pad);
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
  settings: Settings,
  backgroundOnly = false,
  skipBackground = false
): Promise<void> {
  const geometry = line.geometry;
  if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;

  const { ctx, width, height, fontFamily } = draw;
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
    const padW = patch.hPad * boxH;
    const padH = patch.vPad * boxH;
    try {
      const bitmap = await createImageBitmap(new Blob([patch.bytes], { type: 'image/webp' }));
      ctx.drawImage(bitmap, -(boxW + padW) / 2, -(boxH + padH) / 2, boxW + padW, boxH + padH);
      bitmap.close();
    } catch {
      // Fall back to a flat fill if the patch will not decode.
      ctx.fillStyle = argbToCss(line.bgColor);
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    }
  } else if (settings.drawBackground && !skipBackground) {
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
    const outline = patch
      ? Math.max(1, Math.round(size * OUTLINE_RATIO * settings.outlineScale))
      : 0;
    const outlineColor = patch ? argbToCss(line.bgColor) : null;

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
      ctx.fillStyle = argbToCss(line.bgColor);
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
  // Manga is read at a glance; a floor that is fine for a shop sign is not.
  const floorCssPx = settings.mangaMode
    ? Math.max(settings.minReadablePx, 14)
    : settings.minReadablePx;
  const draw: DrawContext = {
    ctx,
    width,
    height,
    fontFamily,
    minFontPx: floorCssPx > 0 ? floorCssPx * canvasPerCssPx : 0,
  };

  const boxes = blocks.map((block) =>
    block.geometry ? rectOf(block.geometry, width, height) : null
  );
  const growth = settings.mangaMode ? Math.max(1, settings.mangaBoxGrowth) : 1;

  for (const [index, block] of blocks.entries()) {
    const vertical = block.writingDirection === 2;
    // Manga mode never leaves a column standing: that is the whole point of it.
    const stayVertical =
      !settings.mangaMode && shouldStayVertical(block, settings.verticalText);
    // Manga mode implies hull erasing; the residue is the reason it exists.
    const hull = settings.drawBackground && (settings.eraseMode === 'hull' || settings.mangaMode);
    if (hull) eraseTextArea(draw, block, settings);
    // Erase the source either way; only the text placement changes.
    //
    // A vertical column has to be re-wrapped or the translation cannot be set
    // in it at all. A horizontal paragraph does not have to be, and Chromium
    // never is - but keeping the server's lines is also what leaves the spacing
    // between them out of anyone's hands, so it is a setting.
    const reflow =
      Boolean(block.geometry) && !stayVertical && (vertical || settings.reflowHorizontal);

    for (let i = 0; i < block.lines.length; i += 1) {
      const line = block.lines[i];
      if (!line) continue;
      // With a hull already painted, the per-line patches would only put the
      // residue back.
      if (reflow) {
        if (!hull) await drawLine(draw, block, line, block.lines[i + 1], settings, true);
      } else await drawLine(draw, block, line, block.lines[i + 1], settings, false, hull);
    }
    if (reflow) {
      const own = boxes[index];
      if (own) {
        const others = boxes.filter((rect, at): rect is Rect => rect !== null && at !== index);
        drawReflowedParagraph(draw, block, settings, roomFor(own, others, growth, width, height));
      }
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the translated image');
  return blob;
}
