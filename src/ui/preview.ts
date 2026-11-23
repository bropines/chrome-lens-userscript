import { t } from '../i18n/index.js';
import { argbToCss } from '../render/layout.js';
import { renderToBlob } from '../render/canvas.js';
import { WritingDirection } from '../types.js';
import type { Bytes } from '../types.js';
import { icon } from './icons.js';
import {
  SAMPLE,
  SAMPLE_BAND_TOP,
  SAMPLE_BUBBLES,
  SAMPLE_H,
  SAMPLE_W,
  patchRect,
  previewSignature,
  sampleBlocks,
} from './sample.js';
import type { PreviewOptions } from './sample.js';

/**
 * A translation, drawn in the settings window from the values in the form.
 *
 * The appearance settings are a page of numbers whose effect is only seen by
 * saving, finding a picture and translating it. This is a picture that is
 * always there: a small scene painted in code, an answer for it written by
 * hand (./sample.ts), and the real `renderToBlob` in between - so what it
 * shows is what the renderer does, not an illustration of it.
 *
 * Nothing leaves this file: no request, no cache, no store, no element in the
 * page. The scene and its patches are made once and kept; a redraw is one call
 * to the renderer on a 400x220 picture.
 */

/** How long the form has to be still before it is drawn. */
const DEBOUNCE_MS = 150;
/**
 * How much of the source's lettering a patch leaves behind. The server's
 * inpainting keeps the glyphs' soft edges, which is what the outline and the
 * hull exist for, so a sample with perfectly clean patches would make both
 * look pointless.
 */
const RESIDUE = 0.12;

const SCENE_FONT = 'sans-serif';

