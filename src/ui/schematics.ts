import type { Settings } from '../types.js';

/**
 * Small pictures for the choices that are about where something goes.
 *
 * "Bottom left" and "hull" are read; a corner with a button in it is seen. Each
 * picture is a list of shapes on a 60x40 grid, as plain data, so that it can be
 * checked without a page and drawn with `createElementNS` rather than from a
 * string of markup. The settings window turns a shape's tone into a class and
 * the theme gives the class its colour.
 */

export const SCHEMATIC_W = 60;
export const SCHEMATIC_H = 40;

/**
 * How a shape is painted.
 *   'dim'   - an outline in the muted colour: the picture, a bubble.
 *   'ink'   - an outline in the text colour: what the choice moves.
 *   'solid' - filled with the text colour: the main thing.
 *   'soft'  - filled with a quiet colour: an area that is covered.
 */
export type Tone = 'dim' | 'ink' | 'solid' | 'soft';

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; tone: Tone }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; tone: Tone }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; tone: Tone }
  | { kind: 'polygon'; points: ReadonlyArray<readonly [number, number]>; tone: Tone }
  | { kind: 'text'; x: number; y: number; text: string; tone: Tone };

const rect = (x: number, y: number, w: number, h: number, tone: Tone, r = 1.5): Shape => ({
  kind: 'rect', x, y, w, h, r, tone,
});
const line = (x1: number, y1: number, x2: number, y2: number, tone: Tone = 'ink'): Shape => ({
  kind: 'line', x1, y1, x2, y2, tone,
});
/** A horizontal stroke of a given width about a centre: one line of text. */
const stroke = (cx: number, y: number, w: number, tone: Tone = 'ink'): Shape =>
  line(cx - w / 2, y, cx + w / 2, y, tone);

/** The picture everything else is drawn on. */
const FRAME = { x: 4, y: 4, w: 52, h: 32 };
const frame = (): Shape => rect(FRAME.x, FRAME.y, FRAME.w, FRAME.h, 'dim', 3);

/**
 * The control row hung from a corner: the main button solid, in the corner
 * itself, and the others following it inwards - which is how the real row is
 * ordered, whichever side it hangs from.
 */
function controls(corner: Settings['buttonCorner'], size: number, count = 3): Shape[] {
  const inset = 3;
  const gap = 2;
  const right = corner === 'tr' || corner === 'br';
  const bottom = corner === 'br' || corner === 'bl';
  const y = bottom ? FRAME.y + FRAME.h - inset - size : FRAME.y + inset;
  const shapes: Shape[] = [];
  for (let i = 0; i < count; i += 1) {
    const step = i * (size + gap);
    const x = right ? FRAME.x + FRAME.w - inset - size - step : FRAME.x + inset + step;
    shapes.push(rect(x, y, size, size, i === 0 ? 'solid' : 'ink'));
  }
  return shapes;
}

/** A mouse pointer with its tip at (x, y). */
const pointer = (x: number, y: number): Shape => ({
  kind: 'polygon',
  tone: 'solid',
  points: [
    [x, y],
    [x, y + 10],
    [x + 2.8, y + 7.4],
    [x + 4.6, y + 11.2],
    [x + 6.2, y + 10.4],
    [x + 4.4, y + 6.8],
    [x + 7.6, y + 6.8],
  ],
});

function buttonMode(value: string): Shape[] {
  // On hover there is a cursor in the picture; pinned, the button is simply there.
  if (value === 'hover') return [frame(), ...controls('tr', 7, 1), pointer(24, 14)];
  if (value === 'pinned') return [frame(), ...controls('tr', 7, 1)];
  // Auto is both: hover where there is a mouse, pinned on a phone.
  return [
    rect(3, 8, 34, 24, 'dim', 3),
    rect(27, 11, 7, 7, 'solid'),
    pointer(13, 15),
    rect(43, 4, 14, 32, 'dim', 3),
    rect(49, 7, 5, 5, 'solid'),
  ];
}

/** Three lines of text of different lengths, as the source left them. */
const TEXT_LINES: ReadonlyArray<readonly [number, number]> = [
  [11, 34],
  [20, 22],
  [29, 30],
];

