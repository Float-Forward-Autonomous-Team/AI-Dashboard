/* View 2, map: chart (harbour or occupancy grid), route, plan, driven track, lidar scan, objects, vessel. */
import { $, $$ } from '../core/dom';
import { C, fitCanvas } from '../core/canvas';
import { MS_TO_KN, clamp, toCompass } from '../core/math';
import { TOPICS } from '../config';
import { HARBOUR_BOUNDS, WORLD, type Polygon } from '../sim/harbour';
import type { Mode } from '../source';
import type { Vessel } from '../vessel';

type Layer = 'scan' | 'map' | 'ref' | 'plan' | 'driven';
type Bounds = [number, number, number, number]; // minX, minY, maxX, maxY

const MIN_SCALE = 0.2, MAX_SCALE = 200; // px per metre
const XTE_LIMIT_M = 1.0;

const mapV = {
  cx: 0, cy: 0, scale: 0, follow: true,
  layers: { scan: true, map: true, ref: true, plan: true, driven: true } as Record<Layer, boolean>,
};
let mapCanvas: HTMLCanvasElement;
let current: Vessel | null = null;
let lastMode: Mode | null = null;

function setFollow(on: boolean): void {
  mapV.follow = on;
  $('#map-follow').setAttribute('aria-pressed', String(on));
}
function zoom(k: number): void { mapV.scale = clamp(mapV.scale * k, MIN_SCALE, MAX_SCALE); }

/** The area to show for "fit": the harbour, the occupancy grid, or the route around the boat. */
function bounds(v: Vessel): Bounds {
  const chart = v.chart;
  if (chart?.kind === 'harbour') return HARBOUR_BOUNDS;
  if (chart?.kind === 'grid') return [chart.x0, chart.y0, chart.x0 + chart.cols * chart.res, chart.y0 + chart.rows * chart.res];
  let b: Bounds = [v.x - 20, v.y - 15, v.x + 20, v.y + 15];
  const r = v.route;
  for (let i = 0; i < r.length; i += 2)
    b = [Math.min(b[0], r[i] - 5), Math.min(b[1], r[i + 1] - 5), Math.max(b[2], r[i] + 5), Math.max(b[3], r[i + 1] + 5)];
  return b;
}

function fitMap(): void {
  if (!current) return;
  const r = mapCanvas.getBoundingClientRect(), [x0, y0, x1, y1] = bounds(current);
  mapV.scale = clamp(Math.min(r.width / (x1 - x0), r.height / (y1 - y0)), MIN_SCALE, MAX_SCALE);
  mapV.cx = (x0 + x1) / 2; mapV.cy = (y0 + y1) / 2;
  setFollow(false);
}

export function initMap(): void {
  mapCanvas = $<HTMLCanvasElement>('#map-canvas');
  $$('.layer').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.layer as Layer;
    mapV.layers[k] = !mapV.layers[k];
    b.setAttribute('aria-pressed', String(mapV.layers[k]));
  }));
  $('#map-follow').addEventListener('click', () => setFollow(!mapV.follow));
  $('#map-zin').addEventListener('click', () => zoom(1.35));
  $('#map-zout').addEventListener('click', () => zoom(1 / 1.35));
  $('#map-fit').addEventListener('click', fitMap);

  // pan (1 finger / mouse), pinch (2 fingers), wheel zoom
  const ptrs = new Map<number, { x: number; y: number }>();
  mapCanvas.addEventListener('pointerdown', e => { mapCanvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  mapCanvas.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (ptrs.size === 1) {
      mapV.cx -= (cur.x - prev.x) / mapV.scale;
      mapV.cy += (cur.y - prev.y) / mapV.scale;
      if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.5) setFollow(false);
    } else if (ptrs.size === 2) {
      const other = [...ptrs].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      if (d0 > 0) zoom(d1 / d0);
    }
    ptrs.set(e.pointerId, cur);
  });
  (['pointerup', 'pointercancel'] as const).forEach(t => mapCanvas.addEventListener(t, e => ptrs.delete(e.pointerId)));
  mapCanvas.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
}

