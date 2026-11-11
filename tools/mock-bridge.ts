/*
 * Mock foxglove_bridge: speaks the same WebSocket protocol and publishes the same topics
 * as the float_forward navigation stack (branch feature/foxglove-bridge), so the dashboard can be tested without ROS or Docker.
 *
 *   npm run mock               listens on ws://localhost:8765
 *   PORT=9000 npm run mock     another port
 *
 * The boat follows a route from a start point to a goal and back, in the "map" frame
 * near the same coordinates as the VRX wayfinding grid. Every number here is made up.
 */
import { FoxgloveServer } from '@foxglove/ws-protocol';
import { parse } from '@foxglove/rosmsg';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import { WebSocketServer } from 'ws';
import { schemaFor } from './ros-schemas';

const PORT = Number(process.env.PORT ?? 8765);

/* ───────── World ───────── */
const GRID = { x0: -560, y0: 90, res: 0.5, cols: 320, rows: 240 }; // 160 m × 120 m
type Rect = [number, number, number, number]; // minX, minY, maxX, maxY
const LAND: Rect[] = [
  [-560, 190, -400, 210],   // north shore
  [-560, 90, -548, 210],    // west shore
  [-470, 176, -466, 190],   // pier
  [-445, 176, -441, 190],   // pier
];
const BUOYS = [[-505, 150], [-470, 125], [-430, 160], [-500, 115]].map(([x, y]) => ({ x, y, r: 0.6 }));
const WAYPOINTS = [[-535, 105], [-515, 140], [-480, 150], [-455, 130], [-420, 145]];

function sample(pts: number[][], step: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
/** Chaikin corner cutting, a few rounds: a stand-in for the spline guidance node. */
function smooth(pts: number[][], rounds = 4): number[][] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
const ROUTE = sample(WAYPOINTS, 0.5);
const SPLINE = sample(smooth(WAYPOINTS), 0.5);
const SPLINE_LEN = SPLINE.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - SPLINE[i][0], p[1] - SPLINE[i][1]), 0);

function along(s: number): { x: number; y: number; dir: number } {
  let left = s;
  for (let i = 0; i < SPLINE.length - 1; i++) {
    const [ax, ay] = SPLINE[i], [bx, by] = SPLINE[i + 1], L = Math.hypot(bx - ax, by - ay);
    if (left <= L) { const k = L ? left / L : 0; return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, dir: Math.atan2(by - ay, bx - ax) }; }
    left -= L;
  }
  const [ax, ay] = SPLINE[SPLINE.length - 2], [bx, by] = SPLINE[SPLINE.length - 1];
  return { x: bx, y: by, dir: Math.atan2(by - ay, bx - ax) };
}

/* ───────── State ───────── */
const SPEED = 1.5; // m/s
const state = { t: 0, s: 0, x: 0, y: 0, yaw: 0, vLat: 0 };
const moversAt = (t: number) => [
  { id: 'kayak-1', classification: 'kayak', x: -490 + 12 * Math.sin(t / 9), y: 135, vx: (12 / 9) * Math.cos(t / 9), vy: 0, r: 1.0 },
  { id: 'vessel-2', classification: 'vessel', x: -440, y: 120 + 10 * Math.sin(t / 13), vx: 0, vy: (10 / 13) * Math.cos(t / 13), r: 2.5 },
];
let movers = moversAt(0);

function step(dt: number): void {
  state.t += dt;
  movers = moversAt(state.t);
  state.s += SPEED * dt;
  if (state.s > SPLINE_LEN) state.s = 0; // back to the start
  const p = along(state.s);
  const off = 0.8 * Math.sin(state.t * 0.3), prev = { x: state.x, y: state.y };
  state.x = p.x - Math.sin(p.dir) * off;
  state.y = p.y + Math.cos(p.dir) * off;
  state.yaw = p.dir + 0.06 * Math.sin(state.t * 0.2);
  // lateral speed in the boat frame, from the motion
  const dx = state.x - prev.x, dy = state.y - prev.y;
  state.vLat = dt > 0 ? (-Math.sin(state.yaw) * dx + Math.cos(state.yaw) * dy) / dt : 0;
}

/* ───────── Messages ───────── */
const stamp = () => { const ms = Date.now(); return { sec: Math.floor(ms / 1000), nanosec: (ms % 1000) * 1e6 }; };
const header = (frame = 'map') => ({ stamp: stamp(), frame_id: frame });
const quat = (yaw: number, roll = 0) => {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return { x: sr * cy, y: sr * sy, z: cr * sy, w: cr * cy }; // yaw then roll, no pitch
};
const zeros = (n: number) => new Array<number>(n).fill(0);
const pose = (x: number, y: number, yaw = 0) => ({ position: { x, y, z: 0 }, orientation: quat(yaw) });
const path = (pts: number[][]) => ({
  header: header(),
  poses: pts.map(([x, y]) => ({ header: header(), pose: pose(x, y) })),
});

function odometry() {
  const roll = 0.04 * Math.sin(state.t * 0.9);
  return {
    header: header(), child_frame_id: 'base_link',
    pose: { pose: { position: { x: state.x, y: state.y, z: 0 }, orientation: quat(state.yaw, roll) }, covariance: zeros(36) },
    twist: { twist: { linear: { x: SPEED, y: state.vLat, z: 0 }, angular: { x: 0, y: 0, z: 0 } }, covariance: zeros(36) },
  };
}

function occupied(x: number, y: number): boolean {
  if (LAND.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d)) return true;
  return [...BUOYS, ...movers].some(o => Math.hypot(x - o.x, y - o.y) <= o.r);
}

