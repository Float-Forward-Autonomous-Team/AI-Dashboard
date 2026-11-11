/*
 * View 3, model performance. Simulated: no ROS topic has these figures yet.
 * A node on the Jetson must publish them (for example diagnostic_msgs/DiagnosticArray from tegrastats).
 */
import { $, segmented, setPressed } from '../core/dom';
import { C } from '../core/canvas';
import { clamp, rand } from '../core/math';

const perf = {
  dt: 0.25, max: 3600, t: 0, range: 60, temp: 64,
  pre: [] as number[], inf: [] as number[], post: [] as number[], e2e: [] as number[], gpu: [] as number[],
};

function perfSample(): void {
  const t = (perf.t += perf.dt);
  const spike = Math.random() < 0.015 ? rand(8, 16) : 0;
  const inf = 17.5 + 2.2 * Math.sin(t / 23) + 1.2 * Math.sin(t / 3.1) + rand(-1, 1.2) + spike;
  const pre = 2.9 + rand(0, 0.6), post = 2.2 + rand(0, 0.8) + spike * 0.1;
  const gpu = clamp(48 + inf * 1.4 + rand(-4, 4), 0, 100);
  perf.temp += (60 + gpu * 0.1 - perf.temp) * 0.02;
  const push = (arr: number[], v: number) => { arr.push(v); if (arr.length > perf.max) arr.shift(); };
  push(perf.pre, pre); push(perf.inf, inf); push(perf.post, post); push(perf.gpu, gpu);
  push(perf.e2e, pre + inf + post + rand(5.5, 8));
}

const pct = (arr: number[], p: number): number => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;
const fmtSpan = (sec: number): string => (sec >= 120 ? `${+(sec / 60).toFixed(1)}m` : `${Math.round(sec)}s`);
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v || 1));
  return [1, 2, 4, 6, 8, 10].map(m => m * p).find(x => x >= v) ?? 10 * p;
}

interface ChartOpts { color: string; unit: string; yMax?: number; ref?: number; refLabel?: string; fmt?: (v: number) => string }
interface LineChart { update(values: number[], dt: number): void; redraw(): void }

