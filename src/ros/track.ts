/* Route-following figures from a route polyline and the boat pose. */
import { wrapAngle } from '../core/math';

export interface TrackFigures {
  xte: number;      // cross-track error, m, + = left (port) of the route
  headErr: number;  // heading minus route direction at the nearest point, rad
  progress: number; // 0…1 along the route
}

/**
 * Find the nearest point on the route `pts` (flat [x0, y0, x1, y1, …]) to (x, y).
 * Returns null when the route has fewer than two points.
 */
export function trackFigures(pts: ArrayLike<number>, x: number, y: number, hdg: number): TrackFigures | null {
  const n = pts.length / 2;
  if (n < 2) return null;
  let best = Infinity, bestS = 0, bestCross = 0, bestDir = 0, total = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[i * 2 + 2], by = pts[i * 2 + 3];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    const along = Math.max(0, Math.min(len, (x - ax) * ux + (y - ay) * uy));
    const qx = ax + ux * along, qy = ay + uy * along;
    const d = Math.hypot(x - qx, y - qy);
    if (d < best) {
      best = d;
      bestS = total + along;
      bestCross = ux * (y - ay) - uy * (x - ax); // > 0 when the boat is left of the segment
      bestDir = Math.atan2(uy, ux);
    }
    total += len;
  }
  if (!Number.isFinite(best)) return null;
  return {
    xte: Math.sign(bestCross || 1) * best,
    headErr: wrapAngle(hdg - bestDir),
    progress: total > 0 ? bestS / total : 0,
  };
}

/** Flatten the positions of a nav_msgs/Path into [x0, y0, x1, y1, …]. */
export function pathPoints(poses: { pose: { position: { x: number; y: number } } }[]): number[] {
  const out: number[] = new Array(poses.length * 2);
  poses.forEach((p, i) => { out[i * 2] = p.pose.position.x; out[i * 2 + 1] = p.pose.position.y; });
  return out;
}
