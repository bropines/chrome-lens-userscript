import {
  OUTLINE_RATIO,
  argbToCss,
  buildLineText,
  fitFontSize,
  isRtl,
  justification,
  shouldStayVertical,
} from './layout.js';
import { watchPicture } from './watch.js';
import type { Geometry, RenderOptions, TranslatedLine, TranslationBlock } from '../types.js';

/**
 * The rules the layer this renderer builds needs to exist.
 *
 * They travel with the renderer rather than with the front end's stylesheet,
 * because they are not styling in the decorative sense - `position: absolute`
 * and `white-space: pre` are how a line lands where the geometry says it does.
 * A front end that drops them gets text stacked in the corner of the page.
 */
export const OVERLAY_CSS = `
.lt-layer {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
}
.lt-bg {
  position: absolute;
  max-width: none;
}
.lt-line {
  position: absolute;
  display: flex;
  align-items: center;
  white-space: pre;
  line-height: 1;
  transform-origin: center center;
  margin: 0;
  padding: 0;
}
`;

interface OverlayEntry {
  layer: HTMLDivElement;
  objectUrls: string[];
  ref: WeakRef<HTMLElement>;
  stopWatching: () => void;
  hiddenFor: Set<'peek' | 'pending'>;
}

const overlays = new WeakMap<HTMLElement, OverlayEntry>();
/**
 * What has an overlay, for the two operations that need to enumerate them.
 *
 * A WeakMap cannot be walked, and this used to walk `document.images` instead -
 * which quietly meant only an <img> could ever be cleared or repositioned, and
 * a canvas or a background would have been stranded.
 */
const live = new Set<WeakRef<HTMLElement>>();
const pct = (value: number): string => `${(value * 100).toFixed(4)}%`;

function textShadow(radius: number, colour: string): string {
  const r = radius.toFixed(2);
  const d = (radius * 0.71).toFixed(2);
  return [
    [`-${r}px`, '0'], [`${r}px`, '0'], ['0', `-${r}px`], ['0', `${r}px`],
    [`-${d}px`, `-${d}px`], [`${d}px`, `-${d}px`],
    [`-${d}px`, `${d}px`], [`${d}px`, `${d}px`],
  ]
    .map(([x, y]) => `${x} ${y} 0 ${colour}`)
    .join(',');
}

export const hasOverlay = (img: HTMLElement): boolean => overlays.has(img);

export function clearOverlay(img: HTMLElement): boolean {
  const entry = overlays.get(img);
  if (!entry) return false;
  entry.stopWatching();
  for (const url of entry.objectUrls) URL.revokeObjectURL(url);
  entry.layer.remove();
  overlays.delete(img);
  // The reference goes with the overlay. It used to stay until the next walk
  // happened to sweep it, so a page that was translated and undone over and
  // over grew the set without bound.
  live.delete(entry.ref);
  return true;
}

function showOrHide(entry: OverlayEntry): void {
  entry.layer.style.visibility = entry.hiddenFor.size ? 'hidden' : '';
}

/** Show the original underneath for as long as it is asked to; nothing is torn down. */
export function peekOverlay(img: HTMLElement, peeking: boolean): boolean {
  const entry = overlays.get(img);
  if (!entry) return false;
  if (peeking) entry.hiddenFor.add('peek');
  else entry.hiddenFor.delete('peek');
  showOrHide(entry);
  return true;
}

export function peekAllOverlays(peeking: boolean): void {
  for (const img of overlaid()) peekOverlay(img, peeking);
}

/**
 * Remove the overlays whose image has left the page.
 *
 * Repositioning does this too, but only when something scrolls or resizes, and
 * a feed that discards its images while the reader is still is the case where
 * the layers would otherwise sit in the page for good.
 */
export function sweepOverlays(): number {
  let removed = 0;
  for (const img of overlaid()) {
    if (!img.isConnected && clearOverlay(img)) removed += 1;
  }
  return removed;
}

/** The shadow host is a fixed full-viewport layer, so these are viewport
 *  coordinates and scrolling needs no page-offset arithmetic. */