function grid() {
  const { x0, y0, res, cols, rows } = GRID, data = new Int8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) data[r * cols + c] = occupied(x0 + (c + 0.5) * res, y0 + (r + 0.5) * res) ? 100 : 0;
  return {
    header: header(),
    info: { map_load_time: stamp(), resolution: res, width: cols, height: rows, origin: pose(x0, y0) },
    data,
  };
}

const RAYS = 360, MAX_RANGE = 60;
function scan() {
  const ranges = new Float32Array(RAYS);
  for (let i = 0; i < RAYS; i++) {
    const a = state.yaw - Math.PI + (i * 2 * Math.PI) / RAYS, dx = Math.cos(a), dy = Math.sin(a);
    let hit = Infinity;
    for (let r = 1; r <= MAX_RANGE; r += 0.25) {
      if (occupied(state.x + dx * r, state.y + dy * r)) { hit = r + (Math.random() - 0.5) * 0.05; break; }
    }
    ranges[i] = hit;
  }
  return {
    header: header('lidar_wamv_link'), angle_min: -Math.PI, angle_max: Math.PI - (2 * Math.PI) / RAYS,
    angle_increment: (2 * Math.PI) / RAYS, time_increment: 0, scan_time: 0.1, range_min: 1, range_max: MAX_RANGE,
    ranges, intensities: new Float32Array(0),
  };
}

const LAT0 = -33.7228, LON0 = 150.6740, EARTH = 6371000; // near the VRX Sydney regatta origin
function navsat() {
  const lat = LAT0 + ((state.y - 150) / EARTH) * (180 / Math.PI);
  const lon = LON0 + ((state.x + 480) / (EARTH * Math.cos((LAT0 * Math.PI) / 180))) * (180 / Math.PI);
  return {
    header: header('gps'), status: { status: 2, service: 1 }, latitude: lat, longitude: lon, altitude: 0,
    position_covariance: zeros(9), position_covariance_type: 0,
  };
}

function objects() {
  return {
    header: header(),
    objects: movers.map(o => ({
      id: o.id, classification: o.classification, pose: pose(o.x, o.y),
      twist: { linear: { x: o.vx, y: o.vy, z: 0 }, angular: { x: 0, y: 0, z: 0 } }, radius_m: o.r,
    })),
  };
}

/* ───────── Server ───────── */
const server = new FoxgloveServer({ name: 'usv-dashboard mock bridge' });
const wss = new WebSocketServer({ port: PORT, handleProtocols: protocols => server.handleProtocols(protocols) });
wss.on('connection', (conn, req) => {
  const name = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  console.log(`client connected: ${name}`);
  server.handleConnection(conn, name);
});
server.on('subscribe', id => console.log(`  subscribe   ${topicOf.get(id)}`));
server.on('unsubscribe', id => console.log(`  unsubscribe ${topicOf.get(id)}`));
server.on('error', err => console.error('server error', err));

const topicOf = new Map<number, string>();
function channel(topic: string, type: string) {
  const schema = schemaFor(type);
  const writer = new MessageWriter(parse(schema, { ros2: true }));
  const id = server.addChannel({ topic, encoding: 'cdr', schemaName: type.replace('/', '/msg/'), schema, schemaEncoding: 'ros2msg' });
  topicOf.set(id, topic);
  return (message: unknown) => server.sendMessage(id, BigInt(Date.now()) * 1_000_000n, writer.writeMessage(message) as Uint8Array<ArrayBuffer>);
}

const pub = {
  odom: channel('/localization/odometry', 'nav_msgs/Odometry'),
  scan: channel('/wamv/sensors/lidars/lidar_wamv_sensor/scan', 'sensor_msgs/LaserScan'),
  route: channel('/planning/global_path', 'nav_msgs/Path'),
  spline: channel('/planning/smoothed_path', 'nav_msgs/Path'),
  grid: channel('/world_model/static_map', 'nav_msgs/OccupancyGrid'),
  objects: channel('/world_model/moving_objects', 'boat_interfaces/TrackedObjectArray'),
  goal: channel('/mission/goal', 'geometry_msgs/PoseStamped'),
  mission: channel('/mission/state', 'std_msgs/String'),
  gps: channel('/wamv/sensors/gps/gps/fix', 'sensor_msgs/NavSatFix'),
  landmarks: channel('/world_model/landmarks', 'boat_interfaces/TrackedObjectArray'),
};

const GOAL = WAYPOINTS[WAYPOINTS.length - 1];
let last = Date.now();
setInterval(() => { const now = Date.now(); step((now - last) / 1000); last = now; pub.odom(odometry()); }, 100); // 10 Hz
setInterval(() => pub.scan(scan()), 100);                                    // 10 Hz
setInterval(() => pub.gps(navsat()), 200);                                   // 5 Hz
setInterval(() => pub.objects(objects()), 500);                              // 2 Hz
setInterval(() => pub.grid(grid()), 500);                                    // 2 Hz, like sim_truth
setInterval(() => {                                                          // 1 Hz
  pub.route(path(ROUTE));
  pub.spline(path(SPLINE));
  pub.goal({ header: header(), pose: pose(GOAL[0], GOAL[1]) });
  pub.landmarks({
    header: header(),
    objects: BUOYS.map((b, i) => ({
      id: `buoy-${i + 1}`, classification: 'buoy', pose: pose(b.x, b.y),
      twist: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }, radius_m: b.r,
    })),
  });
  pub.mission({ data: 'RUNNING 1/1' });
}, 1000);

console.log(`mock foxglove_bridge on ws://localhost:${PORT}  (Ctrl+C to stop)`);
