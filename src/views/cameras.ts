/*
 * View 1, cameras. The feeds are drawn, not real video: no compressed camera topic exists yet.
 * They follow the active vessel's speed, heading, roll and pitch.
 * To show real video, replace each <canvas> with a <video> (WebRTC) or an <img> (CompressedImage).
 */
import { $, $$, segmented, setPressed, toast } from '../core/dom';
import { C, FONT, fitCanvas, mix } from '../core/canvas';
import { MS_TO_KN, clamp, hash, rand, toCompass } from '../core/math';
import type { Vessel } from '../vessel';

type Dir = 'front' | 'rear';
type Kind = 'vessel' | 'buoy' | 'kayak';

interface CamObject {
  id: number; kind: Kind;
  X: number; Z: number;      // lateral and forward distance from the camera, m
  ph: number; conf: number; vz: number;
  W: number; H: number;      // size, m
  red?: boolean;
}
interface Wave { Z: number; X: number; len: number; ph: number }
interface CamSim {
  dir: Dir; cell: HTMLElement; canvas: HTMLCanvasElement;
  ui: { fps: HTMLElement; lat: HTMLElement };
  objs: CamObject[]; waves: Wave[];
  camH: number; dets: CamObject[]; uiAcc: number;
}
type Project = (X: number, Z: number) => [number, number];

const camOpts = { det: true, hud: true, layout: 'split', primary: 'front' as Dir };
let camsEl: HTMLElement;
let camSims: CamSim[] = [];
let camT = 0; // animation clock, s

// One box colour for every class; a box turns red only when the object is inside the watch range.
const WATCH_M = 20;
let nextTrackId = 1;

function spawnObj(dir: Dir, initial: boolean): CamObject {
  const kind = (['vessel', 'vessel', 'buoy', 'buoy', 'kayak'] as const)[Math.floor(Math.random() * 5)];
  const Z = initial ? rand(10, 100) : dir === 'front' ? rand(70, 115) : 9;
  let X = rand(-0.6, 0.6) * Z;
  if (!initial && dir === 'rear') X = (Math.random() < 0.5 ? -1 : 1) * rand(7, 14);
  const o: CamObject = { id: nextTrackId++, kind, X, Z, ph: rand(0, 6.28), conf: rand(0.78, 0.98), vz: 0, W: 1, H: 1 };
  if (kind === 'vessel') { o.W = rand(2.5, 7); o.H = rand(1.6, 2.6); o.vz = rand(-1.5, 1.5); }
  if (kind === 'buoy')   { o.W = 0.6; o.H = 1.3; o.red = Math.random() < 0.5; }
  if (kind === 'kayak')  { o.W = 0.8; o.H = 0.9; o.vz = rand(-0.3, 0.3); }
  return o;
}

function spawnWave(Z: number): Wave { return { Z, X: rand(-1.1, 1.1) * Z, len: rand(0.5, 1.6), ph: rand(0, 6.28) }; }

function applyCamLayout(): void {
  camsEl.dataset.layout = camOpts.layout;
  $$('.cell', camsEl).forEach(c =>
    c.classList.toggle('is-secondary', camOpts.layout === 'pip' && c.dataset.cam !== camOpts.primary));
  setPressed($('#cam-layout'), 'layout', camOpts.layout);
}

