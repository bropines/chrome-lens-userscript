import { GM_registerMenuCommand } from '$';

import { callLens } from './lens/client.js';
import { prepareImage } from './image.js';
import { clearOverlay, hasOverlay, renderTranslation, repositionOverlays } from './render/overlay.js';
import { getSettings } from './settings.js';
import { openSettings } from './ui/settings-panel.js';
import { isOurs, uiRoot } from './ui/root.js';
import type { Settings } from './types.js';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>`;

let settings: Settings = getSettings();

const root = uiRoot();

const button = document.createElement('div');
button.id = 'lt-button';
button.innerHTML = ICON;
button.title = 'Translate the text in this image (click again to undo)';
root.appendChild(button);

const toastEl = document.createElement('div');
toastEl.id = 'lt-toast';
root.appendChild(toastEl);

let toastTimer: number | undefined;
function toast(message: string, ms = 3200): void {
  toastEl.textContent = message;
  toastEl.classList.add('lt-show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('lt-show'), ms);
}

const busy = new WeakSet<HTMLImageElement>();

async function translate(img: HTMLImageElement): Promise<void> {
  if (busy.has(img)) return;
  if (clearOverlay(img)) {
    button.classList.remove('lt-active');
    return;
  }

  busy.add(img);
  button.classList.add('lt-busy');
  button.classList.remove('lt-error');
  try {
    const prepared = await prepareImage(img, settings);
    const result = await callLens(prepared, settings);

    if (!result.blocks.length) {
      const detected = result.ocr.some((p) => p.lines.length > 0);
      toast(
        detected
          ? 'Lens read the text but returned no translation (same language?)'
          : 'Lens found no text in this image'
      );
      return;
    }

    const lines = renderTranslation(img, result.blocks, settings);
    if (currentImage === img) button.classList.add('lt-active');
    if (!lines) toast('Nothing could be placed on this image');
  } catch (error) {
    button.classList.add('lt-error');
    toast(`Lens: ${(error as Error).message}`, 5000);
    window.setTimeout(() => button.classList.remove('lt-error'), 3000);
  } finally {
    busy.delete(img);
    button.classList.remove('lt-busy');
  }
}

let currentImage: HTMLImageElement | null = null;
let hideTimer: number | undefined;

function isCandidate(node: unknown): node is HTMLImageElement {
  const img = node as HTMLImageElement | null;
  if (!img || img.tagName !== 'IMG') return false;
  // Rendered size, not natural size: a 4000px image scaled to a 20px icon is
  // still an icon.
  const rect = img.getBoundingClientRect();
  return rect.width >= settings.minImageSize && rect.height >= settings.minImageSize;
}

/**
 * The image under an event.
 *
 * composedPath is what makes this work on sites that put their content in a
 * shadow root of their own: a plain event.target would report the host element
 * instead of the image inside it.
 */
function imageFromEvent(event: Event): HTMLImageElement | null {
  for (const node of event.composedPath()) {
    if (isOurs(node as EventTarget)) return null;
    if (isCandidate(node)) return node;
  }
  return null;
}

function showButton(img: HTMLImageElement): void {
  if (!settings.showButton) return;
  currentImage = img;
  // Viewport coordinates: the shadow host is fixed and covers the viewport.
  const rect = img.getBoundingClientRect();
  button.style.top = `${rect.top + 5}px`;
  button.style.left = `${rect.left + rect.width - 37}px`;
  button.style.opacity = '1';
  button.style.transform = 'scale(1)';
  button.style.pointerEvents = 'auto';
  button.classList.toggle('lt-active', hasOverlay(img));
}

function hideButton(): void {
  button.style.opacity = '0';
  button.style.transform = 'scale(0.9)';
  button.style.pointerEvents = 'none';
  currentImage = null;
}

document.addEventListener(
  'mouseover',
  (event) => {
    const img = imageFromEvent(event);
    if (!img) return;
    window.clearTimeout(hideTimer);
    showButton(img);
  },
  true
);

document.addEventListener(
  'mouseout',
  (event) => {
    if (imageFromEvent(event)) hideTimer = window.setTimeout(hideButton, 300);
  },
  true
);

button.addEventListener('mouseover', () => window.clearTimeout(hideTimer));
button.addEventListener('mouseout', () => {
  hideTimer = window.setTimeout(hideButton, 300);
});

button.addEventListener(
  'click',
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (currentImage) void translate(currentImage);
  },
  true
);

// Modifier + click works even with the hover button switched off.
document.addEventListener(
  'click',
  (event) => {
    const modifier = settings.hotkey;
    if (modifier === 'none') return;
    const pressed =
      (modifier === 'alt' && event.altKey) ||
      (modifier === 'ctrl' && event.ctrlKey) ||
      (modifier === 'shift' && event.shiftKey);
    if (!pressed) return;

    const img = imageFromEvent(event);
    if (!img) return;
    event.preventDefault();
    event.stopPropagation();
    void translate(img);
  },
  true
);

function reposition(): void {
  repositionOverlays();
  // The button is placed in viewport coordinates too, so it drifts if the page
  // scrolls while it is showing.
  if (currentImage?.isConnected) showButton(currentImage);
  else if (currentImage) hideButton();
}

window.addEventListener('resize', reposition);
window.addEventListener('scroll', reposition, true);

GM_registerMenuCommand('Lens Translate: settings', () =>
  openSettings((saved) => {
    settings = saved;
    toast('Settings saved');
  })
);
