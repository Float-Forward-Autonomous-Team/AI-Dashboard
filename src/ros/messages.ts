/*
 * The fields of the ROS 2 messages that the dashboard reads, as the decoder returns them.
 * Only the fields in use are listed. See `ros2 interface show <type>` for the full messages.
 */
import type { Quaternion } from '../core/math';

export interface Time { sec: number; nanosec: number }
export interface Header { stamp: Time; frame_id: string }
export interface Vector3 { x: number; y: number; z: number }
export interface Pose { position: Vector3; orientation: Quaternion }
export interface Twist { linear: Vector3; angular: Vector3 }

/** nav_msgs/Odometry. Pose in header.frame_id ("map"); twist in child_frame_id (the boat). */
export interface Odometry {
  header: Header;
  child_frame_id: string;
  pose: { pose: Pose };
  twist: { twist: Twist };
}

/** geometry_msgs/PoseStamped */
export interface PoseStamped { header: Header; pose: Pose }

/** nav_msgs/Path */
export interface Path { header: Header; poses: PoseStamped[] }

/** nav_msgs/OccupancyGrid. data: row-major from the origin, -1 unknown, 0 free … 100 occupied. */
export interface OccupancyGrid {
  header: Header;
  info: { resolution: number; width: number; height: number; origin: Pose };
  data: Int8Array | number[];
}

/** sensor_msgs/LaserScan */
export interface LaserScan {
  header: Header;
  angle_min: number;
  angle_increment: number;
  range_min: number;
  range_max: number;
  ranges: Float32Array | number[];
}

/** sensor_msgs/NavSatFix. status.status: -1 no fix, 0 fix, 1 SBAS fix, 2 GBAS fix (RTK). */
export interface NavSatFix {
  header: Header;
  status: { status: number; service: number };
  latitude: number;
  longitude: number;
}

/** boat_interfaces/TrackedObjectArray (float_forward, guidance branch) */
export interface TrackedObjectArray {
  header: Header;
  objects: { id: string; classification: string; pose: Pose; twist: Twist; radius_m: number }[];
}

/** std_msgs/String */
export interface StringMsg { data: string }
