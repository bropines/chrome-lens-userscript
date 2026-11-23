import { describe, expect, test } from 'bun:test';
import { crowdsAtFloor, isBubbleColumn } from '../src/render/bubble.js';
import { buildLineText, fitFontSize, rectOf, shouldStayVertical } from '../src/render/layout.js';
import { DEFAULTS, FIELDS } from '../src/settings.js';
import {
  SAMPLE,
  SAMPLE_BAND_TOP,
  SAMPLE_BUBBLES,
  SAMPLE_H,
  SAMPLE_W,
  patchRect,
  previewSignature,
  sampleBlocks,
  sampleLanguage,
} from '../src/ui/sample.js';
import { SCHEMATIC_H, SCHEMATIC_W, hasSchematic, schematic } from '../src/ui/schematics.js';
import type { Shape } from '../src/ui/schematics.js';
import type { Bytes, Settings } from '../src/types.js';

/**
 * The parts of the settings window's pictures that are plain data: the answer
 * the preview is drawn from, what makes it draw again, and the shapes of the
 * small schematics.
 */

describe('the sample answer', () => {
  test('is three paragraphs with a box for every line, all inside the picture', () => {
    const blocks = sampleBlocks('en');
    expect(blocks.length).toBe(3);
    for (const block of blocks) {
      for (const geometry of [block.geometry, ...block.lines.map((line) => line.geometry)]) {
        if (!geometry) throw new Error('a sample box is missing');
        expect(geometry.w).toBeGreaterThan(0);
        expect(geometry.h).toBeGreaterThan(0);
        expect(geometry.cx - geometry.w / 2).toBeGreaterThanOrEqual(0);
        expect(geometry.cx + geometry.w / 2).toBeLessThanOrEqual(1);
        expect(geometry.cy - geometry.h / 2).toBeGreaterThanOrEqual(0);
        expect(geometry.cy + geometry.h / 2).toBeLessThanOrEqual(1);
      }
    }
  });

  test('the word offsets rebuild every line, and the lines the paragraph', () => {
    for (const lang of ['en', 'ru', 'ja', 'zh-CN', 'ko']) {
      for (const block of sampleBlocks(lang)) {
        const rebuilt = block.lines
          .map((line, index) => buildLineText(block.translation, line, block.lines[index + 1]))
          .join('');
        expect(rebuilt).toBe(block.translation);
        for (const line of block.lines) {
          expect(line.words.length).toBeGreaterThan(0);
          for (const [start, end] of line.words) {
            expect(block.translation.slice(start, end)).toMatch(/^\S+$/);
          }
        }
      }
    }
  });

  test('a language with no sample of its own is shown English, and says so', () => {
    expect(sampleLanguage('de')).toBe('en');
    expect(sampleLanguage('zh-TW')).toBe('zh');
    expect(sampleLanguage('')).toBe('en');
    // The block claims the language its text is in: English is not laid out
    // right to left because Arabic was asked for.
    expect(sampleBlocks('ar').every((block) => block.targetLang === 'en')).toBe(true);
    expect(sampleBlocks('ru')[0]?.translation).toMatch(/[а-я]/);
  });

  test('the bubble is a column the renderer re-wraps under the default settings', () => {
    const [bubble] = sampleBlocks('ru');
    if (!bubble?.geometry) throw new Error('no bubble');
    const lines = bubble.lines.flatMap((line) =>
      line.geometry ? [rectOf(line.geometry, SAMPLE_W, SAMPLE_H)] : []
    );
    expect(isBubbleColumn(lines, rectOf(bubble.geometry, SAMPLE_W, SAMPLE_H))).toBe(true);
    // Its translation only fits line by line below the readable-size floor,
    // which is the other half of the decision.
    const fitted = bubble.lines.map((line, index) =>
      fitFontSize(
        buildLineText(bubble.translation, line, bubble.lines[index + 1]),
        (line.geometry?.w ?? 0) * SAMPLE_W,
        (line.geometry?.h ?? 0) * SAMPLE_H,
        'sans-serif',
        150
      )
    );
    expect(crowdsAtFloor(fitted, DEFAULTS.minReadablePx)).toBe(true);
  });

  test('the column is vertical, and stays one only where the setting says', () => {
    const column = sampleBlocks('ru')[1];
    if (!column) throw new Error('no column');
    expect(shouldStayVertical(column, 'auto')).toBe(false);
    expect(shouldStayVertical(column, 'keep')).toBe(true);
    const cjk = sampleBlocks('ja')[1];
    if (!cjk) throw new Error('no column');
    expect(shouldStayVertical(cjk, 'auto')).toBe(true);
    for (const line of column.lines) {
      expect((line.geometry?.h ?? 0) * SAMPLE_H).toBeGreaterThan((line.geometry?.w ?? 0) * SAMPLE_W);
    }
  });

  test('the text stands where the scene is painted for it', () => {
    const [speech, thought] = SAMPLE_BUBBLES;
    const inside = (x: number, y: number, e: { cx: number; cy: number; rx: number; ry: number }): boolean =>
      ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2 < 1;
    for (const paragraph of SAMPLE) {
      for (const line of paragraph.lines) {
        const corners: Array<[number, number]> = [
          [line.cx - line.w / 2, line.cy - line.h / 2],
          [line.cx + line.w / 2, line.cy - line.h / 2],
          [line.cx - line.w / 2, line.cy + line.h / 2],
          [line.cx + line.w / 2, line.cy + line.h / 2],
        ];
        for (const [x, y] of corners) {
          if (paragraph.id === 'caption') expect(y).toBeGreaterThan(SAMPLE_BAND_TOP);
          else {
            const bubble = paragraph.id === 'bubble' ? speech : thought;
            if (!bubble) throw new Error('no bubble');
            expect(inside(x, y, bubble)).toBe(true);
          }
        }
      }
    }
  });

  test('a patch is cut from the rectangle the renderer draws it over', () => {
    const paragraph = SAMPLE[0];
    const line = paragraph?.lines[0];
    if (!paragraph || !line) throw new Error('no line');
    const area = patchRect(paragraph, line);
    // drawLine: box + pad * box height, about the same centre.
    expect(area.w).toBeCloseTo(line.w + paragraph.hPad * line.h);
    expect(area.h).toBeCloseTo(line.h + paragraph.vPad * line.h);
    expect(area.x + area.w / 2).toBeCloseTo(line.cx);
    expect(area.y + area.h / 2).toBeCloseTo(line.cy);
  });

  test('patches are handed out in line order, and a missing one leaves the line without', () => {
    const bytes = (n: number): Bytes => new Uint8Array([n]);
    const blocks = sampleBlocks('en', [bytes(0), bytes(1), null, bytes(3)]);
    const backgrounds = blocks.flatMap((block) => block.lines.map((line) => line.background));
    expect(backgrounds.map((background) => background?.bytes[0] ?? null)).toEqual([
      0, 1, null, 3, null, null, null,
    ]);
    expect(backgrounds[0]?.hPad).toBe(SAMPLE[0]?.hPad);
  });
});

