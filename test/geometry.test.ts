import { describe, expect, test } from 'bun:test';
import {
  MIN_DRAG_PX,
  boxAfterRelease,
  boxToRect,
  canHoldUi,
  centreOf,
  dragToBox,
  fittedRect,
  insetRect,
  joinPicked,
  keyboardInset,
  objectsStillValid,
  pickables,
  placeRow,
  wrapWidth,
} from '../src/ui/geometry.js';
import type { DetectedObject, Geometry } from '../src/types.js';

const box = { left: 100, top: 50, width: 400, height: 200 };

describe('where object-fit puts a picture in its box', () => {
  test('fill is the box, whatever the picture is', () => {
    expect(fittedRect(box, { width: 10, height: 1000 }, 'fill', '50% 50%')).toEqual(box);
  });

  test('contain letterboxes and centres', () => {
    // A square in a 2:1 box: as tall as the box, half as wide, in the middle.
    expect(fittedRect(box, { width: 500, height: 500 }, 'contain', '50% 50%')).toEqual({
      left: 200,
      top: 50,
      width: 200,
      height: 200,
    });
  });

  test('cover overflows the box rather than shrinking to it', () => {
    // The square has to be 400 wide to cover; 100px hang off top and bottom.
    expect(fittedRect(box, { width: 500, height: 500 }, 'cover', '50% 50%')).toEqual({
      left: 100,
      top: -50,
      width: 400,
      height: 400,
    });
  });

  test('object-position moves it within the free space, percentages and lengths alike', () => {
    const square = { width: 500, height: 500 };
    expect(fittedRect(box, square, 'contain', '0% 50%').left).toBe(100);
    expect(fittedRect(box, square, 'contain', '100% 50%').left).toBe(300);
    expect(fittedRect(box, square, 'contain', '20px 0px').left).toBe(120);
  });

  test('none keeps natural size; scale-down only ever shrinks', () => {
    expect(fittedRect(box, { width: 100, height: 100 }, 'none', '50% 50%')).toEqual({
      left: 250,
      top: 100,
      width: 100,
      height: 100,
    });
    expect(fittedRect(box, { width: 100, height: 100 }, 'scale-down', '50% 50%').width).toBe(100);
    expect(fittedRect(box, { width: 1000, height: 1000 }, 'scale-down', '50% 50%').width).toBe(200);
  });

  test('a picture with no size yet falls back to the box instead of dividing by zero', () => {
    expect(fittedRect(box, { width: 0, height: 0 }, 'contain', '50% 50%')).toEqual(box);
  });

  test('border and padding come off the border box', () => {
    expect(insetRect(box, { top: 5, right: 10, bottom: 15, left: 20 })).toEqual({
      left: 120,
      top: 55,
      width: 370,
      height: 180,
    });
  });
});

describe('a drag as a region of the picture', () => {
  test('is normalised to the picture, in either direction', () => {
    const forward = dragToBox({ x: 200, y: 100 }, { x: 300, y: 150 }, box);
    expect(forward).toEqual({ cx: 0.375, cy: 0.375, w: 0.25, h: 0.25 });
    expect(dragToBox({ x: 300, y: 150 }, { x: 200, y: 100 }, box)).toEqual(forward);
  });

  test('running off the edge means up to the edge', () => {
    const dragged = dragToBox({ x: 300, y: 150 }, { x: 9999, y: -9999 }, box);
    expect(dragged).toEqual({ cx: 0.75, cy: 0.25, w: 0.5, h: 0.5 });
  });

  test('a tap is not a region', () => {
    expect(dragToBox({ x: 200, y: 100 }, { x: 202, y: 101 }, box)).toBeNull();
    // Long but hair-thin is not one either.
    expect(dragToBox({ x: 200, y: 100 }, { x: 400, y: 100 + MIN_DRAG_PX - 1 }, box)).toBeNull();
    expect(dragToBox({ x: 200, y: 100 }, { x: 400, y: 100 + MIN_DRAG_PX }, box)).not.toBeNull();
  });

  test('a drag wholly outside the picture is nothing', () => {
    expect(dragToBox({ x: 0, y: 0 }, { x: 50, y: 40 }, box)).toBeNull();
  });

  test('a box goes back to the pixels it came from', () => {
    const dragged = dragToBox({ x: 200, y: 100 }, { x: 300, y: 150 }, box);
    expect(dragged && boxToRect(dragged, box)).toEqual({ left: 100, top: 50, width: 100, height: 50 });
  });
});

