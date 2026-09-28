import { isCover } from './render/cover.js';

/**
 * Finding the pictures on a page.
 *
 * `<img>` is most of them but not all, and the ones it misses are not exotic:
 * a hero behind CSS `background-image`, a reader that paints into a `<canvas>`,
 * a site that keeps its content inside its own shadow root. And the page this
 * was written for serves 24 kB of HTML with three `<img>` in it - a banner, an
 * icon and a spinner - while every picture worth translating arrives later from
 * an API. A detector that reads the document once finds nothing there.
 *
 * So: what counts as a picture is a *kind* rather than a tag, the list is kept
 * up to date by a MutationObserver instead of re-derived, and the walk descends
 * into open shadow roots, which `document.images` does not.
 */

export type TargetKind = 'img' | 'canvas' | 'video' | 'background';

export interface Target {
  /** What the button sits on and what the translation is laid over. */
  element: HTMLElement;
  kind: TargetKind;
  /**
   * The picture's own address, where it has one - the identity the cache keys
   * on, and the URL to re-fetch from when the canvas comes back tainted.
   * Empty for a canvas or a video, which have no address at all.
   */
  url: string;
}

/** The first `url()` in a computed background, if it is an image at all. */
function backgroundUrl(element: Element): string {
  const value = window.getComputedStyle(element).backgroundImage;
  if (!value || value === 'none') return '';
  const match = /url\((['"]?)(.*?)\1\)/.exec(value);
  const url = match?.[2] ?? '';
  // A gradient is a background image too, and there is nothing to translate in
  // one; so is a 1x1 spacer, which the size test below throws out anyway.
  return url && !url.startsWith('#') ? url : '';
}

/**
 * What this node is, if it is anything.
 *
 * Deliberately not a list of selectors: a `<picture>` is classified through the
 * `<img>` the browser actually rendered inside it, and `currentSrc` is what
 * resolves a `srcset` - which is also why a lazily-loaded image reports its
 * real address here and not the placeholder it was born with.
 */
export function classify(node: unknown): Target | null {
  if (!node || typeof node !== 'object') return null;
  const element = node as HTMLElement;
  if (element.nodeType !== 1 || typeof element.tagName !== 'string') return null;
  // Our own rendering is an <img> in the page; offering to translate it is how
  // a translated image came to look untranslated.
  if (isCover(element)) return null;

  switch (element.tagName) {
    case 'IMG': {
      const img = element as HTMLImageElement;
      return { element, kind: 'img', url: img.currentSrc || img.src || '' };
    }
    case 'CANVAS':
      return { element, kind: 'canvas', url: '' };
    case 'VIDEO':
      return { element, kind: 'video', url: '' };
    default: {
      const url = backgroundUrl(element);
      return url ? { element, kind: 'background', url } : null;
    }
  }
}

/** Rendered size, which is what decides whether this is a picture or an icon. */
export function isBigEnough(target: Target, minSize: number): boolean {
  const rect = target.element.getBoundingClientRect();
  return rect.width >= minSize && rect.height >= minSize;
}

/**
 * Every element in the composed tree, shadow roots included.
 *
 * `querySelectorAll` stops at a shadow boundary and `document.images` never
 * crosses one, so a site that renders its content in a component of its own is
 * invisible to both. Closed roots stay invisible - nothing can reach those.
 */
function* walk(root: ParentNode): Generator<Element> {
  for (const element of root.querySelectorAll('*')) {
    yield element;
    const shadow = (element as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow) yield* walk(shadow);
  }
}

/**
 * How many elements a background sweep will look at.
 *
 * Tags are free to enumerate; a background is not, because deciding costs a
 * computed style per element and a busy page has tens of thousands of them.
 * The cap keeps the worst case bounded, and the hover path does not depend on
 * this sweep at all - it classifies whatever is under the cursor directly, so
 * a background always works there whether or not the sweep reached it.
 */
const BACKGROUND_SWEEP_LIMIT = 4000;

export function collect(minSize: number): Target[] {
  const found: Target[] = [];
  let seen = 0;

  for (const element of walk(document)) {
    seen += 1;
    const tag = element.tagName;
    const tagged = tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO';
    if (!tagged && seen > BACKGROUND_SWEEP_LIMIT) continue;

    const target = classify(element);
    if (target && isBigEnough(target, minSize)) found.push(target);
  }
  return found;
}

/**
 * The picture under an event.
 *
 * composedPath is what makes this work on a site that puts its content in a
 * shadow root of its own: a plain `event.target` reports the host element
 * instead of what is inside it.
 */
export function targetFromEvent(
  event: Event,
  minSize: number,
  ours: (node: EventTarget) => boolean
): Target | null {
  for (const node of event.composedPath()) {
    if (ours(node)) return null;
    const target = classify(node);
    if (target && isBigEnough(target, minSize)) return target;
  }
  return null;
}
