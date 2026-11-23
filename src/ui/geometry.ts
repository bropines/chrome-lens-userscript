import type { DetectedObject, Geometry, NormalizedBox } from '../types.js';

/**
 * Where a picture is on screen, and what a finger did on top of it.
 *
 * Lens speaks in fractions of the picture: a region to search is a box in
 * 0..1, and so is every object and word it reports. The screen speaks in
 * pixels of an element whose box is usually not the picture - `object-fit`
 * letterboxes it, `cover` crops it, a border and padding sit around it. All
 * of the arithmetic between the two is here, and none of it touches the DOM,
 * so it can be checked with numbers.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * One component of a computed `object-position`, as a fraction of free space.
 *
 * A computed value is a percentage or a length; `free` is the room left over
 * on that axis, which is what a percentage is a percentage of. When there is
 * no room the answer cannot matter, and dividing by it would be NaN.
 */
function positionFraction(component: string | undefined, free: number): number {
  const value = Number.parseFloat(component ?? '');
  if (!Number.isFinite(value)) return 0.5;
  if ((component ?? '').trim().endsWith('%')) return value / 100;
  return free === 0 ? 0 : value / free;
}

/**
 * Where a replaced element's picture is drawn inside its content box.
 *
 * `fit` and `position` are the computed `object-fit` and `object-position`.
 * The result can be larger than the box (`cover`, `none`): what overflows is
 * clipped on screen, but it is still where the picture *is*, and a fraction of
 * the picture has to be measured against all of it.
 */
export function fittedRect(box: Rect, natural: Size, fit: string, position: string): Rect {
  if (!(natural.width > 0) || !(natural.height > 0) || fit === 'fill' || fit === '') return { ...box };

  const contain = Math.min(box.width / natural.width, box.height / natural.height);
  const cover = Math.max(box.width / natural.width, box.height / natural.height);
  const scale =
    fit === 'contain' ? contain : fit === 'cover' ? cover : fit === 'scale-down' ? Math.min(1, contain) : 1;

  const width = natural.width * scale;
  const height = natural.height * scale;
  const [px, py] = position.trim().split(/\s+/);
  const freeX = box.width - width;
  const freeY = box.height - height;
  return {
    left: box.left + freeX * positionFraction(px, freeX),
    top: box.top + freeY * positionFraction(py, freeY),
    width,
    height,
  };
}