function paintGround(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#e7e2d8';
  ctx.fillRect(0, 0, SAMPLE_W, SAMPLE_H);
  // Screentone, so that what is outside a bubble is visibly not flat.
  ctx.fillStyle = 'rgba(30, 30, 40, 0.22)';
  for (let y = 3; y < SAMPLE_BAND_TOP; y += 6) {
    for (let x = (y / 3) % 2 ? 3 : 6; x < SAMPLE_W; x += 6) {
      ctx.beginPath();
      ctx.arc(x, y, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The caption's band: a gradient with stripes across it, which is the
  // background a flat fill gets wrong and an inpainted patch gets right.
  const band = ctx.createLinearGradient(0, 0, SAMPLE_W, 0);
  band.addColorStop(0, '#1b2440');
  band.addColorStop(1, '#6a2c5b');
  ctx.fillStyle = band;
  ctx.fillRect(0, SAMPLE_BAND_TOP, SAMPLE_W, SAMPLE_H - SAMPLE_BAND_TOP);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, SAMPLE_BAND_TOP, SAMPLE_W, SAMPLE_H - SAMPLE_BAND_TOP);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 5;
  for (let x = -60; x < SAMPLE_W; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, SAMPLE_H);
    ctx.lineTo(x + 60, SAMPLE_BAND_TOP);
    ctx.stroke();
  }
  ctx.restore();

  // Every outline first and every fill after, so a fill takes the inner half
  // of the strokes with it and the tail joins its bubble without a seam. One
  // path per shape: two that overlap in one path can wind against each other
  // and leave the overlap unfilled.
  const [speech] = SAMPLE_BUBBLES;
  const shapes: Array<() => void> = SAMPLE_BUBBLES.map((bubble) => (): void => {
    ctx.beginPath();
    ctx.ellipse(bubble.cx, bubble.cy, bubble.rx, bubble.ry, 0, 0, Math.PI * 2);
  });
  if (speech) {
    const foot = speech.cy + speech.ry;
    shapes.push((): void => {
      ctx.beginPath();
      ctx.moveTo(speech.cx - 46, foot - 16);
      ctx.lineTo(speech.cx - 62, foot + 8);
      ctx.lineTo(speech.cx - 22, foot - 6);
      ctx.closePath();
    });
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 5;
  for (const trace of shapes) {
    trace();
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  for (const trace of shapes) {
    trace();
    ctx.fill();
  }
}

function paintSource(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const paragraph of SAMPLE) {
    ctx.font = `${paragraph.size}px ${SCENE_FONT}`;
    ctx.fillStyle = argbToCss(paragraph.textColor);
    for (const line of paragraph.lines) {
      if (paragraph.direction !== WritingDirection.TopToBottom) {
        ctx.fillText(line.source, line.cx, line.cy);
        continue;
      }
      const top = line.cy - line.h / 2;
      [...line.source].forEach((char, index) => {
        ctx.fillText(char, line.cx, top + (index + 0.5) * paragraph.size);
      });
    }
  }
}

function blank(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

async function encode(canvas: HTMLCanvasElement): Promise<Bytes | null> {
  // WebP is what the server sends; a browser that cannot write one hands back
  // a PNG under the same call, and the decoder goes by the bytes either way.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

interface Scene {
  /** The picture as found: the ground with the source lettering on it. */
  picture: HTMLCanvasElement;
  /** One inpainted patch per line, in the order `sampleBlocks` takes them. */
  patches: Array<Bytes | null>;
}

async function buildScene(): Promise<Scene | null> {
  const picture = blank();
  const erased = blank();
  if (!picture || !erased) return null;
  paintGround(picture.ctx);
  paintSource(picture.ctx);
  paintGround(erased.ctx);
  erased.ctx.globalAlpha = RESIDUE;
  paintSource(erased.ctx);

  const patches: Array<Bytes | null> = [];
  for (const paragraph of SAMPLE) {
    for (const line of paragraph.lines) {
      const area = patchRect(paragraph, line);
      const cut = document.createElement('canvas');
      cut.width = Math.max(1, Math.round(area.w));
      cut.height = Math.max(1, Math.round(area.h));
      const ctx = cut.getContext('2d');
      if (!ctx) {
        patches.push(null);
        continue;
      }
      ctx.drawImage(erased.canvas, area.x, area.y, area.w, area.h, 0, 0, cut.width, cut.height);
      patches.push(await encode(cut));
    }
  }
  return { picture: picture.canvas, patches };
}

/** Made on the first draw and kept: the same scene for every window opened. */
let scene: Promise<Scene | null> | null = null;
/** Folded or not, for as long as the page lives - the window is rebuilt often. */
let open = true;

export interface Preview {
  /** The block to put in a pane. One node for the life of the window. */
  element: HTMLElement;
  /**
   * Ask for a redraw from whatever `read` returns once the form has been
   * still for a moment. Asking is free: nothing is drawn while the preview is
   * out of sight, or when the answer would be the picture already shown.
   */
  schedule(read: () => PreviewOptions, delay?: number): void;
  dispose(): void;
}

export function createPreview(): Preview {
  const element = document.createElement('details');
  element.className = 'lt-live lt-extra';
  element.open = open;

  const summary = document.createElement('summary');
  summary.className = 'lt-live-head';
  const chevron = document.createElement('span');
  chevron.className = 'lt-live-chevron';
  chevron.innerHTML = icon('down', 14);
  const title = document.createElement('span');
  title.textContent = t('preview.title');
  summary.append(chevron, title);

  const canvas = document.createElement('canvas');
  canvas.className = 'lt-live-canvas';
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('preview.title'));

  const note = document.createElement('div');
  note.className = 'lt-live-note';
  note.textContent = t('preview.note');

  const body = document.createElement('div');
  body.className = 'lt-live-body';
  body.append(canvas, note);
  element.append(summary, body);

  let timer: number | undefined;
  let pending: (() => PreviewOptions) | null = null;
  /** What the canvas shows now, as `previewSignature` spells it. */
  let shown = '';
  /** Counts draws, so one that finishes late does not paint over a newer one. */
  let generation = 0;
  let disposed = false;

  const draw = async (): Promise<void> => {
    const read = pending;
    // Not laid out: folded, on another tab, or not in the window at all. The
    // request is kept and answered when the preview is next looked at.
    if (!read || disposed || canvas.getClientRects().length === 0) return;
    const settings = read();
    // The readable-size floor is in displayed pixels, and the sample stands
    // for a picture shown at its own size - not for the thumbnail of it this
    // window has room for. Drawn for the thumbnail's width, the floor would
    // nearly double every size on a phone and the sample would show nothing
    // but the floor.
    const width = SAMPLE_W;
    const signature = previewSignature(settings, width);
    pending = null;
    if (signature === shown) return;

    const mine = ++generation;
    try {
      scene ??= buildScene();
      const made = await scene;
      if (!made) return;
      const blob = await renderToBlob(
        made.picture,
        SAMPLE_W,
        SAMPLE_H,
        sampleBlocks(settings.targetLang, made.patches),
        settings,
        width
      );
      const bitmap = await createImageBitmap(blob);
      if (mine === generation && !disposed) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          ctx.imageSmoothingQuality = 'high';
          // The original underneath, as a cover below full opacity has it.
          ctx.drawImage(made.picture, 0, 0, canvas.width, canvas.height);
          ctx.globalAlpha = Math.min(1, Math.max(0, settings.coverOpacity / 100));
          ctx.drawImage(bitmap, 0, 0);
          ctx.globalAlpha = 1;
          shown = signature;
        }
      }
      bitmap.close();
    } catch {
      // A preview that cannot be drawn is a picture that stays as it was; the
      // settings it would have shown are no less valid for it.
    }
  };

  const schedule = (read: () => PreviewOptions, delay = DEBOUNCE_MS): void => {
    if (disposed) return;
    pending = read;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void draw(), delay);
  };

  element.addEventListener('toggle', () => {
    open = element.open;
    if (element.open && pending) schedule(pending, 0);
  });

  return {
    element,
    schedule,
    dispose(): void {
      disposed = true;
      pending = null;
      window.clearTimeout(timer);
    },
  };
}
