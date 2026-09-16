import {
  OUTLINE_RATIO,
  argbToCss,
  buildLineText,
  fitFontSize,
  isRtl,
  justification,
  shouldStayVertical,
} from './layout.js';
import { uiRoot } from '../ui/root.js';
import type { Geometry, Settings, TranslatedLine, TranslationBlock } from '../types.js';

interface OverlayEntry {
  layer: HTMLDivElement;
  objectUrls: string[];
}

const overlays = new WeakMap<HTMLImageElement, OverlayEntry>();
const pct = (value: number): string => `${(value * 100).toFixed(4)}%`;

export const hasOverlay = (img: HTMLImageElement): boolean => overlays.has(img);

export function clearOverlay(img: HTMLImageElement): boolean {
  const entry = overlays.get(img);
  if (!entry) return false;
  for (const url of entry.objectUrls) URL.revokeObjectURL(url);
  entry.layer.remove();
  overlays.delete(img);
  return true;
}

/** The shadow host is a fixed full-viewport layer, so these are viewport
 *  coordinates and scrolling needs no page-offset arithmetic. */
function placeLayer(layer: HTMLDivElement, img: HTMLImageElement): void {
  const rect = img.getBoundingClientRect();
  layer.style.top = `${rect.top}px`;
  layer.style.left = `${rect.left}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
}

/** Overlays live in page coordinates, so they must follow layout changes. */
export function repositionOverlays(): void {
  for (const img of Array.from(document.images)) {
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
  img: HTMLImageElement,
  blocks: TranslationBlock[],
  settings: Settings
): number {
  clearOverlay(img);

  const rect = img.getBoundingClientRect();
  const aspect = img.naturalWidth / img.naturalHeight;
  const fontFamily =
    settings.fontFamily || getComputedStyle(img).fontFamily || 'system-ui, sans-serif';

  const layer = document.createElement('div');
  layer.className = 'lt-layer';
  placeLayer(layer, img);
  uiRoot().appendChild(layer);

  const objectUrls: string[] = [];
  overlays.set(img, { layer, objectUrls });

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
      const outline = size * OUTLINE_RATIO;

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
        patch
          ? `text-shadow:${-outline}px ${outline}px 0 ${bgColor},` +
            `${outline}px ${outline}px 0 ${bgColor},` +
            `${outline}px ${-outline}px 0 ${bgColor},` +
            `${-outline}px ${-outline}px 0 ${bgColor}`
          : '',
      ]
        .filter(Boolean)
        .join(';');
      layer.appendChild(element);
      rendered += 1;
    });
  }
  return rendered;
}
