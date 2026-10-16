import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  CORNER_PUNCT,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  ROTATED_PUNCT,
  argbToCss,
  buildLineText,
  fitFontSize,
  fitInside,
  fitTextBlock,
  isRtl,
  isUpright,
  justification,
  roomFor,
  shouldStayVertical,
  verticalRuns,
  wrapText,
  wrapsPerCharacter,
} from '../src/render/layout.js';
import type { Rect } from '../src/render/layout.js';
import { Alignment, WritingDirection } from '../src/types.js';
import type { TranslationBlock } from '../src/types.js';
import { glyphWidth } from './setup.js';

/** Ported from chrome-lens-py/tests/test_units.py where the logic is shared. */

const block = (over: Partial<TranslationBlock> = {}): TranslationBlock => ({
  translation: '',
  geometry: null,
  sourceLang: 'ja',
  targetLang: 'ru',
  writingDirection: WritingDirection.LeftToRight,
  alignment: Alignment.Left,
  lines: [],
  ...over,
});

describe('buildLineText', () => {
  const line = (...words: Array<[number, number]>) => ({ words });

  test('joins words with the gaps between them', () => {
    const translation = 'one two three';
    expect(buildLineText(translation, line([0, 3], [4, 7], [8, 13]), undefined)).toBe(
      'one two three'
    );
  });

  test('takes the trailing separator from the start of the next line', () => {
    const translation = 'alpha beta gamma';
    const first = line([0, 5], [6, 10]);
    const second = line([11, 16]);
    // The gap between "beta" and "gamma" belongs to the first line's last word.
    expect(buildLineText(translation, first, second)).toBe('alpha beta ');
  });

  test('an empty line is empty', () => {
    expect(buildLineText('anything', line(), undefined)).toBe('');
  });

  test('offsets are UTF-16 code units, so an emoji is two of them', () => {
    // Python has to encode to UTF-16 to get this right; here it is how the
    // language already indexes strings, which is the point of asserting it.
    const translation = 'a\u{1F600}b';
    expect(translation.length).toBe(4);
    expect(buildLineText(translation, line([0, 1], [1, 3], [3, 4]), undefined)).toBe(translation);
    expect(buildLineText(translation, line([1, 3]), undefined)).toBe('\u{1F600}');
  });
});

describe('fitFontSize', () => {
  test('a narrow box gets a smaller font than a roomy one', () => {
    const big = fitFontSize('Hi', 400, 200, 'sans-serif');
    const small = fitFontSize('Hi', 40, 12, 'sans-serif');
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  test('never leaves the bounds', () => {
    expect(fitFontSize('x', 100000, 100000, 'sans-serif')).toBe(MAX_FONT_SIZE);
    expect(fitFontSize('a very long line of text indeed', 1, 1, 'sans-serif')).toBe(
      MIN_FONT_SIZE
    );
  });

  test('the cap belongs to the caller: a supersampled canvas has bigger pixels to spend', () => {
    // 150 is a size in the picture's own pixels. On a canvas drawn at 2x the
    // same text is 300 canvas pixels, and capping it at 150 halved every
    // headline that wanted more than 75.
    expect(fitFontSize('x', 100000, 100000, 'sans-serif', MAX_FONT_SIZE * 2)).toBe(300);
    expect(fitFontSize('x', 100000, 100000, 'sans-serif', MAX_FONT_SIZE * 3)).toBe(450);
    // And a box that is the limit is still the limit.
    expect(fitFontSize('abcdefghij', 100, 1000, 'sans-serif', 300)).toBe(19);
  });

  test('the width is what limits a long line', () => {
    // 10 Latin glyphs are 5 em wide, so size * 5 must stay under 100: 19.
    expect(fitFontSize('abcdefghij', 100, 1000, 'sans-serif')).toBe(19);
  });
});

describe('wrapText', () => {
  const measure = (text: string): number =>
    [...text].reduce((sum, char) => sum + glyphWidth(char, 20), 0);

  test('breaks between words', () => {
    const lines = wrapText(measure, 'alpha beta gamma delta epsilon', 80);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.trim().length > 0)).toBe(true);
    expect(lines.join(' ')).toBe('alpha beta gamma delta epsilon');
  });

  test('breaks between characters when asked, which is how CJK arrives', () => {
    const text = '今天天气不错今天天气不错';
    const lines = wrapText(measure, text, 40, true);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
    expect(lines.every((line) => measure(line) <= 40)).toBe(true);
  });

  test('without being asked, never splits a word - even one with no space in it', () => {
    // Deciding per-character wrapping from whether the string contained a
    // space split short Russian words letter by letter down a column.
    expect(wrapText(measure, 'Уже', 8)).toEqual(['Уже']);
  });

  test('a token that cannot be broken is kept even when it overruns', () => {
    expect(wrapText(measure, 'incomprehensibilities', 30)).toEqual(['incomprehensibilities']);
  });

  test('hard line breaks survive, blank lines included', () => {
    expect(wrapText(measure, 'a\n\nb', 1000)).toEqual(['a', '', 'b']);
  });
});

