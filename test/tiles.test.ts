import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { cacheKey } from '../src/cache.js';
import { F } from '../src/gen/fields.js';
import { targetSize } from '../src/image.js';
import type { Source } from '../src/image.js';
import { askLens, looksTransient } from '../src/lens/ask.js';
import { ocrText } from '../src/lens/text.js';
import {
  MAX_TILES,
  mergeTiles,
  planTiles,
  resultToPicture,
  tilingTag,
  toPicture,
} from '../src/lens/tiles.js';
import type { Tile, TilePlan } from '../src/lens/tiles.js';
import { writer } from '../src/protobuf.js';
import type { Writer } from '../src/protobuf.js';
import { getTransport, setTransport } from '../src/transport.js';
import type { BinaryRequest, Transport } from '../src/transport.js';
import type {
  Bytes,
  Geometry,
  LensOptions,
  LensResult,
  OcrParagraph,
  TranslationBlock,
} from '../src/types.js';

/** Chromium's budget, which is what every number in these tests is worked out against. */
const budget = { maxArea: 1_500_000, maxSide: 1600 } as const;

const must = (plan: TilePlan | null): TilePlan => {
  if (!plan) throw new Error('expected the picture to be tiled');
  return plan;
};
const at = (plan: TilePlan, index: number): Tile => {
  const tile = plan.tiles[index];
  if (!tile) throw new Error(`no tile ${index}`);
  return tile;
};

describe('whether a picture is tiled', () => {
  test('a page goes up once, as it always did', () => {
    // The long side scales these, but about as far as the area would have.
    expect(planTiles(1500, 2000, budget)).toBeNull();
    expect(planTiles(1061, 1414, budget)).toBeNull();
    expect(planTiles(1000, 2500, budget)).toBeNull();
    expect(planTiles(2000, 3000, budget)).toBeNull();
    expect(planTiles(4000, 3000, budget)).toBeNull();
  });

  test('a picture that is not scaled at all is not tiled, however long', () => {
    // Chromium scales only what is over the area *and* over the side.
    expect(planTiles(800, 1600, budget)).toBeNull();
    expect(planTiles(1600, 900, budget)).toBeNull();
    expect(planTiles(500, 3000, budget)).toBeNull();
    expect(planTiles(1, 1, budget)).toBeNull();
    expect(planTiles(0, 0, budget)).toBeNull();
  });

  test('a strip the long side reduces to dots is', () => {
    expect(planTiles(800, 12000, budget)?.tiles.length).toBe(10);
    expect(planTiles(600, 3000, budget)?.tiles.length).toBe(3);
    expect(planTiles(720, 5000, budget)).not.toBeNull();
  });

  test('a panorama is the same picture on its side', () => {
    const tall = must(planTiles(800, 12000, budget));
    const wide = must(planTiles(12000, 800, budget));
    expect(tall.vertical).toBe(true);
    expect(wide.vertical).toBe(false);
    expect(wide.tiles.map((t) => [t.x, t.width, t.y, t.height])).toEqual(
      tall.tiles.map((t) => [t.y, t.height, t.x, t.width])
    );
  });

  test('off is one upload, and left out is auto', () => {
    expect(planTiles(800, 12000, { ...budget, tileLongImages: 'off' })).toBeNull();
    expect(planTiles(800, 12000, { ...budget, tileLongImages: 'auto' })).not.toBeNull();
  });

  test('the store files a tiled answer apart, and only a tiled one', () => {
    expect(tilingTag(1500, 2000, budget)).toBe('');
    expect(tilingTag(800, 12000, { ...budget, tileLongImages: 'off' })).toBe('');
    expect(tilingTag(800, 12000, budget)).toBe('.tiled');
  });

  test('the response cache does not hand an untiled answer to a tiled question', () => {
    const lens = { targetLang: 'ru', sourceLang: '', ocrLang: '' } as LensOptions;
    const url = 'https://example.com/strip.png';
    expect(cacheKey(url, { ...lens, tileLongImages: 'auto' })).toBe(cacheKey(url, lens));
    expect(cacheKey(url, { ...lens, tileLongImages: 'off' })).not.toBe(cacheKey(url, lens));
  });
});