function eraseMode(value: string): Shape[] {
  const shapes: Shape[] = [];
  if (value === 'hull') {
    // One shape round all of it: the corners of the outermost boxes, grown.
    shapes.push({
      kind: 'polygon',
      tone: 'soft',
      points: [[11, 5.5], [49, 5.5], [47, 34.5], [13, 34.5]],
    });
  } else {
    // One patch per line, each a little larger than its line.
    for (const [y, w] of TEXT_LINES) shapes.push(rect(30 - w / 2 - 2, y - 3.5, w + 4, 7, 'soft'));
  }
  for (const [y, w] of TEXT_LINES) shapes.push(stroke(30, y, w - 4));
  return shapes;
}

/** A sample glyph, and beside it text set as a column or as rows. */
function script(x: number, glyph: string, vertical: boolean): Shape[] {
  const shapes: Shape[] = [{ kind: 'text', x: x + 5.5, y: 24, text: glyph, tone: 'solid' }];
  if (vertical) {
    shapes.push(line(x + 15, 8, x + 15, 26), line(x + 20, 8, x + 20, 32), line(x + 25, 8, x + 25, 32));
  } else {
    shapes.push(line(x + 13, 12, x + 26, 12), line(x + 13, 20, x + 26, 20), line(x + 13, 28, x + 21, 28));
  }
  return shapes;
}

function verticalText(value: string): Shape[] {
  // Left, a translation into a CJK language; right, into any other.
  return [
    ...script(2, '文', value !== 'horizontal'),
    line(30, 7, 30, 33, 'dim'),
    ...script(31, 'A', value === 'keep'),
  ];
}

const ALIGN_WIDTHS = [36, 24, 30, 18];

function textAlign(value: string): Shape[] {
  if (value === 'auto') {
    // Whatever the source had, the translation gets: a block and its copy.
    const block = (left: number, tone: Tone): Shape[] =>
      [16, 10, 14, 8].map((w, i) => line(left, 11 + i * 6, left + w, 11 + i * 6, tone));
    return [
      ...block(6, 'dim'),
      line(26, 20, 34, 20, 'dim'),
      line(31, 17, 34, 20, 'dim'),
      line(31, 23, 34, 20, 'dim'),
      ...block(38, 'ink'),
    ];
  }
  return ALIGN_WIDTHS.map((w, i) => {
    const y = 11 + i * 6;
    if (value === 'left') return line(12, y, 12 + w, y);
    if (value === 'right') return line(48 - w, y, 48, y);
    return stroke(30, y, w);
  });
}

function reflowHorizontal(value: string): Shape[] {
  const bubble: Shape = { kind: 'ellipse', cx: 18, cy: 20, rx: 13, ry: 13, tone: 'dim' };
  // Kept as the source broke them, a translation's longer lines leave the
  // bubble; set again, they follow its shape.
  const inBubble =
    value === 'off'
      ? [stroke(18, 14, 31), stroke(18, 20, 25), stroke(18, 26, 29)]
      : [stroke(18, 14, 13), stroke(18, 20, 19), stroke(18, 26, 13)];
  // An ordinary paragraph is only touched by 'on'.
  const paragraph =
    value === 'on'
      ? [line(42, 14, 53, 14), line(42, 20, 53, 20), line(42, 26, 53, 26)]
      : [line(42, 14, 54, 14), line(42, 20, 54, 20), line(42, 26, 47, 26)];
  return [bubble, ...inBubble, rect(38, 7, 19, 26, 'dim', 2), ...paragraph];
}

const BUTTON_SIZES: Readonly<Record<string, number>> = { s: 5, m: 7, l: 10 };

const DRAWERS: Partial<Record<keyof Settings, (value: string) => Shape[]>> = {
  buttonCorner: (value) => [frame(), ...controls(value as Settings['buttonCorner'], 7)],
  buttonSize: (value) => [frame(), ...controls('tr', BUTTON_SIZES[value] ?? 7)],
  buttonMode,
  eraseMode,
  verticalText,
  textAlign,
  reflowHorizontal,
};

/** Whether a setting has a picture at all. */
export function hasSchematic(key: keyof Settings): boolean {
  return Object.hasOwn(DRAWERS, key);
}

/** The picture for one value of a setting; empty when the setting has none. */
export function schematic(key: keyof Settings, value: string): Shape[] {
  return DRAWERS[key]?.(value) ?? [];
}
