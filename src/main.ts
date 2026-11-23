import { copyText, gmTransport, preloadStored, prepareTab, registerCommand, storageReady } from './gm.js';
import type { Command } from './gm.js';
import { setTransport } from './transport.js';
import { diagnose } from './diagnose.js';

import { askLens } from './lens/ask.js';
import { tilingTag } from './lens/tiles.js';
import { ImageSearch, textSearchUrl } from './lens/search.js';
import type { Selection } from './lens/search.js';
import { ocrText, translationText } from './lens/text.js';
import { acquireSource, encodeForUpload, encodeRegion, fingerprint } from './image.js';
import { paintRect } from './render/background.js';
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
import { LOCALE_KEYS, onLocaleChange, t, useLanguage } from './i18n/index.js';
import type { Key } from './i18n/index.js';
import { STATE_KEY, getState, reloadState, setState } from './state.js';
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
import { BUTTON_ICONS, openSettings } from './ui/settings-panel.js';
import { parseButtons, rowOf } from './ui/buttons.js';
import type { ButtonId } from './ui/buttons.js';
import { matchesChord, parseChord } from './ui/shortcuts.js';
import type { Chord } from './ui/shortcuts.js';
import { closeMenu, isMenuOpen, openMenu } from './ui/menu.js';
import type { MenuItem } from './ui/menu.js';
import { onReportSettings, openReport } from './ui/report.js';
import { HOST_ID, applyPopupOpacity, isOurs, tendHost, uiRoot } from './ui/root.js';
import { fittedRect, insetRect, placeRow, wrapWidth } from './ui/geometry.js';
import type { Rect, Size } from './ui/geometry.js';
import { icon } from './ui/icons.js';
import { closeTool, openObjectsTool, openRegionTool, openTextTool, repositionTool } from './ui/tools.js';
import type { LensResult, NormalizedBox, OcrParagraph, PeekKey, Settings } from './types.js';

/** How the front end is being started, which boot.ts decides. */
export interface StartOptions {
  /** Inside an iframe: no host menu, no diagnostics, results may not open. */
  framed: boolean;
  /** The picture whose hover woke a sleeping frame, to put the button over. */
  hovered: Target | null;
}

/**
 * Everything this script does to a page, from the moment it decides to.
 *
 * A function rather than the module body, because a frame imports this and
 * may never call it: an ad slot that never wakes must not pay for a shadow
 * root, an observer or a sweep timer. The top window calls it at once.
 */