export function initCameras(): void {
  camsEl = $('#cams');
  segmented($('#cam-layout'), b => {
    camOpts.layout = b.dataset.layout ?? 'split';
    if (camOpts.layout === 'front' || camOpts.layout === 'rear') camOpts.primary = camOpts.layout;
    applyCamLayout();
  });
  $$('.cell', camsEl).forEach(cell => cell.addEventListener('click', () => {
    const cam = cell.dataset.cam as Dir;
    if (camOpts.layout === 'split') { camOpts.layout = cam; camOpts.primary = cam; }        // tap to focus
    else if (camOpts.layout === cam) camOpts.layout = 'split';                              // tap again to go back
    else if (camOpts.layout === 'pip' && cell.classList.contains('is-secondary')) camOpts.primary = cam; // swap
    applyCamLayout();
  }));
  $$('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.toggle as 'det' | 'hud';
    camOpts[k] = !camOpts[k];
    b.setAttribute('aria-pressed', String(camOpts[k]));
  }));
  $('#cam-snap').addEventListener('click', () => toast('Snapshot saved (mock)'));

  camSims = $$('.cell', camsEl).map(cell => {
    const dir = cell.dataset.cam as Dir;
    return {
      dir, cell,
      canvas: $<HTMLCanvasElement>('canvas', cell),
      ui: { fps: $('[data-k=fps]', cell), lat: $('[data-k=lat]', cell) },
      objs: Array.from({ length: 6 }, () => spawnObj(dir, true)),
      waves: Array.from({ length: 260 }, () => spawnWave(rand(3, 80))),
      camH: dir === 'front' ? 1.4 : 1.7,
      dets: [], uiAcc: 0.4,
    };
  });
  applyCamLayout();
}

function stepCam(cs: CamSim, dt: number, v: number): void {
  const sgn = cs.dir === 'front' ? -1 : 1;
  cs.objs.forEach((o, i) => {
    o.Z += (sgn * v + o.vz) * dt;
    if (o.Z < 5 || o.Z > 125 || Math.abs(o.X / o.Z) > 1.3) cs.objs[i] = spawnObj(cs.dir, false);
  });
  for (const w of cs.waves) {
    w.Z += sgn * v * dt;
    if (w.Z < 3) Object.assign(w, spawnWave(w.Z + 77));
    else if (w.Z > 80) Object.assign(w, spawnWave(w.Z - 77));
  }
  cs.uiAcc += dt;
  if (cs.uiAcc > 0.5) {
    cs.uiAcc = 0;
    cs.ui.fps.textContent = `${rand(29.4, 30).toFixed(1)} fps`;
    cs.ui.lat.textContent = `${Math.round(rand(38, 47) + (cs.dir === 'rear' ? 3 : 0))} ms`;
  }
}

/** Relative bearing from the bow, clockwise in degrees (front camera: right = starboard; rear: right = port). */
const relBearing = (dir: Dir, o: CamObject): number => {
  const a = (Math.atan(o.X / o.Z) * 180) / Math.PI;
  return ((dir === 'front' ? a : 180 + a) + 360) % 360;
};
const camName = (dir: Dir): string => (dir === 'front' ? 'Front' : 'Rear');
/** Closing speed: how fast the range shrinks. Negative means it is opening. */
const fmtClosing = (dir: Dir, o: CamObject, v: number): string => {
  const c = -((dir === 'front' ? -1 : 1) * v + o.vz);
  return `${c < 0 ? '−' : ''}${Math.abs(c).toFixed(1)} m/s`;
};
const bearingText = (b: number): string => `${Math.round(b).toString().padStart(3, '0')}°`;
const sideText = (dir: Dir, o: CamObject): string => {
  const b = relBearing(dir, o), off = Math.min(Math.abs(b), Math.abs(360 - b), Math.abs(180 - b));
  const fore = dir === 'front' ? 'ahead' : 'astern';
  if (off < 6) return `dead ${fore}`;
  return `${fore}, ${b < 180 ? 'starboard' : 'port'} side`;
};

