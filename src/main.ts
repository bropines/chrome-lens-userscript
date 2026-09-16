import { GM_registerMenuCommand } from '$';

import { callLens } from './lens/client.js';
import { prepareImage } from './image.js';
import {
  clearAllOverlays,
  clearOverlay,
  hasOverlay,
  renderTranslation,
  repositionOverlays,
} from './render/overlay.js';
import { renderToBlobUrl } from './render/canvas.js';
import { isSwapped, restoreAll, restoreImage, swapImage } from './render/swap.js';
import { getSettings, saveSettings } from './settings.js';
import { openSettings } from './ui/settings-panel.js';
import { isOurs, uiRoot } from './ui/root.js';
import type { Settings } from './types.js';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>`;
const GEAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="15" height="15"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>`;

let settings: Settings = getSettings();

const root = uiRoot();

const button = document.createElement('div');
button.id = 'lt-button';
button.innerHTML = ICON;
button.title = 'Translate the text in this image (click again to undo)';
root.appendChild(button);

const gear = document.createElement('div');
gear.id = 'lt-gear';
gear.innerHTML = GEAR;
gear.title = 'Lens Translate settings';
root.appendChild(gear);

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

const isTranslated = (img: HTMLImageElement): boolean => isSwapped(img) || hasOverlay(img);

function undo(img: HTMLImageElement): boolean {
  const restored = restoreImage(img) || clearOverlay(img);
  if (restored) button.classList.remove('lt-active');
  return restored;
}

async function translate(img: HTMLImageElement): Promise<void> {
  if (busy.has(img)) return;
  if (!settings.enabled) {
    toast('Translation is switched off in settings');
    return;
  }
  if (undo(img)) return;

  busy.add(img);
  button.classList.add('lt-busy');
  button.classList.remove('lt-error');
  try {
    const prepared = await prepareImage(img, settings);
    try {
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

      if (settings.renderMode === 'canvas') {
        const url = await renderToBlobUrl(
          prepared.source,
          prepared.sourceWidth,
          prepared.sourceHeight,
          result.blocks,
          settings,
          // The displayed width is what decides whether text will be legible.
          img.getBoundingClientRect().width || prepared.sourceWidth
        );
        swapImage(img, url);
      } else if (!renderTranslation(img, result.blocks, settings)) {
        toast('Nothing could be placed on this image');
        return;
      }
      if (currentImage === img) button.classList.add('lt-active');
    } finally {
      prepared.release();
    }
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
let gearTimer: number | undefined;

/** How long the cursor has to linger before the settings button joins in. */
const GEAR_DELAY_MS = 550;

function showGear(img: HTMLImageElement): void {
  const rect = img.getBoundingClientRect();
  gear.style.top = `${rect.top + 8}px`;
  gear.style.left = `${rect.left + rect.width - 69}px`;
  gear.style.opacity = '1';
  gear.style.transform = 'scale(1)';
  gear.style.pointerEvents = 'auto';
}

function hideGear(): void {
  window.clearTimeout(gearTimer);
  gear.style.opacity = '0';
  gear.style.transform = 'scale(0.9)';
  gear.style.pointerEvents = 'none';
}

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
  button.classList.toggle('lt-active', isTranslated(img));

  window.clearTimeout(gearTimer);
  if (gear.style.opacity === '1') showGear(img);
  else gearTimer = window.setTimeout(() => showGear(img), GEAR_DELAY_MS);
}

function hideButton(): void {
  button.style.opacity = '0';
  button.style.transform = 'scale(0.9)';
  button.style.pointerEvents = 'none';
  hideGear();
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

for (const control of [button, gear]) {
  control.addEventListener('mouseover', () => window.clearTimeout(hideTimer));
  control.addEventListener('mouseout', () => {
    hideTimer = window.setTimeout(hideButton, 300);
  });
}

gear.addEventListener(
  'click',
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSettings((saved) => {
      settings = saved;
      toast('Settings saved');
    });
  },
  true
);

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
  if (currentImage?.isConnected) {
    showButton(currentImage);
    if (gear.style.opacity === '1') showGear(currentImage);
  } else if (currentImage) hideButton();
}

window.addEventListener('resize', reposition);
window.addEventListener('scroll', reposition, true);

GM_registerMenuCommand('Lens Translate: settings', () =>
  openSettings((saved) => {
    settings = saved;
    toast('Settings saved');
  })
);

GM_registerMenuCommand('Lens Translate: undo all on this page', () => {
  const restored = restoreAll() + clearAllOverlays();
  toast(restored ? `Restored ${restored} image${restored === 1 ? '' : 's'}` : 'Nothing to restore');
});

GM_registerMenuCommand('Lens Translate: toggle on/off', () => {
  settings = saveSettings({ enabled: !settings.enabled });
  if (!settings.enabled) {
    restoreAll();
    clearAllOverlays();
    hideButton();
  }
  toast(settings.enabled ? 'Translation enabled' : 'Translation disabled');
});