export function start({ framed, hovered }: StartOptions): void {

  let settings: Settings = getSettings();
  // Before anything is drawn. A locale fetched earlier for this version is in
  // the host's store and is in use by the next line; one that is not arrives
  // later and redraws what is on screen. On a host whose storage is
  // promise-only the store reads empty until the preload below settles, and
  // asking now would download a locale that is already kept - every page load.
  if (storageReady()) useLanguage(settings.language);

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

  /**
   * The controls over a picture, as one row hung from a corner of it.
   *
   * One container, so the row is placed once and its own layout does the rest:
   * the controls are 32px under a mouse and 44px under a finger, and offsets
   * written out as numbers were only ever right for one of those. They stay
   * `div`s rather than buttons on purpose - a button takes focus when pressed,
   * and a reader that listens for keys loses them to it.
   *
   * Which controls, in what order and from which corner are settings, so the
   * row is rebuilt from them (`buildControls`) rather than made once.
   */
  const controls = document.createElement('div');
  controls.id = 'lt-controls';
  root.appendChild(controls);

  function control(id: string, label: string, content: string): HTMLDivElement {
    const element = document.createElement('div');
    element.id = id;
    element.innerHTML = content;
    element.title = label;
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', label);
    return element;
  }

  /**
   * The main control: the one that arrives first, spins while Lens is asked
   * and takes the long press. A placeholder until the row is first built,
   * which happens at the end of `start`, once everything it calls exists.
   */
  let button: HTMLDivElement = document.createElement('div');
  /** The control that translates, which is the one that goes green. May be absent. */
  let translateControl: HTMLElement | null = null;
  /** The control the menu opens beside: its own button, or the main one. */
  let menuControl: HTMLElement = button;

  const markTranslated = (on: boolean): void => {
    translateControl?.classList.toggle('lt-active', on);
  };

  const toastEl = document.createElement('div');
  toastEl.id = 'lt-toast';
  toastEl.setAttribute('role', 'status');
  root.appendChild(toastEl);

  /** A place to go, offered inside a message. */
  interface ToastLink {
    href: string;
    label: string;
    /**
     * Also print the address and offer to copy it. For a frame whose open just
     * failed, where the link may fail the same way - see `deliver`.
     */
    copy?: boolean;
  }

  let toastTimer: number | undefined;

  function hideToast(): void {
    window.clearTimeout(toastTimer);
    toastEl.classList.remove('lt-show');
  }

  /**
   * Say something along the bottom of the screen.
   *
   * With a link it is also the way to a search's results. That link is a real
   * anchor the person presses themselves, which is the one way of opening a tab
   * that no popup blocker, phone browser or userscript host gets in the way of -
   * so it is offered even when a tab was opened for them, in case it was not.
   * `ms` of 0 leaves the message up until it is dismissed.
   */
  function toast(message: string, ms = 3200, link?: ToastLink): void {
    toastEl.textContent = '';
    const text = document.createElement('span');
    text.textContent = message;
    toastEl.appendChild(text);
    if (link) {
      const anchor = document.createElement('a');
      anchor.className = 'lt-btn lt-primary';
      anchor.href = link.href;
      anchor.target = '_blank';
      // No opener for Google to reach back through, and no Referer naming the
      // page the picture was on.
      anchor.rel = 'noopener noreferrer';
      anchor.innerHTML = icon('external', 16);
      anchor.append(link.label);
      anchor.addEventListener('click', hideToast);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'lt-btn lt-ghost lt-square';
      close.setAttribute('aria-label', t('toast.dismiss'));
      close.innerHTML = icon('close', 16);
      close.addEventListener('click', hideToast);
      if (link.copy) {
        // Selectable, so a host whose clipboard is out of reach as well still
        // leaves a long press.
        const address = document.createElement('span');
        address.className = 'lt-url';
        address.textContent = link.href;
        text.appendChild(address);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'lt-btn';
        copy.innerHTML = icon('copy', 16);
        copy.append(t('toast.copy'));
        copy.addEventListener('click', () => {
          void copyText(link.href).then((done) => {
            // A failed copy keeps the address on screen to be selected by hand.
            if (done) toast(t('toast.addressCopied'));
            else toast(t('toast.addressNotCopied'), 0, link);
          });
        });
        toastEl.append(anchor, copy, close);
      } else {
        toastEl.append(anchor, close);
      }
    }
    toastEl.classList.toggle('lt-has-link', Boolean(link));
    toastEl.classList.add('lt-show');
    window.clearTimeout(toastTimer);
    if (ms > 0) toastTimer = window.setTimeout(hideToast, ms);
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
    if (currentTarget?.element === img) markTranslated(false);
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
    tendHost();
    sweepCovers();
    sweepOverlays();
    // A layout shift moves a picture without a scroll or a resize, and a tool
    // layer left where it was points at the wrong part of the page.
    repositionTool();
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
    if (restored) markTranslated(false);
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
      say(t('toast.off'));
      return 'skipped';
    }
    if (site === 'off') {
      say(t('toast.siteOffHint', { host: hostOf() }));
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
        if (done && coverImage(img, URL.createObjectURL(done), { onGone: forgetter(img), ...seeThrough() })) {
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
        //
        // The fingerprint is of the whole picture; a strip that is asked about
        // in tiles is filed under it with a mark, so the answer a single upload
        // once got for the same pixels is not the one that comes back.
        const print = result ? '' : fingerprint(prepared.source, prepared.width, prepared.height);
        const hash = print && print + tilingTag(prepared.width, prepared.height, settings);
        if (!result && hash) {
          const remembered = await getStored(hash, settings);
          if (remembered) {
            result = remembered;
            if (target.url) putCached(key, result, settings, size);
          }
        }

        if (!result) {
          // One request for a page; several, merged, for a strip too long for one.
          result = await askLens(prepared.source, settings);
          if (target.url) putCached(key, result, settings, size);
          void putStored(hash, result, settings);
        }

        if (!result.blocks.length) {
          const detected = result.ocr.some((p) => p.lines.length > 0);
          // The words are still worth having even when there is nothing to draw.
          results.set(img, result);
          say(
            detected ? t('toast.noTranslation') : t('toast.noText')
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
            ...seeThrough(),
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
            lastFailure = target.kind === 'background' ? t('toast.backgroundTiled') : t('toast.cannotCover');
            say(lastFailure);
            return 'failed';
          }
        } else if (target.kind === 'background') {
          // The DOM renderer lays its lines over the element's whole box, which is
          // only where the picture is for a replaced element.
          lastFailure = t('toast.backgroundNeedsCanvas');
          say(lastFailure);
          return 'failed';
        } else if (
          !renderTranslation(
            img,
            result.blocks,
            settings,
            { width: prepared.width, height: prepared.height },
            root,
            { onGone: forgetter(img), ...seeThrough() }
          )
        ) {
          lastFailure = t('toast.nothingPlaced');
          say(lastFailure);
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
      say(t('toast.lensError', { message: lastFailure }), 5000);
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
    if (currentTarget?.element === img) markTranslated(true);
  }

  /**
   * How much of the original shows through a translation, as the renderers
   * take it. Nothing at all when it is fully opaque, so the cover carries no
   * opacity rule it does not need.
   */
  function seeThrough(): { opacity?: number } {
    const percent = Math.min(100, Math.max(20, Number(settings.coverOpacity) || 100));
    return percent < 100 ? { opacity: percent / 100 } : {};
  }


  // --- Translating many at once -----------------------------------------------

  /**
   * How many requests a batch keeps in flight.
   *
   * Every picture is a round trip to Lens and an upload, and a page of forty of
   * them asked for all at once is forty parallel uploads on a phone's connection
   * and a good way to be rate-limited. Two keeps the pipe full without that,
   * and is the default; the setting is capped where being refused starts.
   * One queue serves every caller, so automatic translation and a button press
   * cannot add up to more than this between them.
   */
  const concurrency = (): number => Math.min(6, Math.max(1, Math.round(settings.concurrency) || 2));
  const queued: Array<() => void> = [];
  let running = 0;

  function pump(): void {
    while (running < concurrency()) {
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
    const parts = [t('toast.batchDone', { shown: tally.shown, total })];
    if (tally.empty) parts.push(t('toast.batchEmpty', { count: tally.empty }));
    if (tally.failed) parts.push(t('toast.batchFailed', { count: tally.failed, reason: lastFailure }));
    return parts.join('; ');
  }

  /** The menu command and the hotkey: every picture in view, now. */
  async function translateVisible(): Promise<void> {
    if (!settings.enabled || site === 'off') {
      toast(
        site === 'off' ? t('toast.siteOff', { host: hostOf() }) : t('toast.off')
      );
      return;
    }
    const targets = untranslatedInView(collect(settings.minImageSize));
    if (!targets.length) {
      toast(t('toast.nothingLeft'));
      return;
    }
    // Held until the summary replaces it: a long batch should not look finished.
    toast(t('toast.batchStart', { count: targets.length }), 120_000);
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
        toast(t('toast.autoFailed', { count: tally.failed, reason: lastFailure }), 5000);
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
  let extrasShown = false;

  function showGear(): void {
    extrasShown = true;
    controls.classList.add('lt-extras');
  }

  function hideGear(): void {
    window.clearTimeout(gearTimer);
    extrasShown = false;
    controls.classList.remove('lt-extras');
  }

  /** The part of the page on screen, in the coordinates the fixed host uses. */
  function visibleViewport(): Rect {
    // Pinch-zoomed, the visual viewport is a window into the layout one, and a
    // row placed against the layout viewport can sit entirely out of sight.
    const visual = window.visualViewport;
    if (visual && visual.width > 0 && visual.height > 0) {
      return { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  /**
   * Hang the row from the chosen corner of `rect`, wrapped to the screen's width
   * and kept on it. Measured rather than assumed: the row is whatever buttons
   * were pinned, at whatever size, with or without their names.
   */
  function placeControls(rect: Anchor): void {
    const view = visibleViewport();
    const margin = 4;
    const gap = Number.parseFloat(getComputedStyle(controls).columnGap) || 0;
    // offsetWidth, not the bounding box: a control not yet shown is scaled down
    // by a transform, and the space it takes is its untransformed size.
    const widths = [...controls.children].map((child) => (child as HTMLElement).offsetWidth);
    // A pixel of slack, since offsetWidth rounds and a row a fraction too narrow
    // would wrap its last control for nothing.
    const width = Math.ceil(wrapWidth(widths, gap, view.width - margin * 2)) + 1;
    controls.style.width = `${width}px`;
    const at = placeRow(
      settings.buttonCorner,
      rect,
      { width, height: controls.offsetHeight },
      view,
      margin,
      6
    );
    controls.style.left = `${at.x}px`;
    controls.style.top = `${at.y}px`;
  }

  /**
   * Whether this picture is a video, or sits on one.
   *
   * A player is under the cursor on the way to every control it has, so a
   * button there pops up constantly over something nobody meant to translate.
   * The <video> is not all of it: before it plays, YouTube covers it with the
   * poster as a background, and a feed's preview lays one over a thumbnail. So
   * anything whose middle falls inside a showing video at least its own size is
   * the player's too - which also takes in the end-screen cards, and that is
   * fine for the same reason.
   */
  function onVideo(target: Target): boolean {
    if (target.kind === 'video') return true;
    const videos = document.getElementsByTagName('video');
    if (!videos.length) return false;
    const box = target.element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const area = box.width * box.height;
    for (const video of videos) {
      const r = video.getBoundingClientRect();
      if (r.width * r.height < area * 0.8) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  /** Whether the buttons may come up over this picture at all. */
  const offersButton = (target: Target): boolean =>
    settings.showButton && site !== 'off' && (settings.videoButton || !onVideo(target));

  function showButton(target: Target, anchor?: Anchor): void {
    if (!offersButton(target)) return;
    const img = target.element;
    currentTarget = target;
    // Viewport coordinates: the shadow host is fixed and covers the viewport.
    // The row hangs from the chosen corner by its own matching corner.
    const rect = anchor ?? img.getBoundingClientRect();
    placeControls(rect);
    controls.classList.add('lt-on');
    markTranslated(isTranslated(img));

    window.clearTimeout(gearTimer);
    if (!extrasShown) {
      // No wait asked for is no timer: the row arrives whole.
      const wait = Math.max(0, Number(settings.extrasDelayMs) || 0);
      if (wait === 0) showGear();
      else gearTimer = window.setTimeout(showGear, wait);
    }
  }

  function hideButton(): void {
    controls.classList.remove('lt-on');
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
      if (!settings.videoButton && onVideo(target)) continue;
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
      showGear();
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
        hideTimer = window.setTimeout(hideButton, hideDelay());
      }
    },
    true
  );

  const hideDelay = (): number => Math.max(0, Number(settings.hideDelayMs) || 0);

  // On the row rather than on each control: the controls come and go with the
  // settings, and both events bubble up from whichever one the cursor is on.
  controls.addEventListener('mouseover', () => window.clearTimeout(hideTimer));
  controls.addEventListener('mouseout', () => {
    if (pinned) return;
    hideTimer = window.setTimeout(hideButton, hideDelay());
  });

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

  /**
   * Open the panel, with nothing of ours left lying over it.
   *
   * A message sits above everything, so one still on screen covers the panel's
   * own Save button on a phone, where both are at the bottom.
   */
  function showSettings(): void {
    hideToast();
    openSettings({ onSaved, site: () => site, setSite: chooseSite });
  }

  function onSaved(saved: Settings): void {
    settings = saved;
    useLanguage(settings.language);
    applySettings();
    applyButtonMode();
    void redrawShowing();
    toast(t('toast.saved'));
  }

  /** The actions a main button set to repeat may take over. */
  const REPEATABLE: readonly ButtonId[] = ['translate', 'search', 'ask', 'area', 'objects', 'text', 'copy'];

  /**
   * What the main button does right now: the setting, or - when it is set to
   * repeat - whatever was last picked from the menu or the row.
   */
  function mainButton(): ButtonId {
    const last = getState().lastAction as ButtonId;
    return settings.repeatLast && REPEATABLE.includes(last) ? last : settings.mainAction;
  }

  /** The question "ask AI" starts from. */
  function question(): string {
    return (settings.rememberQuestion && getState().lastQuestion) || settings.aiPrompt;
  }

  /** Where an action was asked for from, which decides whether it is remembered. */
  type Origin = 'main' | 'row' | 'menu' | 'key' | 'hold';

  /**
   * Do one of the things a control, a menu item or a shortcut can ask for.
   *
   * Not `async`, and nothing is awaited before the action itself: a search
   * asks for its tab on its first line, and a browser only grants one while
   * the press that led here is still being handled.
   */
  function runAction(id: ButtonId, target: Target, origin: Origin, text?: string): void {
    // A choice made from the menu or a secondary button is what "repeat the
    // last action" repeats. The main button repeating itself is not news.
    if ((origin === 'menu' || origin === 'row') && REPEATABLE.includes(id)) {
      const before = mainButton();
      setState({ lastAction: id });
      if (mainButton() !== before) buildControls();
    }
    switch (id) {
      case 'translate':
        void translate(target);
        break;
      case 'search':
        searchPicture(target, { kind: 'image' }, 'visual', '');
        break;
      case 'ask': {
        const asked = (text ?? question()).trim();
        if (text !== undefined && asked) setState({ lastQuestion: asked });
        searchPicture(target, { kind: 'image' }, 'ai', asked);
        break;
      }
      case 'area':
        void selectArea(target);
        break;
      case 'objects':
        void showObjects(target);
        break;
      case 'text':
        void pickText(target);
        break;
      case 'copy':
        void copyAny(target);
        break;
      case 'settings':
        showSettings();
        break;
      case 'menu':
        openActions(target);
        break;
    }
  }

  function pressed(id: ButtonId, isMain: boolean, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (isMain && swallowClick) {
      swallowClick = false;
      return;
    }
    if (id === 'settings') return showSettings();
    if (id === 'menu') {
      if (isMenuOpen()) closeMenu();
      else openActions();
      return undefined;
    }
    if (currentTarget) runAction(id, currentTarget, isMain ? 'main' : 'row');
    return undefined;
  }

  /**
   * Make the row the settings describe.
   *
   * The main control keeps the id the stylesheet and every earlier version
   * knew it by, as do the settings and menu buttons; the rest are named for
   * what they do. The row is listed corner-first and the stylesheet reverses
   * it for a right-hand corner, so the main one is always the one in the corner.
   */
  function buildControls(): void {
    // A hold in progress belongs to the button about to be thrown away: its
    // release goes to an element no longer in the page, which would leave the
    // picture peeking and the next click swallowed. A locale arriving mid-press
    // is all it takes.
    endHold();
    const main = mainButton();
    const ids = rowOf(parseButtons(settings.buttons), main);
    controls.textContent = '';
    controls.dataset['corner'] = settings.buttonCorner;
    controls.dataset['size'] = settings.buttonSize;
    const idle = Math.min(100, Math.max(20, Number(settings.idleOpacity) || 100));
    controls.style.setProperty('--lt-idle', String(idle / 100));

    translateControl = null;
    let menuFound: HTMLElement | null = null;
    for (const id of ids) {
      const isMain = id === main;
      const label =
        id === 'translate'
          ? t('btn.translate')
          : id === 'settings'
            ? t('btn.settings')
            : id === 'menu'
              ? t('btn.more')
              : t(`act.${id}` as Key);
      const element = control(
        isMain ? 'lt-button' : id === 'settings' ? 'lt-gear' : id === 'menu' ? 'lt-more' : `lt-act-${id}`,
        label,
        // The spinner is a second icon rather than the first one turning:
        // letters going round do not read as "working".
        isMain ? icon(BUTTON_ICONS[id]) + icon('loader') : icon(BUTTON_ICONS[id], 16)
      );
      element.className = isMain ? 'lt-ctl lt-main' : 'lt-ctl';
      element.dataset['action'] = id;
      if (settings.buttonLabels) {
        const words = document.createElement('span');
        words.className = 'lt-ctl-label';
        words.textContent = t(`act.${id}` as Key);
        element.appendChild(words);
        element.classList.add('lt-labelled');
      }
      element.addEventListener('click', (event) => pressed(id, isMain, event), true);
      if (id === 'translate') translateControl = element;
      if (id === 'menu') menuFound = element;
      if (isMain) {
        button = element;
        element.addEventListener('pointerdown', startHold);
        for (const type of ['pointerup', 'pointercancel']) element.addEventListener(type, endHold);
        // A right click, or the long press on a touch screen, opens the menu.
        // On a touch screen the hold has usually acted by then; the menu
        // would open as the finger lifts, which is not what holding meant.
        // Android sends this at about 500 ms with the finger still down, so a
        // longer hold has not fired yet: the menu wins, and the hold is called
        // off rather than running behind it.
        element.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const held = holding !== null || swallowClick;
          window.clearTimeout(holdTimer);
          if (!held) openActions();
        });
      }
      controls.appendChild(element);
    }
    menuControl = menuFound ?? button;
    button.classList.toggle('lt-busy', working > 0);
    if (currentTarget) markTranslated(isTranslated(currentTarget.element));
    // A different set of buttons is a different width; the one on screen was
    // measured for the old row.
    if (controls.classList.contains('lt-on')) reposition();
  }

  /** Everything derived from the settings that is not read at the point of use. */
  function applySettings(): void {
    buildControls();
    bindKeys();
  }

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
    if (currentTarget?.element.isConnected) showButton(currentTarget);
    else if (currentTarget) hideButton();
  }

  function moved(): void {
    // A layer drawn over a picture has to follow it. Followed, never closed: a
    // phone's address bar sliding away is a resize nobody asked for.
    repositionTool();
    reposition();
  }

  window.addEventListener('resize', moved);
  window.addEventListener('scroll', moved, true);
  // Entering or leaving fullscreen moves the host (see ui/root.ts) and changes
  // every rectangle on the page. The resize that usually comes with it is not
  // promised, and does not come at all when the element already filled the
  // viewport.
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(type, () => {
      emptyRetries = 0;
      if (watching) scheduleRefresh();
      moved();
    });
  }


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
      toast(t('toast.translateFirst'));
      return;
    }
    const text = kind === 'translation' ? translationText(result) : ocrText(result);
    if (!text) {
      toast(t('toast.nothingToCopy'));
      return;
    }
    await copied(text, kind === 'translation' ? 'toast.copiedTranslation' : 'toast.copiedOriginal');
  }


  // --- Searching with a picture -----------------------------------------------

  /**
   * Uploads that are still good, by the same key the translation cache uses.
   *
   * An upload is two requests and a search after it is one, so the second thing
   * asked about a picture - another area, an object, a question - should not pay
   * for the first again. Kept as promises so two actions started together share
   * one upload instead of racing to make two.
   *
   * Only a picture with an address is kept. A canvas or a video has none, and
   * what it shows now is not what it showed a moment ago, so each search of one
   * uploads what is there. The list is short because every entry holds its
   * JPEG: Lens wants the bytes again when a session is reopened.
   */
  interface Upload {
    promise: Promise<ImageSearch>;
    /** Set once it arrives, so a stale session can be seen without awaiting. */
    search?: ImageSearch;
  }

  const MAX_UPLOADS = 4;
  const uploads = new Map<string, Upload>();

  /**
   * Whether the element still shows the picture the target was made from.
   *
   * A virtualised feed reuses an element for the next post by giving it a new
   * address, and it can do that while a tool is open over it. The upload and the
   * crop read the element as it is *now*, so without asking this they would
   * search a different picture under the old one's name - and the upload would
   * be cached under the old address for the next search to find. Compared by the
   * cache key, so a rendition swap of the same photo is not a change. A canvas
   * or a video has no address to compare and is taken as it stands.
   */
  function stillShows(target: Target): boolean {
    if (!target.url) return target.element.isConnected;
    const now = classify(target.element);
    return Boolean(now?.url) && cacheKey(now?.url ?? '', settings) === cacheKey(target.url, settings);
  }

  /**
   * What an error says when the picture was swapped mid-action. A marker to
   * compare against, never shown: `lensSaid` puts the reader's words in its place.
   */
  const CHANGED = 'The picture changed while it was open; try again on the new one';

  async function upload(target: Target): Promise<ImageSearch> {
    if (!stillShows(target)) throw new Error(CHANGED);
    const acquired = await acquireSource(target);
    try {
      const image = await encodeForUpload(acquired.source, settings);
      return await ImageSearch.upload(image, settings);
    } finally {
      acquired.release();
    }
  }

  function sessionFor(target: Target): Promise<ImageSearch> {
    if (!target.url) return upload(target);
    const key = cacheKey(target.url, settings);
    const held = uploads.get(key);
    // An expired session would be reopened by the search itself, but the objects
    // it found are named by the old upload; start again so the two agree.
    if (held && (!held.search || held.search.fresh)) {
      // Moved to the end: the Map's order is the order of last use.
      uploads.delete(key);
      uploads.set(key, held);
      return held.promise;
    }
    const entry: Upload = { promise: upload(target) };
    uploads.set(key, entry);
    entry.promise.then(
      (search) => {
        entry.search = search;
      },
      () => {
        // A failure is not an answer worth keeping; the next press tries again.
        if (uploads.get(key) === entry) uploads.delete(key);
      }
    );
    for (const oldest of uploads.keys()) {
      if (uploads.size <= MAX_UPLOADS) break;
      uploads.delete(oldest);
    }
    return entry.promise;
  }

  /** A pointer that cannot hover or cannot aim: a phone, in practice. */
  const onTouch = (): boolean => window.matchMedia(TOUCH_QUERY).matches;

  const prefersDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches;

  /** How the results page is asked to look: in the reader's language and theme. */
  const pageOptions = (): { uiLanguage: string; dark: boolean } => ({
    uiLanguage: settings.searchLang || settings.targetLang,
    dark: settings.searchTheme === 'auto' ? prefersDark() : settings.searchTheme === 'dark',
  });

  /** A tab for results, opened the way the settings ask. */
  const tabFor = (preopen: boolean): ReturnType<typeof prepareTab> =>
    prepareTab(preopen, { background: settings.backgroundTabs, waiting: t('toast.searching') });

  /**
   * Hand over a results address: in a tab if one could be had, as a link if not.
   *
   * The link is there both times. A host's opener can report success and open
   * nothing, and a tab opened behind the current one is easy to miss on a phone.
   */
  function deliver(tab: ReturnType<typeof prepareTab>, url: string): void {
    if (tab.go(url)) toast(t('toast.opened'), 9000, { href: url, label: t('toast.openAgain') });
    // A frame sandboxed without `allow-popups` refuses `window.open` and a
    // `target=_blank` link alike, silently in the second case, and nothing in
    // here can read its own sandbox flags to know beforehand. A refused open is
    // the evidence; in a frame the address is then printed and offered to copy
    // as well, which is the one way out no sandbox can close.
    else if (framed) toast(t('toast.ready'), 0, { href: url, label: t('toast.open'), copy: true });
    else toast(t('toast.ready'), 0, { href: url, label: t('toast.openResults') });
  }

  /** What to search for; a region's pixels are cut out when the time comes. */
  type Pick = { kind: 'image' } | { kind: 'region'; box: NormalizedBox } | { kind: 'object'; id: string };

  /**
   * Search with a picture and open the results.
   *
   * Not `async`, and it must be called straight from the press that asked: the
   * tab is requested on the first line, before anything is awaited, because that
   * is the only moment a browser will grant one.
   *
   * A blank tab is only opened ahead of time where there is a mouse. On a phone
   * it would take the whole screen for the length of an upload, `window.open`
   * has not been seen to work from every host there, and the link in the toast
   * does - so a phone whose host cannot open tabs itself gets the link, one
   * extra press, and nothing that can strand it on an empty page.
   */
  function searchPicture(
    target: Target,
    pick: Pick,
    mode: 'visual' | 'ai',
    text: string,
    held?: ImageSearch
  ): void {
    // Before the tab is asked for, so a picture swapped under the tool costs a
    // message rather than an empty tab.
    if (!stillShows(target)) {
      closeTool();
      toast(t('toast.changed'));
      return;
    }
    const tab = tabFor(!onTouch());
    setWorking(1);
    button.classList.remove('lt-error');
    toast(mode === 'ai' ? t('toast.asking') : t('toast.searching'), 120_000);

    void (async (): Promise<string> => {
      // An object id belongs to the upload that found it; that upload is passed
      // in and nothing else will do (see ObjectSource in ui/tools.ts).
      const search = held ?? (await sessionFor(target));
      let selection: Selection = pick;
      if (pick.kind === 'region') {
        // The crop itself has to go, not just its box: without it Lens is shown
        // the whole picture again and answers about that.
        if (!stillShows(target)) throw new Error(CHANGED);
        const acquired = await acquireSource(target);
        try {
          const crop = await encodeRegion(
            { source: acquired.source, sourceWidth: acquired.width, sourceHeight: acquired.height },
            pick.box,
            settings
          );
          selection = { kind: 'region', box: pick.box, crop };
        } finally {
          acquired.release();
        }
      }
      return search.search(selection, { mode, text, ...pageOptions() });
    })()
      .then(
        (url) => deliver(tab, url),
        (error: Error) => {
          tab.cancel();
          lastFailure = error.message;
          button.classList.add('lt-error');
          toast(lensSaid(error), 5000);
          window.setTimeout(() => button.classList.remove('lt-error'), 3000);
        }
      )
      .finally(() => setWorking(-1));
  }

  /**
   * Open an address that is already known.
   *
   * Here the press is still being handled, so asking for a tab outright is
   * allowed on any device - and if it is refused all the same, the link.
   */
  function openNow(url: string): void {
    deliver(tabFor(true), url);
  }

  /** The picture's own size in pixels, which is what its proportions are read from. */
  function naturalSize(target: Target): Promise<Size | null> {
    const element = target.element;
    if (target.kind === 'img') {
      const { naturalWidth, naturalHeight } = element as HTMLImageElement;
      return Promise.resolve(naturalWidth && naturalHeight ? { width: naturalWidth, height: naturalHeight } : null);
    }
    if (target.kind === 'video') {
      const { videoWidth, videoHeight } = element as HTMLVideoElement;
      return Promise.resolve(videoWidth && videoHeight ? { width: videoWidth, height: videoHeight } : null);
    }
    if (target.kind === 'canvas') {
      const { width, height } = element as HTMLCanvasElement;
      return Promise.resolve(width && height ? { width, height } : null);
    }
    // A background's size is nowhere in the page; the picture has to be asked.
    // It is in the HTTP cache already, having been painted.
    return new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => resolve(null);
      probe.src = target.url;
    });
  }

  const px = (value: string): number => Number.parseFloat(value) || 0;

  /**
   * Where the picture itself is on screen, which is rarely the element's box.
   *
   * A replaced element draws into its content box and `object-fit` decides how;
   * a background is wherever its size and position put the one painted copy.
   * Everything Lens says about a picture is a fraction of the picture, so a
   * layer laid over the element's box instead would put every dot and every
   * word a border, a padding or a letterbox away from where it belongs.
   */
  function pictureRect(target: Target, natural: Size): Rect | null {
    const element = target.element;
    if (!element.isConnected) return null;
    const bounds = element.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0)) return null;
    const style = getComputedStyle(element);
    const border = {
      top: px(style.borderTopWidth),
      right: px(style.borderRightWidth),
      bottom: px(style.borderBottomWidth),
      left: px(style.borderLeftWidth),
    };
    const outer: Rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };

    if (target.kind === 'background') {
      const spec = target.background;
      if (!spec) return outer;
      const padding = {
        top: px(style.paddingTop),
        right: px(style.paddingRight),
        bottom: px(style.paddingBottom),
        left: px(style.paddingLeft),
      };
      const area =
        spec.origin === 'border-box'
          ? outer
          : spec.origin === 'padding-box'
            ? insetRect(outer, border)
            : insetRect(insetRect(outer, border), padding);
      const painted = paintRect(spec, area, natural);
      return painted
        ? { left: area.left + painted.x, top: area.top + painted.y, width: painted.width, height: painted.height }
        : outer;
    }

    const content = insetRect(insetRect(outer, border), {
      top: px(style.paddingTop),
      right: px(style.paddingRight),
      bottom: px(style.paddingBottom),
      left: px(style.paddingLeft),
    });
    return fittedRect(content, natural, style.objectFit, style.objectPosition);
  }

  /** A way to ask where the picture is, or null when it cannot be measured. */
  async function frameOf(target: Target): Promise<(() => Rect | null) | null> {
    const natural = await naturalSize(target);
    if (!natural || !pictureRect(target, natural)) {
      toast(t('toast.cannotMeasure'));
      return null;
    }
    return () => pictureRect(target, natural);
  }

  /** Report a failure in a tool that was waiting on Lens, and answer null. */
  function failed(error: Error): null {
    lastFailure = error.message;
    toast(lensSaid(error), 5000);
    return null;
  }

  /** A failure as a message; a picture that changed is ours to say, not Lens's. */
  const lensSaid = (error: Error): string =>
    error.message === CHANGED ? t('toast.changed') : t('toast.lensError', { message: error.message });

  async function selectArea(target: Target): Promise<void> {
    const rect = await frameOf(target);
    if (!rect) return;
    openRegionTool({
      rect,
      onSearch: (box, mode, text) => searchPicture(target, { kind: 'region', box }, mode, text),
    });
  }

  async function showObjects(target: Target): Promise<void> {
    const rect = await frameOf(target);
    if (!rect) return;
    openObjectsTool({
      rect,
      load: () => sessionFor(target).then((search) => search, failed),
      onPick: (search, id) => searchPicture(target, { kind: 'object', id }, 'visual', '', search),
    });
  }

  /**
   * What the picture says, from wherever it is already known.
   *
   * A translation carries the recognised text with it; a picture that was never
   * translated is read by the upload a search would have made anyway, so having
   * looked at its words makes the search that follows cheaper.
   */
  function readText(target: Target): Promise<OcrParagraph[]> {
    const held = results.get(target.element);
    if (held?.ocr.length) return Promise.resolve(held.ocr);
    return sessionFor(target).then((search) => search.result.ocr);
  }

  async function pickText(target: Target): Promise<void> {
    const rect = await frameOf(target);
    if (!rect) return;
    openTextTool({
      rect,
      paragraphs: readText(target).then((paragraphs) => paragraphs, failed),
      onSearch: (text) => openNow(textSearchUrl(text, pageOptions())),
      onCopy: (text) => void copied(text, 'toast.copiedText'),
    });
  }

  /** Copy, and say so in the words for what was copied. */
  async function copied(
    text: string,
    done: 'toast.copiedTranslation' | 'toast.copiedOriginal' | 'toast.copiedText'
  ): Promise<void> {
    toast((await copyText(text)) ? t(done, { count: text.length }) : t('toast.clipboardDenied'));
  }

  /**
   * Copy whatever there is to copy: the translation if there is one, otherwise
   * what the picture says. One button, for someone who should not have to know
   * that those are two different things until they want the other one.
   */
  async function copyAny(target: Target): Promise<void> {
    const result = results.get(target.element);
    const translated = result ? translationText(result) : '';
    if (translated) return copied(translated, 'toast.copiedTranslation');
    let text = result ? ocrText(result) : '';
    if (!text) {
      toast(t('toast.reading'), 120_000);
      try {
        text = (await readText(target))
          .map((paragraph) => paragraph.lines.map((line) => line.text.trim()).filter(Boolean).join('\n'))
          .filter(Boolean)
          .join('\n\n');
      } catch (error) {
        failed(error as Error);
        return undefined;
      }
    }
    if (!text) {
      toast(t('toast.noText'));
      return undefined;
    }
    return copied(text, 'toast.copiedText');
  }

  /**
   * What the menu next to the button offers for the picture it is on.
   *
   * Two lengths of the same list. The short one is four things anyone can use
   * without being told what Lens is; the long one adds the ways of pointing at
   * part of a picture, and splits "copy" into its two halves. Nothing in the
   * short list behaves differently for being in it.
   *
   * The order is the one the buttons were arranged in, and a rule is drawn
   * wherever one kind of action gives way to another. Everything is listed
   * whether or not it also has a button in the row: the menu is the complete
   * list, and the row is the part of it worth a press of its own.
   */
  function openActions(target: Target | null = currentTarget): void {
    if (!target) return;
    closeTool();
    hideToast();
    const translated = isTranslated(target.element);
    const words = results.has(target.element);
    const pro = settings.uiMode === 'pro';

    const items: MenuItem[] = [];
    let lastKind = '';
    const add = (kind: string, item: MenuItem): void => {
      items.push(lastKind && kind !== lastKind ? { ...item, divider: true } : item);
      lastKind = kind;
    };
    const act = (id: ButtonId) => (): void => runAction(id, target, 'menu');

    for (const { id } of parseButtons(settings.buttons)) {
      if (id === 'translate') {
        add('core', {
          id,
          label: translated ? t('menu.original') : t('menu.translate'),
          icon: translated ? 'undo' : 'translate',
          run: act(id),
        });
      } else if (id === 'search') {
        add('core', { id, label: t('menu.search'), icon: 'search', run: act(id) });
      } else if (id === 'ask') {
        add('core', {
          id,
          label: t('menu.ask'),
          icon: 'sparkles',
          run: () => {},
          field: {
            value: question(),
            placeholder: t('menu.askPlaceholder'),
            sendLabel: t('menu.askSend'),
            submit: (text) => runAction('ask', target, 'menu', text),
          },
        });
      } else if (id === 'area' && pro) {
        add('tools', { id, label: t('menu.area'), icon: 'area', run: act(id) });
      } else if (id === 'objects' && pro) {
        add('tools', { id, label: t('menu.objects'), icon: 'objects', run: act(id) });
      } else if (id === 'text' && pro) {
        add('tools', { id, label: t('menu.text'), icon: 'text', run: act(id) });
      } else if (id === 'copy' && pro) {
        add('copy', {
          id: 'copyTranslation',
          label: t('menu.copyTranslation'),
          icon: 'copy',
          run: () => void copyFrom('translation', target.element),
          disabled: !words,
        });
        add('copy', {
          id: 'copyOriginal',
          label: t('menu.copyOriginal'),
          icon: 'copy',
          run: () => void copyFrom('original', target.element),
          disabled: !words,
        });
      } else if (id === 'copy') {
        add('copy', {
          id,
          label: translated ? t('menu.copyTranslation') : t('menu.copyText'),
          icon: 'copy',
          run: act(id),
        });
      }
    }
    if (pro) {
      // With the copies when they end the list, as it always was; on its own
      // once something has been moved in between.
      add(lastKind === 'copy' ? 'copy' : 'all', {
        id: 'all',
        label: t('menu.all'),
        icon: 'images',
        run: () => void translateVisible(),
      });
    }
    add('settings', { id: 'settings', label: t('menu.settings'), icon: 'settings', run: () => showSettings() });

    const rect = menuControl.getBoundingClientRect();
    const onLeft = settings.buttonCorner === 'tl' || settings.buttonCorner === 'bl';
    openMenu({ top: rect.bottom + 6, left: onLeft ? rect.left : rect.right - 260 }, items, menuControl);
  }

  /** Let the original show through one picture, or put the translation back. */
  const peek = (element: HTMLElement, peeking: boolean): boolean =>
    peekCover(element, peeking) || peekOverlay(element, peeking);

  let holdTimer = 0;
  let holding: HTMLElement | null = null;
  /** The click that ends a hold is not a click, and must not undo the translation. */
  let swallowClick = false;

  /**
   * A press that lasts. How long is a setting (350 ms unless changed): short
   * enough to feel immediate, long enough that no ordinary click reaches it.
   *
   * What it does is a setting too. Looking at the original only means anything
   * on a translated picture, so there it waits for one; every other action is
   * simply started, and the click that follows the release is swallowed.
   */
  function startHold(event: PointerEvent): void {
    const action = settings.longPressAction;
    if (event.button !== 0 || !currentTarget || action === 'none') return;
    const target = currentTarget;
    const element = target.element;
    if (action === 'peek' && !isTranslated(element)) return;
    window.clearTimeout(holdTimer);
    holdTimer = window.setTimeout(
      () => {
        swallowClick = true;
        if (action === 'peek') {
          holding = element;
          peek(element, true);
          button.classList.add('lt-peeking');
        } else runAction(action, target, 'hold');
      },
      Math.min(2000, Math.max(150, Number(settings.holdMs) || 350))
    );
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

  /** The chords in force, parsed once per change of settings rather than per key. */
  let chords: Array<readonly [Chord, () => void]> = [];

  /**
   * The picture a key press is about: the one under the cursor, or failing
   * that the one filling most of the view. Looked for now rather than taken
   * from the list a pinned button keeps, which is only kept while pinned.
   */
  function pictureForKey(): Target | null {
    if (currentTarget?.element.isConnected) return currentTarget;
    if (!watching) known = collect(settings.minImageSize);
    return mostVisible()?.target ?? null;
  }

  function bindKeys(): void {
    chords = [];
    const bind = (raw: string, run: () => void): void => {
      const chord = parseChord(raw);
      if (chord) chords.push([chord, run]);
    };
    const onPicture = (id: ButtonId) => (): void => {
      const target = pictureForKey();
      if (target) runAction(id, target, 'key');
      else toast(t('toast.noPicture'));
    };
    bind(settings.keyTranslateAll, () => void translateVisible());
    bind(settings.keyTranslate, onPicture('translate'));
    bind(settings.keySearch, onPicture('search'));
    bind(settings.keyAsk, onPicture('ask'));
    bind(settings.keyArea, onPicture('area'));
    bind(settings.keyCopy, onPicture('copy'));
    bind(settings.keyUndoAll, undoAll);
  }

  document.addEventListener(
    'keydown',
    (event) => {
      // Nor is a key pressed inside our own window: a shortcut being recorded
      // in the settings must not also run.
      if (isTyping(event) || isOurs(event.composedPath()[0] ?? null)) return;

      // Off here means the page's own shortcuts are the page's again.
      if (site !== 'off' && !event.repeat) {
        const hit = chords.find(([chord]) => matchesChord(chord, event));
        if (hit) {
          event.preventDefault();
          event.stopPropagation();
          hit[1]();
          return;
        }
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

  /**
   * A command for the panel, and for the host's menu only from the top window.
   *
   * Every frame that wakes runs this, and a host's menu belongs to the tab: ten
   * reader frames would list every command ten times, each one acting on a
   * frame nobody can tell apart from the others.
   */
  const addCommand = (command: Command): void => registerCommand(command, !framed);

  /** The same words in the host's menu and in ours, prefixed there to stand apart. */
  const command = (
    id: string,
    key: Key,
    run: () => void,
    options: { panel?: boolean; essential?: boolean } = {}
  ): void =>
    addCommand({
      id,
      menuLabel: `Lens Translate: ${t(key)}`,
      // The panel is where these are drawn, so it does not offer what it makes redundant.
      label: options.panel === false ? null : () => t(key),
      ...(options.essential ? { essential: true } : {}),
      run,
    });

  function clearEverything(): void {
    // The memory cache and the stored one are separate allowances, but to the
    // person pressing the button they are one cache, so they are reported as one.
    const memory = cacheStats();
    clearCache();
    void storedStats().then(({ entries, bytes }) => {
      void clearStored();
      const total = memory.entries + entries;
      toast(
        total
          ? t('toast.cleared', { count: total, size: ((memory.bytes + bytes) / 1048576).toFixed(1) })
          : t('toast.cacheEmpty')
      );
    });
  }

  function undoAll(): void {
    showing.clear();
    const restored = uncoverAll() + clearAllOverlays();
    markTranslated(false);
    toast(restored ? t('toast.restored', { count: restored }) : t('toast.nothingToRestore'));
  }

  command('settings', 'cmd.settings', () => showSettings(), { panel: false });
  command('clearCache', 'cmd.clearCache', clearEverything);
  command('undoAll', 'cmd.undoAll', undoAll, { essential: true });
  command('translateAll', 'cmd.translateAll', () => void translateVisible());
  command('copyTranslation', 'cmd.copyTranslation', () => void copyFrom('translation'), { panel: false });
  command('copyOriginal', 'cmd.copyOriginal', () => void copyFrom('original'), { panel: false });

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
        ? t('toast.siteNowOff', { host })
        : next === 'auto'
          ? t('toast.siteNowAuto', { host })
          : t('toast.siteNowDefault', { host })
    );
  }

  command('toggleSite', 'cmd.toggleSite', () => chooseSite(site === 'off' ? 'default' : 'off'), {
    essential: true,
  });
  command('toggleAuto', 'cmd.toggleAuto', () => chooseSite(site === 'auto' ? 'default' : 'auto'));

  // The probes ask from wherever they run, and a frame is the wrong place to
  // diagnose the tab from; the report also needs room a frame may not have.
  if (!framed) command('diagnostics', 'cmd.diagnostics', openDiagnostics, { essential: true });

  command('toggle', 'cmd.toggle', () => {
    settings = saveSettings({ enabled: !settings.enabled });
    if (!settings.enabled) {
      showing.clear();
      uncoverAll();
      clearAllOverlays();
      hideButton();
    }
    toast(settings.enabled ? t('toast.enabled') : t('toast.disabled'));
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
    openReport(t('report.probing'));
    void diagnose({ pinned }).then(openReport, (error: Error) =>
      openReport(t('report.failed', { message: error.message }))
    );
  }

  function checkDebugHash(): void {
    if (window.location.hash === DEBUG_HASH) openDiagnostics();
  }

  onReportSettings(() => showSettings());
  // The fragment is the tab's address, and every frame reading it would open a
  // report of its own on top of the one the top window opens.
  if (!framed) {
    window.addEventListener('hashchange', checkDebugHash);
    checkDebugHash();
  }

  applySettings();
  // The row carries words - titles, and labels when they are switched on - so
  // a language that arrives late redraws it. The menu and the tools are built
  // when they open and need no telling.
  onLocaleChange(buildControls);
  applyButtonMode();
  // A frame woken by a hover has already had the mouseover that would have
  // brought the button out; it would otherwise wait for the next one.
  if (hovered) showButton(hovered);

  // A host whose storage is promise-only (Greasemonkey 4, Safari's Userscripts)
  // has nothing to give a synchronous read, so everything above started from the
  // defaults. Once the saved values arrive they are adopted - without this the
  // settings silently fell back to the site's localStorage, which made them
  // per-site.
  void preloadStored([...SETTINGS_KEYS, SITES_KEY, ...LOCALE_KEYS, STATE_KEY]).then((arrived) => {
    if (!arrived) return;
    settings = reloadSettings();
    reloadSites();
    reloadState();
    site = siteMode();
    // The language setting and the locale kept for it both arrived just now.
    useLanguage(settings.language);
    applyPopupOpacity(settings.popupOpacity);
    applySettings();
    applyButtonMode();
  });
  // Asked once at document-idle is a snapshot, and the answer can arrive late or
  // change under you - a mouse plugged into a tablet, a window moved between
  // screens. Cheaper to be told than to re-ask on a timer.
  window.matchMedia(TOUCH_QUERY).addEventListener('change', applyButtonMode);
}