function drawMap(boat: Vessel): void {
  const { ctx, w, h } = fitCanvas(mapCanvas);
  if (!w || !h) return;
  if (!mapV.scale) mapV.scale = Math.min(w / 50, h / 36) * 1.5;
  if (mapV.follow) { mapV.cx += (boat.x - mapV.cx) * 0.12; mapV.cy += (boat.y - mapV.cy) * 0.12; }
  const S = mapV.scale, X = (x: number) => w / 2 + (x - mapV.cx) * S, Y = (y: number) => h / 2 - (y - mapV.cy) * S;
  const L = mapV.layers;
  const poly = (pts: Polygon) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
  };
  const polyline = (pts: ArrayLike<number>) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) i ? ctx.lineTo(X(pts[i]), Y(pts[i + 1])) : ctx.moveTo(X(pts[i]), Y(pts[i + 1]));
  };

  // drawn like a paper chart: pale water, light land with a grey edge, ink soundings
  ctx.fillStyle = C['map-water']; ctx.fillRect(0, 0, w, h);

  // grid: 1 m minor (when zoomed in), 5 m major; coarser when zoomed out far
  const x0 = mapV.cx - w / 2 / S, x1 = mapV.cx + w / 2 / S, y0 = mapV.cy - h / 2 / S, y1 = mapV.cy + h / 2 / S;
  const gridPass = (step: number, style: string) => {
    ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.beginPath();
    for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) { const px = Math.round(X(gx)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
    for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) { const py = Math.round(Y(gy)) + 0.5; ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke();
  };
  if (S >= 14) gridPass(1, 'rgba(0,76,132,0.04)');
  gridPass(S >= 2 ? 5 : S >= 0.5 ? 50 : 100, 'rgba(0,76,132,0.09)');

  const chart = boat.chart;
  if (L.map && chart?.kind === 'harbour') {
    ctx.fillStyle = C['map-land']; ctx.strokeStyle = C['map-edge']; ctx.lineWidth = 1.25;
    for (const p of WORLD.land) { poly(p); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#e4e9ee';
    for (const p of WORLD.moored) { poly(p); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = C.text; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    for (const [bx, by] of WORLD.buoys) { ctx.beginPath(); ctx.arc(X(bx), Y(by), Math.max(4, 0.4 * S), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else if (L.map && chart?.kind === 'grid') {
    // one image pixel per cell; flip y so grid row 0 sits on the south edge
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(X(chart.x0), Y(chart.y0));
    ctx.scale(S * chart.res, -S * chart.res);
    ctx.drawImage(chart.image, 0, 0);
    ctx.restore();
    ctx.strokeStyle = C['map-edge']; ctx.lineWidth = 1;
    ctx.strokeRect(X(chart.x0), Y(chart.y0 + chart.rows * chart.res), chart.cols * chart.res * S, chart.rows * chart.res * S);
  }

  if (L.map && boat.objects.length) {
    ctx.font = '600 11px Montserrat, system-ui, sans-serif';
    for (const o of boat.objects) {
      ctx.fillStyle = C.text; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), Math.max(4, o.r * S), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (S >= 4) { ctx.fillStyle = C.muted; ctx.fillText(o.label, X(o.x) + Math.max(6, o.r * S + 4), Y(o.y) + 4); }
    }
  }

  if (L.ref && boat.route.length >= 4) {
    ctx.strokeStyle = C['map-route']; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    polyline(boat.route);
    if (boat.routeClosed) ctx.closePath();
    ctx.stroke(); ctx.setLineDash([]);
  }

  if (L.driven && boat.trail.length > 4) {
    // older history fades out
    const T = boat.trail, n = T.length / 2, chunk = 40;
    ctx.strokeStyle = C['map-track']; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let i = 0; i < n - 1; i += chunk) {
      ctx.globalAlpha = 0.3 + 0.7 * (i / n);
      ctx.beginPath(); ctx.moveTo(X(T[i * 2]), Y(T[i * 2 + 1]));
      for (let j = i + 1; j <= Math.min(i + chunk, n - 1); j++) ctx.lineTo(X(T[j * 2]), Y(T[j * 2 + 1]));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(X(T[T.length - 2]), Y(T[T.length - 1])); ctx.lineTo(X(boat.x), Y(boat.y)); ctx.stroke();
  }

  if (L.scan) {
    ctx.fillStyle = C['map-scan'];
    const sc = boat.scan, sz = clamp(S * 0.07, 1.5, 2.6);
    for (let i = 0; i < sc.length; i += 2) ctx.fillRect(X(sc[i]) - sz / 2, Y(sc[i + 1]) - sz / 2, sz, sz);
  }

  if (L.plan && boat.plan.length >= 4) {
    const Pl = boat.plan;
    ctx.strokeStyle = C.data; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    polyline(Pl);
    ctx.stroke(); ctx.lineCap = 'butt';
    const ex = X(Pl[Pl.length - 2]), ey = Y(Pl[Pl.length - 1]);
    ctx.fillStyle = C.data; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  if (boat.goal) {
    const gx = X(boat.goal.x), gy = Y(boat.goal.y);
    ctx.strokeStyle = C.data; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(gx, gy, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.data;
    ctx.beginPath(); ctx.arc(gx, gy, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  drawVessel(ctx, X(boat.x), Y(boat.y), S, boat.hdg);

  // scale bar
  const target = 90 / S, nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find(v => v >= target * 0.7) ?? 500;
  $('#scale-bar').style.width = `${nice * S}px`;
  $('#scale-label').textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
}

/** Own vessel: the two red hulls of the Float Forward mark, bow towards the heading. */
function drawVessel(ctx: CanvasRenderingContext2D, bx: number, by: number, S: number, hdg: number): void {
  const len = Math.max(28, 2.6 * S), beam = Math.max(13, 1.1 * S);
  ctx.save(); ctx.translate(bx, by); ctx.rotate(-hdg);
  ctx.fillStyle = 'rgba(0,76,132,0.08)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, Math.max(40, 6 * S), -0.6, 0.6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.text; ctx.lineWidth = Math.max(1.5, len * 0.06); ctx.lineCap = 'round';
  ctx.beginPath();
  for (const k of [-0.18, 0.18]) { ctx.moveTo(k * len, -beam / 2); ctx.lineTo(k * len, beam / 2); }
  ctx.stroke();
  const hw = (beam * 0.17) / 0.75;
  ctx.fillStyle = C.brand; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  for (const yc of [-beam / 2, beam / 2]) {
    ctx.beginPath();
    ctx.moveTo(len / 2, yc);
    ctx.bezierCurveTo(len / 4, yc - hw, -len / 4, yc - hw, -len / 2, yc);
    ctx.bezierCurveTo(-len / 4, yc + hw, len / 4, yc + hw, len / 2, yc);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

let mmAcc = 1;
function updateMapMetrics(dt: number, boat: Vessel, mode: Mode): void {
  mmAcc += dt;
  if (mmAcc < 0.2) return;
  mmAcc = 0;
  const sgn = (v: number) => (v >= 0 ? '+' : '−');
  const dash = '–';
  $('#mm-speed').textContent = `${(boat.v * MS_TO_KN).toFixed(1)} kn`;
  $('#mm-xte').textContent = boat.xte == null ? dash : `${sgn(boat.xte)}${Math.abs(boat.xte).toFixed(2)} m`;
  $('#mm-hdg').textContent = `${toCompass(boat.hdg).toFixed(0).padStart(3, '0')}°`;
  const hd = boat.headErr == null ? null : (boat.headErr * 180) / Math.PI;
  $('#mm-head').textContent = hd == null ? dash : `${sgn(hd)}${Math.abs(hd).toFixed(1)}°`;
  const prog = boat.progress == null ? null : Math.floor(boat.progress * 100);
  $('#mm-prog').textContent = prog == null ? dash : `${prog}%`;
  $('#mm-prog-label').textContent = boat.lap != null ? 'Lap progress' : 'Route progress';
  $('#h-map').textContent = mode === 'live' ? 'Navigation map' : 'Harbour map';

  const finding = $('#map-finding');
  if (boat.xte == null) {
    const mission = boat.mission ? ` Mission: ${boat.mission}.` : '';
    finding.textContent = `No route yet. Waiting for ${TOPICS.route}.${mission}`;
    return;
  }
  const side = boat.xte >= 0 ? 'port' : 'starboard', xte = Math.abs(boat.xte);
  const onLine = xte < XTE_LIMIT_M
    ? `On route, ${xte.toFixed(2)} m to ${side} of the line (limit ${XTE_LIMIT_M.toFixed(1)} m)`
    : `<span class="warn">Off route: ${xte.toFixed(2)} m to ${side}, over the ${XTE_LIMIT_M.toFixed(1)} m limit</span>`;
  const where = boat.lap != null ? `Lap ${boat.lap}, ${prog}% done.` : `${prog}% of the route done.`;
  const mission = boat.mission ? ` Mission: ${escapeHtml(boat.mission)}.` : '';
  finding.innerHTML = `${onLine}. ${where}${mission}`;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function frameMap(dt: number, boat: Vessel, mode: Mode, visible: boolean): void {
  current = boat;
  if (mode !== lastMode) {
    // the source changed: jump to the boat, because live and simulated positions are far apart
    if (lastMode !== null) { mapV.cx = boat.x; mapV.cy = boat.y; setFollow(true); }
    lastMode = mode;
    mmAcc = 1;
  }
  if (!visible) return;
  drawMap(boat);
  updateMapMetrics(dt, boat, mode);
}