function lineChart(el: HTMLElement, { color, unit, yMax, ref, refLabel, fmt = v => v.toFixed(1) }: ChartOpts): LineChart {
  el.innerHTML = '<svg aria-hidden="true"></svg><div class="tip" hidden></div>';
  const svg = el.firstChild as SVGSVGElement, tip = el.lastChild as HTMLElement;
  let hover: number | null = null, last: { values: number[]; dt: number } | null = null;
  const onMove = (e: PointerEvent) => { hover = e.clientX - svg.getBoundingClientRect().left; draw(); };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerdown', onMove);
  svg.addEventListener('pointerleave', () => { hover = null; draw(); });

  function draw(): void {
    if (!last) return;
    const { values, dt } = last, W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const m = { l: 32, r: 64, t: 12, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b;

    // bucket to about 1 point per 2 px
    const nb = Math.max(2, Math.min(values.length, Math.floor(pw / 2))), per = values.length / nb, pts: number[] = [];
    for (let i = 0; i < nb; i++) {
      const a = Math.floor(i * per), b = Math.max(a + 1, Math.floor((i + 1) * per));
      let s = 0; for (let j = a; j < b; j++) s += values[j];
      pts.push(s / (b - a));
    }
    const vmax = yMax ?? niceMax(Math.max(...pts, ref || 0) * 1.12);
    const x = (i: number) => m.l + (i / (nb - 1)) * pw, y = (v: number) => m.t + ph - (v / vmax) * ph;
    let s = '';
    for (let k = 0; k <= 4; k++) {
      const v = (vmax * k) / 4, yy = y(v).toFixed(1);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="${k ? 'grid' : 'axis'}"/>`;
      s += `<text x="${m.l - 6}" y="${+yy + 4}" class="tick" text-anchor="end">${+v.toFixed(1)}</text>`;
    }
    const span = values.length * dt;
    s += `<text x="${m.l}" y="${H - 4}" class="tick">−${fmtSpan(span)}</text>`;
    s += `<text x="${m.l + pw / 2}" y="${H - 4}" class="tick" text-anchor="middle">−${fmtSpan(span / 2)}</text>`;
    s += `<text x="${W - m.r}" y="${H - 4}" class="tick" text-anchor="end">now</text>`;
    if (ref != null) {
      const yy = y(ref).toFixed(1);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="ref"/>`;
      s += `<text x="${W - m.r + 8}" y="${+yy + 4}" class="ref-label">${refLabel ?? ''}</text>`;
    }
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

    if (hover != null && hover >= m.l - 8 && hover <= W - m.r + 8) {
      const i = clamp(Math.round(((hover - m.l) / pw) * (nb - 1)), 0, nb - 1), xx = x(i), yy = y(pts[i]);
      s += `<line x1="${xx}" x2="${xx}" y1="${m.t}" y2="${m.t + ph}" class="cross"/>`;
      s += `<circle cx="${xx}" cy="${yy}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="2"/>`;
      const ago = (1 - i / (nb - 1)) * span;
      tip.innerHTML = `<span>${ago < 1 ? 'now' : fmtSpan(ago) + ' ago'}</span><b>${fmt(pts[i])} ${unit}</b>`;
      tip.style.left = `${clamp(xx, 50, W - 50)}px`;
      tip.style.top = `${yy}px`;
      tip.hidden = false;
    } else tip.hidden = true;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
  }
  return { update(values, dt) { last = { values, dt }; draw(); }, redraw: draw };
}

const PILL = { good: 'pill-positive', warning: 'pill-warning', idle: 'pill-neutral' } as const;
type PillKind = keyof typeof PILL;
const statusPill = (kind: PillKind, label: string): string => `<span class="pill ${PILL[kind]}">${label}</span>`;

const METERS = [
  { key: 'gpu', label: 'GPU', total: 100, unit: '%' },
  { key: 'vram', label: 'VRAM', total: 12, unit: 'GB' },
  { key: 'cpu', label: 'CPU', total: 100, unit: '%' },
  { key: 'ram', label: 'RAM', total: 32, unit: 'GB' },
] as const;

const MODELS: { name: string; rt: string; input: string; base: number | null; status: [PillKind, string] }[] = [
  { name: 'Object detector (vessels, buoys, people)', rt: 'TensorRT FP16', input: '640×640', base: null, status: ['good', 'Running'] },
  { name: 'Water / sky / land segmentation', rt: 'TensorRT FP16', input: '512×512', base: 9.2, status: ['good', 'Running'] },
  { name: 'Monocular depth', rt: 'ONNX Runtime CUDA', input: '384×384', base: 14.8, status: ['warning', 'Throttled'] },
  { name: 'Lidar clustering', rt: 'CPU · C++', input: '720 pts', base: 5.1, status: ['good', 'Running'] },
  { name: 'Planner (COLREGs)', rt: 'CPU · C++', input: '—', base: 2.6, status: ['good', 'Running'] },
  { name: 'Re-ID tracker', rt: 'TensorRT FP16', input: '128×256', base: 3.4, status: ['idle', 'Standby'] },
];

let chLat: LineChart, chGpu: LineChart;

export function renderPerf(): void {
  const n = Math.round(perf.range / perf.dt);
  const W = (arr: number[]) => arr.slice(-n);
  const inf = W(perf.inf), pre = W(perf.pre), post = W(perf.post), e2e = W(perf.e2e), gpu = W(perf.gpu);

  const p50 = pct(inf, 0.5), p95 = pct(inf, 0.95);
  $('#k-p50').textContent = p50.toFixed(1);
  $('#k-p95').textContent = `p95 ${p95.toFixed(1)} ms`;
  const mPre = mean(pre), mInf = mean(inf), mPost = mean(post);
  $('#k-fps').textContent = (1000 / (mPre + mInf + mPost)).toFixed(0);
  $('#k-e2e').textContent = mean(e2e).toFixed(1);
  const BUDGET = 33.3, miss = e2e.filter(v => v > BUDGET).length, missShare = miss / e2e.length;
  const span = perf.range >= 60 ? `${perf.range / 60} min` : `${perf.range} s`;
  $('#k-miss').textContent = miss.toLocaleString('en');
  const missSub = $('#k-miss-sub');
  missSub.textContent = `${(missShare * 100).toFixed(1)}% of frames, last ${span}`;
  missSub.classList.toggle('warn', missShare > 0.05);
  const g = gpu[gpu.length - 1];
  $('#k-gpu').textContent = mean(gpu).toFixed(0);
  const vram = 5.4 + g * 0.012;
  $('#k-vram').textContent = `VRAM ${vram.toFixed(1)} / 12 GB`;
  $('#k-temp').textContent = perf.temp.toFixed(0);
  const temp = $('#k-temp-status');
  temp.textContent = perf.temp > 80 ? 'Hot, throttles at 83 °C' : 'Normal, throttles at 83 °C';
  temp.classList.toggle('warn', perf.temp > 80);

  chLat.update(inf, perf.dt);
  chGpu.update(gpu, perf.dt);

  // stacked bar, scaled to the 33 ms frame budget; the total is the sum of the parts as shown
  const shown = [mPre, mInf, mPost].map(v => +v.toFixed(1)), total = shown.reduce((a, b) => a + b, 0);
  const stages = { pre: mPre, inf: mInf, post: mPost };
  for (const [k, v] of Object.entries(stages)) {
    const el = $(`.stk[data-stage="${k}"]`);
    el.style.width = `${(v / BUDGET) * 100}%`;
    el.title = `${k}: ${v.toFixed(1)} ms`;
    $(`#lg-${k}`).textContent = `${v.toFixed(1)} ms`;
  }
  const share = Math.round((total / BUDGET) * 100);
  $('#lg-total').textContent = `${total.toFixed(1)} ms · ${share}%`;
  $('#models-meta').textContent = `last ${span}`;
  const finding = $('#perf-finding');
  finding.innerHTML = total <= BUDGET
    ? `Keeping up on average: ${total.toFixed(1)} of ${BUDGET} ms per frame used. ${miss.toLocaleString('en')} frames (${(missShare * 100).toFixed(1)}%) ran over in the last ${span}.`
    : `<span class="warn">Falling behind: ${total.toFixed(1)} ms per frame, over the ${BUDGET} ms budget.</span>`;

  const cur: Record<string, number> = { gpu: g, vram, cpu: 31 + Math.sin(perf.t / 7) * 6 + rand(-2, 2), ram: 9.1 + Math.sin(perf.t / 40) * 0.4 };
  for (const m of METERS) {
    const v = cur[m.key];
    $(`[data-m="${m.key}"]`).textContent = m.unit === '%' ? `${v.toFixed(0)}%` : `${v.toFixed(1)} / ${m.total} ${m.unit}`;
    $(`[data-mf="${m.key}"]`).style.width = `${(v / m.total) * 100}%`;
  }

  $('#models').innerHTML = MODELS.map(md => {
    const idle = md.status[0] === 'idle';
    const a = md.base == null ? p50 : md.base * (1 + rand(-0.04, 0.04));
    const b = md.base == null ? p95 : a * (md.status[0] === 'warning' ? 1.9 : 1.3);
    const cells = idle ? ['—', '—', '—'] : [a.toFixed(1), b.toFixed(1), Math.min(30, 1000 / a).toFixed(0)];
    return `<tr><td>${md.name}</td><td>${md.rt}</td><td>${md.input}</td>
      <td class="num">${cells[0]}</td><td class="num">${cells[1]}</td><td class="num">${cells[2]}</td>
      <td class="col-status">${statusPill(...md.status)}</td></tr>`;
  }).join('');
}

export function initPerf(isVisible: () => boolean): void {
  for (let i = 0; i < perf.max; i++) perfSample(); // prefill history

  segmented($('#perf-range'), b => {
    perf.range = Number(b.dataset.range);
    setPressed($('#perf-range'), 'range', b.dataset.range ?? '60');
    renderPerf();
  });

  chLat = lineChart($('#ch-lat'), { color: C.data, unit: 'ms', ref: 25, refLabel: 'target 25' });
  chGpu = lineChart($('#ch-gpu'), { color: C.data, unit: '%', yMax: 100, fmt: v => v.toFixed(0) });
  addEventListener('resize', () => { if (isVisible()) { chLat.redraw(); chGpu.redraw(); } });

  $('#meters').innerHTML = METERS.map(m =>
    `<div class="meter"><div class="meter-top"><span>${m.label}</span><b data-m="${m.key}">–</b></div>
     <div class="meter-track"><div class="meter-fill" data-mf="${m.key}" style="width:0"></div></div></div>`).join('');

  setInterval(() => {
    perfSample();
    if (isVisible()) renderPerf();
  }, perf.dt * 1000);
}
