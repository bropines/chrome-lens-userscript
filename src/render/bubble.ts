import { MAX_FONT_SIZE, MIN_FONT_SIZE } from './layout.js';
import type { Rect } from './layout.js';
import type { ReflowMode } from '../types.js';

/**
 * A speech bubble as a text area: whether a paragraph is one, what shape it
 * has, and the largest type that shape holds.
 *
 * Lens reports a bubble as a column of short lines, and each line box hugs two
 * or three words. A translation is longer than that per line, so fitting it
 * line by line shrinks it, the readable-size floor puts the size back, and the
 * lines - still pinned to boxes a pitch apart - land on top of each other.
 * The bubble was never a transcript of where the source broke its lines; it is
 * one area, and its outline is in the picture.
 *
 * Everything here is arithmetic on numbers handed in - rectangles, a pixel
 * array, a measuring function - so it runs without a page.
 */

// ---------------------------------------------------------------- decision

/**
 * `reflowHorizontal` as it is now, from whatever was stored or passed.
 *
 * It was a switch. A profile that had it on must stay on, and one that had
 * turned it off said no and is not asked again. Anything else is the default.
 */
export function reflowMode(value: unknown): ReflowMode {
  if (value === true || value === 'on') return 'on';
  if (value === false || value === 'off') return 'off';
  return 'auto';
}

/** A bubble is "several" lines; fewer is a caption, a button, a headline. */
export const COLUMN_MIN_LINES = 3;
/**
 * A line's width in line heights. A dozen is two to four words, which is what
 * a bubble's line holds; body text in a screenshot runs to thirty and more.
 */
export const COLUMN_MAX_LINE_ASPECT = 12;
/**
 * The paragraph's width over its height. Three lines of a dozen heights each
 * come to about 3.6, and that is a strip, not a column; the six bubbles this
 * was tuned against lie between 0.55 and 1.75.
 *
 * Four lines or more may be wider. A page of wide Western bubbles - four and
 * five lines of hand-lettered English - came in at 2.69 and 2.73 and was drawn
 * line by line, each line raised to the floor and written through the next. A
 * centred three-line banner sits at about 3, so the wider limit is earned by
 * the line count rather than given to every stack.
 */
export const COLUMN_MAX_ASPECT = 2.5;
export const COLUMN_MAX_ASPECT_TALL = 3.2;
export const COLUMN_TALL_LINES = 4;
/**
 * How far a line's centre may sit from the column's, as a share of the
 * paragraph's width. Bubble lines measured within 0.04 of each other;
 * left-aligned text with one short last line is off by 0.25 or more, which is
 * the case this exists to refuse.
 */
export const COLUMN_MAX_OFF_CENTRE = 0.15;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
};

/**
 * Whether these line boxes are a bubble's column: several short lines, stacked
 * and centred on one axis.
 *
 * Geometry alone, on purpose - it has to be decided before anything is drawn
 * and without another request. It is also only half of the decision: a column
 * whose translation fits line by line is left as Chromium lays it out.
 */
export function isBubbleColumn(lines: Rect[], paragraph: Rect, minLines = COLUMN_MIN_LINES): boolean {
  if (lines.length < Math.max(2, minLines)) return false;
  const paraW = paragraph.right - paragraph.left;
  const paraH = paragraph.bottom - paragraph.top;
  const maxAspect = lines.length >= COLUMN_TALL_LINES ? COLUMN_MAX_ASPECT_TALL : COLUMN_MAX_ASPECT;
  if (!(paraW > 0) || !(paraH > 0) || paraW > maxAspect * paraH) return false;

  const sorted = [...lines].sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
  for (let i = 1; i < sorted.length; i += 1) {
    const above = sorted[i - 1] as Rect;
    // Two boxes side by side are a table row, not a stack.
    if ((sorted[i] as Rect).top < (above.top + above.bottom) / 2) return false;
  }

  const aspects = sorted.map((line) => (line.right - line.left) / Math.max(1, line.bottom - line.top));
  if (median(aspects) > COLUMN_MAX_LINE_ASPECT) return false;

  const centres = sorted.map((line) => (line.left + line.right) / 2);
  const axis = median(centres);
  return centres.every((centre) => Math.abs(centre - axis) <= COLUMN_MAX_OFF_CENTRE * paraW);
}