describe('tile rectangles and bands', () => {
  const plan = must(planTiles(800, 12000, budget));

  test('each tile spans the short side and they cover the long one', () => {
    expect(plan.tiles.every((t) => t.x === 0 && t.width === 800)).toBe(true);
    expect(at(plan, 0).y).toBe(0);
    const last = at(plan, plan.tiles.length - 1);
    expect(last.y + last.height).toBe(12000);
    expect(plan.tiles.every((t) => t.y >= 0 && t.y + t.height <= 12000)).toBe(true);
  });

  test('a tile goes up at natural size when the strip is narrow enough', () => {
    for (const tile of plan.tiles) {
      expect(tile.height).toBe(1600);
      expect(targetSize(tile.width, tile.height, budget)).toEqual({ width: 800, height: 1600 });
    }
  });

  test('a wide strip gets page-shaped tiles, scaled like any page', () => {
    const wide = must(planTiles(2000, 20000, budget));
    expect(at(wide, 0).height).toBe(3000);
    // 2000x3000 through Chromium's rule: far more than 107 pixels across.
    expect(targetSize(2000, 3000, budget).width).toBe(1067);
  });

  test('neighbours share at least a quarter of a tile', () => {
    for (let i = 1; i < plan.tiles.length; i += 1) {
      const overlap = at(plan, i - 1).y + at(plan, i - 1).height - at(plan, i).y;
      expect(overlap).toBeGreaterThanOrEqual(400);
      // ...and never so much that three tiles hold one spot for nothing.
      expect(overlap).toBeLessThan(800);
    }
  });

  test('bands meet at the middle of each overlap and cover the picture once', () => {
    expect(at(plan, 0).bandStart).toBe(0);
    expect(at(plan, plan.tiles.length - 1).bandEnd).toBe(12000);
    for (let i = 1; i < plan.tiles.length; i += 1) {
      const previous = at(plan, i - 1);
      const tile = at(plan, i);
      expect(tile.bandStart).toBe(previous.bandEnd);
      expect(tile.bandStart).toBe((tile.y + previous.y + previous.height) / 2);
      expect(tile.bandStart).toBeGreaterThan(tile.y);
      expect(tile.bandEnd).toBeLessThanOrEqual(tile.y + tile.height);
    }
  });

  test('past the cap tiles get longer, not more numerous', () => {
    const huge = must(planTiles(800, 40000, budget));
    expect(huge.tiles.length).toBe(MAX_TILES);
    // 12 tiles sharing a quarter cover 9.25 lengths.
    expect(at(huge, 0).height).toBe(Math.ceil(40000 / 9.25));
    const last = at(huge, MAX_TILES - 1);
    expect(last.y + last.height).toBe(40000);
    for (let i = 1; i < huge.tiles.length; i += 1) {
      const overlap = at(huge, i - 1).y + at(huge, i - 1).height - at(huge, i).y;
      expect(overlap).toBeGreaterThanOrEqual(Math.floor(at(huge, 0).height / 4) - 1);
    }
    // Still several times what one upload would have shown: 32 pixels across.
    expect(targetSize(800, at(huge, 0).height, budget).width).toBeGreaterThan(250);
  });

  test('just under the cap the count is what the length asks for', () => {
    expect(planTiles(800, 14800, budget)?.tiles.length).toBe(12);
    expect(at(must(planTiles(800, 14800, budget)), 0).height).toBe(1600);
  });
});

