"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRONE_SENSOR_SETS = exports.RECON_MINI = exports.RECON_3D = void 0;
exports.sensorSetById = sensorSetById;
const raycast_1 = require("../sense/raycast");
/** @description The sensor set the sim assumed through 0.4.0: what you buy, not what you print. */
exports.RECON_3D = {
    id: 'recon-3d',
    label: '3-D spinning LiDAR (Mid-360 class) + zenith ranger',
    mastM: 0.08,
    groundMastM: 0.08,
    padPlateM: 0,
    underDropM: 0.03,
    lidar: raycast_1.DRONE_LIDAR,
    depthCamera: null,
    nadirRangerM: null,
    registration: 'full',
    frontier: 'layer',
    sensingMassG: 275,
};
/** @description The drone we print: a 2-D ring in the flight plane, a downward ToF depth camera, zenith and nadir rangers. */
exports.RECON_MINI = {
    id: 'recon-mini',
    label: '2-D ring (LD19 class) + downward ToF depth camera + zenith/nadir rangers — the printed drone',
    mastM: 0,
    groundMastM: 0,
    padPlateM: 0.03,
    underDropM: 0.02,
    lidar: { ...raycast_1.DEFAULT_LIDAR, azimuthCount: 450, elevationsDeg: [0], maxRange: 12, zenith: { rays: 8, coneDeg: 10, maxRange: 4 } },
    depthCamera: { fovHDeg: 70, fovVDeg: 50, maxRange: 4, stride: 4 },
    nadirRangerM: 8,
    registration: 'planar',
    frontier: 'tops',
    sensingMassG: 84,
    cruiseAltM: 2.075,
};
/** @description Every set by id. */
exports.DRONE_SENSOR_SETS = { 'recon-3d': exports.RECON_3D, 'recon-mini': exports.RECON_MINI };
/**
 * @description Resolve a set by id, defaulting to the 3-D set the earlier tests were written against.
 * @param id - A set id or undefined.
 * @returns The set.
 */
function sensorSetById(id) {
    if (id && id in exports.DRONE_SENSOR_SETS)
        return exports.DRONE_SENSOR_SETS[id];
    return exports.RECON_3D;
}
//# sourceMappingURL=sensor-set.js.map