let objAcc = 1;
function updateObjects(dt: number, v: number): void {
  objAcc += dt;
  if (objAcc < 0.5) return;
  objAcc = 0;
  const rows = camSims.flatMap(cs => cs.dets.map(o => ({ o, dir: cs.dir }))).sort((a, b) => a.o.Z - b.o.Z);
  const finding = $('#cam-finding'), count = $('#obj-count');
  if (!camOpts.det) {
    finding.textContent = 'Detections are switched off. Feeds are shown without the object detector overlay.';
    count.textContent = 'detector overlay off';
    $('#objects').innerHTML = `<tr class="empty"><td colspan="7">Turn on Detections to list tracked objects.</td></tr>`;
    return;
  }
  const near = rows[0];
  if (!near) finding.textContent = 'No objects in view on either camera.';
  else {
    const total = `${rows.length} object${rows.length === 1 ? '' : 's'} in view. `;
    const nearest = `Nearest: ${near.o.kind} at ${near.o.Z.toFixed(0)} m, ${sideText(near.dir, near.o)}`;
    finding.innerHTML = near.o.Z < WATCH_M
      ? `${total}<span class="warn">${nearest}, inside the ${WATCH_M} m watch range.</span>`
      : `${total}${nearest}.`;
  }
  const shown = rows.slice(0, 5);
  count.textContent = rows.length > shown.length ? `nearest ${shown.length} of ${rows.length}` : `${rows.length} in view`;
  $('#objects').innerHTML = shown.length
    ? shown.map(({ o, dir }) => `<tr>
        <td>${o.kind[0].toUpperCase() + o.kind.slice(1)}<span class="id">T-${String(o.id).padStart(3, '0')}<span class="show-sm"> · ${camName(dir)}</span></span></td>
        <td class="hide-sm">${camName(dir)}</td>
        <td class="num">${bearingText(relBearing(dir, o))}</td>
        <td class="num key">${o.Z.toFixed(0)} m</td>
        <td class="num hide-sm">${fmtClosing(dir, o, v)}</td>
        <td class="num hide-sm">${o.conf.toFixed(2)}</td>
        <td class="col-status">${o.Z < WATCH_M ? '<span class="pill pill-negative">Inside 20 m</span>' : '<span class="pill pill-neutral">Clear</span>'}</td>
      </tr>`).join('')
    : `<tr class="empty"><td colspan="7">Nothing detected on either camera.</td></tr>`;
}

/** Skyline height (as a fraction of frame height) at compass bearing `b` (math angle). */
function skyline(b: number): number {
  const north = Math.cos(b - Math.PI / 2), west = Math.cos(b - Math.PI), south = Math.cos(b + Math.PI / 2);
  let hgt = 0;
  if (north > 0.2) {
    const town = north > 0.45 ? 0.35 + 0.65 * hash(Math.floor(b * 70)) : 0; // buildings along the quay
    hgt = Math.max(hgt, (north - 0.2) * 0.05 * (0.7 + 0.3 * Math.sin(b * 7)), town * 0.035 * north);
  }
  if (west > 0.3) hgt = Math.max(hgt, (west - 0.3) * 0.08 * (0.7 + 0.2 * Math.sin(b * 5 + 1) + 0.1 * Math.sin(b * 19)));
  if (south > 0.6) hgt = Math.max(hgt, 0.006); // breakwater
  return hgt;
}

interface Box { o: CamObject; x0: number; y0: number; x1: number; y1: number }

