import type {
  Geometry,
  LensOptions,
  LensResult,
  OcrParagraph,
  TranslationBlock,
} from '../types.js';

/**
 * A long picture, as several pictures Lens can read.
 *
 * The upload budget is an area *and* a longest side. For a page the area is
 * what binds and the text survives; for a webtoon strip of 800x12000 the side
 * does, the strip goes up 107 pixels wide, and every line of it is dots. So a
 * strip is cut along its long axis into overlapping tiles, each asked about on
 * its own at the full budget, and the answers are put back together in the
 * whole picture's coordinates - after which nothing downstream can tell.
 *
 * Everything here is arithmetic and runs without a page; `ask.ts` is the half
 * that encodes and sends.
 */

/**
 * How far below the area budget one upload has to fall before tiling pays.
 *
 * Compared as linear scales: what a single upload gets (`maxSide` over the
 * long side) against what the area alone would have allowed. At 0.7 a tall
 * page - 1500x2000 scales by 0.80 against 0.71, 1000x2500 by 0.64 against 0.77
 * - still goes up once, because losing a sixth of the resolution is not worth
 * a second request; 600x3000 (0.53 against 0.91) and anything longer is cut.
 */
const TILE_BELOW = 0.7;

/**
 * A tile is at least this long, as a multiple of the short side - the shape of
 * a page, which is what Lens is shown most. It is longer when a longer one
 * still goes up unscaled (800 wide: 1600 long, not 1200), since that is fewer
 * requests for the same pixels.
 */
const TILE_ASPECT = 1.5;

/** ...and never thinner than this, however much the budget would take. */
const TILE_MAX_ASPECT = 4;

/**
 * Neighbours share this fraction of a tile's length.
 *
 * A paragraph cut by a tile's edge is only whole in the neighbour if it is
 * shorter than the overlap, so the overlap is sized to a bubble: a quarter of
 * a tile is 400 pixels of an 800-wide strip, half the strip's width.
 */
const TILE_OVERLAP = 0.25;

/**
 * The most requests one picture may cost.
 *
 * Twelve tiles of an 800-wide strip reach 14800 pixels at natural size, which
 * covers the strips sites actually serve. Past that the tiles grow longer
 * instead of more numerous and are scaled down like any oversized upload:
 * still many times what one upload shows, and a bounded bill.
 */
export const MAX_TILES = 12;

export interface Tile {
  /** The tile's rectangle, in the picture's own pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The stretch of the long axis this tile answers for, in pixels. Bands meet
   * at the middle of each overlap and cover the picture exactly once.
   */
  bandStart: number;
  bandEnd: number;
}

export interface TilePlan {
  /** The picture's size, which the tiles are fractions of. */
  width: number;
  height: number;
  /** Whether the long axis is y - a strip rather than a panorama. */
  vertical: boolean;
  tiles: Tile[];
}

type Budget = Pick<LensOptions, 'maxArea' | 'maxSide' | 'tileLongImages'>;

/**
 * The tiles a picture is sent as, or null when it goes up whole.
 *
 * Null is the old path exactly, and it is the answer for everything the long
 * side does not bind: a picture that is not scaled at all, and one the area
 * would have scaled about as far anyway.
 */
export function planTiles(width: number, height: number, budget: Budget): TilePlan | null {
  if (budget.tileLongImages === 'off') return null;
  if (!(width > 0 && height > 0)) return null;
  const { maxArea, maxSide } = budget;
  const long = Math.max(width, height);
  const short = Math.min(width, height);

  // Chromium's rule (see targetSize): nothing is scaled unless both hold.
  if (width * height <= maxArea || long <= maxSide) return null;
  const single = maxSide / long;
  const byArea = Math.min(1, Math.sqrt(maxArea / (width * height)));
  if (single >= TILE_BELOW * byArea) return null;

  // The longest tile that still uploads at natural size, if that is longer
  // than a page; a short side too big for that is scaled, a page at a time.
  const unscaled = Math.min(maxSide, Math.floor(maxArea / short));
  let length = Math.round(
    Math.min(short * TILE_MAX_ASPECT, Math.max(short * TILE_ASPECT, unscaled))
  );
  if (length >= long) return null;

  let count = Math.ceil((long - length * TILE_OVERLAP) / (length * (1 - TILE_OVERLAP)));
  if (count > MAX_TILES) {
    count = MAX_TILES;
    // n tiles with a quarter shared cover n - (n - 1) / 4 lengths.
    length = Math.ceil(long / (count - (count - 1) * TILE_OVERLAP));
  }
  if (count < 2) return null;

  // Spread evenly, so the slack goes into every overlap rather than leaving
  // the last tile sharing most of itself with the one before.
  const starts = Array.from({ length: count }, (_, i) =>
    Math.round((i * (long - length)) / (count - 1))
  );
  const vertical = height >= width;
  const tiles = starts.map((start, i): Tile => {
    const previous = starts[i - 1];
    const next = starts[i + 1];
    const bandStart = previous === undefined ? 0 : (start + previous + length) / 2;
    const bandEnd = next === undefined ? long : (next + start + length) / 2;
    return vertical
      ? { x: 0, y: start, width, height: length, bandStart, bandEnd }
      : { x: start, y: 0, width: length, height, bandStart, bandEnd };
  });
  return { width, height, vertical, tiles };
}

