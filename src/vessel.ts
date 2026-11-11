/*
 * The vessel state that the views draw. Two copies exist: one written by the simulation
 * (src/sim) and one written by ROS (src/ros). src/source.ts picks which one the views see.
 *
 * Frame: local east-north-up, metres. +x = east, +y = north.
 * Angles: math angles in rad (0 = east, counter-clockwise), the same as ROS yaw.
 */

/** Static chart under the map. The simulation has a drawn harbour; ROS sends an occupancy grid. */
export type Chart =
  | { kind: 'harbour' }
  | {
      kind: 'grid';
      image: HTMLCanvasElement; // one pixel per cell, row 0 = south edge
      x0: number; y0: number;   // world position of the south-west corner of cell (0, 0)
      res: number;              // metres per cell
      cols: number; rows: number;
    };

export interface MapObject {
  id: string;
  label: string;
  x: number; y: number;
  r: number; // radius, m
}

export interface Vessel {
  x: number; y: number;
  hdg: number;   // heading, rad
  cog: number;   // course over ground, rad
  v: number;     // speed over ground, m/s
  roll: number; pitch: number;

  trail: number[];          // driven track, flat [x0, y0, x1, y1, …]
  scan: Float32Array;       // lidar returns in world coordinates, flat [x, y, …]
  plan: number[];           // planned path, flat
  route: number[];          // reference route, flat
  routeClosed: boolean;     // true for a lap course
  goal: { x: number; y: number } | null;
  chart: Chart | null;
  objects: MapObject[];

  // route-following figures; null when not known
  xte: number | null;       // cross-track error, m, + = left (port) of the route
  headErr: number | null;   // heading minus route direction, rad
  progress: number | null;  // 0…1 along the route
  lap: number | null;       // lap number on a closed course
  mission: string | null;   // mission state text

  gnss: string | null;      // fix quality text
  battery: number | null;   // percent
}

export function createVessel(): Vessel {
  return {
    x: 0, y: 0, hdg: 0, cog: 0, v: 0, roll: 0, pitch: 0,
    trail: [], scan: new Float32Array(0), plan: [], route: [], routeClosed: false,
    goal: null, chart: null, objects: [],
    xte: null, headErr: null, progress: null, lap: null, mission: null,
    gnss: null, battery: null,
  };
}

const TRAIL_MAX_POINTS = 800;

export function pushTrail(v: Vessel, x: number, y: number): void {
  v.trail.push(x, y);
  if (v.trail.length > TRAIL_MAX_POINTS * 2) v.trail.splice(0, 2);
}
