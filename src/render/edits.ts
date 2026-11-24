import type { BlockEdit, Edits } from '../types.js';

/**
 * Hand corrections to a rendering, as data (pure).
 *
 * The quick editor changes nothing but these records; the renderer reads them.
 * That is what keeps an edit cheap to keep and to redraw: a few fields per
 * paragraph, stored beside the answer, and the picture drawn again from both.
 */

export const SCALE_MIN = 0.3;
export const SCALE_MAX = 3;
/** How far text may be moved, in pictures: past this it is not on it any more. */
const OFFSET_MAX = 1;

const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** An edit as it is being made: a field set to `undefined` is one taken out. */
export type LooseEdit = { [K in keyof BlockEdit]?: BlockEdit[K] | undefined };

/**
 * One edit with everything that is no change taken out, or null when nothing
 * is left. A record that only says "scale 1" is the absence of an edit, and
 * keeping it would make an untouched paragraph look edited - re-wrapped, since
 * an edited paragraph is set as one area.
 */
export function cleanEdit(edit: LooseEdit | undefined): BlockEdit | null {
  if (!edit) return null;
  if (edit.original) return { original: true };
  const out: BlockEdit = {};
  if (typeof edit.text === 'string') out.text = edit.text.slice(0, 2000);
  if (typeof edit.scale === 'number' && Number.isFinite(edit.scale)) {
    const scale = clamp(edit.scale, SCALE_MIN, SCALE_MAX);
    if (Math.abs(scale - 1) > 0.005) out.scale = Math.round(scale * 100) / 100;
  }
  if (typeof edit.color === 'string' && HEX.test(edit.color)) out.color = edit.color.toLowerCase();
  if (typeof edit.outline === 'string' && HEX.test(edit.outline)) out.outline = edit.outline.toLowerCase();
  for (const axis of ['dx', 'dy'] as const) {
    const value = edit[axis];
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.0005) {
      out[axis] = Math.round(clamp(value, -OFFSET_MAX, OFFSET_MAX) * 10000) / 10000;
    }
  }
  if (edit.hidden) out.hidden = true;
  return Object.keys(out).length ? out : null;
}

/**
 * Every edit cleaned, and only those for a paragraph that exists. Also what an
 * answer read back from storage goes through, since storage is the page's.
 */
export function cleanEdits(edits: unknown, blocks: number): Edits | undefined {
  if (!edits || typeof edits !== 'object') return undefined;
  const out: Edits = {};
  for (const [key, value] of Object.entries(edits as Record<string, BlockEdit>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= blocks) continue;
    const edit = cleanEdit(value);
    if (edit) out[index] = edit;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Whether the text of this paragraph is set anew rather than line by line.
 *
 * Changed words have no line ranges to follow, and moving or resizing the text
 * has to leave the erased source where it was - both need the text drawn apart
 * from the patches, which is what re-wrapping already does.
 */
export const resets = (edit: BlockEdit | undefined): boolean =>
  Boolean(edit && (edit.text !== undefined || edit.scale !== undefined || edit.dx || edit.dy));

/**
 * The part of a cache key that edits contribute: empty without any, so every
 * rendering cached before edits existed is still found.
 */
export function editsTag(edits: Edits | undefined): string {
  if (!edits) return '';
  const keys = Object.keys(edits).sort((a, b) => Number(a) - Number(b));
  if (!keys.length) return '';
  return `|e=${JSON.stringify(keys.map((key) => [key, edits[Number(key)]]))}`;
}

/** An aRGB colour as the `#rrggbb` a colour input takes; alpha is dropped. */
export const argbToHex = (value: number): string => `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
