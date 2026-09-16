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
 */

interface Cover {
  element: HTMLImageElement;
  blobUrl: string;
  resize: ResizeObserver;
}

const covers = new WeakMap<HTMLImageElement, Cover>();
const live = new Set<WeakRef<HTMLImageElement>>();

export const isCovered = (img: HTMLImageElement): boolean => covers.has(img);

/**
 * Match the image's box.
 *
 * offsetLeft/offsetTop are measured against the same offsetParent an absolutely
 * positioned sibling resolves against, so these numbers need no correction for
 * scrolling or for where the page happens to be.
 */
function place(cover: HTMLImageElement, img: HTMLImageElement): void {
  cover.style.left = `${img.offsetLeft}px`;
  cover.style.top = `${img.offsetTop}px`;
  cover.style.width = `${img.offsetWidth}px`;
  cover.style.height = `${img.offsetHeight}px`;
}

export function coverImage(img: HTMLImageElement, blobUrl: string): boolean {
  uncoverImage(img);

  const parent = img.parentElement;
  if (!parent) return false;

  const element = document.createElement('img');
  element.src = blobUrl;
  element.setAttribute('data-lens-translate', '');
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

  const resize = new ResizeObserver(() => place(element, img));
  resize.observe(img);

  covers.set(img, { element, blobUrl, resize });
  live.add(new WeakRef(img));
  return true;
}

export function uncoverImage(img: HTMLImageElement): boolean {
  const cover = covers.get(img);
  if (!cover) return false;
  cover.resize.disconnect();
  cover.element.remove();
  URL.revokeObjectURL(cover.blobUrl);
  covers.delete(img);
  return true;
}

/** Remove every cover on the page, for the panic button. */
export function uncoverAll(): number {
  let count = 0;
  for (const ref of live) {
    const img = ref.deref();
    if (!img) {
      live.delete(ref);
      continue;
    }
    if (uncoverImage(img)) count += 1;
  }
  // Sweep up anything orphaned by a framework replacing the image outright.
  for (const stray of Array.from(document.querySelectorAll('img[data-lens-translate]'))) {
    stray.remove();
    count += 1;
  }
  return count;
}
