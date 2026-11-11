/*
 * USV-01 dashboard. Live data from ROS 2 through foxglove_bridge when it is available,
 * otherwise a simulation. See src/config.ts for the bridge address and the topics.
 */
import { $$ } from './core/dom';
import { bridgeUrl } from './config';
import { startRos } from './ros/rosSource';
import { stepSim } from './sim/sim';
import { activeVessel, mode } from './source';
import { frameCameras, initCameras } from './views/cameras';
import { frameMap, initMap } from './views/map';
import { initPerf, renderPerf } from './views/perf';
import { updateTopbar } from './views/topbar';

/* ───────── Tabs ───────── */
const VIEWS = ['cameras', 'map', 'perf'] as const;
type View = (typeof VIEWS)[number];
let view: View = 'cameras';

function setView(name: string): void {
  view = (VIEWS as readonly string[]).includes(name) ? (name as View) : 'cameras';
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.target === view)));
  history.replaceState(null, '', location.search + '#' + view);
  if (view === 'perf') renderPerf();
}
$$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.target ?? 'cameras')));
addEventListener('keydown', e => {
  const target = ({ 1: 'cameras', 2: 'map', 3: 'perf' } as Record<string, View>)[e.key];
  if (target) setView(target);
});

/* ───────── Start ───────── */
initCameras();
initMap();
initPerf(() => view === 'perf');

const url = bridgeUrl();
if (url) startRos(url);

const refreshTopbar = () => { const m = mode(); updateTopbar(m, activeVessel(m)); };
refreshTopbar();
setInterval(refreshTopbar, 1000);

/* ───────── Main loop ───────── */
let lastT = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  stepSim(dt); // always runs, so the dashboard can fall back to it at once
  const m = mode(), boat = activeVessel(m);
  frameCameras(dt, boat, view === 'cameras');
  frameMap(dt, boat, m, view === 'map');
  requestAnimationFrame(frame);
}

setView(location.hash.slice(1).split('?')[0]);
requestAnimationFrame(frame);