describe('tile space to picture space', () => {
  const plan = must(planTiles(800, 12000, budget));

  /** The four corners of a rotated box, in pixels of a `width` x `height` frame. */
  function corners(box: Geometry, width: number, height: number): Array<[number, number]> {
    const radians = (box.angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const halfW = (box.w * width) / 2;
    const halfH = (box.h * height) / 2;
    return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]): [number, number] => [
      box.cx * width + sx * halfW * cos - sy * halfH * sin,
      box.cy * height + sx * halfW * sin + sy * halfH * cos,
    ]);
  }

  test('an upright box keeps its size in pixels and moves by the tile', () => {
    const tile = at(plan, 3);
    const moved = toPicture({ cx: 0.5, cy: 0.25, w: 0.5, h: 0.1, angle: 0 }, tile, plan);
    expect(moved.cx * 800).toBeCloseTo(400, 6);
    expect(moved.cy * 12000).toBeCloseTo(tile.y + 400, 6);
    expect(moved.w * 800).toBeCloseTo(400, 6);
    expect(moved.h * 12000).toBeCloseTo(160, 6);
    expect(moved.angle).toBe(0);
  });

  test('a rotated box lands corner for corner, with its angle untouched', () => {
    // The normalised height changes sevenfold and the width not at all; a
    // transform that scaled the angle with them would fail here.
    const tile = at(plan, 5);
    const box: Geometry = { cx: 0.4, cy: 0.6, w: 0.3, h: 0.05, angle: 30 };
    const moved = toPicture(box, tile, plan);
    expect(moved.angle).toBe(30);
    const before = corners(box, tile.width, tile.height);
    const after = corners(moved, plan.width, plan.height);
    before.forEach(([x, y], i) => {
      expect(after[i]?.[0]).toBeCloseTo(tile.x + x, 6);
      expect(after[i]?.[1]).toBeCloseTo(tile.y + y, 6);
    });
  });

  test('a panorama moves along x', () => {
    const wide = must(planTiles(12000, 800, budget));
    const tile = at(wide, 2);
    const moved = toPicture({ cx: 0.5, cy: 0.5, w: 0.1, h: 0.5, angle: -90 }, tile, wide);
    expect(moved.cx * 12000).toBeCloseTo(tile.x + 800, 6);
    expect(moved.cy * 800).toBeCloseTo(400, 6);
    expect(moved.w * 12000).toBeCloseTo(160, 6);
    expect(moved.h * 800).toBeCloseTo(400, 6);
    expect(moved.angle).toBe(-90);
  });

  test('every box an answer carries is moved: paragraphs, lines, words, blocks', () => {
    const tile = at(plan, 2);
    const box: Geometry = { cx: 0.5, cy: 0.5, w: 0.2, h: 0.1, angle: 0 };
    const patch = { bytes: Uint8Array.of(1, 2, 3) as Bytes, vPad: 0.4, hPad: 0.4 };
    const result: LensResult = {
      contentLanguage: 'ja',
      ocr: [
        {
          writingDirection: 0,
          geometry: box,
          lines: [{ text: 'a', geometry: box, words: [{ text: 'a', separator: '', geometry: box }] }],
        },
      ],
      blocks: [
        {
          translation: 'a',
          geometry: box,
          sourceLang: 'ja',
          targetLang: 'ru',
          writingDirection: 0,
          alignment: 0,
          lines: [{ words: [[0, 1]], textColor: 1, bgColor: 2, geometry: box, background: patch }],
        },
      ],
    };
    const moved = resultToPicture(result, tile, plan);
    const expected = toPicture(box, tile, plan);
    expect(moved.ocr[0]?.geometry).toEqual(expected);
    expect(moved.ocr[0]?.lines[0]?.geometry).toEqual(expected);
    expect(moved.ocr[0]?.lines[0]?.words[0]?.geometry).toEqual(expected);
    expect(moved.blocks[0]?.geometry).toEqual(expected);
    expect(moved.blocks[0]?.lines[0]?.geometry).toEqual(expected);
    // The patch's padding is a fraction of the line's height in pixels, which
    // a crop does not change; the bitmap is the same bytes.
    expect(moved.blocks[0]?.lines[0]?.background).toBe(patch);
    expect(moved.blocks[0]?.lines[0]?.words).toEqual([[0, 1]]);
    // The answer handed in is not edited: a retry may still be holding it.
    expect(result.ocr[0]?.geometry).toBe(box);
  });
});

// --- Seams -------------------------------------------------------------------

const LINE = 40;

/**
 * What one tile would report for lines at these picture rows: a paragraph of
 * `LINE`-pixel lines, `x`..`x + width` across, in the *tile's* proportions -
 * which is how Lens answers, and what the merge has to undo.
 */
