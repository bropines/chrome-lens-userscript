import { gmTransport, registerCommand } from './gm.js';
import { setTransport } from './transport.js';
import { diagnose } from './diagnose.js';

import { callLens } from './lens/client.js';
import { acquireSource, encodeForUpload, fingerprint } from './image.js';
import { clearStored, getStored, putStored, storedStats } from './store.js';
import { collect, ignoreElements, isBigEnough, targetFromEvent } from './detect.js';
import type { Target } from './detect.js';
import {
  clearAllOverlays,
  clearOverlay,
  hasOverlay,
  renderTranslation,
  repositionOverlays,
} from './render/overlay.js';
import { renderToBlob } from './render/canvas.js';
import { coverImage, isCover, isCovered, uncoverAll, uncoverImage } from './render/cover.js';
import { getSettings, saveSettings } from './settings.js';
import {
  cacheKey,
  cacheStats,
  clearCache,
  getCached,
  getRender,
  putCached,
  putRender,
  renderKey,
} from './cache.js';
import { openSettings } from './ui/settings-panel.js';
import { onReportSettings, openReport } from './ui/report.js';
import { HOST_ID, isOurs, uiRoot } from './ui/root.js';
import type { Settings } from './types.js';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>`;
const GEAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="15" height="15"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>`;

let settings: Settings = getSettings();

/**
 * What this front end supplies the engine, before anything can ask it for
 * something.
 *
 * The engine knows it needs a privileged cross-origin POST, and that two kinds
 * of element are not pictures however much they look like one. It does not
 * know which userscript host is running, that our UI is a shadow root, or that
 * a finished translation is an `<img>` in the page - and it used to, by
 * importing all three, which is what made it unusable anywhere but here.
 */
setTransport(gmTransport);
ignoreElements((element) => element.id === HOST_ID || isCover(element));

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

const busy = new WeakSet<HTMLElement>();

/**
 * What is showing a translation right now.
 *
 * A finished rendering is a picture drawn under the settings of the moment, so
 * changing them has to redraw it - otherwise the panel says one thing and the
 * page shows another, and the only way to reconcile them is to toggle every
 * image by hand. A Map rather than a WeakMap because this one has to be walked.
 */
const showing = new Map<HTMLElement, Target>();

const isTranslated = (img: HTMLElement): boolean => isCovered(img) || hasOverlay(img);

function undo(img: HTMLElement): boolean {
  showing.delete(img);
  const restored = uncoverImage(img) || clearOverlay(img);
  if (restored) button.classList.remove('lt-active');
  return restored;
}

