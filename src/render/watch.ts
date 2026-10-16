import { normalizeUrl } from '../cache.js';
import { classify } from '../detect.js';

/**
 * Noticing that a picture is no longer the picture a translation was made for.
 *
 * A translation is laid over an element, not over a picture, and a framework is
 * free to keep the element and change what it shows. A virtualised feed does
 * exactly that: it reuses an `<img>` for the next post by assigning a new `src`,
 * and a translation that nobody told sits on top of a different photograph.
 * When the framework makes a new element instead, the old one is simply gone,
 * and whatever was laid over it is left behind.
 *
 * So both are watched for: the address changing, and the element leaving the
 * document. A new address that normalises to the same one is not a change - that
 * is Twitter rewriting `?name=small` to `?name=large` as the layout moves, and
 * it is the same photo.
 */

export interface PictureHandlers {
  /** The element no longer shows what the translation is for. Final. */
  stale(): void;
  /**
   * The address is changing and it is not known yet whether it is a different
   * picture. The translation should get out of the way until `pending(false)`:
   * showing the old one over a new photograph while it loads is the bug.
   */
  pending(on: boolean): void;
}

/**
 * How long to let a changed `src` settle before reading what it resolved to.
 *
 * `currentSrc` is updated by the browser after the attribute is, so reading it
 * inside the mutation callback can still give the old answer. It does not wait
 * for the *load* - the address is chosen before the bytes arrive - so this is
 * short, and the load event covers anything slower.
 */
const SETTLE_MS = 60;

/** What an element's picture is, as an address that survives a rendition change. */
const identityOf = (element: HTMLElement): string => normalizeUrl(classify(element)?.url ?? '');

/** The attributes an <img> chooses its picture from. */
const signatureOf = (element: HTMLElement): string =>
  ['src', 'srcset', 'sizes'].map((name) => element.getAttribute(name) ?? '').join('\u0000');

export function watchPicture(element: HTMLElement, handlers: PictureHandlers): () => void {
  // Weak, so that watching an element does not keep it alive after the page has
  // thrown it away: a feed that recycles thousands of them would otherwise be
  // held up by the one thing here that was meant to notice.
  const ref = new WeakRef(element);
  const isImage = element.tagName === 'IMG';

  const remembered = identityOf(element);
  let signature = signatureOf(element);
  let timer: number | undefined;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    window.clearTimeout(timer);
    observer.disconnect();
    element.removeEventListener('load', check);
    element.removeEventListener('error', check);
  };

  function check(): void {
    if (stopped) return;
    window.clearTimeout(timer);
    const current = ref.deref();
    if (!current || !current.isConnected || identityOf(current) !== remembered) {
      stop();
      handlers.stale();
      return;
    }
    signature = signatureOf(current);
    handlers.pending(false);
  }

  const observer = new MutationObserver(() => {
    if (stopped) return;
    const current = ref.deref();
    if (!current) return;
    if (!isImage) {
      // A background is read from computed style, which is current already.
      check();
      return;
    }
    // Setting `src` to the value it already has is a mutation too, and it is
    // what a framework does on every render. Only a change is news.
    const now = signatureOf(current);
    if (now === signature) return;
    handlers.pending(true);
    window.clearTimeout(timer);
    timer = window.setTimeout(check, SETTLE_MS);
  });
  observer.observe(element, {
    attributes: true,
    attributeFilter: isImage ? ['src', 'srcset', 'sizes'] : ['style', 'class'],
  });

  // A new picture arriving - from a changed `src`, or from a <picture> source
  // switching under a media query, which no attribute on the <img> reports.
  element.addEventListener('load', check);
  element.addEventListener('error', check);

  return stop;
}