describe('putting what Lens found onto the displayed picture', () => {
  const geometry: Geometry = { cx: 0.25, cy: 0.5, w: 0.1, h: 0.2, angle: 0 };

  test('a centre and a box scale with the size it is shown at', () => {
    expect(centreOf(geometry, { width: 400, height: 200 })).toEqual({ x: 100, y: 100 });
    expect(boxToRect(geometry, { width: 400, height: 200 })).toEqual({ left: 80, top: 80, width: 40, height: 40 });
    expect(centreOf(geometry, { width: 800, height: 400 })).toEqual({ x: 200, y: 200 });
  });
});

describe('the keyboard', () => {
  test('is what the visual viewport lost from the bottom of the layout one', () => {
    expect(keyboardInset(812, { height: 480, offsetTop: 0, scale: 1 })).toBe(332);
    // Scrolled within the layout viewport to keep a field in view.
    expect(keyboardInset(812, { height: 480, offsetTop: 100, scale: 1 })).toBe(232);
  });

  test('is nothing when there is no visual viewport, no keyboard, or the page is zoomed', () => {
    expect(keyboardInset(812, undefined)).toBe(0);
    expect(keyboardInset(812, { height: 812, offsetTop: 0, scale: 1 })).toBe(0);
    // Pinch-zoomed: the difference is the zoom, not a keyboard.
    expect(keyboardInset(812, { height: 406, offsetTop: 0, scale: 2 })).toBe(0);
  });
});

describe('where the UI can live in fullscreen', () => {
  test('a container can hold it; an element that draws itself cannot', () => {
    expect(canHoldUi('DIV')).toBe(true);
    expect(canHoldUi('MAIN')).toBe(true);
    expect(canHoldUi('VIDEO')).toBe(false);
    expect(canHoldUi('IMG')).toBe(false);
    expect(canHoldUi('canvas')).toBe(false);
    expect(canHoldUi('svg')).toBe(false);
  });
});

describe('picking words out of the text', () => {
  const g = (cx: number): Geometry => ({ cx, cy: 0.5, w: 0.1, h: 0.1, angle: 0 });
  const paragraphs = [
    {
      lines: [
        {
          text: 'Hello big world',
          geometry: g(0.5),
          words: [
            { text: 'Hello', separator: ' ', geometry: g(0.1) },
            { text: 'big', separator: ' ', geometry: g(0.2) },
            { text: 'world', separator: '', geometry: g(0.3) },
          ],
        },
        // One word here has no box, so the line is offered whole.
        {
          text: 'second line',
          geometry: g(0.6),
          words: [
            { text: 'second', separator: ' ', geometry: g(0.1) },
            { text: 'line', separator: '', geometry: null },
          ],
        },
        // Nowhere to draw it at all.
        { text: 'lost', geometry: null, words: [] },
      ],
    },
    {
      lines: [
        {
          text: '日本語',
          geometry: g(0.7),
          words: [
            { text: '日本', separator: '', geometry: g(0.7) },
            { text: '語', separator: '', geometry: g(0.8) },
          ],
        },
        {
          text: 'です',
          geometry: g(0.8),
          words: [{ text: 'です', separator: '', geometry: g(0.8) }],
        },
      ],
    },
  ];

  test('words where every word has a box, the line where one does not', () => {
    expect(pickables(paragraphs).map((item) => item.text)).toEqual([
      'Hello',
      'big',
      'world',
      'second line',
      '日本',
      '語',
      'です',
    ]);
  });

  test('neighbours join the way the source did; a gap gets a space', () => {
    const items = pickables(paragraphs);
    expect(joinPicked(items, new Set([0, 1, 2]))).toBe('Hello big world');
    // Skipping "big": two words, not one.
    expect(joinPicked(items, new Set([0, 2]))).toBe('Hello world');
    expect(joinPicked(items, new Set())).toBe('');
  });

  test('a line end separates words in a spaced script and not in an unspaced one', () => {
    const items = pickables(paragraphs);
    // Lens puts nothing after the last word of a line.
    expect(joinPicked(items, new Set([2, 3]))).toBe('world second line');
    expect(joinPicked(items, new Set([4, 5, 6]))).toBe('日本語です');
  });
});