async function translate(target: Target): Promise<void> {
  const img = target.element;
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
    // A canvas and a video have no address, so they key on nothing and are
    // simply never cached - there is no second request to save.
    const key = cacheKey(target.url, settings);
    const displayedWidth = img.getBoundingClientRect().width;

    // A finished rendering short-circuits everything: no pixels to fetch, no
    // canvas to paint, no round trip. This is the path a repeat toggle takes.
    if (settings.renderMode === 'canvas' && target.url) {
      const done = getRender(renderKey(key, settings, displayedWidth), settings);
      if (done && coverImage(img, URL.createObjectURL(done))) {
        showing.set(img, target);
        if (currentTarget?.element === img) button.classList.add('lt-active');
        return;
      }
    }

    // Pixels are needed for rendering either way. The JPEG encode and the round
    // trip are not, so both sit behind the response cache - encoding an upload
    // nobody sends was the expensive half of a cache hit.
    const prepared = await acquireSource(target);
    try {
      let result = target.url ? getCached(key, settings) : undefined;

      // The pixels are in hand but not yet encoded, which is the moment to ask
      // whether this picture has been answered before - under any address, and
      // in any earlier life of this page. The encode is the expensive half and
      // sits after this deliberately.
      const hash = result ? '' : fingerprint(prepared.source, prepared.width, prepared.height);
      if (!result && hash) {
        const remembered = await getStored(hash, settings);
        if (remembered) {
          result = remembered;
          if (target.url) putCached(key, result, settings);
        }
      }

      if (!result) {
        const upload = await encodeForUpload(prepared.source, settings);
        result = await callLens(upload, settings);
        if (target.url) putCached(key, result, settings);
        void putStored(hash, result, settings);
      }

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
        const blob = await renderToBlob(
          prepared.source,
          prepared.width,
          prepared.height,
          result.blocks,
          settings,
          // The displayed width is what decides whether text will be legible.
          displayedWidth
        );
        if (target.url) putRender(renderKey(key, settings, displayedWidth), blob, settings);
        const url = URL.createObjectURL(blob);
        if (!coverImage(img, url)) {
          URL.revokeObjectURL(url);
          toast('This image cannot be covered here');
          return;
        }
      } else if (
        !renderTranslation(
          img,
          result.blocks,
          settings,
          { width: prepared.width, height: prepared.height },
          root
        )
      ) {
        toast('Nothing could be placed on this image');
        return;
      }
      showing.set(img, target);
      if (currentTarget?.element === img) button.classList.add('lt-active');
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

let currentTarget: Target | null = null;
let hideTimer: number | undefined;
let gearTimer: number | undefined;

/** How long the cursor has to linger before the settings button joins in. */
const GEAR_DELAY_MS = 550;

/**
 * Where a control sits. Usually the image's own box, but a pinned button
 * anchors to the part of it that is on screen: scroll a tall page halfway and
 * the image's top edge - and with it the button - is above the viewport.
 */
interface Anchor {
  top: number;
  left: number;
  width: number;
  height: number;
}

function showGear(target: Target, anchor?: Anchor): void {
  const rect = anchor ?? target.element.getBoundingClientRect();
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

function showButton(target: Target, anchor?: Anchor): void {
  if (!settings.showButton) return;
  const img = target.element;
  currentTarget = target;
  // Viewport coordinates: the shadow host is fixed and covers the viewport.
  const rect = anchor ?? img.getBoundingClientRect();
  button.style.top = `${rect.top + 5}px`;
  button.style.left = `${rect.left + rect.width - 37}px`;
  button.style.opacity = '1';
  button.style.transform = 'scale(1)';
  button.style.pointerEvents = 'auto';
  button.classList.toggle('lt-active', isTranslated(img));

  window.clearTimeout(gearTimer);
  if (gear.style.opacity === '1') showGear(target);
  else gearTimer = window.setTimeout(() => showGear(target), GEAR_DELAY_MS);
}

function hideButton(): void {
  button.style.opacity = '0';
  button.style.transform = 'scale(0.9)';
  button.style.pointerEvents = 'none';
  hideGear();
  currentTarget = null;
}

/**
 * Keeping the button on screen, for a device that cannot hover.
 *
 * A touch screen has no hover at all, so nothing would ever bring the button
 * out - and the tap that would summon it is exactly the tap a reader uses to
 * turn the page. Pinned mode puts it over whichever image fills most of the
 * viewport instead, and leaves it there.
 *
 * This is a scan rather than an IntersectionObserver on purpose. The observer
 * version was written first and is the obvious answer, but it only reports
 * while the document is being rendered: in a tab that is never painted it
 * simply never fires, and the button never appears with no error to say why.
 * A scan answers from layout, which is always there, and reading a few hundred
 * rects once per frame costs nothing next to that.
 *
 * What it scans comes from `detect.ts` and is refreshed when the page changes,
 * not re-derived per frame: walking the composed tree is the expensive part,
 * and on the page this was written for every picture arrives from an API long
 * after the document is done.
 */
let pinned = false;
let pinnedFrame = 0;

/**
 * The pictures this page is known to hold.
 *
 * Refreshed when the DOM changes rather than re-derived per frame, and
 * throttled because a busy page mutates constantly while the answer only has
 * to be right by the next time the button is placed.
 */
let known: Target[] = [];
let refreshTimer = 0;
let tree: MutationObserver | null = null;

/**
 * How many times an empty page is asked again before the script gives up.
 *
 * A lazily-loaded image has no box until it loads and does not load until it
 * has one, so a page can materialise its pictures without firing anything this
 * listens for. A bounded retry covers that; unbounded, it would be a walk of
 * the whole tree every quarter second on a page that simply has no pictures.
 * Anything that says the page changed - a mutation, a scroll - resets it.
 */
const EMPTY_RETRIES = 8;
let emptyRetries = 0;

/** Long enough that a chatty page does not pay for every mutation. */
const REFRESH_DELAY_MS = 250;

function refresh(): void {
  known = collect(settings.minImageSize);
  updatePinned();
}

function somethingChanged(): void {
  emptyRetries = 0;
  scheduleRefresh();
}

function scheduleRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0;
    refresh();
  }, REFRESH_DELAY_MS);
}