describe('wrapsPerCharacter and friends', () => {
  test('follows the target language, region subtags included', () => {
    expect(wrapsPerCharacter(block({ targetLang: 'ja' }))).toBe(true);
    expect(wrapsPerCharacter(block({ targetLang: 'zh-CN' }))).toBe(true);
    expect(wrapsPerCharacter(block({ targetLang: 'ru' }))).toBe(false);
    expect(wrapsPerCharacter(block({ targetLang: '' }))).toBe(false);
  });

  test('a vertical source stays vertical only for a CJK target on auto', () => {
    const vertical = (targetLang: string) =>
      block({ writingDirection: WritingDirection.TopToBottom, targetLang });
    expect(shouldStayVertical(vertical('ja'), 'auto')).toBe(true);
    expect(shouldStayVertical(vertical('ru'), 'auto')).toBe(false);
    expect(shouldStayVertical(vertical('ru'), 'keep')).toBe(true);
    expect(shouldStayVertical(vertical('ja'), 'horizontal')).toBe(false);
    expect(shouldStayVertical(block({ targetLang: 'ja' }), 'keep')).toBe(false);
  });

  test('right-to-left comes from the direction or the language', () => {
    expect(isRtl(block({ writingDirection: WritingDirection.RightToLeft }))).toBe(true);
    expect(isRtl(block({ targetLang: 'ar' }))).toBe(true);
    expect(isRtl(block({ targetLang: 'he-IL' }))).toBe(true);
    expect(isRtl(block({ targetLang: 'ru' }))).toBe(false);
  });

  test('alignment follows the source unless forced, and flips for RTL', () => {
    expect(justification(Alignment.Left, false)).toBe('flex-start');
    expect(justification(Alignment.Left, true)).toBe('flex-end');
    expect(justification(Alignment.Right, false)).toBe('flex-end');
    expect(justification(Alignment.Center, false)).toBe('center');
    expect(justification(Alignment.Left, false, 'right')).toBe('flex-end');
  });

  test('colours come out in CSS channel order', () => {
    expect(argbToCss(0xff284678)).toBe('rgba(40, 70, 120, 1)');
    expect(argbToCss(0x00000000)).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('vertical runs', () => {
  test('upright classification', () => {
    for (const char of ['今', 'は', 'ア', '한']) expect(isUpright(char)).toBe(true);
    for (const char of ['A', '7']) expect(isUpright(char)).toBe(false);
  });

  test('CJK splits from Latin', () => {
    expect(verticalRuns('今日はWiFiです')).toEqual([
      [true, '今日は'],
      [false, 'WiFi'],
      [true, 'です'],
    ]);
  });

  test('a space joins the run before it', () => {
    const runs = verticalRuns('今日 は');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.[0]).toBe(true);
  });

  test('a leading space has nothing to join and is sideways', () => {
    expect(verticalRuns(' a')).toEqual([[false, ' a']]);
  });
});

describe('vertical punctuation', () => {
  test('dashes and brackets turn, kuten and touten hang, kana stand', () => {
    for (const char of 'ー「」（）【】…') expect(ROTATED_PUNCT.has(char)).toBe(true);
    for (const char of '、。') expect(CORNER_PUNCT.has(char)).toBe(true);
    for (const char of '、。今は') expect(ROTATED_PUNCT.has(char)).toBe(false);
  });

  const python = new URL(
    '../../../chrome-lens-py/src/chrome_lens_py/core/text_renderer.py',
    import.meta.url
  );
  test.skipIf(!existsSync(python))('is the set the Python renderer rotates', () => {
    // Only where the sibling checkout is, which CI does not have: this is a
    // drift guard for whoever edits one port and forgets the other.
    const source = readFileSync(python, 'utf8');
    const literal = /_VERTICAL_ROTATED_PUNCT = frozenset\(\s*"([^"]*)"/.exec(source)?.[1];
    expect(literal).toBeDefined();
    expect([...ROTATED_PUNCT].sort()).toEqual([...new Set([...(literal ?? '')])].sort());
  });
});

describe('fitTextBlock', () => {
  const rig = () => {
    let size = 10;
    return {
      setFont: (px: number) => {
        size = px;
      },
      measure: (text: string) => [...text].reduce((sum, char) => sum + glyphWidth(char, size), 0),
      lineHeight: (px: number) => px * 1.25,
    };
  };

  test('the text fits the box at the size it picks, and one more would not', () => {
    const { setFont, measure, lineHeight } = rig();
    const text = 'the quick brown fox jumps over the lazy dog';
    const { size, lines } = fitTextBlock(setFont, measure, lineHeight, text, 120, 90);
    setFont(size);
    expect(lines.length * lineHeight(size)).toBeLessThan(90);
    expect(Math.max(...lines.map(measure))).toBeLessThan(120);
    expect(lines.join(' ')).toBe(text);

    setFont(size + 1);
    const bigger = wrapText(measure, text, 120);
    const fits =
      Math.max(...bigger.map(measure)) < 120 && bigger.length * lineHeight(size + 1) < 90;
    expect(fits).toBe(false);
  });

  test('stays inside the size bounds', () => {
    const { setFont, measure, lineHeight } = rig();
    expect(fitTextBlock(setFont, measure, lineHeight, 'x', 1e6, 1e6).size).toBe(MAX_FONT_SIZE);
    expect(fitTextBlock(setFont, measure, lineHeight, 'x', 1, 1).size).toBe(MIN_FONT_SIZE);
  });

  test('takes its cap from the caller too', () => {
    const { setFont, measure, lineHeight } = rig();
    const fitted = fitTextBlock(setFont, measure, lineHeight, 'x', 1e6, 1e6, false, 300);
    expect(fitted.size).toBe(300);
  });
});

describe('roomFor', () => {
  const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
    left,
    top,
    right,
    bottom,
  });

  test('grows by the multiple when nothing is in the way', () => {
    const room = roomFor(rect(40, 40, 60, 60), [], 2, 100, 100);
    expect(room).toEqual(rect(30, 30, 70, 70));
  });

  test('is capped by the picture', () => {
    const room = roomFor(rect(0, 0, 20, 20), [], 3, 25, 25);
    expect(room).toEqual(rect(0, 0, 25, 25));
  });

  test('stops short of a neighbour that shares its band', () => {
    const own = rect(40, 40, 60, 60);
    const right = rect(65, 35, 90, 65);
    const room = roomFor(own, [right], 3, 100, 100);
    expect(room.right).toBe(63);
    expect(room.left).toBe(20);
  });

  test('ignores a neighbour that is only diagonally away', () => {
    const own = rect(40, 40, 60, 60);
    const diagonal = rect(65, 65, 90, 90);
    const room = roomFor(own, [diagonal], 2, 100, 100);
    expect(room).toEqual(rect(30, 30, 70, 70));
  });

  test('never shrinks below the box itself', () => {
    const own = rect(40, 40, 60, 60);
    const touching = rect(61, 40, 90, 60);
    const room = roomFor(own, [touching], 2, 100, 100);
    expect(room.right).toBe(60);
  });
});

describe('fitInside', () => {
  const upright = { cx: 50, cy: 50, w: 20, h: 10, angle: 0 };

  test('a box that already fits is untouched', () => {
    expect(fitInside(upright, 100, 100)).toEqual({ cx: 50, cy: 50, w: 20, h: 10 });
  });

  test('moves a box back in rather than shrinking it', () => {
    const moved = fitInside({ ...upright, cx: 95 }, 100, 100);
    expect(moved.w).toBe(20);
    expect(moved.cx).toBe(90);
  });

  test('shrinks only by what no amount of moving could fix', () => {
    const shrunk = fitInside({ ...upright, w: 200 }, 100, 100);
    expect(shrunk.w).toBe(100);
    expect(shrunk.h).toBe(5);
    expect(shrunk.cx).toBe(50);
  });

  test('a rotated box is bounded by its axis-aligned extent', () => {
    // 90 degrees turns a 40x10 box into a 10x40 one, which fits a 20-wide image.
    const turned = fitInside({ cx: 10, cy: 50, w: 40, h: 10, angle: 90 }, 20, 100);
    expect(turned.w).toBeCloseTo(40);
    expect(turned.cx).toBeCloseTo(10);
  });
});
