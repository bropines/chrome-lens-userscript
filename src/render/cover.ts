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

/**
 * Match the image's box.
 *
 * offsetLeft/offsetTop are measured against the same offsetParent an absolutely
 * positioned sibling resolves against, so these numbers need no correction for
 * scrolling or for where the page happens to be.
 */
function place(cover: HTMLImageElement, img: HTMLElement): void {
  cover.style.left = `${img.offsetLeft}px`;
  cover.style.top = `${img.offsetTop}px`;
  cover.style.width = `${img.offsetWidth}px`;
  cover.style.height = `${img.offsetHeight}px`;
}

function showOrHide(cover: Cover): void {
  if (cover.hiddenFor.size) cover.element.style.setProperty('visibility', 'hidden', 'important');
  else cover.element.style.removeProperty('visibility');
}

export interface CoverOptions {
  /**
   * Called when the cover is removed because the picture changed or the image
   * left the page - not when the caller removes it itself. The front end keeps
   * its own list of what is translated, and this is how it learns that an entry
   * is stale.
   */
  onGone?: () => void;
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
      // Inherit the shape so rounded media does not get square corners.
      `border-radius: ${getComputedStyle(img).borderRadius}`,
      `object-fit: ${getComputedStyle(img).objectFit || 'fill'}`,
    ]
      .map((rule) => `${rule} !important`)
      .join(';')
  );

  // An absolutely positioned child needs a positioned ancestor to resolve
  // against; without one it would escape to the viewport.
  if (getComputedStyle(parent).position === 'static') {
    parent.style.setProperty('position', 'relative', 'important');
  }

  img.insertAdjacentElement('afterend', element);
  place(element, img);

  // The callbacks hold a weak reference, not the image: the cover is kept in a
  // registry that outlives the image, and a closure here would make that
  // registry the thing keeping a discarded element in memory.
  const ref = new WeakRef(img);
  const resize = new ResizeObserver(() => {
    const current = ref.deref();
    if (!current) return;
    // An element that leaves the document is reported as having shrunk to
    // nothing, which is the earliest anyone is told.
    if (!current.isConnected) drop(current);
    else place(element, current);
  });
  resize.observe(img);

  const cover: Cover = {
    element,
    blobUrl,
    resize,
    hiddenFor: new Set(),
    onGone: options.onGone,
    stopWatching: () => {},
  };
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