/** The part of an image that is actually on screen. */
function visiblePart(element: HTMLElement): Anchor {
  const rect = element.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const width = Math.min(rect.right, window.innerWidth) - left;
  const height = Math.min(rect.bottom, window.innerHeight) - top;
  return { top, left, width: Math.max(0, width), height: Math.max(0, height) };
}

/** The picture the reader is looking at: the most viewport area wins. */
function mostVisible(): (Anchor & { target: Target }) | null {
  let best: (Anchor & { target: Target }) | null = null;
  let bestArea = 0;

  let bestRank = -1;

  for (const target of known) {
    if (!target.element.isConnected) continue;
    if (!isBigEnough(target, settings.minImageSize)) continue;
    const part = visiblePart(target.element);
    const area = part.width * part.height;
    // Area decides among equals, but anything a pointer can reach outranks
    // anything it cannot: a full-viewport overlay always wins on area alone.
    const rank = target.pointable ? 1 : 0;
    if (rank > bestRank || (rank === bestRank && area > bestArea)) {
      bestRank = rank;
      bestArea = area;
      best = { ...part, target };
    }
  }
  return best;
}

function updatePinned(): void {
  // Scrolling fires far faster than the screen refreshes, and the answer only
  // has to be right once per frame.
  if (!pinned || pinnedFrame) return;
  pinnedFrame = window.requestAnimationFrame(() => {
    pinnedFrame = 0;
    if (!pinned) return;
    const found = settings.showButton ? mostVisible() : null;
    if (!found) {
      hideButton();
      if (emptyRetries < EMPTY_RETRIES) {
        emptyRetries += 1;
        scheduleRefresh();
      }
      return;
    }
    emptyRetries = 0;
    showButton(found.target, found);
    // No cursor to linger, so the delay before the settings button would only
    // ever be a delay.
    showGear(found.target, found);
  });
}

/** An image with no size yet fails isCandidate, so it is reconsidered on load. */
function onImageLoad(event: Event): void {
  // An image with no size yet is not a candidate, so the list has to be taken
  // again once it has one - and its address may only now be its real one.
  if ((event.target as Element | null)?.tagName === 'IMG') somethingChanged();
}

/**
 * A pointer that cannot hover, or one too coarse to aim with.
 *
 * `hover: none` alone is the textbook test and it is not enough: a phone with a
 * stylus or a mouse attached reports `hover: hover`, and the answer also is not
 * always settled at document-idle. Both were enough to leave a phone with no
 * button at all, back when pinning took the hover path away with it.
 */
const TOUCH_QUERY = '(hover: none), (pointer: coarse)';

function applyButtonMode(): void {
  const wanted =
    settings.buttonMode === 'pinned' ||
    (settings.buttonMode === 'auto' && window.matchMedia(TOUCH_QUERY).matches);
  if (wanted === pinned) return;
  pinned = wanted;
  if (pinned) {
    document.addEventListener('load', onImageLoad, true);
    tree = new MutationObserver(somethingChanged);
    tree.observe(document.documentElement, {
      childList: true,
      subtree: true,
      // A lazily-loaded image is the same element with a new address, and a
      // background only exists in a style, so neither shows up as a new node.
      attributes: true,
      attributeFilter: ['src', 'srcset', 'style', 'class'],
    });
    refresh();
  } else {
    document.removeEventListener('load', onImageLoad, true);
    tree?.disconnect();
    tree = null;
    hideButton();
  }
}

document.addEventListener(
  'mouseover',
  (event) => {
    const found = targetFromEvent(event, settings.minImageSize, isOurs);
    if (!found) return;
    window.clearTimeout(hideTimer);
    showButton(found);
  },
  true
);

document.addEventListener(
  'mouseout',
  (event) => {
    if (pinned) return;
    if (targetFromEvent(event, settings.minImageSize, isOurs)) {
      hideTimer = window.setTimeout(hideButton, 300);
    }
  },
  true
);

for (const control of [button, gear]) {
  control.addEventListener('mouseover', () => window.clearTimeout(hideTimer));
  control.addEventListener('mouseout', () => {
    if (pinned) return;
    hideTimer = window.setTimeout(hideButton, 300);
  });
}

/**
 * Draw everything again under the settings just saved.
 *
 * It goes back through `translate`, so a change that only affects the drawing
 * comes out of the response cache and costs nothing, while changing the target
 * language asks Lens again - which is the right answer in both cases and not
 * one this has to decide for itself.
 */