/**
 * What a stored answer is filed under, beyond the picture's fingerprint.
 *
 * Empty for a picture that goes up whole, so every answer stored before
 * tiling existed is still found. For a strip it is not: the answer on disk
 * from an older version is the unreadable one, and it must not be what a
 * fingerprint hit hands back for ever. The same suffix keeps 'off' and 'auto'
 * apart for the one kind of picture where they differ.
 */
export function tilingTag(width: number, height: number, budget: Budget): string {
  return planTiles(width, height, budget) ? '.tiled' : '';
}

/**
 * A box in a tile's proportions, in the picture's.
 *
 * A tile is a crop, so in pixels this is a translation and nothing else: the
 * angle is untouched and so is the box's size. Only the normalisation changes,
 * and it changes per axis - a fraction of the tile's height is a much smaller
 * fraction of the strip's. (Uploading scales the tile uniformly, which
 * normalised coordinates never see.)
 */
export function toPicture(box: Geometry, tile: Tile, plan: TilePlan): Geometry {
  return {
    cx: (tile.x + box.cx * tile.width) / plan.width,
    cy: (tile.y + box.cy * tile.height) / plan.height,
    w: (box.w * tile.width) / plan.width,
    h: (box.h * tile.height) / plan.height,
    angle: box.angle,
  };
}

const move = (box: Geometry | null, tile: Tile, plan: TilePlan): Geometry | null =>
  box ? toPicture(box, tile, plan) : null;

/**
 * One tile's answer, with every box it carries moved into the picture.
 *
 * The inpainted patch needs nothing: its padding is a fraction of the line's
 * height in pixels, which a crop does not change, and its bitmap is stretched
 * to the box wherever the box is.
 */
export function resultToPicture(result: LensResult, tile: Tile, plan: TilePlan): LensResult {
  return {
    contentLanguage: result.contentLanguage,
    ocr: result.ocr.map((paragraph) => ({
      ...paragraph,
      geometry: move(paragraph.geometry, tile, plan),
      lines: paragraph.lines.map((line) => ({
        ...line,
        geometry: move(line.geometry, tile, plan),
        words: line.words.map((word) => ({ ...word, geometry: move(word.geometry, tile, plan) })),
      })),
    })),
    blocks: result.blocks.map((block) => ({
      ...block,
      geometry: move(block.geometry, tile, plan),
      lines: block.lines.map((line) => ({ ...line, geometry: move(line.geometry, tile, plan) })),
    })),
  };
}

// --- Seams -------------------------------------------------------------------

/** What an OCR paragraph and a translated one have in common, which is all a seam needs. */
interface Para {
  geometry: Geometry | null;
  lines: ReadonlyArray<{ geometry: Geometry | null }>;
}

/** An axis-aligned extent in picture pixels: `a` along the long axis, `c` across it. */
interface Extent {
  a0: number;
  a1: number;
  c0: number;
  c1: number;
}

const DEG = Math.PI / 180;

/** Where a rotated box really reaches, the way the canvas would clip it. */
function extentOf(box: Geometry, plan: TilePlan): Extent {
  const w = box.w * plan.width;
  const h = box.h * plan.height;
  const cos = Math.abs(Math.cos(box.angle * DEG));
  const sin = Math.abs(Math.sin(box.angle * DEG));
  const halfX = (w * cos + h * sin) / 2;
  const halfY = (w * sin + h * cos) / 2;
  const x = box.cx * plan.width;
  const y = box.cy * plan.height;
  return plan.vertical
    ? { a0: y - halfY, a1: y + halfY, c0: x - halfX, c1: x + halfX }
    : { a0: x - halfX, a1: x + halfX, c0: y - halfY, c1: y + halfY };
}

function union(extents: Extent[]): Extent | null {
  const first = extents[0];
  if (!first) return null;
  const all = { ...first };
  for (const e of extents) {
    all.a0 = Math.min(all.a0, e.a0);
    all.a1 = Math.max(all.a1, e.a1);
    all.c0 = Math.min(all.c0, e.c0);
    all.c1 = Math.max(all.c1, e.c1);
  }
  return all;
}

function paragraphExtent(para: Para, plan: TilePlan): Extent | null {
  const boxes = [para.geometry, ...para.lines.map((line) => line.geometry)];
  return union(boxes.flatMap((box) => (box ? [extentOf(box, plan)] : [])));
}

