import { scriptVersion } from '../gm.js';
import { OVERLAY_CSS } from '../render/overlay.js';
import { getSettings } from '../settings.js';
import { canHoldUi, keyboardInset } from './geometry.js';
import { MAX_OPACITY, clampOpacity } from './opacity.js';
import styles from './styles.css?raw';

/**
 * One shadow root for every piece of UI this script draws.
 *
 * Injecting into the page with GM_addStyle loses: the host page's own rules win
 * on equal specificity when they come later, and any `!important` beats us
 * outright. A shadow root is not a specificity contest — page CSS cannot reach
 * inside it at all.
 *
 * The host is a fixed, full-viewport, click-through layer. Everything inside is
 * therefore positioned in *viewport* coordinates, which also means overlays
 * follow scrolling by simply re-reading getBoundingClientRect, with no page
 * offset arithmetic.
 */

export const HOST_ID = 'lens-translate-root';

let shadow: ShadowRoot | null = null;
let host: HTMLDivElement | null = null;

const TOP = '2147483647';

/**
 * The innermost element that is fullscreen, through any shadow roots.
 *
 * `document.fullscreenElement` stops at the first shadow host on the way down;
 * the element that actually went fullscreen is found by asking each root in
 * turn. The prefixed name is what older WebKit publishes, and both are read as
 * properties that may simply not be there.
 */
function fullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  let element: Element | null = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  for (;;) {
    const inner: Element | null | undefined = element?.shadowRoot?.fullscreenElement;
    if (!inner || inner === element) return element;
    element = inner;
  }
}

/**
 * Put the host where it can be seen.
 *
 * Fullscreen renders the fullscreen element's subtree and nothing else, so a
 * host parked on `<html>` is simply not drawn while a reader is fullscreen -
 * no button, no menu, no settings. It moves inside on the way in and back out
 * on the way out. Covers need none of this: they are siblings of the picture
 * and go wherever it goes.
 *
 * A component that is fullscreen and keeps its content in a shadow root of its
 * own shows only that root, so the host goes into it rather than beside it. An
 * element that cannot show children at all (a `<video>` made fullscreen by
 * itself) leaves nowhere to go, and the host stays where it was.
 */
export function placeHost(): void {
  if (!host) return;
  const full = fullscreenElement();
  const home: ParentNode =
    full && canHoldUi(full.tagName) ? (full.shadowRoot ?? full) : document.documentElement;
  if (host.parentNode !== home) home.appendChild(host);
}

/**
 * How many times the host has stepped over a rival for the top of the stack.
 *
 * Bounded, because the rival may be another script doing exactly this, and two
 * of them re-appending themselves past each other for ever is worse than
 * either being underneath.
 */
let overtakes = 0;
const MAX_OVERTAKES = 5;

/**
 * Keep the host in the page and on top of it.
 *
 * Its z-index is already the largest there is, which settles everything except
 * a tie: a reader that opens its page in a fixed layer with the same number
 * and adds it later is painted above, because later wins among equals. Going
 * to the end of the parent again wins it back. Called from the front end's
 * slow sweep rather than from an observer of its own - it is a backstop for
 * pages that rebuild their own `<html>` children as well.
 */
export function tendHost(): void {
  if (!host) return;
  placeHost();
  if (overtakes >= MAX_OVERTAKES) return;
  let sibling = host.nextElementSibling;
  for (let seen = 0; sibling && seen < 20; seen += 1, sibling = sibling.nextElementSibling) {
    const style = getComputedStyle(sibling);
    if (style.zIndex === TOP && style.position !== 'static') {
      overtakes += 1;
      host.parentNode?.appendChild(host);
      return;
    }
  }
}

/**
 * Tell the stylesheet how much of the bottom the keyboard has taken.
 *
 * A sheet fixed to the bottom of the screen is exactly where a keyboard opens,
 * and the one sheet with a text field in it is the one that summons it. CSS
 * has no unit for this that Android Chrome fills in, so it is measured: see
 * `keyboardInset`. `visualViewport` is feature-tested like everything else - a
 * host that hands the script a copy of `window` may not carry it.
 */
function trackKeyboard(target: HTMLElement): void {
  const visual = window.visualViewport;
  if (!visual || typeof visual.addEventListener !== 'function') return;
  const update = (): void => {
    target.style.setProperty('--lt-kb', `${keyboardInset(window.innerHeight, visual)}px`);
  };
  visual.addEventListener('resize', update);
  visual.addEventListener('scroll', update);
  update();
}

/**
 * What a press on our UI may not tell the page.
 *
 * In fullscreen the host lives inside the reader's own element, so a reader
 * that turns the page on a click turned it on every tap of our menu; outside
 * fullscreen the same happens to anything listening on the document. Stopped
 * at the host, on the way up: everything of ours is registered inside the
 * shadow root, below the host, and has already run by the time the event gets
 * here. The page's capture-phase listeners still see it, which nothing can
 * prevent and nothing of ours relies on.
 *
 * Only propagation. Cancelling the default would break our own buttons, links
 * and the wheel scrolling a sheet. Keyboard events are left alone: the fields
 * stop their own keys, and Escape has to reach whoever closes on it.
 */
