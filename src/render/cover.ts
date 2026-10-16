import { paintRect, tilesVisibly } from './background.js';
import type { BackgroundSpec } from './background.js';
import { watchPicture } from './watch.js';

/**
 * Lay the translated rendering over an image as a sibling element.
 *
 * Two earlier approaches both failed, in opposite ways:
 *
 * - A layer parented to <body> and positioned from getBoundingClientRect
 *   drifts on a virtualised feed, which recycles and moves its <img> elements
 *   constantly. It ended up smeared across unrelated parts of the page.
 * - Overwriting the element's own `src` puts us in a tug-of-war with whoever
 *   owns it. React re-asserts `src` on its next render; measured against a
 *   harness that re-asserts on every change, a MutationObserver lost after 30
 *   rounds and the translation vanished.
 *
 * A sibling solves both. It shares the image's containing block, so it tracks
 * the image through scrolling and reflow with no bookkeeping at all, and the
 * framework never touches it because it did not create it.
 *
 * What it does not solve by itself is the framework changing what the image
 * *is*. A virtualised feed reuses the element for the next post, and a sibling
 * that nobody told stays on top of a different photograph; one that replaces
 * the element outright leaves the sibling orphaned in the page for good. So a
 * cover watches its image (`watch.ts`) and goes when the picture does, and
 * `sweepCovers` is the backstop for whatever the watching missed.
 */

interface Cover {
  element: HTMLImageElement;
  blobUrl: string;
  /** Set for a CSS background: where, inside the element, the picture is painted. */
  background: BackgroundOptions | undefined;
  resize: ResizeObserver;
  stopWatching: () => void;
  /** Why the cover is currently out of sight; empty when it is showing. */
  hiddenFor: Set<'peek' | 'pending'>;
  onGone: (() => void) | undefined;
}

/**
 * What image a cover belongs to, if it is still alive.
 *
 * Keyed by the cover element, which is in the page and therefore alive, rather
 * than by the image, which a framework may have dropped. That is what makes an
 * orphan findable: the old arrangement could only reach a cover through its
 * image, so when the image went the cover became unreachable and its object
 * URL could never be revoked.
 */
const registry = new Map<HTMLElement, { image: WeakRef<HTMLElement>; blobUrl: string }>();
const covers = new WeakMap<HTMLElement, Cover>();

export const isCovered = (img: HTMLElement): boolean => covers.has(img);

/**
 * The marker on a cover element.
 *
 * A cover is an `<img>` that lives in the page, so everything that looks for
 * images finds it - `document.images` included. It sits on the image's own box,
 * which ought to make it a harmless tie, except that `place` copies the box
 * through `offsetWidth`, an integer, while the contest measures
 * `getBoundingClientRect`, which is not: one measured 375.333 wide against the
 * other's 375. Whichever way that rounds decides the winner, which is why a
 * translated image intermittently reported itself untranslated and a second
 * press sent the rendering back to Lens.
 */
export const COVER_MARK = 'data-lens-translate';

export const isCover = (node: Element): boolean => node.hasAttribute(COVER_MARK);

const px = (value: string): number => Number.parseFloat(value) || 0;

/** The widths of one kind of edge on an element, in pixels. */
interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const borderOf = (style: CSSStyleDeclaration): Edges => ({
  top: px(style.borderTopWidth),
  right: px(style.borderRightWidth),
  bottom: px(style.borderBottomWidth),
  left: px(style.borderLeftWidth),
});

const paddingOf = (style: CSSStyleDeclaration): Edges => ({
  top: px(style.paddingTop),
  right: px(style.paddingRight),
  bottom: px(style.paddingBottom),
  left: px(style.paddingLeft),
});

/** How far inside the border box each named box starts. */
function inset(style: CSSStyleDeclaration, box: BackgroundSpec['origin']): Edges {
  const border = borderOf(style);
  if (box === 'border-box') return { top: 0, right: 0, bottom: 0, left: 0 };
  if (box === 'padding-box') return border;
  const padding = paddingOf(style);
  return {
    top: border.top + padding.top,
    right: border.right + padding.right,
    bottom: border.bottom + padding.bottom,
    left: border.left + padding.left,
  };
}

/**
 * Put the cover where the picture is painted.
 *
 * offsetLeft/offsetTop are measured against the same offsetParent an absolutely
 * positioned sibling resolves against, so these numbers need no correction for
 * scrolling or for where the page happens to be.
 *
 * For a replaced element (`<img>`, `<canvas>`, `<video>`) the picture is its
 * *content* box, because that is what `object-fit` fits into: with padding or a
 * border, the whole box was a few pixels too big on each side. For a background
 * it is wherever `background-size` and `-position` put it inside the positioning
 * area, clipped to the box the background is clipped to - an element with
 * `background-size: cover` paints a picture far bigger than itself and shows a
 * window onto it, and a cover the size of the element would show all of it.
 *
 * Returns false when there is nowhere sensible to put it, which for a
 * background means the browser tiled it.
 */