/**
 * Whether laying the translation out line by line is about to go wrong.
 *
 * `fitted` is the size each line gets in its own box. A fitted line is inside
 * its box by construction, so lines can only collide once the readable-size
 * floor raises one past what its box holds - "below the floor" and "will
 * overlap its neighbour" are the same event seen from two sides, and the first
 * is the one that can be read off before drawing. With the floor off nothing
 * is ever raised, and there is nothing to rescue.
 */
export function crowdsAtFloor(fitted: number[], floor: number): boolean {
  return floor > 0 && fitted.some((size) => size < floor);
}

// -------------------------------------------------------------------- mask

export interface Pixels {
  /** RGBA, row by row, as `ImageData.data`. */
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** Which edges of the search window are there only because the search had to stop somewhere. */
export interface Sides {
  left: boolean;
  top: boolean;
  right: boolean;
  bottom: boolean;
}

/** One span per row: `left[y] <= x < right[y]` for `top <= y < bottom`. */
export interface Mask {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: Int32Array;
  right: Int32Array;
}

/**
 * How far a channel may sit from the bubble's colour and still be the bubble.
 *
 * Wide enough for what lossy compression does to a flat fill (a handful of
 * levels) and for a faint gradient; narrow enough that a glyph's anti-aliased
 * edge and a one-pixel outline averaged down to an eighth of its darkness are
 * both on the other side of it. Compared with the bubble's colour, never with
 * the neighbouring pixel, so a gradient cannot walk the fill out of the bubble
 * a level at a time.
 */
export const BG_TOLERANCE = 32;
/**
 * The least share of the line boxes that has to be the background.
 *
 * Lettering in boxes that hug it leaves well over half; text over artwork has
 * no single colour that reaches a quarter. Below this there is no bubble to
 * find.
 */
export const MIN_BG_SHARE = 0.4;
/** Rows this much narrower than the widest are a tail, and text does not go in a tail. */
export const TAIL_SHARE = 0.3;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const gridBox = (rect: Rect, width: number, height: number): Box => ({
  x0: Math.max(0, Math.min(width, Math.floor(rect.left))),
  y0: Math.max(0, Math.min(height, Math.floor(rect.top))),
  x1: Math.max(0, Math.min(width, Math.ceil(rect.right))),
  y1: Math.max(0, Math.min(height, Math.ceil(rect.bottom))),
});

/**
 * The bubble around some lines of text, read from the picture.
 *
 * The background is the commonest colour inside the line boxes - they hug the
 * glyphs, so what is not ink there is bubble. From those pixels the fill
 * spreads over everything of that colour, four-connected, and stops at the
 * outline because the outline is not that colour. `blocked` is the other
 * paragraphs: a second paragraph in the same bubble is not room.
 *
 * Null when the picture does not show a bubble:
 *   - the line boxes have no dominant colour (text over artwork);
 *   - the fill reached an `open` edge of the window, which means nothing
 *     stopped it - no outline, or a gap in one;
 *   - the result is larger than `maxArea`.
 *
 * The line boxes themselves are inside by fiat. The glyphs are holes in the
 * fill, and a shape with holes has no single span per row; and the text was
 * there, so it is certainly room.
 *
 * Each row keeps one span, chosen walking outwards from the middle line by
 * overlap with the row before, so a lobe the fill reached round a corner is
 * not offered as part of the text area.
 */
export function bubbleMask(
  pixels: Pixels,
  lines: Rect[],
  blocked: Rect[],
  open: Sides,
  maxArea = Infinity
): Mask | null {
  const { data, width, height } = pixels;
  if (width < 1 || height < 1) return null;
  const boxes = lines
    .map((line) => gridBox(line, width, height))
    .filter((box) => box.x1 > box.x0 && box.y1 > box.y0);
  if (!boxes.length) return null;

  // The commonest colour, in 16-level bins: a mode survives the glyphs being
  // nearly half the pixels, which a mean or a median does not.
  const bins = new Uint32Array(4096);
  const binOf = (i: number): number =>
    (((data[i] as number) >> 4) << 8) | (((data[i + 1] as number) >> 4) << 4) | ((data[i + 2] as number) >> 4);
  let total = 0;
  for (const box of boxes) {
    for (let y = box.y0; y < box.y1; y += 1) {
      for (let x = box.x0; x < box.x1; x += 1) {
        const bin = binOf((y * width + x) * 4);
        bins[bin] = (bins[bin] as number) + 1;
        total += 1;
      }
    }
  }
  let top = 0;
  for (let bin = 1; bin < bins.length; bin += 1) {
    if ((bins[bin] as number) > (bins[top] as number)) top = bin;
  }
  let red = 0;
  let green = 0;
  let blue = 0;
  let members = 0;
  for (const box of boxes) {
    for (let y = box.y0; y < box.y1; y += 1) {
      for (let x = box.x0; x < box.x1; x += 1) {
        const i = (y * width + x) * 4;
        if (binOf(i) !== top) continue;
        red += data[i] as number;
        green += data[i + 1] as number;
        blue += data[i + 2] as number;
        members += 1;
      }
    }
  }
  if (!members) return null;
  red /= members;
  green /= members;
  blue /= members;

  // 0: not the bubble, 1: its colour, 2: reached, 3: somebody else's paragraph.
  const state = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < state.length; p += 1, i += 4) {
    const off = Math.max(
      Math.abs((data[i] as number) - red),
      Math.abs((data[i + 1] as number) - green),
      Math.abs((data[i + 2] as number) - blue)
    );
    if (off <= BG_TOLERANCE) state[p] = 1;
  }
  for (const rect of blocked) {
    const box = gridBox(rect, width, height);
    for (let y = box.y0; y < box.y1; y += 1) state.fill(3, y * width + box.x0, y * width + box.x1);
  }

