/*
 * Live data from ROS 2: one handler per topic, each one writes into `rosVessel`.
 * The views never talk to ROS; they only read the vessel state (see src/source.ts).
 */
import { C } from '../core/canvas';
import { quatToEuler } from '../core/math';
import { TOPICS } from '../config';
import { createVessel, pushTrail, type MapObject } from '../vessel';
import { connectBridge, type Handlers, type LinkState } from './bridge';
import type { LaserScan, NavSatFix, OccupancyGrid, Odometry, Path, PoseStamped, StringMsg, TrackedObjectArray } from './messages';
import { pathPoints, trackFigures } from './track';

export const rosVessel = createVessel();

export const link = {
  enabled: false,
  state: 'disconnected' as LinkState,
  url: '',
  detail: '',
  advertised: new Set<string>(),
  lastPoseMs: 0,
  lastGpsMs: 0,
  poseTimes: [] as number[], // receive times of the last poses, for the rate
};

const TRAIL_STEP_M = 0.2;
const RATE_WINDOW_MS = 2000;
const MOVING_MS = 0.2; // below this speed, course over ground is not meaningful

/** Pose messages per second over the last 2 s. */
export function poseRate(now = Date.now()): number {
  const recent = link.poseTimes.filter(t => now - t < RATE_WINDOW_MS);
  link.poseTimes = recent;
  return recent.length / (RATE_WINDOW_MS / 1000);
}

/** Route used for the figures: the smoothed route if there is one, else the A* route. */
function updateTrackFigures(): void {
  const v = rosVessel;
  const route = v.plan.length >= 4 ? v.plan : v.route;
  const f = trackFigures(route, v.x, v.y, v.hdg);
  v.xte = f?.xte ?? null;
  v.headErr = f?.headErr ?? null;
  v.progress = f?.progress ?? null;
}

function onOdometry(m: Odometry, now: number): void {
  const v = rosVessel;
  const { position, orientation } = m.pose.pose;
  const { roll, pitch, yaw } = quatToEuler(orientation);
  v.x = position.x; v.y = position.y;
  v.hdg = yaw; v.roll = roll; v.pitch = pitch;
  // the twist is in the boat frame (child_frame_id), so rotate it by the heading for the course
  const { x: vx, y: vy } = m.twist.twist.linear;
  v.v = Math.hypot(vx, vy);
  v.cog = v.v > MOVING_MS ? yaw + Math.atan2(vy, vx) : yaw;

  const T = v.trail, n = T.length;
  if (n < 2 || Math.hypot(v.x - T[n - 2], v.y - T[n - 1]) >= TRAIL_STEP_M) pushTrail(v, v.x, v.y);

  updateTrackFigures();
  link.lastPoseMs = now;
  link.poseTimes.push(now);
}

/**
 * LaserScan → world points, with the latest boat pose.
 * Simplification: the lidar is taken to sit at the boat origin, level and facing forward.
 * Use /tf for the real mount position when that matters.
 */
function onScan(m: LaserScan): void {
  const v = rosVessel, n = m.ranges.length;
  const out = new Float32Array(n * 2);
  const c = Math.cos(v.hdg), s = Math.sin(v.hdg);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const r = m.ranges[i];
    if (!Number.isFinite(r) || r < m.range_min || r > m.range_max) continue;
    const a = m.angle_min + i * m.angle_increment;
    const lx = r * Math.cos(a), ly = r * Math.sin(a);
    out[k++] = v.x + lx * c - ly * s;
    out[k++] = v.y + lx * s + ly * c;
  }
  v.scan = out.subarray(0, k);
}

function onRoute(m: Path): void {
  rosVessel.route = pathPoints(m.poses);
  rosVessel.routeClosed = false;
  updateTrackFigures();
}

function onSpline(m: Path): void {
  rosVessel.plan = pathPoints(m.poses);
  updateTrackFigures();
}