function place(cover: Cover, img: HTMLElement): boolean {
  const target = cover.element;
  const style = getComputedStyle(img);

  if (!cover.background) {
    const border = borderOf(style);
    const padding = paddingOf(style);
    const left = border.left + padding.left;
    const top = border.top + padding.top;
    target.style.left = `${img.offsetLeft + left}px`;
    target.style.top = `${img.offsetTop + top}px`;
    target.style.width = `${img.offsetWidth - left - border.right - padding.right}px`;
    target.style.height = `${img.offsetHeight - top - border.bottom - padding.bottom}px`;
    return true;
  }

  const { spec, natural } = cover.background;
  const width = img.offsetWidth;
  const height = img.offsetHeight;
  const origin = inset(style, spec.origin);
  const area = {
    width: width - origin.left - origin.right,
    height: height - origin.top - origin.bottom,
  };

  const rect = paintRect(spec, area, natural);
  if (!rect || tilesVisibly(spec, rect, area)) return false;

  // Relative to the border box, which is what offsetLeft/offsetTop name.
  const x = origin.left + rect.x;
  const y = origin.top + rect.y;
  const clip = inset(style, spec.clip);
  const cut = {
    top: Math.max(0, clip.top - y),
    right: Math.max(0, x + rect.width - (width - clip.right)),
    bottom: Math.max(0, y + rect.height - (height - clip.bottom)),
    left: Math.max(0, clip.left - x),
  };
  // Nothing of it is inside what the background is clipped to.
  if (cut.left + cut.right >= rect.width || cut.top + cut.bottom >= rect.height) return false;

  target.style.left = `${img.offsetLeft + x}px`;
  target.style.top = `${img.offsetTop + y}px`;
  target.style.width = `${rect.width}px`;
  target.style.height = `${rect.height}px`;

  // The element's rounded corners clip its background, so they are applied to
  // the visible window to stay where the page drew them.
  const radius = style.borderRadius.trim();
  const round = radius && !/^0(px)?$/.test(radius) ? ` round ${radius}` : '';
  const visible = `inset(${cut.top}px ${cut.right}px ${cut.bottom}px ${cut.left}px${round})`;
  target.style.setProperty('clip-path', visible, 'important');
  return true;
}

function showOrHide(cover: Cover): void {
  if (cover.hiddenFor.size) cover.element.style.setProperty('visibility', 'hidden', 'important');
  else cover.element.style.removeProperty('visibility');
}

/** What a background cover needs to know that the element's own style does not say. */
export interface BackgroundOptions {
  spec: BackgroundSpec;
  /** The picture's own size - the original, not the supersampled rendering. */
  natural: { width: number; height: number };
}

export interface CoverOptions {
  /**
   * Called when the cover is removed because the picture changed or the image
   * left the page - not when the caller removes it itself. The front end keeps
   * its own list of what is translated, and this is how it learns that an entry
   * is stale.
   */
  onGone?: () => void;
  /**
   * Present for a CSS background. Without it the cover assumes a replaced
   * element and fills its content box, which is wrong for a background twice
   * over: the picture is usually not the element's size, and it can be tiled.
   */
  background?: BackgroundOptions;
}

/**
 * Cover an image with a rendering.
 *
 * Takes ownership of `blobUrl`: it is revoked when the cover goes, for any
 * reason, and also here if the cover cannot be laid at all. A caller that
 * revoked it on failure itself would be one early return away from forgetting.
 */