function drawCam(cs: CamSim, boat: Vessel): void {
  const { ctx, w, h } = fitCanvas(cs.canvas);
  if (!w || !h) return;
  const t = camT, f = h * 1.05, camH = cs.camH, cx = w / 2, cy = h / 2;
  const camHdg = cs.dir === 'front' ? boat.hdg : boat.hdg + Math.PI;
  const roll = cs.dir === 'front' ? boat.roll : -boat.roll;
  const hz = h * 0.42 + (cs.dir === 'front' ? boat.pitch : -boat.pitch) * f;
  const P: Project = (X, Z) => [cx + (f * X) / Z, hz + (f * camH) / Z];
  const haze = '#3b4a58';

  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(roll); ctx.translate(-cx, -cy);

  // sky + sea (oversized so the roll never shows an edge)
  let g = ctx.createLinearGradient(0, -h * 0.3, 0, hz);
  g.addColorStop(0, '#0d1520'); g.addColorStop(1, haze);
  ctx.fillStyle = g; ctx.fillRect(-w, -h, w * 3, hz + h);
  g = ctx.createLinearGradient(0, hz, 0, h * 1.2);
  g.addColorStop(0, '#2f3d48'); g.addColorStop(0.25, '#1a2832'); g.addColorStop(1, '#0a131a');
  ctx.fillStyle = g; ctx.fillRect(-w, hz, w * 3, h * 2);

  // coastline on the horizon, pans as the boat turns
  ctx.fillStyle = '#1b232b'; ctx.beginPath(); ctx.moveTo(-w * 0.5, hz);
  for (let x = -w * 0.5; x <= w * 1.5; x += 3) ctx.lineTo(x, hz - skyline(camHdg - Math.atan((x - cx) / f)) * h);
  ctx.lineTo(w * 1.5, hz); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(200,215,225,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-w * 0.5, hz); ctx.lineTo(w * 1.5, hz); ctx.stroke();

  // wave crests
  ctx.lineCap = 'round';
  for (const wv of cs.waves) {
    const [x, y] = P(wv.X, wv.Z), half = (f * wv.len) / wv.Z / 2;
    if (x + half < -w * 0.3 || x - half > w * 1.3) continue;
    const a = (1 - wv.Z / 80) * 0.32 * (0.45 + 0.55 * Math.sin(t * 1.6 + wv.ph));
    if (a <= 0.01) continue;
    ctx.strokeStyle = `rgba(200,215,225,${a.toFixed(3)})`;
    ctx.lineWidth = clamp((f * 0.05) / wv.Z, 0.6, 2.5);
    ctx.beginPath(); ctx.moveTo(x - half, y); ctx.lineTo(x + half, y); ctx.stroke();
  }

  if (cs.dir === 'rear') drawWake(ctx, P);

  // objects, far → near
  const dets: Box[] = [];
  for (const o of [...cs.objs].sort((a, b) => b.Z - a.Z)) {
    const s = f / o.Z;
    const bob = Math.sin(t * 1.3 + o.ph) * 0.12 * s;
    const [x, gy0] = P(o.X, o.Z), gy = gy0 + bob, ww = o.W * s, hh = o.H * s;
    if (x + ww < -w * 0.3 || x - ww > w * 1.3) continue;
    const fog = clamp(o.Z / 120, 0, 0.85);
    const tint = (c: string) => mix(c, haze, fog);

    // reflection
    ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - fog)})`;
    ctx.fillRect(x - ww * 0.45, gy, ww * 0.9, Math.max(1, hh * 0.25));

    if (o.kind === 'vessel') {
      const hullH = hh * 0.45;
      ctx.fillStyle = tint('#c9c6bd');
      ctx.beginPath();
      ctx.moveTo(x - ww / 2, gy - hullH); ctx.lineTo(x + ww / 2, gy - hullH);
      ctx.lineTo(x + ww * 0.42, gy); ctx.lineTo(x - ww * 0.42, gy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = tint('#8d8a83'); ctx.fillRect(x - ww * 0.2, gy - hh, ww * 0.42, hh - hullH);
      ctx.fillStyle = tint('#26303a'); ctx.fillRect(x - ww * 0.16, gy - hh * 0.9, ww * 0.34, (hh - hullH) * 0.35);
    } else if (o.kind === 'buoy') {
      ctx.fillStyle = tint(o.red ? '#b8423a' : '#2f8a4a');
      ctx.beginPath(); ctx.moveTo(x - ww / 2, gy); ctx.lineTo(x + ww / 2, gy); ctx.lineTo(x, gy - hh * 0.75); ctx.closePath(); ctx.fill();
      ctx.fillStyle = tint('#3a3a3a'); ctx.fillRect(x - Math.max(0.5, ww * 0.05), gy - hh, Math.max(1, ww * 0.1), hh * 0.3);
    } else {
      ctx.fillStyle = tint('#d98c2b');
      ctx.beginPath(); ctx.ellipse(x, gy - hh * 0.08, ww * 0.9, Math.max(1, hh * 0.1), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tint('#5b5650');
      ctx.beginPath(); ctx.roundRect(x - ww * 0.2, gy - hh * 0.75, ww * 0.4, hh * 0.6, ww * 0.12); ctx.fill();
      ctx.beginPath(); ctx.arc(x, gy - hh * 0.85, ww * 0.14, 0, Math.PI * 2); ctx.fill();
    }
    if (o.Z < 90) dets.push({ o, x0: x - ww / 2 - 4, y0: gy - hh - 4, x1: x + ww / 2 + 4, y1: gy + 3 });
  }

  if (camOpts.hud) drawRangeMarks(ctx, P, w);
  ctx.restore();

  // own boat: bow (front) / stern deck (rear), fixed to the camera
  ctx.fillStyle = '#16191c'; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (cs.dir === 'front') {
    ctx.moveTo(cx - w * 0.3, h + 2); ctx.lineTo(cx - w * 0.05, h * 0.9); ctx.lineTo(cx, h * 0.875);
    ctx.lineTo(cx + w * 0.05, h * 0.9); ctx.lineTo(cx + w * 0.3, h + 2);
  } else {
    ctx.moveTo(-2, h * 0.94); ctx.quadraticCurveTo(cx, h * 0.91, w + 2, h * 0.94); ctx.lineTo(w + 2, h + 2); ctx.lineTo(-2, h + 2);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // vignette
  g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // detections: the model sees axis-aligned boxes in image space, so rotate the corners and re-box them
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = (x: number, y: number): [number, number] => [cx + (x - cx) * cr - (y - cy) * sr, cy + (x - cx) * sr + (y - cy) * cr];
  cs.dets = [];
  if (camOpts.det) {
    const showText = w > 340, placed: number[][] = [];
    ctx.font = `600 11px ${FONT}`;
    for (const d of dets.reverse()) {
      const pts = [rot(d.x0, d.y0), rot(d.x1, d.y0), rot(d.x0, d.y1), rot(d.x1, d.y1)];
      const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
      const y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
      if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) continue;
      cs.dets.push(d.o);
      const color = d.o.Z < WATCH_M ? C.alert : C.sky;
      ctx.strokeStyle = color; ctx.lineWidth = d.o.Z < WATCH_M ? 2 : 1.5;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      if (!showText) continue;
      const txt = `${d.o.kind}  ${d.o.Z.toFixed(0)} m  ${d.o.conf.toFixed(2)}`;
      const tw = ctx.measureText(txt).width, ly = Math.max(0, y0 - 20);
      const box = [x0 - 1, ly, x0 + tw + 13, ly + 19];
      if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.fillStyle = color; ctx.fillRect(x0 - 1, ly, tw + 14, 19);
      ctx.fillStyle = '#0b1118'; ctx.fillText(txt, x0 + 6, ly + 13.5);
    }
  }

  if (camOpts.hud && cs.dir === 'front') drawCompass(ctx, w, roll, boat);
}

function drawWake(ctx: CanvasRenderingContext2D, P: Project): void {
  // turbulent centre + Kelvin arms (about 19.5°) spreading behind the stern
  const g = ctx.createLinearGradient(0, P(0, 2)[1], 0, P(0, 50)[1]);
  g.addColorStop(0, 'rgba(225,235,240,0.12)'); g.addColorStop(1, 'rgba(225,235,240,0)');
  ctx.fillStyle = g;
  for (const k of [1.8, 1.2, 0.7, 0.35]) { // stacked translucent bands → soft edges
    ctx.beginPath();
    for (let Z = 2; Z <= 50; Z += 2) { const [x, y] = P(-k * (0.35 + 0.05 * Z), Z); if (Z === 2) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    for (let Z = 50; Z >= 2; Z -= 2) { const [x, y] = P(k * (0.35 + 0.05 * Z), Z); ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fill();
  }

  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let Z = 2; Z < 45; Z += 1.5) {
      const [ax, ay] = P(side * (0.6 + 0.36 * Z), Z), [bx, by] = P(side * (0.6 + 0.36 * (Z + 1.5)), Z + 1.5);
      ctx.strokeStyle = `rgba(225,235,240,${(0.3 * (1 - Z / 45)).toFixed(3)})`;
      ctx.lineWidth = clamp(6 / Z, 0.6, 3);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(235,240,245,0.35)';
  for (let i = 0; i < 50; i++) {
    const Z = 2 + rand() ** 2 * 25, [x, y] = P(rand(-1, 1) * (0.35 + 0.05 * Z), Z);
    ctx.fillRect(x, y, 1.5, 1.5);
  }
}

function drawRangeMarks(ctx: CanvasRenderingContext2D, P: Project, w: number): void {
  ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
  ctx.font = `600 11px ${FONT}`;
  for (const Z of [5, 10, 25]) {
    const [, y] = P(0, Z), half = w * (Z === 5 ? 0.26 : Z === 10 ? 0.19 : 0.12);
    ctx.strokeStyle = 'rgba(240,239,236,0.4)';
    ctx.beginPath(); ctx.moveTo(w / 2 - half, y); ctx.lineTo(w / 2 + half, y); ctx.stroke();
    ctx.fillStyle = 'rgba(240,239,236,0.75)'; ctx.fillText(`${Z} m`, w / 2 + half + 6, y + 4);
  }
  ctx.setLineDash([]);
}

function drawCompass(ctx: CanvasRenderingContext2D, w: number, roll: number, boat: Vessel): void {
  const cx = w / 2, hdg = toCompass(boat.hdg);
  ctx.font = `600 12px ${FONT}`; ctx.textAlign = 'center';
  if (w > 440) {
    const tw = Math.min(320, w * 0.38), ppd = tw / 60, y = 18;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - tw / 2, 0, tw, 50); ctx.clip();
    ctx.strokeStyle = 'rgba(240,239,236,0.7)'; ctx.fillStyle = 'rgba(240,239,236,0.85)'; ctx.lineWidth = 1.2;
    for (let d = Math.ceil((hdg - 32) / 5) * 5; d <= hdg + 32; d += 5) {
      const x = cx + (d - hdg) * ppd, dd = ((d % 360) + 360) % 360, major = dd % 30 === 0;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (major ? 9 : 5)); ctx.stroke();
      if (major) ctx.fillText(({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[dd] ?? String(dd).padStart(3, '0'), x, y + 23);
    }
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(cx, y + 1); ctx.lineTo(cx - 5, y - 6); ctx.lineTo(cx + 5, y - 6); ctx.closePath(); ctx.fill();
  }
  const rollDeg = (roll * 180) / Math.PI;
  const line = `HDG ${hdg.toFixed(0).padStart(3, '0')}°  ·  SOG ${(boat.v * MS_TO_KN).toFixed(1)} kn  ·  ROLL ${rollDeg >= 0 ? '+' : '−'}${Math.abs(rollDeg).toFixed(1)}°`;
  const lw = ctx.measureText(line).width, ly = w > 440 ? 64 : 60;
  ctx.fillStyle = 'rgba(10,10,10,0.55)'; ctx.fillRect(cx - lw / 2 - 8, ly - 14, lw + 16, 20);
  ctx.fillStyle = 'rgba(240,239,236,0.92)'; ctx.fillText(line, cx, ly);
  ctx.textAlign = 'left';
}

/** Advance the camera simulation; draw it when the view is visible. */
export function frameCameras(dt: number, boat: Vessel, visible: boolean): void {
  camT += dt;
  for (const cs of camSims) {
    stepCam(cs, dt, boat.v);
    if (visible && cs.cell.offsetParent !== null) drawCam(cs, boat);
    else cs.dets = [];
  }
  if (visible) updateObjects(dt, boat.v);
}
