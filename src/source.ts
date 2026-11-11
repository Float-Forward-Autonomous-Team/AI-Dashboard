/*
 * Which vessel state the views show: live ROS data while poses arrive, else the simulation.
 * The cameras and the performance view are always simulated for now (no topics yet).
 */
import { POSE_STALE_MS } from './config';
import { link, rosVessel } from './ros/rosSource';
import { simVessel } from './sim/sim';
import type { Vessel } from './vessel';

export type Mode = 'live' | 'sim';

export function mode(now = Date.now()): Mode {
  return link.state === 'connected' && now - link.lastPoseMs < POSE_STALE_MS ? 'live' : 'sim';
}

export function activeVessel(m: Mode = mode()): Vessel {
  return m === 'live' ? rosVessel : simVessel;
}
