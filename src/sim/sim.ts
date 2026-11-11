/* Simulated vessel: drives laps of the harbour route, pushed off the line by wind and current. */
import { wrapAngle } from '../core/math';
import { createVessel, pushTrail } from '../vessel';
import { PATH, ROUTE, castScan, refPt, refTan } from './harbour';

export const simVessel = createVessel();
simVessel.chart = { kind: 'harbour' };
simVessel.route = ROUTE;
simVessel.routeClosed = true;
simVessel.gnss = 'RTK fix';
simVessel.battery = 78;
simVessel.lap = 1;

const sim = { t: 0, s: 0, laps: 0, trailAcc: 0, scanAcc: 1 };

{ // start on course at cruising speed
  const p0 = refPt(0), t0 = refTan(0), off0 = 0.2 * Math.sin(1), b = simVessel;
  b.x = p0.x - t0.y * off0; b.y = p0.y + t0.x * off0;
  b.cog = b.hdg = Math.atan2(t0.y, t0.x); b.v = 1.6;
}

export function stepSim(dt: number): void {
  const b = simVessel;
  sim.t += dt;
  const prevS = sim.s;
  sim.s += (1.6 + 0.2 * Math.sin(sim.t * 0.2)) * dt;
  if (Math.floor(sim.s / PATH.len) > Math.floor(prevS / PATH.len)) sim.laps++;

  // wind + current push the boat off the route; + = to port of the line
  const p = refPt(sim.s), tn = refTan(sim.s);
  const off = 0.6 * Math.sin(sim.t * 0.35) + 0.2 * Math.sin(sim.t * 1.3 + 1);
  const px = b.x, py = b.y;
  b.x = p.x - tn.y * off;
  b.y = p.y + tn.x * off;
  const mdx = b.x - px, mdy = b.y - py;
  if (dt > 0 && (mdx || mdy)) {
    b.cog += wrapAngle(Math.atan2(mdy, mdx) - b.cog) * 0.25;
    b.v += (Math.hypot(mdx, mdy) / dt - b.v) * 0.1;
  }
  const crab = 0.05 + 0.04 * Math.sin(sim.t * 0.13); // bow points slightly into the current
  b.hdg = b.cog + crab;
  b.roll = 0.05 * Math.sin(sim.t * 0.9) + 0.025 * Math.sin(sim.t * 1.7 + 0.5);
  b.pitch = 0.015 * Math.sin(sim.t * 1.1 + 0.3);

  b.xte = off;
  b.headErr = wrapAngle(b.hdg - Math.atan2(tn.y, tn.x));
  b.progress = (sim.s % PATH.len) / PATH.len;
  b.lap = sim.laps + 1;
  b.battery = Math.max(5, (b.battery ?? 78) - 0.01 * dt);

  sim.trailAcc += dt;
  if (sim.trailAcc > 0.15) { sim.trailAcc = 0; pushTrail(b, b.x, b.y); }

  // local plan: converges from the current offset back onto the route over about 8 m
  const N = 30;
  b.plan.length = 0;
  for (let k = 0; k <= N; k++) {
    const sk = sim.s + k * 0.27, q = refPt(sk), qt = refTan(sk), f = off * (1 - k / N) ** 2;
    b.plan.push(q.x - qt.y * f, q.y + qt.x * f);
  }

  sim.scanAcc += dt;
  if (sim.scanAcc >= 0.1) { sim.scanAcc = 0; b.scan = castScan(b.x, b.y); } // 10 Hz lidar
}