export function coverImage(
  img: HTMLElement,
  blobUrl: string,
  options: CoverOptions = {}
): boolean {
  uncoverImage(img);

  const parent = img.parentElement;
  if (!parent) {
    URL.revokeObjectURL(blobUrl);
    return false;
  }

  const element = document.createElement('img');
  element.src = blobUrl;
  element.setAttribute(COVER_MARK, '');
  element.setAttribute(
    'style',
    [
      'position: absolute',
      'margin: 0',
      'padding: 0',
      'border: 0',
      'max-width: none',
      'max-height: none',
      'min-width: 0',
      'min-height: 0',
      'pointer-events: none',
      // Above the image, below anything the page floats on top of it.
      'z-index: 1',
      // A background's window, corners included, is cut out by place().
      ...(options.background
        ? ['border-radius: 0', 'object-fit: fill']
        : [
            // Inherit the shape so rounded media does not get square corners.
            `border-radius: ${getComputedStyle(img).borderRadius}`,
            // And how the picture sits in its box: `contain` letterboxes it,
            // and where in the box it lands is object-position's to say.
            `object-fit: ${getComputedStyle(img).objectFit || 'fill'}`,
            `object-position: ${getComputedStyle(img).objectPosition || '50% 50%'}`,
          ]),
    ]
      .map((rule) => `${rule} !important`)
      .join(';')
  );

  // An absolutely positioned child needs a positioned ancestor to resolve
  // against; without one it would escape to the viewport.
  if (getComputedStyle(parent).position === 'static') {
    parent.style.setProperty('position', 'relative', 'important');
  }

  const cover: Cover = {
    element,
    blobUrl,
    background: options.background,
    // Both are filled in below, once what they need exists.
    resize: undefined as unknown as ResizeObserver,
    stopWatching: () => {},
    hiddenFor: new Set(),
    onGone: options.onGone,
  };

  img.insertAdjacentElement('afterend', element);
  if (!place(cover, img)) {
    element.remove();
    URL.revokeObjectURL(blobUrl);
    return false;
  }

  // The callbacks hold a weak reference, not the image: the cover is kept in a
  // registry that outlives the image, and a closure here would make that
  // registry the thing keeping a discarded element in memory.
  const ref = new WeakRef(img);
  cover.resize = new ResizeObserver(() => {
    const current = ref.deref();
    if (!current) return;
    // An element that leaves the document is reported as having shrunk to
    // nothing, which is the earliest anyone is told. A background that has
    // since been tiled by a resize has nowhere to be either.
    if (!current.isConnected || !place(cover, current)) drop(current);
  });
  cover.resize.observe(img);
  cover.stopWatching = watchPicture(img, {
    stale: () => {
      const current = ref.deref();
      if (current) drop(current);
    },
    pending: (on) => {
      if (on) cover.hiddenFor.add('pending');
      else cover.hiddenFor.delete('pending');
      showOrHide(cover);
    },
  });

  covers.set(img, cover);
  registry.set(element, { image: ref, blobUrl });
  return true;
}

/** Remove a cover because what it covered is gone, and say so. */
function drop(img: HTMLElement): void {
  const onGone = covers.get(img)?.onGone;
  if (uncoverImage(img)) onGone?.();
}

export function uncoverImage(img: HTMLElement): boolean {
  const cover = covers.get(img);
  if (!cover) return false;
  release(cover);
  covers.delete(img);
  return true;
}

function release(cover: Cover): void {
  cover.stopWatching();
  cover.resize.disconnect();
  cover.element.remove();
  URL.revokeObjectURL(cover.blobUrl);
  registry.delete(cover.element);
}

/**
 * Remove every cover whose image is gone.
 *
 * The watching reports most of it as it happens; this is for what it cannot
 * see - an image dropped from the page while nothing observable changed, or one
 * that was collected, leaving a cover with no image to be asked about. It is
 * what stops the object URLs of a long scroll through an infinite feed adding
 * up to the whole session's worth of bitmaps.
 */
export function sweepCovers(): number {
  let removed = 0;
  for (const [element, entry] of [...registry]) {
    const img = entry.image.deref();
    if (img?.isConnected) continue;
    if (img) {
      drop(img);
    } else {
      // The image is gone and so is the only way to its record: do by hand
      // what uncoverImage would have.
      element.remove();
      URL.revokeObjectURL(entry.blobUrl);
      registry.delete(element);
    }
    removed += 1;
  }
  return removed;
}

/** Remove every cover on the page, for the panic button. */
export function uncoverAll(): number {
  let count = 0;
  for (const [element, entry] of [...registry]) {
    const img = entry.image.deref();
    if (img && uncoverImage(img)) count += 1;
    else {
      element.remove();
      URL.revokeObjectURL(entry.blobUrl);
      registry.delete(element);
      count += 1;
    }
  }
  // Sweep up anything orphaned by a framework replacing the image outright.
  for (const stray of Array.from(document.querySelectorAll('img[data-lens-translate]'))) {
    stray.remove();
    count += 1;
  }
  return count;
}

/**
 * Show the original underneath, for as long as it is asked to.
 *
 * Out of sight rather than removed, so that letting go is instant and costs
 * nothing: nothing is re-rendered, re-fetched or re-covered.
 */
export function peekCover(img: HTMLElement, peeking: boolean): boolean {
  const cover = covers.get(img);
  if (!cover) return false;
  if (peeking) cover.hiddenFor.add('peek');
  else cover.hiddenFor.delete('peek');
  showOrHide(cover);
  return true;
}

export function peekAllCovers(peeking: boolean): void {
  for (const entry of registry.values()) {
    const img = entry.image.deref();
    if (img) peekCover(img, peeking);
  }
}