describe('what redraws the preview', () => {
  const base = { ...DEFAULTS };
  const signature = (patch: Partial<Settings> = {}, width = 320): string =>
    previewSignature({ ...base, ...patch }, width);

  test('every appearance setting with something to show changes it', () => {
    const changes: Partial<Settings> = {
      fontFamily: 'Georgia',
      fontWeight: 700,
      textAlign: 'right',
      textColor: '#ff0000',
      outlineColor: '#00ff00',
      outlineScale: 3,
      minReadablePx: 20,
      verticalText: 'keep',
      reflowHorizontal: 'off',
      bubbleShape: false,
      fitToBox: false,
      lineSpacing: 1.6,
      mangaBoxGrowth: 2,
      mangaMinPx: 20,
      drawBackground: false,
      eraseMode: 'hull',
      fillColor: '#0000ff',
      hullPadding: 1,
      patchPadding: 2,
      supersample: 3,
      coverOpacity: 60,
    };
    const appearance = FIELDS.filter((field) => field.tab === 'appearance').map((field) => field.key);
    // Each appearance field is tried, so one added later has to be decided here.
    expect(Object.keys(changes).sort()).toEqual([...appearance].sort());
    for (const [key, value] of Object.entries(changes)) {
      expect(signature({ [key]: value } as Partial<Settings>)).not.toBe(signature());
    }
  });

  test('manga mode and the target language do too, from the tab they live on', () => {
    expect(signature({ mangaMode: true })).not.toBe(signature());
    expect(signature({ targetLang: 'ja' })).not.toBe(signature());
    // Two targets shown the same English sample are the same picture.
    expect(signature({ targetLang: 'de' })).toBe(signature({ targetLang: 'fr' }));
  });

  test('a setting the renderer never reads does not', () => {
    expect(signature({ hotkey: 'ctrl', buttonCorner: 'bl', apiKey: 'x', uiMode: 'pro' })).toBe(signature());
  });

  test('the displayed width does: the size floor is measured in it', () => {
    expect(signature({}, 240)).not.toBe(signature({}, 320));
  });
});

