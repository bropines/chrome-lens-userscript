import { describe, expect, test } from 'bun:test';
import { FRAME_MIN_HEIGHT, FRAME_MIN_WIDTH, roomyFrame, shouldWake } from '../src/frame.js';
import { MAX_OPACITY, MIN_OPACITY, clampOpacity } from '../src/ui/opacity.js';

const MIN = 50;

describe('waking a frame', () => {
  test('no IAB ad unit is roomy enough, whatever it holds', () => {
    const units = [
      [300, 250],
      [336, 280],
      [728, 90],
      [970, 90],
      [970, 250],
      [320, 50],
      [160, 600],
      [300, 600],
      [300, 1050],
    ] as const;
    for (const [width, height] of units) {
      // The picture in an ad is usually the ad.
      expect(shouldWake({ width, height }, [{ width, height }], MIN)).toBe(false);
    }
  });

  test('a page-sized frame wakes for a big picture', () => {
    expect(shouldWake({ width: 800, height: 600 }, [{ width: 640, height: 480 }], MIN)).toBe(true);
  });

  test('the bound is inclusive on both axes', () => {
    const picture = [{ width: 200, height: 200 }];
    expect(shouldWake({ width: FRAME_MIN_WIDTH, height: FRAME_MIN_HEIGHT }, picture, MIN)).toBe(true);
    expect(shouldWake({ width: FRAME_MIN_WIDTH - 1, height: 2000 }, picture, MIN)).toBe(false);
    expect(shouldWake({ width: 2000, height: FRAME_MIN_HEIGHT - 1 }, picture, MIN)).toBe(false);
  });

  test('a roomy frame with only small pictures stays asleep', () => {
    const icons = [
      { width: 24, height: 24 },
      { width: 120, height: 40 },
    ];
    expect(shouldWake({ width: 1200, height: 800 }, icons, MIN)).toBe(false);
    expect(shouldWake({ width: 1200, height: 800 }, [], MIN)).toBe(false);
  });

  test('the picture test is the setting, not a constant', () => {
    const viewport = { width: 800, height: 600 };
    const picture = [{ width: 100, height: 100 }];
    expect(shouldWake(viewport, picture, 100)).toBe(true);
    expect(shouldWake(viewport, picture, 101)).toBe(false);
  });

  test('one picture is enough', () => {
    const pictures = [
      { width: 10, height: 10 },
      { width: 500, height: 30 },
      { width: 400, height: 300 },
    ];
    expect(shouldWake({ width: 800, height: 600 }, pictures, MIN)).toBe(true);
  });

  test('roomyFrame agrees with the constants', () => {
    expect(roomyFrame({ width: 400, height: 300 })).toBe(true);
    expect(roomyFrame({ width: 399.5, height: 300 })).toBe(false);
  });
});

describe('popup opacity', () => {
  test('in range and on the step, a value is kept', () => {
    for (const value of [40, 45, 60, 85, 100]) expect(clampOpacity(value)).toBe(value);
  });

  test('out of range is clamped', () => {
    expect(clampOpacity(0)).toBe(MIN_OPACITY);
    expect(clampOpacity(-30)).toBe(MIN_OPACITY);
    expect(clampOpacity(39)).toBe(MIN_OPACITY);
    expect(clampOpacity(150)).toBe(MAX_OPACITY);
  });

  test('off the step, a value snaps to the nearest one', () => {
    expect(clampOpacity(62)).toBe(60);
    expect(clampOpacity(63)).toBe(65);
    expect(clampOpacity(97.4)).toBe(95);
  });

  test('a string from the form is parsed', () => {
    expect(clampOpacity('70')).toBe(70);
    expect(clampOpacity(' 55 ')).toBe(55);
  });

  test('anything that is not a number is fully opaque', () => {
    for (const value of [undefined, null, '', 'abc', Number.NaN, Infinity, {}, true]) {
      expect(clampOpacity(value)).toBe(MAX_OPACITY);
    }
  });
});