describe('what a press on the region layer leaves chosen', () => {
  const picture = { left: 0, top: 0, width: 400, height: 200 };
  const drawn = { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 };

  test('a real drag replaces the area and says so', () => {
    const released = boxAfterRelease({ x: 0, y: 0 }, { x: 200, y: 100 }, picture, drawn);
    expect(released.changed).toBe(true);
    expect(released.box).toEqual({ cx: 0.25, cy: 0.25, w: 0.5, h: 0.5 });
  });

  test('a tap keeps the area and changes nothing, so the bar is not rebuilt', () => {
    expect(boxAfterRelease({ x: 50, y: 50 }, { x: 50, y: 50 }, picture, drawn)).toEqual({ box: drawn, changed: false });
  });

  test('a drag under the threshold counts as a tap', () => {
    const shy = MIN_DRAG_PX - 1;
    expect(boxAfterRelease({ x: 10, y: 10 }, { x: 10 + shy, y: 10 + shy }, picture, drawn).changed).toBe(false);
  });

  test('a tap with nothing chosen leaves nothing chosen', () => {
    expect(boxAfterRelease({ x: 5, y: 5 }, { x: 6, y: 6 }, picture, null)).toEqual({ box: null, changed: false });
  });
});

describe('whether object ids still name what they named', () => {
  const objects: DetectedObject[] = [{ id: 'a', geometry: null }];

  test('the same upload, still open, with the list the dots came from', () => {
    expect(objectsStillValid({ objects, fresh: true }, objects)).toBe(true);
  });

  test('an expired session has forgotten them', () => {
    expect(objectsStillValid({ objects, fresh: false }, objects)).toBe(false);
  });

  test('a session reopened since replaced the list, so the old ids are stale even though it is fresh', () => {
    expect(objectsStillValid({ objects: [...objects], fresh: true }, objects)).toBe(false);
  });
});

describe('the row of controls on a small screen', () => {
  const phone = { left: 0, top: 0, width: 375, height: 812 };
  const nine = Array.from({ length: 9 }, () => 44);

  test('a row that fits is one line, as wide as its controls', () => {
    expect(wrapWidth([32, 32, 32], 4, 1000)).toBe(104);
    expect(wrapWidth([44, 0, 44], 6, 1000)).toBe(94);
  });

  test('nine 44px buttons wrap to what a 375px phone can hold', () => {
    // 444px laid end to end; seven to a line is 344, eight would be 394.
    const width = wrapWidth(nine, 6, 375 - 8);
    expect(width).toBe(344);
    const at = placeRow('tr', { left: 0, top: 100, width: 375, height: 300 }, { width, height: 94 }, phone, 4, 6);
    expect(at.x).toBeGreaterThanOrEqual(4);
    expect(at.x + width).toBeLessThanOrEqual(371);
    // Still hung from the corner: its right edge is the picture's, less the inset.
    expect(at.x + width).toBe(369);
    expect(at.y).toBe(106);
  });

  test('a control wider than the screen gets a line to itself', () => {
    expect(wrapWidth([44, 500, 44], 6, 300)).toBe(500);
  });

  test('hung from each corner of a picture that is on screen, nothing moves', () => {
    const pic = { left: 100, top: 100, width: 200, height: 200 };
    const row = { width: 80, height: 32 };
    expect(placeRow('tl', pic, row, phone, 4, 6)).toEqual({ x: 106, y: 106 });
    expect(placeRow('tr', pic, row, phone, 4, 6)).toEqual({ x: 214, y: 106 });
    expect(placeRow('bl', pic, row, phone, 4, 6)).toEqual({ x: 106, y: 262 });
    expect(placeRow('br', pic, row, phone, 4, 6)).toEqual({ x: 214, y: 262 });
  });

  test('a picture running off the screen keeps the row on it', () => {
    const row = { width: 150, height: 32 };
    // A narrow picture at the left edge: a right-corner row would start at -94.
    expect(placeRow('tr', { left: 0, top: -50, width: 50, height: 900 }, row, phone, 4, 6)).toEqual({ x: 4, y: 4 });
    // Off the right and the bottom.
    expect(placeRow('bl', { left: 300, top: 600, width: 400, height: 400 }, row, phone, 4, 6)).toEqual({
      x: 221,
      y: 776,
    });
  });

  test('a row bigger than the screen keeps the end the main control is on', () => {
    const huge = { width: 500, height: 32 };
    const pic = { left: 0, top: 0, width: 375, height: 400 };
    expect(placeRow('tl', pic, huge, phone, 4, 6).x).toBe(4);
    expect(placeRow('tr', pic, huge, phone, 4, 6).x + huge.width).toBe(371);
  });

  test('the visible viewport is the bound, not the page: a pinch-zoomed window', () => {
    const view = { left: 200, top: 300, width: 180, height: 300 };
    const at = placeRow('tr', { left: 0, top: 0, width: 375, height: 812 }, { width: 94, height: 44 }, view, 4, 6);
    // Its corner is inside the window across; down, it is above it and comes in.
    expect(at).toEqual({ x: 275, y: 304 });
  });
});
