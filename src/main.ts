import { copyText, gmTransport, preloadStored, registerCommand } from './gm.js';
import { setTransport } from './transport.js';
import { diagnose } from './diagnose.js';

import { callLens } from './lens/client.js';
import { ocrText, translationText } from './lens/text.js';
import { acquireSource, encodeForUpload, fingerprint } from './image.js';
import { clearStored, getStored, putStored, storedStats } from './store.js';
import { classify, collect, ignoreElements, isBigEnough, targetFromEvent } from './detect.js';
import type { Target } from './detect.js';
import {
  clearAllOverlays,
  clearOverlay,
  hasOverlay,
  peekAllOverlays,
  peekOverlay,
  renderTranslation,
  repositionOverlays,
  sweepOverlays,
} from './render/overlay.js';
import { renderToBlob } from './render/canvas.js';
import {
  coverImage,
  isCover,
  isCovered,
  peekAllCovers,
  peekCover,
  sweepCovers,
  uncoverAll,
  uncoverImage,
} from './render/cover.js';
import { SETTINGS_KEYS, getSettings, reloadSettings, saveSettings } from './settings.js';
import { SITES_KEY, hostOf, reloadSites, setSiteMode, siteMode } from './sites.js';
import type { SiteMode } from './sites.js';
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
import { closeMenu, isMenuOpen, openMenu } from './ui/menu.js';
import { onReportSettings, openReport } from './ui/report.js';
import { HOST_ID, isOurs, uiRoot } from './ui/root.js';
import type { LensResult, PeekKey, Settings } from './types.js';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>`;
const MORE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="15" height="15"><path d="M6,10A2,2 0 0,0 4,12A2,2 0 0,0 6,14A2,2 0 0,0 8,12A2,2 0 0,0 6,10M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10M18,10A2,2 0 0,0 16,12A2,2 0 0,0 18,14A2,2 0 0,0 20,12A2,2 0 0,0 18,10Z"/></svg>`;
const GEAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="15" height="15"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>`;

let settings: Settings = getSettings();

/**
 * What this site has been told: nothing, switched off, or translate-as-you-go.
 * Read once, because the page does not change hostname under a running script;
 * the commands that change it update this as well as the store.
 */
let site: SiteMode = siteMode();

/** Whether the script should act on this page at all. */
const active = (): boolean => settings.enabled && site !== 'off';

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

const more = document.createElement('div');
more.id = 'lt-more';
more.innerHTML = MORE;
more.title = 'Copy text, undo, and more';
root.appendChild(more);

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

/** The natural size an <img> already knows, for checking a cache entry's frame. */
function naturalSizeOf(target: Target): { width: number; height: number } | undefined {
  if (target.kind !== 'img') return undefined;
  const { naturalWidth, naturalHeight } = target.element as HTMLImageElement;
  return naturalWidth && naturalHeight ? { width: naturalWidth, height: naturalHeight } : undefined;
}

/**
 * What to do when a translation is taken away by the picture changing under it.
 *
 * Without this the entry stayed in `showing` for good: a settings change would
 * then translate it again by its old address, laying a translation of the
 * previous photo over the new one.
 */
const forgetter = (img: HTMLElement) => (): void => {
  showing.delete(img);
  if (currentTarget?.element === img) button.classList.remove('lt-active');
};

/**
 * Let go of what the page has thrown away.
 *
 * A feed that never ends discards images as fast as it makes them, and each
 * translated one was held by `showing` (a strong reference to the element) and
 * by an object URL nothing would revoke. The covers watch for most of this as
 * it happens; this is the backstop, and the only thing that prunes `showing`
 * of an entry whose translation was removed by somebody else.
 */
const SWEEP_MS = 3000;

function sweep(): void {
  if (document.hidden) return;
  sweepCovers();
  sweepOverlays();
  for (const img of [...showing.keys()]) {
    if (!img.isConnected || !isTranslated(img)) showing.delete(img);
  }
}

window.setInterval(sweep, SWEEP_MS);

const isTranslated = (img: HTMLElement): boolean => isCovered(img) || hasOverlay(img);

function undo(img: HTMLElement): boolean {
  showing.delete(img);
  results.delete(img);
  const restored = uncoverImage(img) || clearOverlay(img);
  if (restored) button.classList.remove('lt-active');
  return restored;
}

/**
 * What Lens said about each picture that is showing, for copying the words.
 *
 * Weak, so a picture the page discards takes its answer with it - an answer
 * carries the inpainted patches and is not small.
 */
const results = new WeakMap<HTMLElement, LensResult>();
let lastShown: WeakRef<HTMLElement> | null = null;

/** How many translations are in flight; the button spins while it is above zero. */
let working = 0;

function setWorking(delta: number): void {
  working += delta;
  button.classList.toggle('lt-busy', working > 0);
}

/**
 * How a translate request ended, for a caller that is doing many of them.
 *   shown   - a translation is on the picture now
 *   undone  - it was already translated, so this took it off
 *   empty   - Lens answered and there was nothing to put up
 *   failed  - something went wrong; the message is in `lastFailure`
 *   skipped - not attempted: busy, or the script is switched off here
 */
type Outcome = 'shown' | 'undone' | 'empty' | 'failed' | 'skipped';

let lastFailure = '';

interface TranslateOptions {
  /**
   * Say nothing. A batch of forty pictures with forty toasts is no way to
   * report that three of them had no text; the caller summarises instead.
   */
  quiet?: boolean;
}

async function translate(target: Target, options: TranslateOptions = {}): Promise<Outcome> {
  const img = target.element;
  const say = (message: string, ms?: number): void => {
    if (!options.quiet) toast(message, ms);
  };

  if (busy.has(img)) return 'skipped';
  if (!settings.enabled) {
    say('Translation is switched off in settings');
    return 'skipped';
  }
  if (site === 'off') {
    say(`Lens Translate is switched off on ${hostOf()} (userscript menu: toggle for this site)`);
    return 'skipped';
  }
  if (undo(img)) return 'undone';

  busy.add(img);
  setWorking(1);
  button.classList.remove('lt-error');
  try {
    // A canvas and a video have no address, so they key on nothing and are
    // simply never cached - there is no second request to save.
    const key = cacheKey(target.url, settings);
    const displayedWidth = img.getBoundingClientRect().width;

    // A finished rendering short-circuits everything: no pixels to fetch, no
    // canvas to paint, no round trip. This is the path a repeat toggle takes.
    //
    // Not for a background: where its cover goes depends on the picture's own
    // size, which a stored rendering does not carry and the pixels do.
    if (settings.renderMode === 'canvas' && target.url && target.kind !== 'background') {
      const done = getRender(
        renderKey(key, settings, displayedWidth),
        settings,
        naturalSizeOf(target)
      );
      // coverImage owns the URL from here, so a cover that cannot be laid does
      // not leave one behind.
      if (done && coverImage(img, URL.createObjectURL(done), { onGone: forgetter(img) })) {
        shown(img, target, getCached(key, settings, naturalSizeOf(target)));
        return 'shown';
      }
    }

    // Pixels are needed for rendering either way. The JPEG encode and the round
    // trip are not, so both sit behind the response cache - encoding an upload
    // nobody sends was the expensive half of a cache hit.
    const prepared = await acquireSource(target);
    try {
      // What the pixels measure, so a cached answer for a different crop under
      // the same address is a miss rather than a translation laid out for
      // another frame.
      const size = { width: prepared.width, height: prepared.height };
      let result = target.url ? getCached(key, settings, size) : undefined;

      // The pixels are in hand but not yet encoded, which is the moment to ask
      // whether this picture has been answered before - under any address, and
      // in any earlier life of this page. The encode is the expensive half and
      // sits after this deliberately.
      const hash = result ? '' : fingerprint(prepared.source, prepared.width, prepared.height);
      if (!result && hash) {
        const remembered = await getStored(hash, settings);
        if (remembered) {
          result = remembered;
          if (target.url) putCached(key, result, settings, size);
        }
      }

      if (!result) {
        const upload = await encodeForUpload(prepared.source, settings);
        result = await callLens(upload, settings);
        if (target.url) putCached(key, result, settings, size);
        void putStored(hash, result, settings);
      }

      if (!result.blocks.length) {
        const detected = result.ocr.some((p) => p.lines.length > 0);
        // The words are still worth having even when there is nothing to draw.
        results.set(img, result);
        say(
          detected
            ? 'Lens read the text but returned no translation (same language?)'
            : 'Lens found no text in this image'
        );
        return 'empty';
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
        if (target.url) {
          putRender(renderKey(key, settings, displayedWidth), blob, settings, size);
        }
        const covered = coverImage(img, URL.createObjectURL(blob), {
          onGone: forgetter(img),
          ...(target.background
            ? {
                background: {
                  spec: target.background,
                  natural: { width: prepared.width, height: prepared.height },
                },
              }
            : {}),
        });
        if (!covered) {
          lastFailure = 'it cannot be covered here';
          say(
            target.kind === 'background'
              ? 'This background is tiled or clipped in a way a translation cannot follow'
              : 'This image cannot be covered here'
          );
          return 'failed';
        }
      } else if (target.kind === 'background') {
        // The DOM renderer lays its lines over the element's whole box, which is
        // only where the picture is for a replaced element.
        lastFailure = 'backgrounds need the canvas renderer';
        say('Backgrounds need the canvas renderer (Render as, in settings)');
        return 'failed';
      } else if (
        !renderTranslation(
          img,
          result.blocks,
          settings,
          { width: prepared.width, height: prepared.height },
          root,
          { onGone: forgetter(img) }
        )
      ) {
        lastFailure = 'nothing could be placed on it';
        say('Nothing could be placed on this image');
        return 'failed';
      }
      shown(img, target, result);
      return 'shown';
    } finally {
      prepared.release();
    }
  } catch (error) {
    lastFailure = (error as Error).message;
    button.classList.add('lt-error');
    say(`Lens: ${lastFailure}`, 5000);
    window.setTimeout(() => button.classList.remove('lt-error'), 3000);
    return 'failed';
  } finally {
    busy.delete(img);
    setWorking(-1);
  }
}

/** Book-keeping for a translation that is now on screen. */
function shown(img: HTMLElement, target: Target, result: LensResult | null | undefined): void {
  showing.set(img, target);
  if (result) results.set(img, result);
  lastShown = new WeakRef(img);
  if (currentTarget?.element === img) button.classList.add('lt-active');
}


// --- Translating many at once -----------------------------------------------

/**
 * How many requests a batch keeps in flight.
 *
 * Every picture is a round trip to Lens and an upload, and a page of forty of
 * them asked for all at once is forty parallel uploads on a phone's connection
 * and a good way to be rate-limited. Two keeps the pipe full without that.
 * One queue serves every caller, so automatic translation and a button press
 * cannot add up to more than this between them.
 */
const CONCURRENCY = 2;
const queued: Array<() => void> = [];
let running = 0;

function pump(): void {
  while (running < CONCURRENCY) {
    const start = queued.shift();
    if (!start) return;
    running += 1;
    start();
  }
}

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queued.push(() => {
      void job()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          pump();
        });
    });
    pump();
  });
}

interface Tally {
  shown: number;
  empty: number;
  failed: number;
}

async function translateAll(targets: Target[]): Promise<Tally> {
  const tally: Tally = { shown: 0, empty: 0, failed: 0 };
  await Promise.all(
    targets.map((target) =>
      schedule(async () => {
        const outcome = await translate(target, { quiet: true });
        if (outcome === 'shown') tally.shown += 1;
        else if (outcome === 'empty') tally.empty += 1;
        else if (outcome === 'failed') tally.failed += 1;
      })
    )
  );
  return tally;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Whether any of a picture is on screen and it is big enough to be one. */
function inView(target: Target): boolean {
  if (!target.element.isConnected) return false;
  const part = visiblePart(target.element);
  return part.width * part.height > 0 && isBigEnough(target, settings.minImageSize);
}

/** Pictures worth translating that nothing has been done to yet. */
function untranslatedInView(candidates: Target[]): Target[] {
  return candidates.filter(
    (target) =>
      target.kind !== 'video' &&
      inView(target) &&
      !isTranslated(target.element) &&
      !busy.has(target.element)
  );
}

/** One line for a batch, saying what happened to the ones that did not work. */
function summarise(tally: Tally, total: number): string {
  const parts = [`Translated ${tally.shown} of ${plural(total, 'image')}`];
  if (tally.empty) parts.push(`${tally.empty} had no text`);
  if (tally.failed) parts.push(`${tally.failed} failed (${lastFailure})`);
  return parts.join('; ');
}

/** The menu command and the hotkey: every picture in view, now. */
async function translateVisible(): Promise<void> {
  if (!settings.enabled || site === 'off') {
    toast(
      site === 'off'
        ? `Lens Translate is switched off on ${hostOf()}`
        : 'Translation is switched off in settings'
    );
    return;
  }
  const targets = untranslatedInView(collect(settings.minImageSize));
  if (!targets.length) {
    toast('Nothing left to translate in view');
    return;
  }
  // Held until the summary replaces it: a long batch should not look finished.
  toast(`Translating ${plural(targets.length, 'image')}...`, 120_000);
  toast(summarise(await translateAll(targets), targets.length), 5000);
}

/**
 * Translate as you read, on a site that asked for it.
 *
 * Remembers what it has already tried by address, so a picture that came back
 * empty is not asked about again on every scroll, and one the reader undid
 * stays undone - while a virtualised feed that reuses the element for a new
 * photo, which changes the address, gets a fresh attempt.
 */
const autoTried = new WeakMap<HTMLElement, string>();
let autoTimer = 0;
let lastAutoComplaint = 0;

function autoTranslate(): void {
  if (site !== 'auto' || !active()) return;
  const targets = untranslatedInView(known).filter(
    (target) => autoTried.get(target.element) !== target.url
  );
  if (!targets.length) return;
  for (const target of targets) autoTried.set(target.element, target.url);
  void translateAll(targets).then((tally) => {
    // One complaint at most every half minute: a bad key or no connection fails
    // every picture, and a toast per scroll is worse than the problem.
    if (tally.failed && Date.now() - lastAutoComplaint > 30_000) {
      lastAutoComplaint = Date.now();
      toast(`Auto-translate: ${plural(tally.failed, 'image')} failed (${lastFailure})`, 5000);
    }
  });
}

/** Scrolling brings new pictures into view; look again once it settles. */
function scheduleAuto(): void {
  if (autoTimer || site !== 'auto') return;
  autoTimer = window.setTimeout(() => {
    autoTimer = 0;
    autoTranslate();
  }, 250);
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

/**
 * The two small controls beside the main one: settings, and the menu of things
 * that belong to this picture. They arrive together, a beat after the button.
 */
function showGear(target: Target, anchor?: Anchor): void {
  const rect = anchor ?? target.element.getBoundingClientRect();
  gear.style.top = `${rect.top + 8}px`;
  gear.style.left = `${rect.left + rect.width - 69}px`;
  more.style.top = `${rect.top + 8}px`;
  more.style.left = `${rect.left + rect.width - 101}px`;
  for (const control of [gear, more]) {
    control.style.opacity = '1';
    control.style.transform = 'scale(1)';
    control.style.pointerEvents = 'auto';
  }
}

function hideGear(): void {
  window.clearTimeout(gearTimer);
  for (const control of [gear, more]) {
    control.style.opacity = '0';
    control.style.transform = 'scale(0.9)';
    control.style.pointerEvents = 'none';
  }
}

function showButton(target: Target, anchor?: Anchor): void {
  if (!settings.showButton || site === 'off') return;
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
  autoTranslate();
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
    const found = settings.showButton && site !== 'off' ? mostVisible() : null;
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

/**
 * Whether the page is being watched for pictures arriving.
 *
 * Two things need the list of what is on the page kept current: a pinned
 * button, which has to know where the picture in view is, and automatic
 * translation, which has to know when a new one scrolls into view. Neither
 * needs it when it is off, and watching a busy page is not free.
 */
let watching = false;

function syncWatchers(): boolean {
  const wanted = pinned || site === 'auto';
  if (wanted === watching) return false;
  watching = wanted;
  if (watching) {
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
  }
  return watching;
}

function applyButtonMode(): void {
  const wanted =
    settings.buttonMode === 'pinned' ||
    (settings.buttonMode === 'auto' && window.matchMedia(TOUCH_QUERY).matches);
  const turnedOn = wanted && !pinned;
  if (wanted !== pinned) {
    pinned = wanted;
    if (!pinned) hideButton();
  }
  // Starting to watch refreshes the list itself; only an already-watching page
  // needs telling that the button wants it now.
  const started = syncWatchers();
  if (turnedOn && !started) refresh();
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

for (const control of [button, gear, more]) {
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
    // Re-read what the element is now rather than trusting the address it had
    // when it was translated: a picture that has been swapped since would
    // otherwise be asked about, and drawn over, as the one that was there.
    await translate(classify(target.element) ?? target);
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

more.addEventListener(
  'click',
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isMenuOpen()) closeMenu();
    else openActions();
  },
  true
);

button.addEventListener(
  'click',
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (currentTarget) void translate(currentTarget);
  },
  true
);

// A right click, or the long press on a touch screen, opens the same menu. On
// a touch screen the hold has usually started peeking by then; the menu would
// open as the finger lifts, which is not what holding meant.
button.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!holding && !swallowClick) openActions();
});

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

    // Off here means the page's own modifier-clicks are the page's again.
    if (site === 'off') return;
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
  scheduleAuto();
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


// --- Copying, menus and peeking ---------------------------------------------

/** The picture a command that is not about a particular one should act on. */
function subject(): HTMLElement | null {
  const current = currentTarget?.element;
  if (current && results.has(current)) return current;
  const last = lastShown?.deref();
  if (last?.isConnected && results.has(last)) return last;
  return current ?? null;
}

async function copyFrom(kind: 'translation' | 'original', element = subject()): Promise<void> {
  const result = element ? results.get(element) : undefined;
  if (!result) {
    toast('Translate an image first, then its text can be copied');
    return;
  }
  const text = kind === 'translation' ? translationText(result) : ocrText(result);
  const what = kind === 'translation' ? 'the translation' : 'the original text';
  if (!text) {
    toast(`There is no text to copy from ${what}`);
    return;
  }
  toast(
    (await copyText(text))
      ? `Copied ${what} (${plural(text.length, 'character')})`
      : 'The browser would not let the script use the clipboard'
  );
}

/** What the menu next to the button offers for the picture it is on. */
function openActions(): void {
  const target = currentTarget;
  if (!target) return;
  const translated = isTranslated(target.element);
  const words = results.has(target.element);
  const rect = more.getBoundingClientRect();
  openMenu({ top: rect.bottom + 6, left: rect.right - 220 }, [
    {
      label: translated ? 'Show the original (undo)' : 'Translate this image',
      run: () => void translate(target),
    },
    { label: 'Copy translation', run: () => void copyFrom('translation', target.element), disabled: !words },
    { label: 'Copy original text', run: () => void copyFrom('original', target.element), disabled: !words },
    { label: 'Translate everything in view', run: () => void translateVisible() },
    { label: 'Settings', run: () => openSettings(onSaved) },
  ]);
}

/** Let the original show through one picture, or put the translation back. */
const peek = (element: HTMLElement, peeking: boolean): boolean =>
  peekCover(element, peeking) || peekOverlay(element, peeking);

/**
 * How long the button has to be held before it counts as looking, not clicking.
 * Short enough to feel immediate, long enough that no ordinary click reaches it.
 */
const HOLD_MS = 350;
let holdTimer = 0;
let holding: HTMLElement | null = null;
/** The click that ends a hold is not a click, and must not undo the translation. */
let swallowClick = false;

function startHold(event: PointerEvent): void {
  if (event.button !== 0 || !currentTarget || !isTranslated(currentTarget.element)) return;
  const element = currentTarget.element;
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    holding = element;
    swallowClick = true;
    peek(element, true);
    button.classList.add('lt-peeking');
  }, HOLD_MS);
  // The release may land anywhere once the finger or cursor has drifted.
  try {
    button.setPointerCapture(event.pointerId);
  } catch {
    // A pointer that is already gone has nothing to capture; the timer is enough.
  }
}

function endHold(): void {
  window.clearTimeout(holdTimer);
  if (holding) {
    peek(holding, false);
    holding = null;
    button.classList.remove('lt-peeking');
  }
  // The click that follows a release is dispatched before this timer fires,
  // so by now it has either been swallowed or was never coming.
  window.setTimeout(() => {
    swallowClick = false;
  }, 0);
}

button.addEventListener('pointerdown', startHold);
for (const type of ['pointerup', 'pointercancel']) button.addEventListener(type, endHold);

/** A key held to look at the original everywhere. */
const PEEK_CODES: Record<Exclude<PeekKey, 'off'>, readonly string[]> = {
  backquote: ['Backquote'],
  shift: ['ShiftLeft', 'ShiftRight'],
  control: ['ControlLeft', 'ControlRight'],
};
let keyPeeking = false;

/** Typing into a field is not a shortcut, whatever keys it involves. */
function isTyping(event: Event): boolean {
  const node = event.composedPath()[0] as HTMLElement | undefined;
  if (!node?.tagName) return false;
  return node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
}

function endKeyPeek(): void {
  if (!keyPeeking) return;
  keyPeeking = false;
  peekAllCovers(false);
  peekAllOverlays(false);
}

document.addEventListener(
  'keydown',
  (event) => {
    if (isTyping(event)) return;

    if (
      settings.batchHotkey &&
      event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.code === 'KeyT'
    ) {
      event.preventDefault();
      void translateVisible();
      return;
    }

    if (settings.peekKey === 'off' || event.repeat || keyPeeking) return;
    if (!PEEK_CODES[settings.peekKey].includes(event.code)) return;
    keyPeeking = true;
    peekAllCovers(true);
    peekAllOverlays(true);
  },
  true
);

document.addEventListener(
  'keyup',
  (event) => {
    if (settings.peekKey !== 'off' && PEEK_CODES[settings.peekKey].includes(event.code)) {
      endKeyPeek();
    }
  },
  true
);
// A key released while another window had focus never reports it.
window.addEventListener('blur', endKeyPeek);

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
    // The memory cache and the stored one are separate allowances, but to the
    // person pressing the button they are one cache, so they are reported as one.
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
  menuLabel: 'Lens Translate: translate all visible images',
  label: 'Translate all in view',
  run: () => void translateVisible(),
});

registerCommand({
  menuLabel: 'Lens Translate: copy translation',
  label: null,
  run: () => void copyFrom('translation'),
});

registerCommand({
  menuLabel: 'Lens Translate: copy original text',
  label: null,
  run: () => void copyFrom('original'),
});

/**
 * Change what this site does, and make it so at once.
 *
 * Switching a site off takes its translations down with it: leaving them up
 * would be the one thing the person did not ask for.
 */
function chooseSite(next: SiteMode): void {
  site = next;
  setSiteMode(next);
  if (next === 'off') {
    showing.clear();
    uncoverAll();
    clearAllOverlays();
    hideButton();
  }
  const started = syncWatchers();
  if (next === 'auto' && !started) refresh();
  const host = hostOf();
  toast(
    next === 'off'
      ? `Lens Translate is off on ${host}`
      : next === 'auto'
        ? `Images on ${host} will be translated as they come into view`
        : `${host} is back to the default`
  );
}

registerCommand({
  menuLabel: 'Lens Translate: toggle on/off for this site',
  label: 'Toggle for this site',
  run: () => chooseSite(site === 'off' ? 'default' : 'off'),
});

registerCommand({
  menuLabel: 'Lens Translate: toggle auto-translate for this site',
  label: 'Toggle auto-translate here',
  run: () => chooseSite(site === 'auto' ? 'default' : 'auto'),
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

// A host whose storage is promise-only (Greasemonkey 4, Safari's Userscripts)
// has nothing to give a synchronous read, so everything above started from the
// defaults. Once the saved values arrive they are adopted - without this the
// settings silently fell back to the site's localStorage, which made them
// per-site.
void preloadStored([...SETTINGS_KEYS, SITES_KEY]).then((arrived) => {
  if (!arrived) return;
  settings = reloadSettings();
  reloadSites();
  site = siteMode();
  applyButtonMode();
});
// Asked once at document-idle is a snapshot, and the answer can arrive late or
// change under you - a mouse plugged into a tablet, a window moved between
// screens. Cheaper to be told than to re-ask on a timer.
window.matchMedia(TOUCH_QUERY).addEventListener('change', applyButtonMode);