/**
 * How close to a tile's edge a paragraph has to end to count as cut by it.
 *
 * A line the edge runs through is usually not reported at all, so the
 * paragraph stops a line short of the edge rather than at it: the next line's
 * pitch is the distance that matters, and a glyph and a half covers it. The
 * thickness of a line is its smaller side, which holds for a vertical column
 * as well. Guessing "cut" too readily costs nothing where the neighbour has
 * the paragraph whole, and where it has not, it only settles a tie.
 */
function edgeMargin(para: Para, plan: TilePlan): number {
  const thick = para.lines
    .flatMap((line) =>
      line.geometry
        ? [Math.min(line.geometry.w * plan.width, line.geometry.h * plan.height)]
        : []
    )
    .sort((a, b) => a - b);
  const median = thick[Math.floor(thick.length / 2)] ?? 0;
  return Math.max(4, median * 1.5);
}

interface Candidate<T extends Para> {
  item: T;
  tile: number;
  index: number;
  extent: Extent | null;
  /** Ends against the tile's leading / trailing edge, where that edge is inside the picture. */
  cutStart: boolean;
  cutEnd: boolean;
  /** 3: whole, in its tile's own band. 2: whole, in a neighbour's. 1: cut. */
  rank: number;
  area: number;
}

const length = (from: number, to: number): number => Math.max(0, to - from);

/**
 * Whether two paragraphs from different tiles are one paragraph seen twice.
 *
 * 'same' is most of the smaller lying inside the other, which is what two
 * readings of one bubble look like however Lens grouped its lines each time.
 * 'pieces' is the case that test misses: a paragraph longer than the overlap,
 * cut by both tiles, whose two parts share only the overlap itself.
 */
function relation<T extends Para>(a: Candidate<T>, b: Candidate<T>): 'same' | 'pieces' | null {
  if (!a.extent || !b.extent) return null;
  const along = length(Math.max(a.extent.a0, b.extent.a0), Math.min(a.extent.a1, b.extent.a1));
  const across = length(Math.max(a.extent.c0, b.extent.c0), Math.min(a.extent.c1, b.extent.c1));
  if (along <= 0 || across <= 0) return null;
  if (along * across >= 0.5 * Math.min(a.area, b.area)) return 'same';

  const [first, second] = a.tile < b.tile ? [a, b] : [b, a];
  const facing = first.cutEnd && second.cutStart;
  const narrower = Math.min(a.extent.c1 - a.extent.c0, b.extent.c1 - b.extent.c0);
  return facing && across >= 0.5 * narrower ? 'pieces' : null;
}

/**
 * One list of paragraphs out of every tile's, each paragraph once.
 *
 * The rule is the bands': a paragraph belongs to the tile whose band holds its
 * centre. Applied literally it loses text, because two readings of a paragraph
 * do not agree on its centre to the pixel and a seam can fall between them -
 * each tile then defers to the other. So the bands only *rank*: whole and in
 * its own band first, whole in a neighbour's next, cut last, larger before
 * smaller; a paragraph is then kept unless one already kept, from another
 * tile, is the same paragraph. Nothing is dropped on the strength of where it
 * is, only for being a duplicate of something that stays.
 *
 * A cut paragraph therefore yields to the neighbour's whole copy when there is
 * one. When no tile has it whole, the larger piece stays as it is and the
 * smaller keeps the lines that lie past it (`trim`), so the far end of a
 * paragraph taller than the overlap is still translated - as a second
 * paragraph, which reads less well than one and far better than a hole.
 */