/** A border box with its border and padding taken off. */
export function insetRect(
  rect: Rect,
  edges: { top: number; right: number; bottom: number; left: number }
): Rect {
  return {
    left: rect.left + edges.left,
    top: rect.top + edges.top,
    width: Math.max(0, rect.width - edges.left - edges.right),
    height: Math.max(0, rect.height - edges.top - edges.bottom),
  };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * The smallest drag, in pixels on each side, that counts as choosing an area.
 *
 * A tap is a drag of a pixel or two, and a region that size is not a region
 * anyone meant - sent to Lens it is a search for a few pixels of nothing.
 */
export const MIN_DRAG_PX = 12;

/**
 * A drag across the screen, as a box in the picture's own proportions.
 *
 * The two points may be in any order and either may be outside the picture: a
 * finger that runs off the edge means "up to the edge". Null when what is left
 * inside the picture is too small to have been meant.
 */
export function dragToBox(from: Point, to: Point, picture: Rect): NormalizedBox | null {
  if (!(picture.width > 0) || !(picture.height > 0)) return null;
  const x0 = clamp01((Math.min(from.x, to.x) - picture.left) / picture.width);
  const x1 = clamp01((Math.max(from.x, to.x) - picture.left) / picture.width);
  const y0 = clamp01((Math.min(from.y, to.y) - picture.top) / picture.height);
  const y1 = clamp01((Math.max(from.y, to.y) - picture.top) / picture.height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w * picture.width < MIN_DRAG_PX || h * picture.height < MIN_DRAG_PX) return null;
  return { cx: x0 + w / 2, cy: y0 + h / 2, w, h };
}

/**
 * What a press on the region layer leaves chosen when it lifts.
 *
 * A drag big enough to mean something replaces the area. Anything smaller - a
 * tap, a finger that shifted a pixel - leaves the area that was there, and
 * says nothing changed: the bar under it holds a question that may already be
 * half typed, and redrawing it for a stray touch is how that question was lost.
 */
export function boxAfterRelease(
  from: Point,
  to: Point,
  picture: Rect,
  chosen: NormalizedBox | null
): { box: NormalizedBox | null; changed: boolean } {
  const dragged = dragToBox(from, to, picture);
  return dragged ? { box: dragged, changed: true } : { box: chosen, changed: false };
}

/** A box in the picture's proportions, as pixels relative to the picture's corner. */
export function boxToRect(box: NormalizedBox, picture: Size): Rect {
  return {
    left: (box.cx - box.w / 2) * picture.width,
    top: (box.cy - box.h / 2) * picture.height,
    width: box.w * picture.width,
    height: box.h * picture.height,
  };
}

/** The middle of something Lens reported, in pixels from the picture's corner. */
export function centreOf(geometry: Geometry, picture: Size): Point {
  return { x: geometry.cx * picture.width, y: geometry.cy * picture.height };
}

/**
 * How far the on-screen keyboard reaches up from the bottom of the layout.
 *
 * Android Chrome leaves the layout viewport alone when the keyboard opens and
 * shrinks only the visual one, so anything fixed to the bottom is underneath
 * it. The difference between the two is the keyboard - and also the page being
 * pinch-zoomed, which is why a zoomed page reports nothing: there the
 * difference is the zoom, and a sheet pushed up by it would leave the screen.
 */
export function keyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number; scale: number } | null | undefined
): number {
  if (!visual || Math.abs(visual.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(layoutHeight - visual.height - visual.offsetTop));
}

/**
 * Whether an element can show a child at all.
 *
 * In fullscreen only the fullscreen element's subtree is rendered, so the UI
 * has to move inside it - but a replaced or void element draws its own content
 * and ignores whatever is appended. Those are named rather than tested for,
 * because appending to one succeeds and simply shows nothing.
 */
const CHILDLESS = new Set([
  'IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'INPUT', 'TEXTAREA', 'SELECT', 'PICTURE', 'SVG',
]);

export const canHoldUi = (tagName: string): boolean => !CHILDLESS.has(tagName.toUpperCase());

/** One thing that can be picked out of the recognised text. */
export interface Pickable {
  text: string;
  /** What follows it in running text: a space, or nothing between CJK glyphs. */
  separator: string;
  geometry: Geometry;
}

interface PickableLine {
  text: string;
  geometry: Geometry | null;
  words: ReadonlyArray<{ text: string; separator: string; geometry: Geometry | null }>;
}

/**
 * The recognised text as things to tap, in reading order.
 *
 * Words where Lens placed every word of a line; otherwise the line as one
 * piece, because a word with no box cannot be drawn and leaving it out would
 * make it impossible to select. A line with no box either is dropped - there
 * is nowhere on the picture to put it.
 */
export function pickables(paragraphs: ReadonlyArray<{ lines: ReadonlyArray<PickableLine> }>): Pickable[] {
  const out: Pickable[] = [];
  for (const paragraph of paragraphs) {
    for (const line of paragraph.lines) {
      const words = line.words.filter((word) => word.text);
      if (words.length && words.every((word) => word.geometry)) {
        words.forEach((word, index) => {
          // Lens puts nothing after the last word of a line, which is right
          // inside the line and wrong at its end: picked together with the
          // next line's first word, "world" and "second" would become one.
          // Scripts written without spaces are left as they are.
          const last = index === words.length - 1;
          const spaced = (word.text.codePointAt(word.text.length - 1) ?? 0) < 0x2e80;
          out.push({
            text: word.text,
            separator: last && !word.separator && spaced ? ' ' : word.separator,
            geometry: word.geometry as Geometry,
          });
        });
      } else if (line.geometry && line.text) {
        out.push({ text: line.text, separator: ' ', geometry: line.geometry });
      }
    }
  }
  return out;
}

/**
 * What was picked, as one line of text to search for.
 *
 * Neighbours are joined by whatever Lens put between them, so Japanese stays
 * unspaced and English keeps its spaces. Two picks with a gap between them
 * were not adjacent in the source, and running them together would make one
 * word out of two.
 */
export function joinPicked(items: ReadonlyArray<Pickable>, picked: ReadonlySet<number>): string {
  let text = '';
  let previous = -2;
  items.forEach((item, index) => {
    if (!picked.has(index)) return;
    if (text && previous !== index - 1 && !/\s$/.test(text)) text += ' ';
    text += item.text + item.separator;
    previous = index;
  });
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The upload a set of objects came from.
 *
 * An object id means something only to the upload that produced it, so the
 * tool keeps the upload with the dots and a tap searches through that same
 * one - never through whatever upload the front end would make or find now. A
 * canvas has no address to look an upload up by, and a cached one can be
 * evicted or expire, so asking again could hand back a different upload whose
 * ids name different things or nothing.
 */
export interface ObjectSource {
  /** Replaced, not edited, when the session behind it is reopened. */
  readonly objects: readonly DetectedObject[];
  /** False once the session has expired; reopening it makes the old ids meaningless. */
  readonly fresh: boolean;
}

/** Whether ids taken from `source` as `list` still name what they named. */
export const objectsStillValid = (source: ObjectSource, list: readonly DetectedObject[]): boolean =>
  source.fresh && source.objects === list;

/**
 * How wide the row of controls over a picture has to be.
 *
 * Laid out the way `flex-wrap` will lay it: as many controls to a line as fit
 * in `max`, the next one starting a new line. Nine pinned 44px buttons are
 * 444px and a phone is 375, so a row that was never measured against the
 * screen ran off it. A control with no width is not in the row (no gap for
 * it); a single control wider than `max` still gets a line to itself.
 */
export function wrapWidth(widths: readonly number[], gap: number, max: number): number {
  let widest = 0;
  let line = 0;
  for (const width of widths) {
    if (!(width > 0)) continue;
    const next = line === 0 ? width : line + gap + width;
    if (line > 0 && next > max) {
      widest = Math.max(widest, line);
      line = width;
    } else line = next;
  }
  return Math.max(widest, line);
}

export type Corner = 'tr' | 'tl' | 'br' | 'bl';

/**
 * Where the row goes: hung from a corner of the picture, `inset` inside it,
 * then moved - never shrunk - until it is inside the visible part of the
 * screen, `margin` from its edges. A row bigger than the screen keeps its
 * start edge, which is where the main control is.
 */
export function placeRow(corner: Corner, anchor: Rect, row: Size, view: Rect, margin: number, inset: number): Point {
  const onLeft = corner === 'tl' || corner === 'bl';
  const onBottom = corner === 'br' || corner === 'bl';
  const x = onLeft ? anchor.left + inset : anchor.left + anchor.width - inset - row.width;
  const y = onBottom ? anchor.top + anchor.height - inset - row.height : anchor.top + inset;
  const clamp = (value: number, start: number, room: number, size: number, keepEnd: boolean): number => {
    const low = start + margin;
    const high = start + room - margin - size;
    if (high < low) return keepEnd ? high : low;
    return Math.min(high, Math.max(low, value));
  };
  return {
    x: clamp(x, view.left, view.width, row.width, !onLeft),
    y: clamp(y, view.top, view.height, row.height, onBottom),
  };
}
