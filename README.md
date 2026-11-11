# USV-01 dashboard

Shore dashboard for the Float Forward autonomous boat. It shows live ROS 2 data from the boat
through `foxglove_bridge`. When no live data is available, it shows a simulation.

## Run

```bash
npm install        # first time only
npm run dev        # dashboard on http://localhost:5173
```

To test with live data, you need a bridge on port 8765. Use one of these:

| Bridge | Command |
|---|---|
| Mock bridge (no ROS, no Docker) | `npm run mock` |
| VRX simulator | in `float_forward` (branch `feature/foxglove-bridge`), see below |
| Real boat | `foxglove_bridge` on the Jetson |

### VRX simulator

In `float_forward`, on branch `feature/foxglove-bridge`:

```bash
make build && make down && make colcon     # first time only: installs foxglove_bridge
make vrx-nav WORLD=wayfinding_task         # terminal 1: the simulator
make sh                                    # terminal 2:
ros2 launch boat navigation_demo.launch.py
make sh                                    # terminal 3:
ros2 launch foxglove_bridge foxglove_bridge_launch.xml
```

## Bridge address

The dashboard does not run on the boat. It connects across the network to the bridge on the Jetson.
Add `?ws=<address>` to the URL one time. The page remembers it.

| Connection | URL |
|---|---|
| Simulator or mock on this computer (default) | `http://localhost:5173/?ws=ws://localhost:8765` |
| Jetson on the same Wi-Fi or radio network | `http://localhost:5173/?ws=ws://192.168.1.50:8765` |
| Jetson through a VPN (for example Tailscale) | `http://localhost:5173/?ws=ws://jetson:8765` |
| Simulation only, no connection | `http://localhost:5173/?ws=off` |

If the page comes from an `https://` address, the browser blocks `ws://`. Then you must use `wss://`.

## Status in the top bar

| Status | Meaning |
|---|---|
| **ROS live**, green, with the pose rate | Poses arrive from ROS. The map shows live data. |
| **Bridge connected**, amber | The bridge is connected, but no pose came in the last 3 s. The map shows the simulation. |
| **Simulation**, grey | No bridge. The dashboard tries again every 2 s. |

A **Simulated** chip next to a view title means that the view shows made-up data.

## What is live and what is simulated

| View | Data |
|---|---|
| Map | Live from ROS (topics below) |
| Top bar: link, GNSS fix | Live from ROS |
| Top bar: battery | No topic yet: shows "–" in live mode |
| Cameras | Simulated: no compressed camera topic yet. The feeds follow the live heading, speed and roll. |
| Performance | Simulated: no topic yet |

## Topics

All topic names are in [src/config.ts](src/config.ts).

| Map part | Topic | Type |
|---|---|---|
| Boat position, heading, speed | `/localization/odometry` | `nav_msgs/Odometry` |
| Lidar scan | `/wamv/sensors/lidars/lidar_wamv_sensor/scan` | `sensor_msgs/LaserScan` |
| Route (dashed) | `/planning/global_path` | `nav_msgs/Path` |
| Planned (solid) | `/planning/smoothed_path` | `nav_msgs/Path` |
| Chart | `/world_model/static_map` | `nav_msgs/OccupancyGrid` |
| Objects | `/world_model/moving_objects`, `/world_model/landmarks` | `boat_interfaces/TrackedObjectArray` |
| Goal | `/mission/goal` | `geometry_msgs/PoseStamped` |
| Mission text | `/mission/state` | `std_msgs/String` |
| GNSS fix | `/wamv/sensors/gps/gps/fix` | `sensor_msgs/NavSatFix` |

These topics are on the `feature/foxglove-bridge` branch of `float_forward` (the navigation stack,
see its `documentation/NAVIGATION_INPUTS.md`). In simulation, `sim_truth` publishes `/localization/odometry`.
On the real boat, a localization node must publish the same topic.

## Known simplifications

- The lidar scan is drawn as if the lidar is at the boat origin, level. It does not use `/tf`.
- The occupancy grid is drawn as if its origin is not rotated.
- The occupancy grid (`/world_model/static_map`) can be large. It is sent only when it changes.

## Code

```
src/
  main.ts            tabs, start-up, frame loop
  config.ts          bridge address and topic names
  source.ts          live or simulation: which vessel state the views show
  vessel.ts          the vessel state that the views draw
  ros/bridge.ts      WebSocket connection to foxglove_bridge (from float_forward/live/bridge.js)
  ros/rosSource.ts   one handler per topic; writes the ROS vessel state
  ros/messages.ts    fields of the ROS messages in use
  ros/track.ts       cross-track error, heading error, progress
  sim/               simulated harbour and vessel
  views/             cameras, map, performance, top bar
tools/
  mock-bridge.ts     mock foxglove_bridge for tests
```