function seen(
  plan: TilePlan,
  tileIndex: number,
  rows: Array<[top: number, text: string]>,
  x = 200,
  width = 400
): { ocr: OcrParagraph; block: TranslationBlock } {
  const tile = at(plan, tileIndex);
  const box = (top: number, height: number): Geometry => ({
    cx: (x + width / 2 - tile.x) / tile.width,
    cy: (top + height / 2 - tile.y) / tile.height,
    w: width / tile.width,
    h: height / tile.height,
    angle: 0,
  });
  const first = rows[0]?.[0] ?? 0;
  const last = rows[rows.length - 1]?.[0] ?? 0;
  const paragraph = box(first, last + LINE - first);
  let translation = '';
  const lines = rows.map(([top, text]) => {
    if (translation) translation += ' ';
    const start = translation.length;
    translation += text.toUpperCase();
    return {
      words: [[start, translation.length]] as Array<[number, number]>,
      textColor: 0,
      bgColor: 0,
      geometry: box(top, LINE),
      background: null,
    };
  });
  return {
    ocr: {
      writingDirection: 0,
      geometry: paragraph,
      lines: rows.map(([top, text]) => ({ text, words: [], geometry: box(top, LINE) })),
    },
    block: {
      translation,
      geometry: paragraph,
      sourceLang: 'ja',
      targetLang: 'en',
      writingDirection: 0,
      alignment: 0,
      lines,
    },
  };
}

/** Answers for every tile of a plan, from what each tile is said to have seen. */
function answers(
  plan: TilePlan,
  perTile: Record<number, Array<{ ocr: OcrParagraph; block: TranslationBlock }>>
): LensResult[] {
  return plan.tiles.map((_, i) => ({
    contentLanguage: i === 0 ? '' : 'ja',
    ocr: (perTile[i] ?? []).map((p) => p.ocr),
    blocks: (perTile[i] ?? []).map((p) => p.block),
  }));
}

const linesOf = (result: LensResult): string[] =>
  result.ocr.flatMap((p) => p.lines.map((l) => l.text));
const translated = (result: LensResult): string[] => result.blocks.map((b) => b.translation);