  const stack = new Int32Array(width * height);
  let depth = 0;
  let seeds = 0;
  for (const box of boxes) {
    for (let y = box.y0; y < box.y1; y += 1) {
      for (let p = y * width + box.x0; p < y * width + box.x1; p += 1) {
        if (state[p] !== 1) continue;
        state[p] = 2;
        stack[depth] = p;
        depth += 1;
        seeds += 1;
      }
    }
  }
  if (seeds < total * MIN_BG_SHARE) return null;

  while (depth > 0) {
    depth -= 1;
    const p = stack[depth] as number;
    const x = p % width;
    if (x > 0 && state[p - 1] === 1) {
      state[p - 1] = 2;
      stack[depth] = p - 1;
      depth += 1;
    }
    if (x < width - 1 && state[p + 1] === 1) {
      state[p + 1] = 2;
      stack[depth] = p + 1;
      depth += 1;
    }
    if (p >= width && state[p - width] === 1) {
      state[p - width] = 2;
      stack[depth] = p - width;
      depth += 1;
    }
    if (p + width < state.length && state[p + width] === 1) {
      state[p + width] = 2;
      stack[depth] = p + width;
      depth += 1;
    }
  }

  // An edge that is only where the search gave up must not have been reached:
  // whatever got that far was not held in by an outline.
  for (let y = 0; y < height; y += 1) {
    if (open.left && state[y * width] === 2) return null;
    if (open.right && state[y * width + width - 1] === 2) return null;
  }
  for (let x = 0; x < width; x += 1) {
    if (open.top && state[x] === 2) return null;
    if (open.bottom && state[(height - 1) * width + x] === 2) return null;
  }

  let linesTop = height;
  let linesBottom = 0;
  const thickness: number[] = [];
  for (const box of boxes) {
    for (let y = box.y0; y < box.y1; y += 1) state.fill(2, y * width + box.x0, y * width + box.x1);
    linesTop = Math.min(linesTop, box.y0);
    linesBottom = Math.max(linesBottom, box.y1);
    thickness.push(Math.min(box.x1 - box.x0, box.y1 - box.y0));
  }

  // A line box hugs its line and the lettering does not stay in it: a comma or
  // a descender crosses the row or two between one box and the next, and cuts
  // that row's span in half - which showed as lines of the translation pushed
  // to one side of a symmetrical bubble. On the rows the text stood on, a gap
  // in the fill narrower than a line is tall is ink, not outline: an outline
  // has nothing reached on its far side to be a gap between.
  const stroke = median(thickness);
  for (let y = linesTop; y < linesBottom; y += 1) {
    let reached = -1;
    for (let x = 0; x < width; x += 1) {
      if (state[y * width + x] !== 2) continue;
      if (reached >= 0 && x - reached > 1 && x - reached - 1 <= stroke) {
        // Not through another paragraph, which is marked apart from mere ink.
        let clear = true;
        for (let between = reached + 1; between < x; between += 1) {
          if (state[y * width + between] === 3) clear = false;
        }
        if (clear) state.fill(2, y * width + reached + 1, y * width + x);
      }
      reached = x;
    }
  }