function dedupe<T extends Para>(
  perTile: T[][],
  plan: TilePlan,
  trim: (item: T, keep: number[]) => T | null
): T[] {
  const candidates: Candidate<T>[] = [];
  perTile.forEach((items, t) => {
    const tile = plan.tiles[t];
    if (!tile) return;
    const start = plan.vertical ? tile.y : tile.x;
    const end = start + (plan.vertical ? tile.height : tile.width);
    items.forEach((item, index) => {
      const extent = paragraphExtent(item, plan);
      const margin = edgeMargin(item, plan);
      const cutStart = Boolean(extent) && t > 0 && (extent as Extent).a0 - start <= margin;
      const cutEnd =
        Boolean(extent) && t < plan.tiles.length - 1 && end - (extent as Extent).a1 <= margin;
      const centre = extent ? (extent.a0 + extent.a1) / 2 : 0;
      const owned = !extent || (centre >= tile.bandStart && centre < tile.bandEnd);
      candidates.push({
        item,
        tile: t,
        index,
        extent,
        cutStart,
        cutEnd,
        rank: cutStart || cutEnd ? 1 : owned ? 3 : 2,
        area: extent ? (extent.a1 - extent.a0) * (extent.c1 - extent.c0) : 0,
      });
    });
  });

  const order = [...candidates].sort(
    (a, b) => b.rank - a.rank || b.area - a.area || a.tile - b.tile || a.index - b.index
  );
  const kept: Candidate<T>[] = [];
  for (const candidate of order) {
    let current: Candidate<T> | null = candidate;
    for (const other of kept) {
      if (!current) break;
      if (other.tile === current.tile) continue;
      const how = relation(current, other);
      if (!how) continue;
      const bothCut = current.rank === 1 && other.rank === 1;
      if (how === 'same' && !bothCut) {
        current = null;
        break;
      }
      // Two pieces of one paragraph: what the other already says is taken out
      // of this one, and whatever is left stands as a paragraph of its own.
      const covered = other.extent as Extent;
      const keep: number[] = [];
      current.item.lines.forEach((line, i) => {
        if (!line.geometry) return;
        const e = extentOf(line.geometry, plan);
        const centre = (e.a0 + e.a1) / 2;
        if (centre < covered.a0 || centre > covered.a1) keep.push(i);
      });
      const trimmed: T | null = keep.length ? trim(current.item, keep) : null;
      if (!trimmed) {
        current = null;
        break;
      }
      const extent = paragraphExtent(trimmed, plan);
      current = {
        ...current,
        item: trimmed,
        extent,
        area: extent ? (extent.a1 - extent.a0) * (extent.c1 - extent.c0) : 0,
      };
    }
    if (current) kept.push(current);
  }

  // Back into reading order: tile by tile, and within a tile as Lens gave it.
  return kept.sort((a, b) => a.tile - b.tile || a.index - b.index).map((c) => c.item);
}

/** The box around the lines that are left, when the paragraph was upright enough for one. */
function boxAround<T extends Para>(item: T, lines: T['lines'], plan: TilePlan): Geometry | null {
  const old = item.geometry;
  if (!old || Math.abs(old.angle) > 1) return old;
  const all = union(lines.flatMap((line) => (line.geometry ? [extentOf(line.geometry, plan)] : [])));
  if (!all) return old;
  const [x0, x1, y0, y1] = plan.vertical
    ? [all.c0, all.c1, all.a0, all.a1]
    : [all.a0, all.a1, all.c0, all.c1];
  return {
    cx: (x0 + x1) / 2 / plan.width,
    cy: (y0 + y1) / 2 / plan.height,
    w: (x1 - x0) / plan.width,
    h: (y1 - y0) / plan.height,
    angle: 0,
  };
}

function trimOcr(paragraph: OcrParagraph, keep: number[], plan: TilePlan): OcrParagraph {
  const lines = keep.flatMap((i) => paragraph.lines[i] ?? []);
  return { ...paragraph, lines, geometry: boxAround(paragraph, lines, plan) };
}

/**
 * A translated paragraph reduced to some of its lines.
 *
 * The lines index into the paragraph's translation, and a renderer that
 * re-wraps draws that whole string - so the string is cut to what the
 * remaining lines cover and their ranges are moved to match. Lines without a
 * word in them carry nothing to draw and cannot say where they were.
 */
function trimBlock(block: TranslationBlock, keep: number[], plan: TilePlan): TranslationBlock | null {
  const lines = keep.flatMap((i) => block.lines[i] ?? []);
  const ranges = lines.flatMap((line) => line.words);
  if (!ranges.length) return null;
  const from = Math.min(...ranges.map(([start]) => start));
  const to = Math.max(...ranges.map(([, end]) => end));
  return {
    ...block,
    translation: block.translation.slice(from, to),
    geometry: boxAround(block, lines, plan),
    lines: lines.map((line) => ({
      ...line,
      words: line.words.map(([start, end]): [number, number] => [start - from, end - from]),
    })),
  };
}

/**
 * Every tile's answer as one, in the picture's coordinates.
 *
 * `results` are as Lens returned them, one per tile and in the plan's order.
 * The recognised paragraphs and the translated ones are settled separately
 * and by the same rule: Copy text reads the first, the renderer the second,
 * and a paragraph Lens read but did not translate exists only in the first.
 */
export function mergeTiles(plan: TilePlan, results: LensResult[]): LensResult {
  const moved = results.map((result, i) => {
    const tile = plan.tiles[i];
    return tile ? resultToPicture(result, tile, plan) : { contentLanguage: '', ocr: [], blocks: [] };
  });
  return {
    contentLanguage: moved.find((result) => result.contentLanguage)?.contentLanguage ?? '',
    ocr: dedupe(
      moved.map((result) => result.ocr),
      plan,
      (paragraph, keep) => trimOcr(paragraph, keep, plan)
    ),
    blocks: dedupe(
      moved.map((result) => result.blocks),
      plan,
      (block, keep) => trimBlock(block, keep, plan)
    ),
  };
}
