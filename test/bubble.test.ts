import { describe, expect, test } from 'bun:test';
import {
  SHAPE_MARGIN,
  bubbleMask,
  crowdsAtFloor,
  ellipseShape,
  fitShaped,
  isBubbleColumn,
  maskShape,
  reflowMode,
} from '../src/render/bubble.js';
import type { Mask, Pixels, Shape, Sides } from '../src/render/bubble.js';
import { fitTextBlock } from '../src/render/layout.js';
import type { Rect } from '../src/render/layout.js';
import { glyphWidth } from './setup.js';

const rect = (cx: number, cy: number, w: number, h: number): Rect => ({
  left: cx - w / 2,
  right: cx + w / 2,
  top: cy - h / 2,
  bottom: cy + h / 2,
});
const around = (rects: Rect[]): Rect => ({
  left: Math.min(...rects.map((r) => r.left)),
  right: Math.max(...rects.map((r) => r.right)),
  top: Math.min(...rects.map((r) => r.top)),
  bottom: Math.max(...rects.map((r) => r.bottom)),
});

describe('reflowMode', () => {
  test('the switch it used to be still reads', () => {
    expect(reflowMode(true)).toBe('on');
    expect(reflowMode(false)).toBe('off');
  });

  test('the three values are themselves, and anything else is the default', () => {
    expect(reflowMode('on')).toBe('on');
    expect(reflowMode('off')).toBe('off');
    expect(reflowMode('auto')).toBe('auto');
    expect(reflowMode(undefined)).toBe('auto');
    expect(reflowMode('sometimes')).toBe('auto');
  });
});

describe('isBubbleColumn', () => {
  // Line boxes Lens returned for a real page, in the picture's pixels.
  const bubble = [
    rect(533, 445, 66, 15), rect(530, 461, 51, 15), rect(534, 476, 90, 14), rect(529, 493, 66, 14),
    rect(531, 510, 175, 18), rect(531, 525, 181, 16), rect(529, 543, 155, 16), rect(532, 558, 41, 14),
    rect(530, 576, 136, 16), rect(533, 591, 66, 16), rect(529, 608, 43, 14), rect(533, 624, 64, 15),
  ];
  const three = [rect(930, 604, 56, 14), rect(930, 620, 74, 15), rect(930, 633, 50, 14)];

  test('short centred lines in a stack are a column', () => {
    expect(isBubbleColumn(bubble, rect(531, 534, 181, 195))).toBe(true);
    expect(isBubbleColumn(three, rect(930, 619, 74, 43))).toBe(true);
  });

  test('a single line is not', () => {
    const line = [rect(400, 100, 300, 30)];
    expect(isBubbleColumn(line, around(line))).toBe(false);
  });

  test('two lines are a caption unless the caller knows the page is bubbles', () => {
    const two = [rect(100, 100, 80, 16), rect(100, 118, 60, 16)];
    expect(isBubbleColumn(two, around(two))).toBe(false);
    expect(isBubbleColumn(two, around(two), 2)).toBe(true);
  });

  test('a banner is wider than a column is', () => {
    const banner = [rect(400, 100, 420, 40), rect(400, 150, 380, 40), rect(400, 200, 300, 40)];
    expect(isBubbleColumn(banner, around(banner))).toBe(false);
  });

  test('body text has long lines', () => {
    const body = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => rect(300, 100 + i * 18, 400, 14));
    expect(isBubbleColumn(body, around(body))).toBe(false);
  });

  test('left-aligned text with a short last line is not centred', () => {
    const ragged = [
      rect(100, 100, 120, 14), rect(98, 118, 116, 14), rect(99, 136, 118, 14), rect(60, 154, 40, 14),
    ];
    expect(isBubbleColumn(ragged, around(ragged))).toBe(false);
  });

  test('boxes side by side are a row', () => {
    const row = [rect(100, 100, 60, 16), rect(100, 118, 60, 16), rect(100, 120, 60, 16)];
    expect(isBubbleColumn(row, around(row))).toBe(false);
  });
});