  const left = new Int32Array(height).fill(-1);
  const right = new Int32Array(height).fill(-1);
  const anchor = [...boxes].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1))[boxes.length >> 1] as Box;
  const row = Math.min(height - 1, (anchor.y0 + anchor.y1) >> 1);
  const column = Math.min(width - 1, (anchor.x0 + anchor.x1) >> 1);

  let from = column;
  let to = column + 1;
  while (from > 0 && state[row * width + from - 1] === 2) from -= 1;
  while (to < width && state[row * width + to] === 2) to += 1;
  left[row] = from;
  right[row] = to;

  /** Give row `y` the run that shares the most columns with `[lo, hi)`. */
  const follow = (y: number, lo: number, hi: number): boolean => {
    let best = 0;
    let x = lo;
    // A run may begin left of the span it overlaps.
    while (x > 0 && state[y * width + x] === 2 && state[y * width + x - 1] === 2) x -= 1;
    while (x < hi) {
      if (state[y * width + x] !== 2) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < width && state[y * width + end] === 2) end += 1;
      const shared = Math.min(end, hi) - Math.max(x, lo);
      if (shared > best) {
        best = shared;
        left[y] = x;
        right[y] = end;
      }
      x = end;
    }
    return best > 0;
  };

  let first = row;
  let last = row + 1;
  for (let y = row - 1; y >= 0; y -= 1) {
    if (!follow(y, left[y + 1] as number, right[y + 1] as number)) break;
    first = y;
  }
  for (let y = row + 1; y < height; y += 1) {
    if (!follow(y, left[y - 1] as number, right[y - 1] as number)) break;
    last = y + 1;
  }

  // The tail is part of the bubble and no part of the text area: centring a
  // block on a shape that includes it pulls every line towards the speaker.
  // Never trimmed into the rows the source text stood on.
  let widest = 0;
  for (let y = first; y < last; y += 1) widest = Math.max(widest, (right[y] as number) - (left[y] as number));
  const narrow = (y: number): boolean => (right[y] as number) - (left[y] as number) < widest * TAIL_SHARE;
  while (first < linesTop && narrow(first)) first += 1;
  while (last > linesBottom && narrow(last - 1)) last -= 1;

  let area = 0;
  for (let y = first; y < last; y += 1) area += (right[y] as number) - (left[y] as number);
  if (area > maxArea) return null;

  return { width, height, top: first, bottom: last, left, right };
}

// ------------------------------------------------------------------- shape

/**
 * An area text is set in, asked the only question the wrap has for it: how
 * wide is the band between these two heights, at its narrowest.
 */
export interface Shape {
  top: number;
  bottom: number;
  /** `[left, right]` every row of `y0..y1` has in common, or null if there is none. */
  span(y0: number, y1: number): readonly [number, number] | null;
}

/** A mask as a shape, in the caller's coordinates: `x = originX + column * scaleX`. */
export function maskShape(mask: Mask, originX: number, originY: number, scaleX: number, scaleY: number): Shape {
  return {
    top: originY + mask.top * scaleY,
    bottom: originY + mask.bottom * scaleY,
    span(y0, y1) {
      const from = Math.floor((y0 - originY) / scaleY);
      const to = Math.ceil((y1 - originY) / scaleY);
      if (from < mask.top || to > mask.bottom || to <= from) return null;
      let lo = -Infinity;
      let hi = Infinity;
      for (let y = from; y < to; y += 1) {
        lo = Math.max(lo, mask.left[y] as number);
        hi = Math.min(hi, mask.right[y] as number);
      }
      return hi > lo ? [originX + lo * scaleX, originX + hi * scaleX] : null;
    },
  };
}

/** The stand-in when the picture shows no bubble: bubbles are round more often than not. */
export function ellipseShape(cx: number, cy: number, rx: number, ry: number): Shape {
  return {
    top: cy - ry,
    bottom: cy + ry,
    span(y0, y1) {
      // An ellipse is narrowest at whichever end of the band is further out.
      const reach = Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy)) / ry;
      if (!(reach < 1) || !(rx > 0)) return null;
      const half = rx * Math.sqrt(1 - reach * reach);
      return [cx - half, cx + half];
    },
  };
}

// --------------------------------------------------------------------- fit

export interface ShapedLine {
  text: string;
  /** The room this line has, margin already taken off. */
  left: number;
  right: number;
  /** Top of the line's em box. */
  y: number;
}

/**
 * Clear space kept between the text and the outline, in ems, on every side.
 * A quarter of an em is roughly the gap a letterer leaves; without it a line
 * that "fits" touches the line it is supposed to be inside.
 */
export const SHAPE_MARGIN = 0.25;

/** A line as token indices, before it is text: `from <= token < to`. */
interface Slot {
  from: number;
  to: number;
  left: number;
  right: number;
  y: number;
}