function placeLayer(layer: HTMLDivElement, img: HTMLElement): void {
  const rect = img.getBoundingClientRect();
  layer.style.top = `${rect.top}px`;
  layer.style.left = `${rect.left}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
}

/** Whatever still has an overlay, with the dead references swept out. */
function overlaid(): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const ref of live) {
    const element = ref.deref();
    if (!element || !overlays.has(element)) live.delete(ref);
    else out.push(element);
  }
  return out;
}

/** Remove every overlay on the page. */
export function clearAllOverlays(): number {
  let count = 0;
  for (const img of overlaid()) {
    if (clearOverlay(img)) count += 1;
  }
  return count;
}

/** Overlays live in page coordinates, so they must follow layout changes. */
export function repositionOverlays(): void {
  for (const img of overlaid()) {
    const entry = overlays.get(img);
    if (!entry) continue;
    if (!img.isConnected) {
      clearOverlay(img);
      continue;
    }
    placeLayer(entry.layer, img);
  }
}

function renderBackground(
  layer: HTMLDivElement,
  line: TranslatedLine,
  geometry: Geometry,
  aspect: number,
  objectUrls: string[]
): void {
  if (!line.background) return;
  // Both paddings are fractions of the LINE HEIGHT. The horizontal one is
  // divided by the image aspect ratio to become a fraction of width; skipping
  // that makes the patch wildly too wide.
  const padW = (line.background.hPad * geometry.h) / aspect;
  const padH = line.background.vPad * geometry.h;

  const url = URL.createObjectURL(new Blob([line.background.bytes], { type: 'image/webp' }));
  objectUrls.push(url);

  const patch = document.createElement('img');
  patch.className = 'lt-bg';
  patch.src = url;
  patch.style.cssText = [
    `width:${pct(geometry.w + padW)}`,
    `height:${pct(geometry.h + padH)}`,
    `left:${pct(geometry.cx - geometry.w / 2 - padW / 2)}`,
    `top:${pct(geometry.cy - geometry.h / 2 - padH / 2)}`,
    `transform:rotate(${geometry.angle}deg)`,
  ].join(';');
  layer.appendChild(patch);
}

export function renderTranslation(
  img: HTMLElement,
  blocks: TranslationBlock[],
  settings: RenderOptions,
  // The picture's own proportions, which only an <img> carries on the element.
  // A canvas, a video and a background all get theirs from whatever was read.
  natural: { width: number; height: number },
  /**
   * Where the layer goes.
   *
   * A parameter rather than this script's own shadow root: the renderer used to
   * reach into `ui/root.ts` for it, which meant the engine's DOM renderer only
   * worked inside this particular front end's chrome. It needs a positioned,
   * full-viewport container and the rules above; whose it is, is not its
   * business.
   */
  root: ParentNode,
  options: {
    /** The overlay was removed because the picture changed, not because it was asked to be. */
    onGone?: () => void;
  } = {}
): number {
  clearOverlay(img);

  const rect = img.getBoundingClientRect();
  const aspect = natural.width / natural.height;
  const fontFamily =
    settings.fontFamily || getComputedStyle(img).fontFamily || 'system-ui, sans-serif';

  const layer = document.createElement('div');
  layer.className = 'lt-layer';
  placeLayer(layer, img);
  root.append(layer);

  const objectUrls: string[] = [];
  const ref = new WeakRef(img);
  const entry: OverlayEntry = {
    layer,
    objectUrls,
    ref,
    hiddenFor: new Set(),
    stopWatching: () => {},
  };
  // Watched like a cover is: the layer sits in our own root, so it is not even
  // a sibling to be orphaned - it would simply float over whatever the page
  // shows next at the old image's position.
  entry.stopWatching = watchPicture(img, {
    stale: () => {
      const current = ref.deref();
      if (current && clearOverlay(current)) options.onGone?.();
    },
    pending: (on) => {
      if (on) entry.hiddenFor.add('pending');
      else entry.hiddenFor.delete('pending');
      showOrHide(entry);
    },
  });
  overlays.set(img, entry);
  live.add(ref);

  let rendered = 0;
  for (const block of blocks) {
    const rtl = isRtl(block);
    const vertical = shouldStayVertical(block, settings.verticalText);
    const justify = justification(block.alignment, rtl);

    block.lines.forEach((line, index) => {
      const geometry = line.geometry;
      if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;

      const patch = Boolean(settings.drawBackground && line.background);
      if (patch) renderBackground(layer, line, geometry, aspect, objectUrls);

      const str = buildLineText(block.translation, line, block.lines[index + 1]);
      if (!str.trim()) return;

      const boxW = geometry.w * rect.width;
      const boxH = geometry.h * rect.height;
      const size = fitFontSize(str, vertical ? boxH : boxW, vertical ? boxW : boxH, fontFamily);
      const bgColor = argbToCss(line.bgColor);
      const outline = size * OUTLINE_RATIO * settings.outlineScale;

      // Without a patch the background must be opaque, and Chromium adds a few
      // pixels of padding in that case only.
      const padX = patch ? 0 : 2;
      const padY = patch ? 0 : 1;

      const element = document.createElement('div');
      element.className = 'lt-line';
      element.textContent = str;
      element.style.cssText = [
        `width:calc(${pct(geometry.w)} + ${padX * 2}px)`,
        `height:calc(${pct(geometry.h)} + ${padY * 2}px)`,
        `left:calc(${pct(geometry.cx - geometry.w / 2)} - ${padX}px)`,
        `top:calc(${pct(geometry.cy - geometry.h / 2)} - ${padY}px)`,
        `color:${argbToCss(line.textColor)}`,
        `background-color:${patch ? 'transparent' : bgColor}`,
        `font-size:${size}px`,
        `font-family:${fontFamily}`,
        `justify-content:${justify}`,
        `direction:${rtl ? 'rtl' : 'ltr'}`,
        `writing-mode:${vertical ? 'vertical-rl' : 'horizontal-tb'}`,
        `transform:rotate(${geometry.angle}deg)`,
        // The outline keeps the text legible over whatever residue the
        // inpainting left behind.
        // Eight directions rather than Chromium's four: the diagonals alone
        // separate into distinct copies once the offset grows past a pixel or
        // two, and this renderer has no stroke to fall back on.
        patch ? `text-shadow:${textShadow(outline, bgColor)}` : '',
      ]
        .filter(Boolean)
        .join(';');
      layer.appendChild(element);
      rendered += 1;
    });
  }
  return rendered;
}
