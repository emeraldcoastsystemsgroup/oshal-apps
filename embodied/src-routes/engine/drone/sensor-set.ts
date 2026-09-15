/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the drone's SENSOR SET as data, so the sim can
 *                     |                             | judge the drone we can print against the drone we could buy.
 *                     |                             | `recon-3d`: a 64-ring spinning LiDAR (Mid-360 class, ~265 g) on
 *                     |                             | an 8 cm mast, full 4-DOF registration. `recon-mini`: a single
 *                     |                             | 2-D ring (LD19 class, ~47 g, 450 points/rev, 12 m) whose scan
 *                     |                             | plane IS the flight plane, a downward ToF depth camera for the
 *                     |                             | height map, a nadir ranger for altitude, planar (x, y, yaw)
 *                     |                             | registration with z from the ranger, one altitude per mission.
 *                     |                             | Both carry the zenith ranger that clears the climb.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The pad plate lifts the body on the ground (`padPlateM`) and the downward sensors hang `underDropM` below the reference — on the pad they must sit above the floor, not inside it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Each set says what its exploration chases: unknown air in the flight layer, or columns whose top the downward camera has not seen.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A set may fix its own mission altitude: the ring flies 20 cm under the ceiling so tall appliances sit below its clearance band instead of inside it.
 */

import { DEFAULT_LIDAR, DRONE_LIDAR, type LidarOptions } from '../sense/raycast';

/** @description The two drones the design documents describe. */
export type DroneSensorSetId = 'recon-3d' | 'recon-mini';

/** @description A downward depth camera: field of view, range, and the pixel stride the sim renders at. */
export interface DepthCameraSpec {
  fovHDeg: number;
  fovVDeg: number;
  maxRange: number;
  stride: number;
}

/** @description Everything the sim needs to know about what the drone carries. */
export interface DroneSensorSet {
  id: DroneSensorSetId;
  label: string;
  /** Sensor height above the body reference IN FLIGHT. Zero means the scan plane is the flight plane. */
  mastM: number;
  /** Sensor height above the body reference ON THE GROUND — the body sits on a pad plate; a sensor at floor level sees only the floor it touches. */
  groundMastM: number;
  /** How high the body reference sits above the floor when landed (the printed pad plate). Every sensor rides up with it. */
  padPlateM: number;
  /** How far under the body reference the downward sensors (depth camera, nadir ranger) hang. */
  underDropM: number;
  lidar: LidarOptions;
  depthCamera: DepthCameraSpec | null;
  /** A single downward ray that reads altitude over the floor. */
  nadirRangerM: number | null;
  /** `full` solves x, y, z and yaw from the sweep; `planar` solves x, y and yaw and takes z from the nadir ranger — a ring's normals are all horizontal, so z is unobservable from it. */
  registration: 'full' | 'planar';
  /** What exploration chases: unknown AIR in the flight layer (a 3-D sensor fills the volume as it goes) or columns whose TOP has not been seen (a ring sees the whole layer from afar; only the downward camera learns what is below). */
  frontier: 'layer' | 'tops';
  /** Approximate mass of the sensing, for the design documents. */
  sensingMassG: number;
  /** The altitude this set flies its missions at, when it must differ from the drone's default: a ring must clear the tallest furniture by more than the clearance band, because it cannot see what is just under its plane. */
  cruiseAltM?: number;
}

/** @description The sensor set the sim assumed through 0.4.0: what you buy, not what you print. */
export const RECON_3D: DroneSensorSet = {
  id: 'recon-3d',
  label: '3-D spinning LiDAR (Mid-360 class) + zenith ranger',
  mastM: 0.08,
  groundMastM: 0.08,
  padPlateM: 0,
  underDropM: 0.03,
  lidar: DRONE_LIDAR,
  depthCamera: null,
  nadirRangerM: null,
  registration: 'full',
  frontier: 'layer',
  sensingMassG: 275,
};

/** @description The drone we print: a 2-D ring in the flight plane, a downward ToF depth camera, zenith and nadir rangers. */
export const RECON_MINI: DroneSensorSet = {
  id: 'recon-mini',
  label: '2-D ring (LD19 class) + downward ToF depth camera + zenith/nadir rangers — the printed drone',
  mastM: 0,
  groundMastM: 0,
  padPlateM: 0.03,
  underDropM: 0.02,
  lidar: { ...DEFAULT_LIDAR, azimuthCount: 450, elevationsDeg: [0], maxRange: 12, zenith: { rays: 8, coneDeg: 10, maxRange: 4 } },
  depthCamera: { fovHDeg: 70, fovVDeg: 50, maxRange: 4, stride: 4 },
  nadirRangerM: 8,
  registration: 'planar',
  frontier: 'tops',
  sensingMassG: 84,
  cruiseAltM: 2.075,
};

/** @description Every set by id. */
export const DRONE_SENSOR_SETS: Record<DroneSensorSetId, DroneSensorSet> = { 'recon-3d': RECON_3D, 'recon-mini': RECON_MINI };

/**
 * @description Resolve a set by id, defaulting to the 3-D set the earlier tests were written against.
 * @param id - A set id or undefined.
 * @returns The set.
 */
export function sensorSetById(id: string | undefined): DroneSensorSet {
  if (id && id in DRONE_SENSOR_SETS) return DRONE_SENSOR_SETS[id as DroneSensorSetId];
  return RECON_3D;
}
