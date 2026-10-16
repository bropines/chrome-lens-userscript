/**
 * What a CSS background is, as geometry.
 *
 * An `<img>` is a picture by definition; a `background-image` is only a picture
 * sometimes. It is also how a page paints a texture behind everything, a sprite
 * sheet, a gradient fallback, a 1px spacer, and a hero banner that really is
 * the thing worth translating. Telling those apart, and then laying a
 * translation over the last kind in the place the browser painted it, both come
 * down to the same arithmetic: where does the image end up inside the element.
 *
 * Nothing here touches the DOM. It takes the computed values as strings, which
 * is also what makes it testable.
 */

/** A length as computed: absolute pixels, or a fraction of the positioning area. */
export type Dimension = 'auto' | { px: number } | { pct: number };

export type BackgroundSize =
  | { kind: 'cover' }
  | { kind: 'contain' }
  | { kind: 'lengths'; width: Dimension; height: Dimension };

/** `calc(pct% + px)`, which is every form a computed position takes. */
export interface Offset {
  pct: number;
  px: number;
}

export type Box = 'border-box' | 'padding-box' | 'content-box';

export interface BackgroundSpec {
  size: BackgroundSize;
  x: Offset;
  y: Offset;
  /** Whether copies of the image appear along each axis. */
  repeatX: boolean;
  repeatY: boolean;
  origin: Box;
  clip: Box;
}

/** The computed values of one element's background properties. */
export interface RawBackground {
  image: string;
  size: string;
  positionX: string;
  positionY: string;
  repeat: string;
  origin: string;
  clip: string;
  attachment: string;
}

export interface Area {
  width: number;
  height: number;
}

export interface PaintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Split on the commas that are not inside parentheses: `url(a,b), linear-gradient(...)`. */
export function splitList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let at = 0; at < value.length; at += 1) {
    const char = value.charAt(at);
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, at).trim());
      start = at + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