const CONTAINED = [
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'touchmove',
  'touchcancel',
  'wheel',
] as const;

function containEvents(target: HTMLElement): void {
  const stop = (event: Event): void => event.stopPropagation();
  // Passive: a wheel or touch listener that is not would make the browser wait
  // on it before scrolling, and this one never cancels anything.
  for (const type of CONTAINED) target.addEventListener(type, stop, { passive: true });
}

/**
 * How see-through our popups are, as two things the stylesheet reads off the
 * host: `--lt-opacity`, which goes into the background colours and nowhere
 * else, and `data-translucent`, which adds the blur that keeps text readable
 * over a busy picture.
 *
 * On the host's inline style because that is the one place no page rule can
 * override, and custom properties are not reset by its `all: initial`. Also
 * what the settings panel calls while its slider moves, so the panel itself is
 * the preview; closing it puts back whatever is saved.
 */
export function applyPopupOpacity(raw: unknown): void {
  if (!host) return;
  const percent = clampOpacity(raw);
  host.style.setProperty('--lt-opacity', `${percent}%`);
  host.toggleAttribute('data-translucent', percent < MAX_OPACITY);
}

/**
 * Light or dark, and which tint, as two attributes on the host that the
 * stylesheet keys its colour tokens on. 'auto' and the neutral tint are the
 * absence of the attribute, so the defaults are exactly the stylesheet as it
 * was. Like the opacity, also what the settings window calls while a choice is
 * being looked at.
 */
export function applyLook(theme: unknown, accent: unknown): void {
  if (!host) return;
  if (theme === 'light' || theme === 'dark') host.dataset['theme'] = theme;
  else delete host.dataset['theme'];
  if (typeof accent === 'string' && accent !== 'zinc' && /^[a-z]+$/.test(accent)) host.dataset['accent'] = accent;
  else delete host.dataset['accent'];
}

/**
 * Our stylesheet, as a constructed sheet where the browser has them.
 *
 * A `<style>` element is inline style to a Content-Security-Policy, and a page
 * or frame with `style-src` but no 'unsafe-inline' (or with a nonce, which
 * switches 'unsafe-inline' off) refuses it: the controls then come out as a
 * bare column of icons under the page, as reported on 360.yandex.ru. A
 * constructed sheet is CSSOM, which CSP does not govern, and no page script
 * can take it out of the tree either. The element stays as the fallback for an
 * engine without `adoptedStyleSheets`.
 */
function adoptStyles(root: ShadowRoot, css: string): void {
  try {
    if ('adoptedStyleSheets' in root && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      return;
    }
  } catch {
    // An engine that has the property but refuses the constructor.
  }
  const element = document.createElement('style');
  element.textContent = css;
  root.appendChild(element);
}

export function uiRoot(): ShadowRoot {
  if (shadow) return shadow;

  host = document.createElement('div');
  host.id = HOST_ID;
  // The one place a phone can be asked which build it is running. There is no
  // console to open there and GM_info does not reach the page, so without this
  // the answer costs a round trip through the user every time.
  host.dataset['version'] = scriptVersion();
  // Inline, and marked important, because this one element does live in the
  // page and is the only thing page CSS could still interfere with.
  //
  // `all: initial` is what stops inherited properties - font, colour, direction,
  // line-height - from leaking in through the host, since shadow DOM only
  // blocks *selectors*. It has to come first, and the font has to be restated
  // after it: `initial` for font-family is the browser's serif default, and an
  // inline !important declaration outranks any :host rule, so a stylesheet
  // cannot put it back.
  //
  // Through `cssText`, never the `style` attribute: a page whose CSP allows no
  // inline styles drops an attribute set from script, and the host then sits
  // in the flow after the page with everything inherited from it. CSSOM is not
  // what CSP governs.
  host.style.cssText = [
    'all: initial',
    "font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif",
    'color: #09090b',
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 100%',
    'height: 100%',
    `z-index: ${TOP}`,
    'pointer-events: none',
  ]
    .map((rule) => `${rule} !important`)
    .join(';');

  shadow = host.attachShadow({ mode: 'open' });
  // The DOM renderer's own rules come with it rather than being kept here: a
  // front end that forgets them gets a correct layout stacked in one corner.
  adoptStyles(shadow, `${styles}\n${OVERLAY_CSS}`);

  containEvents(host);
  applyPopupOpacity(getSettings().popupOpacity);
  applyLook(getSettings().uiTheme, getSettings().uiAccent);
  placeHost();
  trackKeyboard(host);
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(type, placeHost);
  }
  return shadow;
}

/** True when the node belongs to our own UI, so we never act on our own chrome. */
export function isOurs(node: EventTarget | null): boolean {
  const element = node as Element | null;
  return Boolean(element?.closest?.(`#${HOST_ID}`)) || (element?.getRootNode?.() === shadow);
}
