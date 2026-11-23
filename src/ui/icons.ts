/**
 * The icons, as stroke paths on a 24-unit grid.
 *
 * Drawn with `currentColor` so one definition serves the light theme, the dark
 * one and the button that sits on top of somebody's photograph. Kept as path
 * data rather than whole SVG documents because the wrapper is the same every
 * time and this file is parsed on every page load.
 */

const PATHS = {
  translate: 'm5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.3-4.3',
  sparkles:
    'M12 3l1.9 5.1a2 2 0 0 0 1.2 1.2L20 11l-4.9 1.7a2 2 0 0 0-1.2 1.2L12 19l-1.9-5.1a2 2 0 0 0-1.2-1.2L4 11l4.9-1.7a2 2 0 0 0 1.2-1.2zM19 3v4M21 5h-4',
  copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
  settings: 'M20 7h-9M14 17H5M17 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  more: 'M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM19 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM5 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  area: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2',
  objects:
    'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  close: 'M18 6 6 18M6 6l12 12',
  send: 'm5 12 7-7 7 7M12 19V5',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  images: 'M18 22H4a2 2 0 0 1-2-2V6M8 2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM22 13l-3-3-7 7',
  loader: 'M21 12a9 9 0 1 1-6.2-8.6',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 18): string {
  return (
    `<svg class="lt-icon lt-icon-${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`
  );
}
