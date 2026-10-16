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

import { knownPaintedSize, mayBePicture, parseBackground } from './render/background.js';
import type { BackgroundSpec } from './render/background.js';

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
  /**
   * Whether a pointer can reach it at all.
   *
   * `pointer-events: none` is what an overlay is made of - a devtools
   * highlighter, a scrim, our own cover. eruda's DOM highlighter is a canvas
   * the size of the viewport, and it beat the actual page on area, which is how
   * the button ended up in the top corner.
   *
   * It only lowers the ranking rather than disqualifying, because a reader that
   * sets `pointer-events: none` on its page image to stop dragging is a real
   * thing, and there the picture is all there is. What it does fix is the
   * disagreement: the hover path can never select an unpointable element, so
   * the pinned one should not prefer it.
   */
  pointable: boolean;
  /**
   * How a background is painted: its size, position, repeat and the box it is
   * positioned against. Only a `background` has one, and it is what lets the
   * cover land where the browser put the picture instead of on the whole box.
   */
  background?: BackgroundSpec;
}

/**
 * Elements that are not part of the page.
 *
 * Two things look exactly like a picture and are neither: the front end's own
 * UI - ours is a shadow host whose settings panel has a canvas in it - and a
 * finished translation, which this script lays over the image as an `<img>`
 * that everything looking for images duly finds, offering to translate a
 * translation.
 *
 * Both are the caller's to name. This module knows what a picture is; what any
 * particular front end draws on top of one is not its business, and asking it
 * to import the answer is what had a detector importing a renderer and a
 * shadow root.
 */
let ignored: (element: Element) => boolean = () => false;

export function ignoreElements(predicate: (element: Element) => boolean): void {
  ignored = predicate;
}

/**
 * The picture in an element's background, if it has one worth the name.
 *
 * A gradient has nothing to translate, a `url(#id)` is a paint server, and a
 * 1x1 spacer is thrown out by the size test. What this adds is the question of
 * whether the background is *one picture*: a pattern that tiles, a sprite, a
 * texture behind a wrapper are all `background-image: url()` and none of them
 * has text in it to translate.
 */
function backgroundOf(element: HTMLElement): { url: string; spec: BackgroundSpec } | null {
  // The root and the body are not pictures whatever they are painted with. A
  // site that tiles a texture behind everything puts it on one of them, and
  // because a hover takes the nearest picture up the tree, that made every spot
  // of the page without a picture of its own offer to translate the texture.
  if (element.tagName === 'BODY' || element.tagName === 'HTML') return null;
  const style = window.getComputedStyle(element);
  const image = style.backgroundImage;
  if (!image || image === 'none') return null;

  const parsed = parseBackground({
    image,
    size: style.backgroundSize,
    positionX: style.backgroundPositionX,
    positionY: style.backgroundPositionY,
    repeat: style.backgroundRepeat,
    origin: style.backgroundOrigin,
    clip: style.backgroundClip,
    attachment: style.backgroundAttachment,
  });
  if (!parsed) return null;
  return mayBePicture(parsed.spec, { width: element.offsetWidth, height: element.offsetHeight })
    ? parsed
    : null;
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
  if (ignored(element)) return null;

  const pointable = window.getComputedStyle(element).pointerEvents !== 'none';

  switch (element.tagName) {
    case 'IMG': {
      const img = element as HTMLImageElement;
      return { element, kind: 'img', url: img.currentSrc || img.src || '', pointable };
    }
    case 'CANVAS':
      return { element, kind: 'canvas', url: '', pointable };
    case 'VIDEO':
      return { element, kind: 'video', url: '', pointable };
    default: {
      const background = backgroundOf(element);
      return background
        ? { element, kind: 'background', url: background.url, pointable, background: background.spec }
        : null;
    }
  }
}

/** Rendered size, which is what decides whether this is a picture or an icon. */
export function isBigEnough(target: Target, minSize: number): boolean {
  const rect = target.element.getBoundingClientRect();
  if (!(rect.width >= minSize && rect.height >= minSize)) return false;
  // A background is painted at its own size, not the element's: a 24px icon
  // on a full-width button is a big element and a tiny picture.
  const painted =
    target.background && knownPaintedSize(target.background, { width: rect.width, height: rect.height });
  return !painted || (painted.width >= minSize && painted.height >= minSize);
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
    // The front end's own UI is a shadow root like any other, and our settings
    // panel has a canvas in it. Walking into ourselves would offer to translate
    // our own preview.
    if (ignored(element)) continue;
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