/** The address inside `url(...)`, quoted or not. */
export function urlOf(layer: string): string {
  const match = /^url\((['"]?)(.*?)\1\)$/.exec(layer.trim());
  return match?.[2] ?? '';
}

const NUMBER = '(-?\\d*\\.?\\d+)';
const PLAIN = new RegExp(`^${NUMBER}(px|%)?$`);
const CALC = new RegExp(`^calc\\(\\s*${NUMBER}(px|%)\\s*([+-])\\s*${NUMBER}(px|%)\\s*\\)$`);

/** One length or percentage; null for anything this does not understand. */
function lengthOf(value: string): { px: number; pct: number } | null {
  const text = value.trim();
  const plain = PLAIN.exec(text);
  if (plain) {
    const amount = Number(plain[1]);
    // A bare 0 is the one unitless length CSS allows.
    return plain[2] === '%' ? { px: 0, pct: amount } : { px: amount, pct: 0 };
  }
  const calc = CALC.exec(text);
  if (calc) {
    const first = Number(calc[1]);
    const sign = calc[3] === '-' ? -1 : 1;
    const second = sign * Number(calc[4]);
    if (calc[2] === calc[5]) return null;
    return calc[2] === '%' ? { pct: first, px: second } : { px: first, pct: second };
  }
  return null;
}

/** A `background-size` component: `auto`, or a plain length or percentage. */
function dimensionOf(value: string): Dimension | null {
  const text = value.trim();
  if (text === 'auto') return 'auto';
  const plain = PLAIN.exec(text);
  if (!plain) return null;
  const amount = Number(plain[1]);
  return plain[2] === '%' ? { pct: amount } : { px: amount };
}

const boxOf = (value: string, fallback: Box): Box =>
  value === 'border-box' || value === 'padding-box' || value === 'content-box' ? value : fallback;

/**
 * Read the layer of the background that is a picture.
 *
 * `background-image` is a list and so is every other background property, one
 * entry per layer, repeating if shorter. The first `url()` layer is the one
 * taken, and its siblings are looked up at the same index - which is why this
 * cannot just read `background-size` as if it described the only layer.
 *
 * Null means "not something to translate": a gradient, no image at all, or a
 * layer using a feature this does not model - a fixed attachment, text-clipped
 * painting, `space`/`round` tiling, a size or position it cannot resolve.
 * Refusing is the safe answer, because the alternative is laying a translation
 * where the browser did not paint the picture.
 */
export function parseBackground(raw: RawBackground): { url: string; spec: BackgroundSpec } | null {
  const layers = splitList(raw.image);
  const index = layers.findIndex((layer) => {
    const url = urlOf(layer);
    // `url(#id)` is an SVG paint server reference, not a picture.
    return url !== '' && !url.startsWith('#');
  });
  if (index < 0) return null;
  const url = urlOf(layers[index] ?? '');

  const at = (list: string): string => {
    const entries = splitList(list);
    return entries[index % Math.max(1, entries.length)] ?? '';
  };

  if (at(raw.attachment) === 'fixed') return null;
  const clipValue = at(raw.clip);
  if (clipValue === 'text') return null;

  // Size.
  const sizeText = at(raw.size).trim() || 'auto';
  let size: BackgroundSize;
  if (sizeText === 'cover' || sizeText === 'contain') size = { kind: sizeText };
  else {
    const tokens = sizeText.split(/\s+(?![^(]*\))/);
    const width = dimensionOf(tokens[0] ?? 'auto');
    const height = dimensionOf(tokens[1] ?? 'auto');
    if (!width || !height) return null;
    size = { kind: 'lengths', width, height };
  }

  // Position: the computed value of each axis is a length, a percentage, or a
  // calc() of the two.
  const x = lengthOf(at(raw.positionX));
  const y = lengthOf(at(raw.positionY));
  if (!x || !y) return null;

  // Repeat. One keyword names both axes, except the two that name one.
  const [first = 'repeat', second] = at(raw.repeat).trim().split(/\s+/);
  if ([first, second].some((word) => word === 'space' || word === 'round')) return null;
  const repeatX = second === undefined ? first === 'repeat' || first === 'repeat-x' : first === 'repeat';
  const repeatY = second === undefined ? first === 'repeat' || first === 'repeat-y' : second === 'repeat';

  return {
    url,
    spec: {
      size,
      x,
      y,
      repeatX,
      repeatY,
      origin: boxOf(at(raw.origin), 'padding-box'),
      clip: boxOf(clipValue, 'border-box'),
    },
  };
}

const resolve = (dimension: Dimension, of: number): number | null =>
  dimension === 'auto' ? null : 'px' in dimension ? dimension.px : (dimension.pct / 100) * of;

/**
 * The size the image is painted at, inside a positioning area.
 *
 * Needs the image's own size for everything but two explicit lengths: `auto`
 * means "as the image is", and `cover`/`contain` are ratios against it.
 */
export function paintedSize(
  spec: BackgroundSpec,
  area: Area,
  natural: Area
): { width: number; height: number } | null {
  if (!(natural.width > 0 && natural.height > 0)) return null;

  if (spec.size.kind !== 'lengths') {
    const fit = spec.size.kind === 'cover' ? Math.max : Math.min;
    const scale = fit(area.width / natural.width, area.height / natural.height);
    return { width: natural.width * scale, height: natural.height * scale };
  }

  const width = resolve(spec.size.width, area.width);
  const height = resolve(spec.size.height, area.height);
  if (width !== null && height !== null) return { width, height };
  // One side auto keeps the image's proportions; both auto is the image itself.
  if (width !== null) return { width, height: (width * natural.height) / natural.width };
  if (height !== null) return { width: (height * natural.width) / natural.height, height };
  return { width: natural.width, height: natural.height };
}

/**
 * Where the one painted copy lands, relative to the positioning area's corner.
 *
 * A percentage position lines up the same fraction of the image with the same
 * fraction of the area, which is why it is applied to the *difference* of the
 * two sizes and not to the area.
 */
export function paintRect(spec: BackgroundSpec, area: Area, natural: Area): PaintRect | null {
  const size = paintedSize(spec, area, natural);
  if (!size || !(size.width > 0 && size.height > 0)) return null;
  return {
    x: ((area.width - size.width) * spec.x.pct) / 100 + spec.x.px,
    y: ((area.height - size.height) * spec.y.pct) / 100 + spec.y.px,
    width: size.width,
    height: size.height,
  };
}

/** Sub-pixel slack: layout rounds, and a hairline of daylight is not a second tile. */
const EPSILON = 1;

/**
 * Whether the browser painted more than one copy where it can be seen.
 *
 * A repeating background is fine as long as the single copy already covers the
 * area on the repeating axes - which is every `cover` hero, and every explicit
 * size that is at least as big as the box. Anything short of that tiles, and a
 * translation laid over one tile of a pattern is a translation of a texture.
 */
export function tilesVisibly(spec: BackgroundSpec, rect: PaintRect, area: Area): boolean {
  const coversX = rect.x <= EPSILON && rect.x + rect.width >= area.width - EPSILON;
  const coversY = rect.y <= EPSILON && rect.y + rect.height >= area.height - EPSILON;
  return (spec.repeatX && !coversX) || (spec.repeatY && !coversY);
}

/**
 * Whether a background could be one picture, from the style alone.
 *
 * This is the detector's question, asked before the image has been loaded and
 * its size is known: a repeating background is a picture only when its size is
 * one that always fills the box (`cover`) or an explicit one that does. With
 * `auto` size and a repeat - the signature of a pattern - nothing can be known,
 * and the answer is no. Without a repeat anything goes, and the exact geometry
 * is settled when the cover is laid.
 */
export function mayBePicture(spec: BackgroundSpec, area: Area): boolean {
  if (!spec.repeatX && !spec.repeatY) return true;
  if (spec.size.kind === 'cover') return true;
  if (spec.size.kind === 'contain') return false;

  const { width, height } = spec.size;
  const fills = (dimension: Dimension, of: number): boolean => {
    const length = resolve(dimension, of);
    return length !== null && length >= of - EPSILON;
  };
  return (!spec.repeatX || fills(width, area.width)) && (!spec.repeatY || fills(height, area.height));
}

/**
 * The painted size when the style alone settles it, for a size test.
 *
 * A 16px icon behind a button is a background image and not a picture, however
 * big the button is.
 */
export function knownPaintedSize(spec: BackgroundSpec, area: Area): Area | null {
  if (spec.size.kind === 'lengths') {
    const width = resolve(spec.size.width, area.width);
    const height = resolve(spec.size.height, area.height);
    if (width !== null && height !== null) return { width, height };
  }
  return null;
}
