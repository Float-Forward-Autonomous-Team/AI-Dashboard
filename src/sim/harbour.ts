/* The simulated harbour: reference route, land, moored boats, buoys and a lidar ray-caster. */
import { rand } from '../core/math';

type Segment =
  | { line: true; x0: number; y0: number; x1: number; y1: number; len: number }
  | { line: false; cx: number; cy: number; a0: number; a1: number; len: number };

export type Point = [number, number];
export type Polygon = Point[];

/** Reference route: rounded rectangle around the harbour basin, parameterised by arc length. */
export const PATH = (() => {
  const A = 18, B = 8, R = 6, segs: Segment[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    segs.push({ line: true, x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0) });
  const arc = (cx: number, cy: number, a0: number) =>
    segs.push({ line: false, cx, cy, a0, a1: a0 + Math.PI / 2, len: (Math.PI * R) / 2 });
  line(-A + R, -B, A - R, -B); arc(A - R, -B + R, -Math.PI / 2);
  line(A, -B + R, A, B - R);   arc(A - R, B - R, 0);
  line(A - R, B, -A + R, B);   arc(-A + R, B - R, Math.PI / 2);
  line(-A, B - R, -A, -B + R); arc(-A + R, -B + R, Math.PI);
  return { segs, R, len: segs.reduce((s, g) => s + g.len, 0) };
})();

export function refPt(s: number): { x: number; y: number } {
  s = ((s % PATH.len) + PATH.len) % PATH.len;
  for (const g of PATH.segs) {
    if (s <= g.len) {
      const k = s / g.len;
      if (g.line) return { x: g.x0 + (g.x1 - g.x0) * k, y: g.y0 + (g.y1 - g.y0) * k };
      const a = g.a0 + (g.a1 - g.a0) * k;
      return { x: g.cx + PATH.R * Math.cos(a), y: g.cy + PATH.R * Math.sin(a) };
    }
    s -= g.len;
  }
  return refPt(0);
}

export function refTan(s: number): { x: number; y: number } {
  const a = refPt(s - 0.01), b = refPt(s + 0.01), L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
}

/** The reference route as a flat polyline, sampled every 0.25 m. */
export const ROUTE: number[] = (() => {
  const out: number[] = [];
  for (let s = 0; s < PATH.len; s += 0.25) { const p = refPt(s); out.push(p.x, p.y); }
  return out;
})();

/** Hull outline (bow towards +x) rotated by `ang`, centred at cx, cy. */
export function hullPoly(cx: number, cy: number, w: number, len: number, ang: number): Polygon {
  const pts: Point[] = [[-len / 2, -w / 2], [len / 4, -w / 2], [len / 2, 0], [len / 4, w / 2], [-len / 2, w / 2]];
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/** Harbour: +y is north. Shore with piers to the north, west shore, breakwater to the south, open sea east. */
export const WORLD = (() => {
  const rect = (cx: number, cy: number, w: number, h: number): Polygon =>
    [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  const land: Polygon[] = [
    [[-34, 16], [34, 16], [34, 26], [-34, 26]],
    [[-34, -26], [-30, -26], [-30, 16], [-34, 16]],
    rect(-10, -17, 40, 1.4),            // breakwater, entrance gap x 10…18
    rect(26, -17, 16, 1.4),
    [[-4, -1.5], [-2, -2.3], [1.6, -2], [4.2, -0.7], [3.6, 1.3], [0.6, 2.3], [-3.1, 1.8]], // islet
    ...[-20, -10, 0, 10].map(x => rect(x, 13.5, 1.2, 5)), // piers
  ];
  const moored = [-20, -10, 0, 10].flatMap(x => [
    hullPoly(x - 2.1, 13.2, 1.6, 4.4, -Math.PI / 2),
    hullPoly(x + 2.2, 13.6, 1.9, 5, -Math.PI / 2),
  ]);
  const buoys: Point[] = [[-22, -2], [22, 3], [6, -12], [10.8, -15], [17.2, -15]];
  const segs: [number, number, number, number][] = [];
  for (const poly of [...land, ...moored])
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; segs.push([p[0], p[1], q[0], q[1]]); });
  for (const [bx, by] of buoys)
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2, r = 0.45;
      segs.push([bx + r * Math.cos(a0), by + r * Math.sin(a0), bx + r * Math.cos(a1), by + r * Math.sin(a1)]);
    }
  return { land, moored, buoys, segs };
})();

/** The area that "fit" shows for the simulated harbour: [minX, minY, maxX, maxY]. */
export const HARBOUR_BOUNDS: [number, number, number, number] = [-31, -21, 31, 21];

/** Cast `n` rays from (px, py) against the harbour; returns hit points as a flat array. */
export function castScan(px: number, py: number, n = 720, maxR = 35): Float32Array {
  const out = new Float32Array(n * 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let best = maxR;
    for (const [x1, y1, x2, y2] of WORLD.segs) {
      const ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = x1 - px, wy = y1 - py;
      const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    if (best < maxR) {
      const r = best + rand(-0.05, 0.05);
      out[k++] = px + dx * r; out[k++] = py + dy * r;
    }
  }
  return out.subarray(0, k);
}
