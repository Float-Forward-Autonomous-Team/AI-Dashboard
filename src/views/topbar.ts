/* Top bar: link state, GNSS fix, battery, clock. Also the "Simulated" chips on each view title. */
import { $, $$ } from '../core/dom';
import { POSE_STALE_MS, TOPICS } from '../config';
import { link, poseRate } from '../ros/rosSource';
import type { Mode } from '../source';
import type { Vessel } from '../vessel';

type Dot = 'live' | 'warn' | 'off';

function setLink(dot: Dot, label: string, detail: string, title: string): void {
  $('#st-dot').dataset.state = dot;
  $('#st-link').textContent = label;
  $('#st-ping').textContent = detail;
  $('#st-linkbox').title = title;
}

export function updateTopbar(mode: Mode, boat: Vessel): void {
  const now = Date.now();
  if (mode === 'live') {
    setLink('live', 'ROS live', `${poseRate(now).toFixed(0)} Hz`, `Live data from ${link.url}`);
  } else if (!link.enabled) {
    setLink('off', 'Simulation', '', 'Live data is off (?ws=off). Add ?ws=<bridge address> to the URL to connect.');
  } else if (link.state === 'connected') {
    const missing = !link.advertised.has(TOPICS.odometry);
    setLink('warn', 'Bridge connected', missing ? 'no pose topic' : 'no pose',
      missing
        ? `Connected to ${link.url}, but nothing publishes ${TOPICS.odometry}. Showing the simulation.`
        : `Connected to ${link.url}, but no pose for ${POSE_STALE_MS / 1000} s. Showing the simulation.`);
  } else {
    setLink('off', 'Simulation', 'no bridge', `No connection to ${link.url}. Retrying every 2 s. Showing the simulation.`);
  }

  // in live mode, show only what ROS sends: no topic means a dash, not a made-up value
  const gpsFresh = now - link.lastGpsMs < POSE_STALE_MS;
  $('#st-gnss').textContent = mode === 'live' ? (gpsFresh ? (boat.gnss ?? '–') : 'No data') : (boat.gnss ?? '–');
  const batt = boat.battery;
  $('#st-batt').textContent = batt == null ? '–' : `${Math.round(batt)}%`;
  $('#st-batt-fill').setAttribute('width', String(((batt ?? 0) / 100) * 14));
  $('#st-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // which views show simulated data
  $$('[data-sim-chip]').forEach(chip => {
    chip.hidden = chip.dataset.simChip === 'map' && mode === 'live';
  });
}
