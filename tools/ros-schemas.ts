/*
 * ROS 2 message definitions for the mock bridge, in the "ros2msg" text format that
 * foxglove_bridge sends: the main type first, then each dependency after a separator line.
 */

const DEFS: Record<string, string> = {
  'builtin_interfaces/Time': 'int32 sec\nuint32 nanosec',
  'std_msgs/Header': 'builtin_interfaces/Time stamp\nstring frame_id',
  'std_msgs/String': 'string data',
  'geometry_msgs/Point': 'float64 x\nfloat64 y\nfloat64 z',
  'geometry_msgs/Quaternion': 'float64 x\nfloat64 y\nfloat64 z\nfloat64 w',
  'geometry_msgs/Vector3': 'float64 x\nfloat64 y\nfloat64 z',
  'geometry_msgs/Pose': 'geometry_msgs/Point position\ngeometry_msgs/Quaternion orientation',
  'geometry_msgs/PoseStamped': 'std_msgs/Header header\ngeometry_msgs/Pose pose',
  'geometry_msgs/PoseWithCovariance': 'geometry_msgs/Pose pose\nfloat64[36] covariance',
  'geometry_msgs/Twist': 'geometry_msgs/Vector3 linear\ngeometry_msgs/Vector3 angular',
  'geometry_msgs/TwistWithCovariance': 'geometry_msgs/Twist twist\nfloat64[36] covariance',
  'nav_msgs/Odometry':
    'std_msgs/Header header\nstring child_frame_id\ngeometry_msgs/PoseWithCovariance pose\ngeometry_msgs/TwistWithCovariance twist',
  'nav_msgs/Path': 'std_msgs/Header header\ngeometry_msgs/PoseStamped[] poses',
  'nav_msgs/MapMetaData':
    'builtin_interfaces/Time map_load_time\nfloat32 resolution\nuint32 width\nuint32 height\ngeometry_msgs/Pose origin',
  'nav_msgs/OccupancyGrid': 'std_msgs/Header header\nnav_msgs/MapMetaData info\nint8[] data',
  'sensor_msgs/LaserScan':
    'std_msgs/Header header\nfloat32 angle_min\nfloat32 angle_max\nfloat32 angle_increment\nfloat32 time_increment\n' +
    'float32 scan_time\nfloat32 range_min\nfloat32 range_max\nfloat32[] ranges\nfloat32[] intensities',
  'sensor_msgs/NavSatStatus': 'int8 status\nuint16 service',
  'sensor_msgs/NavSatFix':
    'std_msgs/Header header\nsensor_msgs/NavSatStatus status\nfloat64 latitude\nfloat64 longitude\nfloat64 altitude\n' +
    'float64[9] position_covariance\nuint8 position_covariance_type',
  'boat_interfaces/TrackedObject':
    'string id\nstring classification\ngeometry_msgs/Pose pose\ngeometry_msgs/Twist twist\nfloat32 radius_m',
  'boat_interfaces/TrackedObjectArray': 'std_msgs/Header header\nboat_interfaces/TrackedObject[] objects',
};

const SEPARATOR = '='.repeat(80);

/** Full definition text of `type`, with all the types it uses. */
export function schemaFor(type: string): string {
  const order: string[] = [];
  const visit = (t: string) => {
    if (order.includes(t)) return;
    const def = DEFS[t];
    if (!def) throw new Error(`No definition for ${t}`);
    order.push(t);
    for (const line of def.split('\n')) {
      const fieldType = line.split(' ')[0].replace(/\[\d*\]$/, '');
      if (fieldType.includes('/')) visit(fieldType);
    }
  };
  visit(type);
  const [main, ...deps] = order;
  return [DEFS[main], ...deps.map(t => `${SEPARATOR}\nMSG: ${t}\n${DEFS[t]}`)].join('\n');
}