async function redrawShowing(): Promise<void> {
  const targets = [...showing.values()].filter((target) => target.element.isConnected);
  if (!targets.length) return;
  for (const target of targets) {
    undo(target.element);
    await translate(target);
  }
}

function onSaved(saved: Settings): void {
  settings = saved;
  applyButtonMode();
  void redrawShowing();
  toast('Settings saved');
}

gear.addEventListener(
  'click',
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSettings(onSaved);
  },
  true
);

button.addEventListener(
  'click',
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (currentTarget) void translate(currentTarget);
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

    const found = targetFromEvent(event, settings.minImageSize, isOurs);
    if (!found) return;
    event.preventDefault();
    event.stopPropagation();
    void translate(found);
  },
  true
);

function reposition(): void {
  repositionOverlays();
  // The button is placed in viewport coordinates too, so it drifts if the page
  // scrolls while it is showing - and when it is pinned, scrolling is also
  // what moves it to the next image.
  if (pinned) {
    // A scroll is the page saying something is different; a list that came up
    // empty deserves another look.
    emptyRetries = 0;
    updatePinned();
    return;
  }
  if (currentTarget?.element.isConnected) {
    showButton(currentTarget);
    if (gear.style.opacity === '1') showGear(currentTarget);
  } else if (currentTarget) hideButton();
}

window.addEventListener('resize', reposition);
window.addEventListener('scroll', reposition, true);

registerCommand({
  menuLabel: 'Lens Translate: settings',
  // The panel is where these are drawn, so it does not offer to open itself.
  label: null,
  run: () => openSettings(onSaved),
});

registerCommand({
  menuLabel: 'Lens Translate: clear cache',
  label: 'Clear cache',
  run: () => {
    // Two stores with one budget between them, so they are reported as one.
    const memory = cacheStats();
    clearCache();
    void storedStats().then(({ entries, bytes }) => {
      void clearStored();
      const total = memory.entries + entries;
      toast(
        total
          ? `Cleared ${total} cached result${total === 1 ? '' : 's'} ` +
            `(${((memory.bytes + bytes) / 1048576).toFixed(1)} MB)`
          : 'The cache was already empty'
      );
    });
  },
});

registerCommand({
  menuLabel: 'Lens Translate: undo all on this page',
  label: 'Undo all on this page',
  run: () => {
    showing.clear();
    const restored = uncoverAll() + clearAllOverlays();
    toast(restored ? `Restored ${restored} image${restored === 1 ? '' : 's'}` : 'Nothing to restore');
  },
});

registerCommand({
  menuLabel: 'Lens Translate: diagnostics',
  label: 'Run diagnostics',
  run: openDiagnostics,
});

registerCommand({
  menuLabel: 'Lens Translate: toggle on/off',
  label: 'Toggle on/off',
  run: () => {
    settings = saveSettings({ enabled: !settings.enabled });
    if (!settings.enabled) {
      showing.clear();
      uncoverAll();
      clearAllOverlays();
      hideButton();
    }
    toast(settings.enabled ? 'Translation enabled' : 'Translation disabled');
  },
});

/**
 * A way in that needs neither the button nor a menu.
 *
 * `GM_registerMenuCommand` exists on some hosts and has nowhere to appear on a
 * phone - mobile browsers have no userscript menu at all - and the settings
 * button is exactly what is missing whenever something is wrong. A fragment
 * needs no chrome of any kind: put `#lens-debug` on the end of any URL and the
 * report opens, which is the only way to ask a phone what the script is seeing.
 */
const DEBUG_HASH = '#lens-debug';

function openDiagnostics(): void {
  openReport('Probing...');
  void diagnose({ pinned }).then(openReport, (error: Error) =>
    openReport(`Diagnostics failed: ${error.message}`)
  );
}

function checkDebugHash(): void {
  if (window.location.hash === DEBUG_HASH) openDiagnostics();
}

onReportSettings(() => openSettings(onSaved));
window.addEventListener('hashchange', checkDebugHash);

applyButtonMode();
checkDebugHash();
// Asked once at document-idle is a snapshot, and the answer can arrive late or
// change under you - a mouse plugged into a tablet, a window moved between
// screens. Cheaper to be told than to re-ask on a timer.
window.matchMedia(TOUCH_QUERY).addEventListener('change', applyButtonMode);