describe('crowdsAtFloor', () => {
  test('a line that has to be raised past its box is the trouble', () => {
    expect(crowdsAtFloor([20, 11, 18], 12)).toBe(true);
  });

  test('lines that all fit are left alone', () => {
    expect(crowdsAtFloor([20, 12, 18], 12)).toBe(false);
  });

  test('with no floor nothing is ever raised', () => {
    expect(crowdsAtFloor([3, 3, 3], 0)).toBe(false);
  });
});

// ---------------------------------------------------------------- pictures

type Colour = readonly [number, number, number];
const WHITE: Colour = [255, 255, 255];
const BLACK: Colour = [0, 0, 0];
const GREY: Colour = [120, 110, 100];

function picture(width: number, height: number, at: (x: number, y: number) => Colour): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = at(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

/** A filled region with an outline, on a grey page, with lettering in the line boxes. */
function bubble(
  width: number,
  height: number,
  inside: (x: number, y: number) => number,
  lines: Rect[],
  options: { page?: Colour; outline?: boolean; extra?: (x: number, y: number) => Colour | null } = {}
): Pixels {
  const page = options.page ?? GREY;
  return picture(width, height, (x, y) => {
    const extra = options.extra?.(x, y);
    if (extra) return extra;
    const depth = inside(x + 0.5, y + 0.5);
    if (depth < 0) return page;
    if (depth < 2 && options.outline !== false) return BLACK;
    // Lettering: every third column of a line box is ink, which is about what
    // bold capitals leave of the box they are in.
    for (const line of lines) {
      if (x >= line.left && x < line.right && y >= line.top && y < line.bottom) {
        return x % 3 === 0 ? BLACK : WHITE;
      }
    }
    return WHITE;
  });
}

/** Signed distance-ish to an ellipse's edge: positive inside, in pixels along x. */
const ellipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number): number => {
  const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return (1 - k) * Math.min(rx, ry);
};
const roundedRect = (cx: number, cy: number, w: number, h: number, r: number) => (x: number, y: number): number => {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  return r - (Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0));
};
const cloud = (circles: Array<[number, number, number]>) => (x: number, y: number): number =>
  Math.max(...circles.map(([cx, cy, r]) => r - Math.hypot(x - cx, y - cy)));

const OPEN: Sides = { left: true, top: true, right: true, bottom: true };
const LINES = [rect(100, 82, 50, 12), rect(100, 100, 80, 12), rect(100, 118, 44, 12)];

const area = (mask: Mask): number => {
  let sum = 0;
  for (let y = mask.top; y < mask.bottom; y += 1) sum += (mask.right[y] as number) - (mask.left[y] as number);
  return sum;
};
/** Every cell of the mask is inside the region, and every line box is inside the mask. */
function sound(mask: Mask, inside: (x: number, y: number) => number, lines: Rect[]): void {
  for (let y = mask.top; y < mask.bottom; y += 1) {
    expect(inside((mask.left[y] as number) + 0.5, y + 0.5)).toBeGreaterThanOrEqual(0);
    expect(inside((mask.right[y] as number) - 0.5, y + 0.5)).toBeGreaterThanOrEqual(0);
  }
  for (const line of lines) {
    for (let y = Math.floor(line.top); y < Math.ceil(line.bottom); y += 1) {
      expect(y).toBeGreaterThanOrEqual(mask.top);
      expect(y).toBeLessThan(mask.bottom);
      expect(mask.left[y] as number).toBeLessThanOrEqual(line.left);
      expect(mask.right[y] as number).toBeGreaterThanOrEqual(line.right);
    }
  }
}