/** Paint the grid into a small canvas, one pixel per cell; the map scales it. */
function onGrid(m: OccupancyGrid): void {
  const { width: cols, height: rows, resolution: res, origin } = m.info;
  if (!cols || !rows) return;
  const prev = rosVessel.chart;
  const image = prev?.kind === 'grid' && prev.cols === cols && prev.rows === rows ? prev.image : document.createElement('canvas');
  image.width = cols; image.height = rows;
  const ctx = image.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  const land = parseHex(C['map-land']), unknown = [120, 130, 140, 60];
  for (let i = 0; i < cols * rows; i++) {
    const cell = m.data[i], p = i * 4; // row 0 of the grid is row 0 of the image (south edge)
    if (cell >= 50) { img.data[p] = land[0]; img.data[p + 1] = land[1]; img.data[p + 2] = land[2]; img.data[p + 3] = 255; }
    else if (cell < 0) { img.data[p] = unknown[0]; img.data[p + 1] = unknown[1]; img.data[p + 2] = unknown[2]; img.data[p + 3] = unknown[3]; }
  }
  ctx.putImageData(img, 0, 0);
  // simplification: the grid origin is taken as not rotated (yaw 0), which is the usual case
  rosVessel.chart = { kind: 'grid', image, x0: origin.position.x, y0: origin.position.y, res, cols, rows };
}

function parseHex(h: string): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// moving objects and landmarks (buoys, posts) come on two topics; the map shows both
let movingObjects: MapObject[] = [];
let landmarks: MapObject[] = [];
const toMapObjects = (m: TrackedObjectArray): MapObject[] => m.objects.map(o => ({
  id: o.id, label: o.classification || 'object',
  x: o.pose.position.x, y: o.pose.position.y, r: o.radius_m,
}));
function onObjects(m: TrackedObjectArray): void {
  movingObjects = toMapObjects(m);
  rosVessel.objects = [...landmarks, ...movingObjects];
}
function onLandmarks(m: TrackedObjectArray): void {
  landmarks = toMapObjects(m);
  rosVessel.objects = [...landmarks, ...movingObjects];
}

function onGoal(m: PoseStamped): void {
  rosVessel.goal = { x: m.pose.position.x, y: m.pose.position.y };
}

function onMissionState(m: StringMsg): void {
  rosVessel.mission = m.data;
}

const FIX_TEXT: Record<number, string> = { [-1]: 'No fix', 0: 'GPS fix', 1: 'SBAS fix', 2: 'RTK fix' }; // 2 = STATUS_GBAS_FIX
function onGps(m: NavSatFix, now: number): void {
  rosVessel.gnss = FIX_TEXT[m.status.status] ?? 'Unknown fix';
  link.lastGpsMs = now;
}

const handlers: Handlers = {
  [TOPICS.odometry]: (m, t) => onOdometry(m as Odometry, t),
  [TOPICS.scan]: m => onScan(m as LaserScan),
  [TOPICS.route]: m => onRoute(m as Path),
  [TOPICS.spline]: m => onSpline(m as Path),
  [TOPICS.grid]: m => onGrid(m as OccupancyGrid),
  [TOPICS.objects]: m => onObjects(m as TrackedObjectArray),
  [TOPICS.landmarks]: m => onLandmarks(m as TrackedObjectArray),
  [TOPICS.goal]: m => onGoal(m as PoseStamped),
  [TOPICS.missionState]: m => onMissionState(m as StringMsg),
  [TOPICS.gps]: (m, t) => onGps(m as NavSatFix, t),
};

export function startRos(url: string): void {
  link.enabled = true;
  link.url = url;
  connectBridge(url, handlers, {
    onStatus(state, detail) {
      link.state = state;
      link.detail = detail;
      if (state !== 'connected') link.advertised.clear();
    },
    onTopics(channels) {
      link.advertised = new Set(channels.map(c => c.topic));
    },
  });
}
