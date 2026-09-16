import type { Geometry } from '../types.js';

/**
 * The area the source text actually occupies, as a convex hull.
 *
 * The server's inpainting erases glyphs but leaves their anti-aliased edges,
 * and on a page of vertical text that residue reads as streaks running the full
 * height of a bubble. Covering it needs a shape, and the paragraph's bounding
 * box is the wrong one: for columns set at an angle, or a bubble whose lines
 * are ragged, a rectangle takes in far more than the text and an ellipse
 * inscribed in it takes in too little at the corners.
 *
 * The hull of every line box's corners is exactly the text's extent, whatever
 * arrangement the lines are in.
 */

export interface Point {
  x: number;
  y: number;
}

/** The four corners of a rotated line box, in image pixels. */
export function boxCorners(geometry: Geometry, width: number, height: number): Point[] {
  const cx = geometry.cx * width;
  const cy = geometry.cy * height;
  const halfW = (geometry.w * width) / 2;
  const halfH = (geometry.h * height) / 2;
  const radians = (geometry.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ].map(([dx, dy]) => ({
    x: cx + (dx as number) * cos - (dy as number) * sin,
    y: cy + (dx as number) * sin + (dy as number) * cos,
  }));
}

const cross = (o: Point, a: Point, b: Point): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Andrew's monotone chain. Returns the hull counter-clockwise. */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points];

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const build = (input: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const point of input) {
      while (chain.length >= 2) {
        const last = chain[chain.length - 1] as Point;
        const prev = chain[chain.length - 2] as Point;
        if (cross(prev, last, point) > 0) break;
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

/**
 * Paint the hull, grown and with its corners rounded.
 *
 * Stroking the path with a round-joined line of width `2 * pad` and then
 * filling it does both jobs at once: the stroke straddles the outline, so the
 * shape grows by `pad` in every direction and every corner comes out rounded.
 */
export function fillHull(
  ctx: CanvasRenderingContext2D,
  hull: Point[],
  colour: string,
  pad: number
): void {
  if (hull.length < 3) return;

  ctx.save();
  ctx.beginPath();
  const [first, ...rest] = hull as [Point, ...Point[]];
  ctx.moveTo(first.x, first.y);
  for (const point of rest) ctx.lineTo(point.x, point.y);
  ctx.closePath();

  ctx.fillStyle = colour;
  if (pad > 0) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = pad * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.fill();
  ctx.restore();
}