describe('bubbleMask', () => {
  test('an ellipse is found whole, and stops at its outline', () => {
    const shape = ellipse(100, 100, 70, 55);
    const mask = bubbleMask(bubble(200, 200, shape, LINES), LINES, [], OPEN);
    if (!mask) throw new Error('no mask');
    sound(mask, shape, LINES);
    const whole = Math.PI * 70 * 55;
    expect(area(mask)).toBeGreaterThan(whole * 0.85);
    expect(area(mask)).toBeLessThan(whole);
  });

  test('a rounded rectangle keeps its corners', () => {
    const shape = roundedRect(100, 100, 150, 90, 14);
    const mask = bubbleMask(bubble(200, 200, shape, LINES), LINES, [], OPEN);
    if (!mask) throw new Error('no mask');
    sound(mask, shape, LINES);
    // An ellipse inscribed in the same box would hold 0.785 of it.
    expect(area(mask)).toBeGreaterThan(150 * 90 * 0.88);
    // And the row through the middle runs nearly the full width.
    expect((mask.right[100] as number) - (mask.left[100] as number)).toBeGreaterThan(140);
  });

  test('a cloud is followed lobe by lobe', () => {
    const shape = cloud([[70, 90, 40], [120, 85, 45], [100, 125, 42], [140, 120, 30]]);
    const mask = bubbleMask(bubble(200, 200, shape, LINES), LINES, [], OPEN);
    if (!mask) throw new Error('no mask');
    sound(mask, shape, LINES);
    expect(area(mask)).toBeGreaterThan(8000);
  });

  test('a coloured bubble works as a white one does', () => {
    const shape = ellipse(100, 100, 70, 55);
    const white = bubble(200, 200, shape, LINES).data;
    const pink = picture(200, 200, (x, y) => {
      const i = (y * 200 + x) * 4;
      const colour: Colour = [white[i] as number, white[i + 1] as number, white[i + 2] as number];
      return colour[0] === 255 ? [255, 176, 230] : colour;
    });
    const mask = bubbleMask(pink, LINES, [], OPEN);
    if (!mask) throw new Error('no mask');
    sound(mask, shape, LINES);
  });

  test('no outline at all: the fill reaches the window and is refused', () => {
    const shape = ellipse(100, 100, 70, 55);
    const pixels = bubble(200, 200, shape, LINES, { page: WHITE, outline: false });
    expect(bubbleMask(pixels, LINES, [], OPEN)).toBeNull();
  });

  test('a gap in the outline leaks, and a leak is refused', () => {
    const shape = ellipse(100, 100, 70, 55);
    const pixels = bubble(200, 200, shape, LINES, {
      page: WHITE,
      // Six pixels of the outline rubbed out on the right-hand side.
      extra: (x, y) => (x > 160 && Math.abs(y - 100) < 3 ? WHITE : null),
    });
    expect(bubbleMask(pixels, LINES, [], OPEN)).toBeNull();
  });

  test('the same leak is no leak where the window ends at the picture or a neighbour', () => {
    const shape = ellipse(100, 100, 70, 55);
    const pixels = bubble(200, 200, shape, LINES, { page: WHITE, outline: false });
    const closed: Sides = { left: false, top: false, right: false, bottom: false };
    expect(bubbleMask(pixels, LINES, [], closed)).not.toBeNull();
  });

  test('text over artwork has no background to follow', () => {
    let seed = 7;
    const noise = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // The high bits: the low ones of this generator repeat every 256 draws.
      return (seed >>> 16) & 255;
    };
    const pixels = picture(200, 200, () => [noise(), noise(), noise()]);
    expect(bubbleMask(pixels, LINES, [], OPEN)).toBeNull();
  });

  test('another paragraph in the same bubble is not room', () => {
    const shape = ellipse(100, 100, 70, 80);
    const other = rect(100, 150, 60, 14);
    const pixels = bubble(200, 200, shape, [...LINES, other]);
    const mask = bubbleMask(pixels, LINES, [other], OPEN);
    if (!mask) throw new Error('no mask');
    for (let y = Math.floor(other.top); y < Math.ceil(other.bottom); y += 1) {
      if (y < mask.top || y >= mask.bottom) continue;
      const overlap = Math.min(mask.right[y] as number, other.right) - Math.max(mask.left[y] as number, other.left);
      expect(overlap).toBeLessThanOrEqual(0);
    }
  });

  test('a descender between two lines does not cut the row in half', () => {
    const shape = ellipse(100, 100, 70, 55);
    const pixels = bubble(200, 200, shape, LINES, {
      // A comma hanging out of the second line box into the gap below it.
      extra: (x, y) => (x >= 108 && x < 111 && y >= 106 && y < 112 ? BLACK : null),
    });
    const mask = bubbleMask(pixels, LINES, [], OPEN);
    if (!mask) throw new Error('no mask');
    for (let y = 106; y < 112; y += 1) {
      expect(mask.left[y] as number).toBeLessThan(50);
      expect(mask.right[y] as number).toBeGreaterThan(150);
    }
  });

  test('the tail is left out of the text area', () => {
    const body = ellipse(100, 90, 70, 50);
    const shape = (x: number, y: number): number =>
      Math.max(body(x, y), y >= 130 && y < 185 ? 6 - Math.abs(x - 110) : -1);
    const mask = bubbleMask(bubble(200, 200, shape, LINES.map((l) => ({ ...l, top: l.top - 10, bottom: l.bottom - 10 }))), LINES.map((l) => ({ ...l, top: l.top - 10, bottom: l.bottom - 10 })), [], OPEN);
    if (!mask) throw new Error('no mask');
    expect(mask.bottom).toBeLessThan(145);
    expect(mask.bottom).toBeGreaterThan(125);
  });

  test('a region over the allowance is the page, not a bubble', () => {
    const shape = ellipse(100, 100, 70, 55);
    expect(bubbleMask(bubble(200, 200, shape, LINES), LINES, [], OPEN, 5000)).toBeNull();
  });
});

