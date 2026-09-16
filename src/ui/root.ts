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

const HOST_ID = 'lens-translate-root';

let shadow: ShadowRoot | null = null;

export function uiRoot(): ShadowRoot {
  if (shadow) return shadow;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Inline, and marked important, because this one element does live in the
  // page and is the only thing page CSS could still interfere with.
  //
  // `all: initial` is what stops inherited properties - font, colour, direction,
  // line-height - from leaking in through the host, since shadow DOM only
  // blocks *selectors*. It has to come first, and the font has to be restated
  // after it: `initial` for font-family is the browser's serif default, and an
  // inline !important declaration outranks any :host rule, so a stylesheet
  // cannot put it back.
  host.setAttribute(
    'style',
    [
      'all: initial',
      "font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif",
      'color: #1a1a1a',
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'z-index: 2147483647',
      'pointer-events: none',
    ]
      .map((rule) => `${rule} !important`)
      .join(';')
  );

  shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  shadow.appendChild(sheet);

  document.documentElement.appendChild(host);
  return shadow;
}

/** True when the node belongs to our own UI, so we never act on our own chrome. */
export function isOurs(node: EventTarget | null): boolean {
  const element = node as Element | null;
  return Boolean(element?.closest?.(`#${HOST_ID}`)) || (element?.getRootNode?.() === shadow);
}
