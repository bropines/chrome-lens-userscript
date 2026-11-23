import { classify, isBigEnough, targetFromEvent } from './detect.js';
import type { Target } from './detect.js';

/**
 * Running inside an iframe, and staying out of the way until there is a reason.
 *
 * The script used to carry `@noframes`, because without it every ad and embed
 * on a page paid for its own copy of the bundle, an observer over its tree, a
 * shadow root and a sweep timer - and offered to translate an advertisement.
 * The cost was a reader or a gallery that renders its pages in an iframe of its
 * own, which got no button at all. So a frame now boots asleep: a handful of
 * listeners that each look at one element, and nothing else, until the frame
 * turns out to hold a picture somebody might want translated.
 */

export interface Size {
  width: number;
  height: number;
}

/**
 * The smallest frame that can wake, in the frame's own CSS pixels.
 *
 * Chosen against the IAB's standard ad units, which are what most frames on a
 * page are: 300x250, 336x280, 728x90, 970x90, 970x250, 320x50, 160x600,
 * 300x600 and 300x1050. Every one of them is either narrower than 400 or
 * shorter than 300, so none can wake however big the picture inside it - and
 * the picture inside an ad is usually exactly the size of the ad. A reader's
 * page, a gallery or an embedded viewer is comfortably past both.
 */
export const FRAME_MIN_WIDTH = 400;
export const FRAME_MIN_HEIGHT = 300;

/** How long a burst of resizes is allowed to settle before the frame is looked at again. */
const RESIZE_SETTLE_MS = 200;

/**
 * Whether this document is a frame.
 *
 * Comparing `top` with `window` is allowed across origins, but a host that hands
 * the script a wrapped window may make even that throw; a frame is the safer
 * guess then, because a frame only sleeps while a top window would lose its UI.
 */
export function isFramed(): boolean {
  try {
    return window.top !== window;
  } catch {
    return true;
  }
}

/** Big enough to be a page rather than an ad slot. */
export const roomyFrame = (viewport: Size): boolean =>
  viewport.width >= FRAME_MIN_WIDTH && viewport.height >= FRAME_MIN_HEIGHT;

/**
 * The wake rule, as arithmetic: the frame is roomy and holds one picture that
 * passes the same size test the top window uses. Both halves, always - a hover
 * over the banner in a 300x250 slot is still a hover inside an ad.
 */
export function shouldWake(viewport: Size, pictures: Iterable<Size>, minImageSize: number): boolean {
  if (!roomyFrame(viewport)) return false;
  for (const picture of pictures) {
    if (picture.width >= minImageSize && picture.height >= minImageSize) return true;
  }
  return false;
}

/**
 * The hostname of the page this frame sits in, when that can be learned.
 *
 * `location.ancestorOrigins` names it outright (its last entry is the top
 * origin) in Chromium and Safari; Firefox has no such list. Failing that, the
 * referrer is the parent's address - which is the top only for a frame directly
 * inside it, and only while the referrer policy leaves at least the origin,
 * which the default does. A sandboxed ancestor reads as the origin `null`.
 * Anything else is unknowable from in here, and an unknown top is not treated
 * as a switched-off one: the frame then answers to its own hostname alone.
 */
export function topHostname(): string | null {
  try {
    const origins = window.location.ancestorOrigins as DOMStringList | undefined;
    const last = origins && origins.length ? origins.item(origins.length - 1) : null;
    if (last && last !== 'null') return new URL(last).hostname;
  } catch {
    // Not there, or not an address; try the referrer.
  }
  try {
    if (window.parent === window.top && document.referrer) return new URL(document.referrer).hostname;
  } catch {
    // Unknowable.
  }
  return null;
}

/** The size a picture is shown at, after the shared test has passed it. */
function shownSizes(targets: Iterable<Target>, minImageSize: number): Size[] {
  const sizes: Size[] = [];
  for (const target of targets) {
    if (!isBigEnough(target, minImageSize)) continue;
    const rect = target.element.getBoundingClientRect();
    sizes.push({ width: rect.width, height: rect.height });
  }
  return sizes;
}

/**
 * Wait, cheaply, for this frame to be worth waking.
 *
 * Nothing here walks the tree or observes it. A picture arrives with a `load`
 * (caught in the capture phase, since it does not bubble), a pointer going over
 * one says so itself, and a frame that grows from an ad-sized slot into a page
 * reports a resize; each of those looks at one element, or at the plain
 * `img`/`canvas`/`video` list for a resize. A CSS background is only found by
 * the pointer, which is the one path that can afford to compute a style.
 *
 * `wake` runs once, with the picture that was hovered when that is what woke
 * it, so the button can appear over it straight away rather than on the next
 * time the pointer comes back.
 */
export function sleepUntilPicture(
  minImageSize: () => number,
  wake: (hovered: Target | null) => void
): void {
  let awake = false;
  let timer = 0;

  const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });
  // Asked before anything is classified, which costs a computed style: in an ad
  // slot this is the only work any of the listeners below ever does.
  const pointless = (): boolean => awake || !roomyFrame(viewport());

  const consider = (targets: Target[], hovered: Target | null): void => {
    if (pointless()) return;
    const min = minImageSize();
    if (!shouldWake(viewport(), shownSizes(targets, min), min)) return;
    awake = true;
    document.removeEventListener('load', onLoad, true);
    document.removeEventListener('pointerover', onPointer, true);
    window.removeEventListener('resize', onResize);
    window.clearTimeout(timer);
    wake(hovered);
  };

  const scan = (): void => {
    timer = 0;
    if (pointless()) return;
    const found: Target[] = [];
    for (const element of document.querySelectorAll('img, canvas, video')) {
      const target = classify(element);
      if (target) found.push(target);
    }
    consider(found, null);
  };

  function onLoad(event: Event): void {
    if (pointless()) return;
    const target = classify(event.target);
    if (target) consider([target], null);
  }

  function onPointer(event: Event): void {
    if (pointless()) return;
    // Nothing of ours exists yet, so nothing is ours.
    const target = targetFromEvent(event, minImageSize(), () => false);
    if (target) consider([target], target);
  }

  function onResize(): void {
    if (!timer) timer = window.setTimeout(scan, RESIZE_SETTLE_MS);
  }

  document.addEventListener('load', onLoad, true);
  document.addEventListener('pointerover', onPointer, true);
  window.addEventListener('resize', onResize);
  scan();
}
