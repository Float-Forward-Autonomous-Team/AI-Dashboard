export const MS_TO_KN = 1.94384;

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const rand = (a = 0, b = 1): number => a + Math.random() * (b - a);
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Repeatable pseudo-random value in [0, 1) for an integer seed. */
export const hash = (i: number): number => {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

/** Math angle (+x, counter-clockwise, rad) → compass degrees (from north, clockwise). */
export const toCompass = (a: number): number => (((90 - (a * 180) / Math.PI) % 360) + 360) % 360;

export interface Quaternion { x: number; y: number; z: number; w: number }

/** ROS quaternion (ENU) → roll, pitch, yaw in rad. Yaw is a math angle: 0 = east, counter-clockwise. */
export function quatToEuler({ x, y, z, w }: Quaternion): { roll: number; pitch: number; yaw: number } {
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { roll, pitch, yaw };
}