describe('paragraphs at a seam', () => {
  // Tiles 0 and 1 of this strip are rows 0..1600 and 1156..2756: they share
  // 1156..1600, and the seam between their bands is row 1378.
  const plan = must(planTiles(800, 12000, budget));

  test('the plan is the one these rows were worked out for', () => {
    expect([at(plan, 0).y, at(plan, 1).y, at(plan, 0).bandEnd]).toEqual([0, 1156, 1378]);
  });

  test('a paragraph wholly in the overlap is kept once', () => {
    const rows: Array<[number, string]> = [[1300, 'one'], [1350, 'two'], [1400, 'three']];
    const merged = mergeTiles(plan, answers(plan, { 0: [seen(plan, 0, rows)], 1: [seen(plan, 1, rows)] }));
    expect(linesOf(merged)).toEqual(['one', 'two', 'three']);
    expect(translated(merged)).toEqual(['ONE TWO THREE']);
  });

  test('two readings that disagree about the centre do not both defer', () => {
    // Centred on the seam itself; each tile reads it a pixel to its own side,
    // so by the bands alone each would leave it to the other and it would go.
    const mine: Array<[number, string]> = [[1339, 'one'], [1379, 'two']];
    const theirs: Array<[number, string]> = [[1337, 'one'], [1377, 'two']];
    const merged = mergeTiles(plan, answers(plan, { 0: [seen(plan, 0, mine)], 1: [seen(plan, 1, theirs)] }));
    expect(linesOf(merged)).toEqual(['one', 'two']);
    // ...and the reverse, where each would have claimed it.
    const both = mergeTiles(plan, answers(plan, { 0: [seen(plan, 0, theirs)], 1: [seen(plan, 1, mine)] }));
    expect(linesOf(both)).toEqual(['one', 'two']);
    expect(translated(both).length).toBe(1);
  });

  test("a paragraph cut by a tile's edge yields to the neighbour's whole copy", () => {
    // Tile 0 ends at row 1600 and reads only the first two lines; tile 1 has
    // all four, with room to spare on both sides.
    const cut: Array<[number, string]> = [[1500, 'one'], [1550, 'two']];
    const whole: Array<[number, string]> = [[1500, 'one'], [1550, 'two'], [1600, 'three'], [1650, 'four']];
    const merged = mergeTiles(plan, answers(plan, { 0: [seen(plan, 0, cut)], 1: [seen(plan, 1, whole)] }));
    expect(linesOf(merged)).toEqual(['one', 'two', 'three', 'four']);
    expect(translated(merged)).toEqual(['ONE TWO THREE FOUR']);
  });

  test('a paragraph taller than the overlap loses no line and repeats none', () => {
    // Rows 800..2040: no tile holds all of it. Tile 0 reads down to its edge,
    // tile 1 from its own edge on; the larger piece stays whole and the other
    // keeps what lies past it.
    const all: Array<[number, string]> = Array.from({ length: 25 }, (_, i) => [800 + i * 50, `l${i}`]);
    const top = all.filter(([row]) => row + LINE <= 1600);
    const bottom = all.filter(([row]) => row >= 1156);
    expect(top.length).toBeLessThan(bottom.length);
    const merged = mergeTiles(plan, answers(plan, { 0: [seen(plan, 0, top)], 1: [seen(plan, 1, bottom)] }));
    expect(linesOf(merged)).toEqual(all.map(([, text]) => text));
    // Two paragraphs, in reading order, and the translation follows the lines.
    expect(merged.ocr.length).toBe(2);
    expect(translated(merged).join(' ')).toBe(all.map(([, text]) => text.toUpperCase()).join(' '));
    const kept = merged.blocks[0];
    expect(kept?.lines.length).toBe(all.length - bottom.length);
    // Word ranges still index the string they travel with.
    expect(kept?.lines.map((line) => kept.translation.slice(...(line.words[0] ?? [0, 0])))).toEqual(
      all.slice(0, all.length - bottom.length).map(([, text]) => text.toUpperCase())
    );
    // The trimmed paragraph's box is the box of what is left of it.
    const box = merged.ocr[0]?.geometry;
    expect((box?.cy ?? 0) * 12000 + ((box?.h ?? 0) * 12000) / 2).toBeCloseTo(1190, 3);
  });

  test('a whole paragraph the owning tile did not report is not dropped for being out of band', () => {
    // Below the seam, so it is tile 1's by the bands - and tile 1 missed it.
    const rows: Array<[number, string]> = [[1420, 'only'], [1470, 'here']];
    const merged = mergeTiles(plan, answers(plan, { 0: [seen(plan, 0, rows)], 1: [] }));
    expect(linesOf(merged)).toEqual(['only', 'here']);
  });

  test('paragraphs that are not each other are all kept, in reading order', () => {
    const a = seen(plan, 0, [[100, 'a']]);
    const b = seen(plan, 0, [[1300, 'b']], 50, 300);
    const c = seen(plan, 1, [[1300, 'c']], 450, 300);
    const d = seen(plan, 1, [[2000, 'd']]);
    const e = seen(plan, 4, [[5000, 'e']]);
    const merged = mergeTiles(plan, answers(plan, { 0: [a, b], 1: [c, d], 4: [e] }));
    expect(linesOf(merged)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(merged.contentLanguage).toBe('ja');
  });

  test('copy text has each paragraph once, including one Lens did not translate', () => {
    const rows: Array<[number, string]> = [[1300, 'sfx']];
    const zero = seen(plan, 0, rows);
    const one = seen(plan, 1, rows);
    const merged = mergeTiles(plan, [
      { contentLanguage: 'ja', ocr: [zero.ocr], blocks: [] },
      { contentLanguage: 'ja', ocr: [one.ocr], blocks: [] },
      ...plan.tiles.slice(2).map(() => ({ contentLanguage: '', ocr: [], blocks: [] })),
    ]);
    expect(ocrText(merged)).toBe('sfx');
  });

  test('a seam in a panorama is the same seam', () => {
    const wide = must(planTiles(12000, 800, budget));
    const tile0 = at(wide, 0);
    const tile1 = at(wide, 1);
    const column = (tile: Tile): OcrParagraph => {
      const box: Geometry = {
        cx: (1378 - tile.x) / tile.width,
        cy: 0.5,
        w: 100 / tile.width,
        h: 0.25,
        angle: 0,
      };
      return { writingDirection: 0, geometry: box, lines: [{ text: 'x', words: [], geometry: box }] };
    };
    const merged = mergeTiles(wide, [
      { contentLanguage: '', ocr: [column(tile0)], blocks: [] },
      { contentLanguage: '', ocr: [column(tile1)], blocks: [] },
    ]);
    expect(linesOf(merged)).toEqual(['x']);
  });
});

// --- Asking ------------------------------------------------------------------

describe('which failures are worth one more try', () => {
  test('a dropped connection, a 5xx and "later" are', () => {
    expect(looksTransient(new Error('via Tampermonkey: network error'))).toBe(true);
    expect(looksTransient(new Error('HTTP 503'))).toBe(true);
    expect(looksTransient(new Error('HTTP 429'))).toBe(true);
    expect(looksTransient(new Error('Could not parse the Lens response: truncated'))).toBe(true);
  });

  test("the other end's considered answer and a timeout are not", () => {
    expect(looksTransient(new Error('HTTP 403'))).toBe(false);
    expect(looksTransient(new Error('HTTP 400; HTTP 400'))).toBe(false);
    const timeout = new Error('Timed out');
    timeout.name = 'TimeoutError';
    expect(looksTransient(timeout)).toBe(false);
  });
});

describe('askLens', () => {
  const options: LensOptions = {
    targetLang: 'en',
    sourceLang: '',
    ocrLang: '',
    region: 'US',
    timeZone: 'UTC',
    apiKey: 'test-key',
    timeoutMs: 1000,
    jpegQuality: 0.4,
    ...budget,
  };

  /** A response holding one recognised line, centred in whatever was uploaded. */
  function reply(text: string): Bytes {
    const box = (geometry: Writer): void => {
      geometry.sub(F.Geometry.boundingBox, (b) =>
        b
          .float(F.CenterRotatedBox.centerX, 0.5)
          .float(F.CenterRotatedBox.centerY, 0.5)
          .float(F.CenterRotatedBox.width, 0.5)
          .float(F.CenterRotatedBox.height, 0.025)
      );
    };
    return writer()
      .sub(F.LensOverlayServerResponse.objectsResponse, (objects) =>
        objects.sub(F.LensOverlayObjectsResponse.text, (t) =>
          t.sub(F.Text.textLayout, (layout) =>
            layout.sub(F.TextLayout.paragraphs, (paragraph) => {
              paragraph.sub(F.TextLayout_Paragraph.geometry, box);
              paragraph.sub(F.TextLayout_Paragraph.lines, (line) => {
                line.sub(F.TextLayout_Line.geometry, box);
                line.sub(F.TextLayout_Line.words, (word) => word.str(F.TextLayout_Word.plainText, text));
              });
            })
          )
        )
      )
      .finish();
  }

  interface Lens {
    posts: number;
    peak: number;
    /** How many were in flight when each request started. */
    inFlightAtStart: number[];
  }

  /** A Lens that answers after a tick, so overlapping requests really overlap. */
  function fakeLens(fail: (post: number) => Error | null = () => null): Lens {
    const lens: Lens = { posts: 0, peak: 0, inFlightAtStart: [] };
    let inFlight = 0;
    const transport: Transport = {
      async post(_request: BinaryRequest) {
        lens.posts += 1;
        const post = lens.posts;
        lens.inFlightAtStart.push(inFlight);
        inFlight += 1;
        lens.peak = Math.max(lens.peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        const error = fail(post);
        if (error) throw error;
        return { status: 200, bytes: reply(`t${post}`), contentType: 'application/x-protobuf' };
      },
      async get() {
        throw new Error('not used');
      },
    };
    setTransport(transport);
    return lens;
  }

  // The encode needs a canvas that can be drawn on and turned into a blob, and
  // `sourceSize` asks what kind of element it was handed. Everything put on
  // the global object here is taken off again: the other files share it.
  const globals = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  let before: Transport | null = null;
  const drawn: Array<[number, number, number, number]> = [];

  beforeAll(() => {
    for (const name of ['document', 'HTMLImageElement', 'HTMLVideoElement']) saved.set(name, globals[name]);
    globals['HTMLImageElement'] = class {};
    globals['HTMLVideoElement'] = class {};
    globals['document'] = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '',
          fillRect() {},
          drawImage(_source: unknown, ...rest: number[]) {
            if (rest.length === 8) drawn.push([rest[0] ?? 0, rest[1] ?? 0, rest[2] ?? 0, rest[3] ?? 0]);
          },
        }),
        toBlob(done: (blob: Blob) => void) {
          done(new Blob([Uint8Array.of(0xff, 0xd8)]));
        },
      }),
    };
    try {
      before = getTransport();
    } catch {
      before = null;
    }
  });
  afterAll(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
    if (before) setTransport(before);
  });
  afterEach(() => {
    drawn.length = 0;
  });

  const picture = (width: number, height: number): Source => ({ width, height }) as unknown as Source;

  test('a page is one request', async () => {
    const lens = fakeLens();
    const result = await askLens(picture(1500, 2000), options);
    expect(lens.posts).toBe(1);
    expect(linesOf(result)).toEqual(['t1']);
    // The line is where Lens put it: nothing was moved.
    expect(result.ocr[0]?.geometry?.cy).toBeCloseTo(0.5, 6);
  });

  test('a strip is one request a tile, and one answer', async () => {
    const lens = fakeLens();
    const plan = must(planTiles(800, 12000, options));
    const result = await askLens(picture(800, 12000), options);
    expect(lens.posts).toBe(plan.tiles.length);
    // Each tile was cut from its own rows of the source.
    expect(drawn).toEqual(plan.tiles.map((t) => [t.x, t.y, t.width, t.height]));
    // Ten lines, each in the middle of its own tile, in the picture's rows.
    expect(result.ocr.length).toBe(10);
    result.ocr.forEach((paragraph, i) => {
      const tile = at(plan, i);
      expect((paragraph.geometry?.cy ?? 0) * 12000).toBeCloseTo(tile.y + tile.height / 2, 3);
      expect((paragraph.geometry?.h ?? 0) * 12000).toBeCloseTo(40, 3);
    });
  });

  test('the first tile goes alone and no more than two follow at once', async () => {
    const lens = fakeLens();
    await askLens(picture(800, 12000), options);
    expect(lens.inFlightAtStart[0]).toBe(0);
    expect(lens.inFlightAtStart[1]).toBe(0);
    expect(lens.peak).toBe(2);
  });

  test('off sends the strip whole', async () => {
    const lens = fakeLens();
    await askLens(picture(800, 12000), { ...options, tileLongImages: 'off' });
    expect(lens.posts).toBe(1);
  });

  test('a tile that fails once is asked again, and the answer is whole', async () => {
    const lens = fakeLens((post) => (post === 4 ? new Error('via Tampermonkey: network error') : null));
    const result = await askLens(picture(800, 12000), options);
    expect(lens.posts).toBe(11);
    expect(result.ocr.length).toBe(10);
  });

  test('a tile that fails twice fails the translation, and says which', async () => {
    const lens = fakeLens((post) => (post >= 4 ? new Error('HTTP 503') : null));
    await expect(askLens(picture(800, 12000), options)).rejects.toThrow(
      /^part \d+ of 10 of a long picture: HTTP 503$/
    );
    // Nothing new was started once the answer was lost: far fewer than the
    // twenty requests ten tiles and ten retries would be.
    expect(lens.posts).toBeLessThanOrEqual(7);
  });

  test('a refusal is not asked twice, and costs one request', async () => {
    const lens = fakeLens(() => new Error('HTTP 403'));
    await expect(askLens(picture(800, 12000), options)).rejects.toThrow(
      'part 1 of 10 of a long picture: HTTP 403'
    );
    expect(lens.posts).toBe(1);
  });
});
