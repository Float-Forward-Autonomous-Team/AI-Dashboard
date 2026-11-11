/*
 * Where the dashboard gets live data, and which ROS topics it reads.
 *
 * Bridge address: add ?ws=<address> to the page URL once; the page remembers it.
 *   ?ws=ws://localhost:8765      simulator or mock bridge on this computer (the default)
 *   ?ws=ws://192.168.1.50:8765   Jetson on the same Wi-Fi / radio network
 *   ?ws=ws://jetson:8765         Jetson through a VPN such as Tailscale
 *   ?ws=off                      never connect; show the simulation only
 */

const STORAGE_KEY = 'usv.bridgeUrl';
const DEFAULT_URL = 'ws://localhost:8765';

/** The bridge address to use, or null when the live connection is switched off. */
export function bridgeUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('ws');
  if (fromQuery !== null) {
    try { localStorage.setItem(STORAGE_KEY, fromQuery); } catch { /* private mode: use it for this visit only */ }
  }
  let url = fromQuery;
  if (url === null) {
    try { url = localStorage.getItem(STORAGE_KEY); } catch { url = null; }
  }
  url = url?.trim() || DEFAULT_URL;
  return url === 'off' ? null : url;
}

/**
 * Topic names, from float_forward branch feature/foxglove-bridge (navigation stack),
 * as listed in its documentation/NAVIGATION_INPUTS.md.
 * In simulation, sim_truth publishes /localization/odometry; on the real boat a
 * localization node must publish the same name and type.
 */
export const TOPICS = {
  odometry: '/localization/odometry',               // nav_msgs/Odometry, frame "map"
  scan: '/wamv/sensors/lidars/lidar_wamv_sensor/scan', // sensor_msgs/LaserScan
  route: '/planning/global_path',                   // nav_msgs/Path, global planner route
  spline: '/planning/smoothed_path',                // nav_msgs/Path, smoothed route from guidance
  grid: '/world_model/static_map',                  // nav_msgs/OccupancyGrid, latched
  objects: '/world_model/moving_objects',           // boat_interfaces/TrackedObjectArray
  landmarks: '/world_model/landmarks',              // boat_interfaces/TrackedObjectArray, latched
  goal: '/mission/goal',                            // geometry_msgs/PoseStamped
  missionState: '/mission/state',                   // std_msgs/String
  gps: '/wamv/sensors/gps/gps/fix',                 // sensor_msgs/NavSatFix
} as const;

/** With no pose for this long, the dashboard goes back to the simulation. */
export const POSE_STALE_MS = 3000;