describe('the schematics', () => {
  const pictured = FIELDS.filter((field) => hasSchematic(field.key));

  test('the spatial choices have one, and only selects do', () => {
    expect(pictured.map((field) => field.key).sort()).toEqual([
      'buttonCorner',
      'buttonMode',
      'buttonSize',
      'eraseMode',
      'reflowHorizontal',
      'textAlign',
      'verticalText',
    ]);
    expect(pictured.every((field) => field.type === 'select')).toBe(true);
    expect(schematic('hotkey', 'alt')).toEqual([]);
  });

  const extent = (shape: Shape): Array<[number, number]> => {
    if (shape.kind === 'rect') return [[shape.x, shape.y], [shape.x + shape.w, shape.y + shape.h]];
    if (shape.kind === 'line') return [[shape.x1, shape.y1], [shape.x2, shape.y2]];
    if (shape.kind === 'ellipse') {
      return [[shape.cx - shape.rx, shape.cy - shape.ry], [shape.cx + shape.rx, shape.cy + shape.ry]];
    }
    if (shape.kind === 'polygon') return shape.points.map(([x, y]) => [x, y]);
    return [[shape.x, shape.y]];
  };

  test('every option draws something, inside the picture, unlike every other option', () => {
    for (const field of pictured) {
      const seen = new Set<string>();
      for (const value of field.options ?? []) {
        const shapes = schematic(field.key, value);
        expect(shapes.length).toBeGreaterThan(0);
        for (const shape of shapes) {
          for (const [x, y] of extent(shape)) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(SCHEMATIC_W);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(SCHEMATIC_H);
          }
        }
        seen.add(JSON.stringify(shapes));
      }
      expect(seen.size).toBe(field.options?.length ?? 0);
    }
  });

  test('the main button is the one in the chosen corner', () => {
    const solid = (value: string): { x: number; y: number } => {
      const found = schematic('buttonCorner', value).find(
        (shape) => shape.kind === 'rect' && shape.tone === 'solid'
      );
      if (!found || found.kind !== 'rect') throw new Error('no main button');
      return { x: found.x + found.w / 2, y: found.y + found.h / 2 };
    };
    const midX = SCHEMATIC_W / 2;
    const midY = SCHEMATIC_H / 2;
    expect(solid('tr').x > midX && solid('tr').y < midY).toBe(true);
    expect(solid('tl').x < midX && solid('tl').y < midY).toBe(true);
    expect(solid('br').x > midX && solid('br').y > midY).toBe(true);
    expect(solid('bl').x < midX && solid('bl').y > midY).toBe(true);
    // And every other button of the row lies further from that corner.
    for (const value of ['tr', 'tl', 'br', 'bl']) {
      const rects = schematic('buttonCorner', value).filter(
        (shape) => shape.kind === 'rect' && shape.tone !== 'dim'
      );
      const distance = (shape: Shape): number =>
        shape.kind === 'rect' ? Math.abs(shape.x + shape.w / 2 - (value.endsWith('r') ? SCHEMATIC_W : 0)) : 0;
      const [main, ...rest] = rects;
      if (!main) throw new Error('no row');
      expect(rest.every((shape) => distance(shape) > distance(main))).toBe(true);
    }
  });
});