// ------------------------------------------------------------------ shapes

describe('shapes', () => {
  test('an ellipse is as wide as its narrower end', () => {
    const shape = ellipseShape(0, 0, 100, 50);
    expect(shape.span(-5, 5)?.[1]).toBeCloseTo(100 * Math.sqrt(1 - 0.01), 6);
    expect(shape.span(20, 30)?.[1]).toBeCloseTo(80, 6);
    expect(shape.span(-30, 10)?.[0]).toBeCloseTo(-80, 6);
    expect(shape.span(40, 51)).toBeNull();
  });

  test('a mask answers in the coordinates it is given, with the narrowest row of the band', () => {
    const mask: Mask = {
      width: 10,
      height: 4,
      top: 1,
      bottom: 4,
      left: Int32Array.from([-1, 2, 1, 3]),
      right: Int32Array.from([-1, 8, 9, 7]),
    };
    const shape = maskShape(mask, 100, 200, 2, 4);
    expect(shape.top).toBe(204);
    expect(shape.bottom).toBe(216);
    expect(shape.span(204, 208)).toEqual([104, 116]);
    expect(shape.span(204, 212)).toEqual([104, 116]);
    expect(shape.span(205, 216)).toEqual([106, 114]);
    // Outside the rows it has, there is no band.
    expect(shape.span(200, 208)).toBeNull();
    expect(shape.span(210, 217)).toBeNull();
  });
});

