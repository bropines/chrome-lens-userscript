/**
 * Replace an image with its translated rendering, reversibly.
 *
 * Nothing needs repositioning afterwards: the translated pixels live in the
 * same element, so they scroll, reflow, zoom and get recycled along with it.
 * That is the whole point - a separately positioned overlay cannot survive a
 * virtualised feed that moves and reuses its <img> elements.
 */

interface Original {
  src: string;
  srcset: string;
  blobUrl: string;
}

const swapped = new WeakMap<HTMLImageElement, Original>();
const live = new Set<WeakRef<HTMLImageElement>>();

export const isSwapped = (img: HTMLImageElement): boolean => swapped.has(img);

export function swapImage(img: HTMLImageElement, blobUrl: string): void {
  if (swapped.has(img)) restoreImage(img);
  swapped.set(img, { src: img.getAttribute('src') ?? '', srcset: img.getAttribute('srcset') ?? '', blobUrl });
  live.add(new WeakRef(img));
  // srcset must go, or the browser may re-pick a candidate and undo the swap.
  img.removeAttribute('srcset');
  img.src = blobUrl;
}

export function restoreImage(img: HTMLImageElement): boolean {
  const original = swapped.get(img);
  if (!original) return false;
  URL.revokeObjectURL(original.blobUrl);
  if (original.srcset) img.setAttribute('srcset', original.srcset);
  if (original.src) img.src = original.src;
  swapped.delete(img);
  return true;
}

/** Put every translated image on the page back, for the panic button. */
export function restoreAll(): number {
  let count = 0;
  for (const ref of live) {
    const img = ref.deref();
    if (!img) {
      live.delete(ref);
      continue;
    }
    if (restoreImage(img)) count += 1;
  }
  return count;
}
