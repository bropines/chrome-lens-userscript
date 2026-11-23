/**
 * How opaque the backgrounds of our popups are, in percent.
 *
 * Only the background: the text and icons on it stay solid, because a menu
 * whose words fade along with it is harder to read, which is the opposite of
 * the point. The floor is 40 because below that a busy picture wins over the
 * blur, and the words stop being readable even at full strength.
 */
export const MIN_OPACITY = 40;
export const MAX_OPACITY = 100;
export const OPACITY_STEP = 5;

/**
 * Whatever was stored or typed, as a percentage the stylesheet can use.
 *
 * Snapped to the slider's step so a value written by hand lands where the
 * slider can show it; anything that is not a number is the default, fully
 * opaque, which is what everyone had before the setting existed.
 */
export function clampOpacity(raw: unknown): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_OPACITY;
  const snapped = Math.round(value / OPACITY_STEP) * OPACITY_STEP;
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, snapped));
}