describe('fitShaped', () => {
  let font = 10;
  const setFont = (size: number): void => {
    font = size;
  };
  const measure = (text: string): number => {
    let width = 0;
    for (const char of text) width += glyphWidth(char, font);
    return width;
  };
  const TEXT =
    'Если ты сделала что-то настолько милое, значит, мои романтические наклонности, должно быть, передались тебе, да?';

  /** Every line inside the band the shape has at its height, margin included. */
  function contained(shape: Shape, fit: { size: number; lines: Array<{ text: string; left: number; right: number; y: number }> }): void {
    setFont(fit.size);
    for (const line of fit.lines) {
      const span = shape.span(line.y, line.y + fit.size);
      if (!span) throw new Error('a line outside the shape');
      expect(line.left).toBeGreaterThanOrEqual(span[0]);
      expect(line.right).toBeLessThanOrEqual(span[1]);
      expect(measure(line.text)).toBeLessThanOrEqual(line.right - line.left);
      // And clear of the edge by the margin, not merely inside it.
      const centre = (line.left + line.right) / 2;
      expect(centre - measure(line.text) / 2 - span[0]).toBeGreaterThanOrEqual(fit.size * SHAPE_MARGIN - 1e-9);
    }
  }

  test('every line fits the band it is set in', () => {
    const shape = ellipseShape(0, 0, 110, 130);
    const fit = fitShaped(setFont, measure, TEXT, shape, 1.25);
    if (!fit) throw new Error('no fit');
    contained(shape, fit);
    expect(fit.lines.map((line) => line.text).join(' ')).toBe(TEXT);
    expect(font).toBe(fit.size);
  });

  test('the block is centred on the shape', () => {
    const shape = ellipseShape(40, 300, 110, 130);
    const fit = fitShaped(setFont, measure, TEXT, shape, 1.25);
    if (!fit) throw new Error('no fit');
    const first = fit.lines[0]?.y ?? 0;
    const last = (fit.lines[fit.lines.length - 1]?.y ?? 0) + fit.size;
    expect((first + last) / 2).toBeCloseTo(300, 6);
    for (const line of fit.lines) expect((line.left + line.right) / 2).toBeCloseTo(40, 6);
  });

  test('an ellipse holds larger type than the rectangle inscribed in it', () => {
    for (const [rx, ry] of [[110, 130], [140, 90], [80, 80], [200, 120]] as const) {
      const shaped = fitShaped(setFont, measure, TEXT, ellipseShape(0, 0, rx, ry), 1.25);
      const boxed = fitTextBlock(setFont, measure, (px) => px * 1.25, TEXT, rx * Math.SQRT2, ry * Math.SQRT2);
      expect(shaped?.size ?? 0).toBeGreaterThan(boxed.size);
    }
  });

  test('where the search starts does not change what it finds', () => {
    const shape = ellipseShape(0, 0, 110, 130);
    const free = fitShaped(setFont, measure, TEXT, shape, 1.25, false, 150);
    if (!free) throw new Error('no fit');
    for (const cap of [free.size, free.size + 1, free.size + 7, 60, 97]) {
      expect(fitShaped(setFont, measure, TEXT, shape, 1.25, false, cap)?.size).toBe(free.size);
    }
    expect(fitShaped(setFont, measure, TEXT, shape, 1.25, false, free.size - 3)?.size).toBeLessThanOrEqual(free.size - 3);
  });

  test('looser spacing costs size, not containment', () => {
    const shape = ellipseShape(0, 0, 110, 130);
    const tight = fitShaped(setFont, measure, TEXT, shape, 1);
    const loose = fitShaped(setFont, measure, TEXT, shape, 1.8);
    if (!tight || !loose) throw new Error('no fit');
    expect(loose.size).toBeLessThan(tight.size);
    contained(shape, loose);
  });

  test('a language without spaces breaks between characters', () => {
    const shape = ellipseShape(0, 0, 90, 70);
    const text = '今日はとても良い天気ですね、散歩に行きましょうか';
    const fit = fitShaped(setFont, measure, text, shape, 1.25, true);
    if (!fit) throw new Error('no fit');
    expect(fit.lines.length).toBeGreaterThan(1);
    expect(fit.lines.map((line) => line.text).join('')).toBe(text);
    contained(shape, fit);
    // Word-wise it is one unbreakable token, and has to be far smaller.
    expect(fitShaped(setFont, measure, text, shape, 1.25, false)?.size ?? 0).toBeLessThan(fit.size);
  });

  test('a shape nothing fits in says so', () => {
    expect(fitShaped(setFont, measure, TEXT, ellipseShape(0, 0, 6, 6), 1.25)).toBeNull();
    expect(fitShaped(setFont, measure, '   ', ellipseShape(0, 0, 100, 100), 1.25)).toBeNull();
  });

  test('a mask read from a picture holds the text it is given', () => {
    const outline = ellipse(100, 100, 80, 70);
    const mask = bubbleMask(bubble(200, 200, outline, LINES), LINES, [], OPEN);
    if (!mask) throw new Error('no mask');
    const shape = maskShape(mask, 0, 0, 1, 1);
    const fit = fitShaped(setFont, measure, 'ТАКОЙ БЫЛ МОЙ ПЛАН С САМОГО НАЧАЛА.', shape, 1.25);
    if (!fit) throw new Error('no fit');
    contained(shape, fit);
    setFont(fit.size);
    for (const line of fit.lines) {
      const width = measure(line.text);
      const x = (line.left + line.right - width) / 2;
      for (const [px, py] of [[x, line.y], [x + width, line.y], [x, line.y + fit.size], [x + width, line.y + fit.size]] as const) {
        expect(outline(px, py)).toBeGreaterThan(0);
      }
    }
  });
});