/**
 * Wrap into a shape at one size, as arithmetic on token widths.
 *
 * The block is centred vertically, so where a line's band is depends on how
 * many lines there are, and how many there are depends on the bands. Line
 * counts are tried from one upwards and the first that takes all the text
 * wins - fewer lines sit nearer the middle, where a bubble is widest.
 */
function arrange(widths: number[], gap: number, shape: Shape, size: number, spacing: number): Slot[] | null {
  const pitch = size * spacing;
  const margin = size * SHAPE_MARGIN;
  const middle = (shape.top + shape.bottom) / 2;
  const height = shape.bottom - shape.top;

  for (let count = 1; count * pitch <= height && count <= widths.length; count += 1) {
    const slots: Slot[] = [];
    let next = 0;
    const blockTop = middle - (count * pitch) / 2;
    for (let i = 0; i < count && next < widths.length; i += 1) {
      // The em box sits in the middle of its pitch.
      const y = blockTop + i * pitch + (pitch - size) / 2;
      const span = shape.span(y - margin, y + size + margin);
      if (!span) break;
      const left = span[0] + margin;
      const right = span[1] - margin;
      const from = next;
      let used = 0;
      while (next < widths.length) {
        const wider = used + (next > from ? gap : 0) + (widths[next] as number);
        if (wider > right - left) break;
        used = wider;
        next += 1;
      }
      // A band too narrow for even one token: this count cannot work.
      if (next === from) break;
      slots.push({ from, to: next, left, right, y });
    }
    if (next >= widths.length) return slots;
  }
  return null;
}

/**
 * Wrap into a shape at one size: each line as wide as its own band.
 *
 * `measure` must already be measuring at `size`. The tokens are measured one
 * by one and each finished line once more whole, because a line is not exactly
 * the sum of its words and the whole line is what gets painted. Null when the
 * text does not fit.
 */
export function layoutShaped(
  measure: (s: string) => number,
  tokens: string[],
  joiner: string,
  shape: Shape,
  size: number,
  spacing: number
): ShapedLine[] | null {
  const slots = arrange(tokens.map(measure), joiner ? measure(joiner) : 0, shape, size, spacing);
  if (!slots) return null;
  const lines: ShapedLine[] = [];
  for (const slot of slots) {
    const text = tokens.slice(slot.from, slot.to).join(joiner);
    if (measure(text) > slot.right - slot.left) return null;
    lines.push({ text, left: slot.left, right: slot.right, y: slot.y });
  }
  return lines;
}

/**
 * The largest size at which `text` fits `shape`, and the lines at that size.
 *
 * Not a binary search, though the rectangle fit is one. In a rectangle a
 * smaller font always fits if a larger one did; in a shape the bands change
 * with the line count and the breaks change with the bands, so sizes that fit
 * and sizes that do not are interleaved. A bisection lands on whichever
 * feasible size its midpoints happen to visit - on one bubble 36px or 40px
 * depending only on where the upper bound started, which made the same
 * paragraph change size with the width the picture was displayed at.
 *
 * So every size is tried, largest first - cheaply: token widths are taken once
 * at the top size and scaled, which is arithmetic, and only a size that looks
 * feasible is measured for real. That measurement is the one that counts: the
 * layout returned was wrapped with widths measured at the size it is painted
 * at, never at another. Null when not even the smallest size fits, and the
 * caller falls back to a rectangle.
 */
export function fitShaped(
  setFont: (size: number) => void,
  measure: (s: string) => number,
  text: string,
  shape: Shape,
  spacing: number,
  perCharacter = false,
  maxSize = MAX_FONT_SIZE
): { size: number; lines: ShapedLine[] } | null {
  // Breaking between characters is the language's property, as in wrapText.
  const flat = text.trim().replace(/\s+/g, ' ');
  if (!flat) return null;
  const tokens = perCharacter ? [...flat] : flat.split(' ');
  const joiner = perCharacter ? '' : ' ';

  const high = Math.max(MIN_FONT_SIZE, Math.floor(maxSize));
  setFont(high);
  const widths = tokens.map(measure);
  const gap = joiner ? measure(joiner) : 0;

  for (let size = high; size >= MIN_FONT_SIZE; size -= 1) {
    const ratio = size / high;
    if (!arrange(widths.map((width) => width * ratio), gap * ratio, shape, size, spacing)) continue;
    setFont(size);
    const lines = layoutShaped(measure, tokens, joiner, shape, size, spacing);
    if (lines) return { size, lines };
  }
  return null;
}
