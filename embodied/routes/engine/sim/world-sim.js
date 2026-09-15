"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the simulation environment: one scene, one
 *                     |                             | mobile manipulator (base + lift + sim-6 arm + gripper), one
 *                     |                             | mini drone with a camera, fixed 50 ms stepping, and the command
 *                     |                             | primitives every caller (planner, executor, manual control)
 *                     |                             | goes through. Each primitive validates BEFORE it moves anything
 *                     |                             | — path clearance, keep-out, reach, the live tip budget, the
 *                     |                             | drone fence — and refuses by throwing. A held object follows
 *                     |                             | the tool; a released object rests on the surface under it or
 *                     |                             | falls to the floor and says so. Cloneable, so a plan can be
 *                     |                             | rehearsed in a copy before a human executes it live.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Doors: solids now include each appliance door at its swing, the
 *                     |                             | grid and fence rebuild when a door moves, the gripper can take
 *                     |                             | and release a handle and the door follows the tool along its
 *                     |                             | arc (a held door is carried, not an obstacle to the arm).
 *                     |                             | Collision samples every link along its length; a swept-volume
 *                     |                             | check runs on the joint path and the IK branch clear of both
 *                     |                             | target and sweep is chosen. Tip-budget refusals name the force.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The discovered world: `world: WorldModel` (voxel map + tracked surfaces/objects) is the only thing the guards read — the scene answers sensor rays and physics and nothing else. Base/wrist/drone scans and pictures; frontier exploration goals; configuration collision against the map (unknown = blocked outside a 0.45 m self-bubble, `contactRadius` exempts the grasp/place target, a held door is exempt); drive, takeoff, flight and landing checks on the map; grasp lifts the mapped object, release rests on any solid top and marks the placed box; door relocation re-rasterised.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The drone's pose is an ESTIMATE: `drone` is the belief the autopilot flies and the guards read, `truth` is where it really is (sensors cast from it, the hidden scene is struck at it). Dead reckoning drifts the truth by the odometry model; every drone sweep is registered scan-to-map before it is integrated (`registerDrone`), a landing on the pad takes the fiducial fix (`padFix`), a non-converging registration marks the drone lost and refuses flight, and a true strike on an unmapped solid puts the drone down (`droneDown`). The drone LiDAR carries the upward ranger. Observation frames report the believed camera; pictures form at the true one.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Blind-recon follow-through: the drone LiDAR sits on a mast (`DRONE_LIDAR_Z`); the map extends one voxel beyond the room (`MAP_SHELL_M`) so walls, floor and ceiling are mapped, anchored solids; `droneClear` keeps `DRONE_CLEARANCE_M` from every mapped voxel and `DRONE_KNOWN_RING_M` of seen air beside the path (takeoff checks the column only); a sweep the machine cannot place (lost) is not integrated; arm refusals name the unknown point.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | The drone carries a SENSOR SET (`WorldSimOptions.sensorSet`, default `recon-3d`): the ring/rings on the mast, an optional downward depth camera and nadir ranger, each read from its own origin in the body frame and integrated as one scan; `registerDrone` takes the altitude from the nadir ranger, runs planar registration for a single scan plane, and reports `dead-reckoned` when a sweep has nothing to match (no contradiction) as distinct from `lost`.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Altitude hold: with a nadir ranger the believed altitude is the reading plus the discovered top under the drone, every step in flight; `anchored` means on the pad, an airborne sweep with nothing to match is `dead-reckoned`.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | A single-plane sensor set flies at a voxel-centre altitude so the ring and the guards read the same layer.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Exploration frontier by sensor set: unknown air in the layer, or tops the downward camera has not seen.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | `flightLegs`: a drone.goto is routed through the flight grid (breadth-first, simplified) before it is flown — a straight line is a route only when the map says so.
 * 11 | maintainer@emeraldcoastsystemsgroup.com   | Backing out: a drone standing inside a clearance violation (the map grew under it) may fly `DRONE_BACKOUT_M` before the rule applies, and the flight grid opens the same bubble for routing and frontier search; a set may fix its own cruise altitude.
 * 12 | maintainer@emeraldcoastsystemsgroup.com   | Altitude hold gating: the ranger reading is explained by the floor or a discovered top within one cell, whichever moves the belief least; an unexplained reading is ignored — a floor reading beside a counter edge no longer lifts the belief by the counter height.
 * 13 | maintainer@emeraldcoastsystemsgroup.com   | Exploration legs fly at the mission altitude (`cruiseAlt`), not at the current estimate — flying level at a drifting estimate ratcheted the 3-D drone down a centimetre per leg until the fridge top was in its clearance band; `flightLegs` routes in the target's layer.
 * 14 | maintainer@emeraldcoastsystemsgroup.com   | Every set flies at a voxel-centre mission altitude (1.9 m sat exactly on a layer boundary and the guards read a different layer than the sweeps carved).
 * 15 | maintainer@emeraldcoastsystemsgroup.com   | Exploration: the wall inset is the fence in metres (the shell had shifted the cell-count inset one cell outward, sending a goal outside the fence); a tops-driven set flies to the gain-best goal under its camera footprint; routed flights respect the fence.
 * 16 | maintainer@emeraldcoastsystemsgroup.com   | The altitude hold trusts only tops with known free air above them (a side hit on the fridge front is not a top); exploration keeps a 10 cm drift buffer inside the fence.
 * 17 | maintainer@emeraldcoastsystemsgroup.com   | The physics plant seam (ADR-152 D3): with a `plant`, the drone's TRUTH is stepped by the plant toward the belief the autopilot commands (the belief is the commanded pose; the plant lags, tilts and is gusted), a strike is a real contact the plant reports, the belief holds 'moving'/'takeoff'/'landing' until the plant has settled (a node reports arrival, the belief does not assume it), and every drone sensor frame comes from the plant's rays at the true pose through the same map and registration. Without a plant nothing changes.
 * 17 | maintainer@emeraldcoastsystemsgroup.com   | Planar sets register with `PLANAR_REGISTER`.
 * 18 | maintainer@emeraldcoastsystemsgroup.com   | `nextExplorationGoal(scannedFrom)`: a tops-driven exploration is told where it has already scanned from.
 * 19 | maintainer@emeraldcoastsystemsgroup.com   | Flight legs are simplified with the supercover line test: the point-by-point flight guard must never refuse a leg the route planner approved.
 * 20 | maintainer@emeraldcoastsystemsgroup.com   | One body radius for both truth models (B18): the hull half-width comes from the parts model of the fit that carries the sensor set (0.178 m printed, 0.205 m 3-D fit) and every flight guard keeps that hull plus a 5 cm margin from mapped voxels; the kinematic strike uses the hull the physics plant collides with. DRONE_BODY_RADIUS and DRONE_CLEARANCE_M are gone.
 * 21 | maintainer@emeraldcoastsystemsgroup.com   | B20: a plant's clone may be null (a node that is one body) — the rehearsal copy then runs on the kinematic twin from the plant's last reported truth; the snapshot names the node behind the plant (nodeId, link, endpoint) and reports backend 'node' for a plant on the swarm rail.
 * 22 | maintainer@emeraldcoastsystemsgroup.com   | A plant's arrival at a hover counts only inside the commanded voxel layer (half a layer less LAYER_HOLD_MARGIN_M): a climb overshoot the plant called settled put the first scan into the layer above the mission altitude and the return leg was refused on MuJoCo. Found by the live node suite (B20).
 * 23 | maintainer@emeraldcoastsystemsgroup.com   | B4 + B14: a world starts from a named scenario (`scenario`, default kitchen; the snapshot names it); the believed positions at which registrations converged form a trail; `scanDrone({wide})` registers with the 30 cm capture; `droneGoto(target, {recovering})` may fly while lost; `recoveryTrail()` is the way back (the trail reversed, then above the pad); `groundLost()` lands and declares the drone down when recovery fails.
 * 24 | maintainer@emeraldcoastsystemsgroup.com   | B6: a sweep is expressed in the body frame of the pose the sensing REPORTS -- a plant says where it sensed from and a real vehicle's estimate drifts between steps -- not a truth snapshot taken before sensing; on a vehicle a centimetre off its load pose the whole pad sweep landed beside the belief column and the climb was refused.
 * 25 | maintainer@emeraldcoastsystemsgroup.com   | B22 (half a): the ARM plant seam, the drone plant's counterpart — with an `armPlant` the joint truth is STEPPED BY THE PHYSICS and the measured angles are what every guard, the tool point and the tip budget read (a position servo settles short of its command by its load over its gain, so a command echoed back would be a lie); arrival is the plant's `settled`, not the ramp's; what each servo exerted and what a link touched ride in the snapshot as `unit.servos`, and `unit.backend` says which body answered. A rehearsal clones the arm plant the way it clones the drone's. `armMount()` is where the base really stands, so the model in the container stands where the kinematic sim says it does. Half (b) — an arm NODE on the swarm rail — is blocked by core ADR-149 (B20).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldSim = exports.handleHold = exports.SWEEP_STEP_RAD = exports.PAD_FIX_RADIUS = exports.MAP_SHELL_M = exports.DRONE_LIDAR_Z = exports.TOPS_MIN_GAIN_CELLS = exports.TOPS_FOOTPRINT_M = exports.FENCE_DRIFT_BUFFER_M = exports.RECOVERY_TRAIL_MAX = exports.DRONE_BACKOUT_M = exports.MAX_UNREGISTERED_M = exports.DRONE_KNOWN_RING_M = exports.LAYER_HOLD_MARGIN_M = exports.DRONE_CLEARANCE_MARGIN_M = exports.SELF_BUBBLE_M = exports.ROVER_LIDAR_Z = exports.STEP_S = exports.ARM_GRIP_CLOSED_RAD = exports.ARM_GRIP_OPEN_RAD = exports.GRASP_TOLERANCE = exports.GRIPPER_MAX_WIDTH = exports.DRONE_NODE_ID = exports.UNIT_NODE_ID = exports.ARM_MOUNT_X = void 0;
const arm_model_1 = require("../arm/arm-model");
const inverse_kinematics_1 = require("../arm/inverse-kinematics");
const diff_drive_1 = require("../base/diff-drive");
const stability_1 = require("../base/stability");
const camera_model_1 = require("../drone/camera-model");
const quad_model_1 = require("../drone/quad-model");
const plant_1 = require("../physics/plant");
const arm_plant_1 = require("../physics/arm-plant");
const mjcf_1 = require("../physics/mjcf");
const parts_model_1 = require("../design/parts-model");
const register_1 = require("../sense/register");
const scenes_1 = require("../world/scenes");
const sensor_set_1 = require("../drone/sensor-set");
const transform_1 = require("../math/transform");
const vec_1 = require("../math/vec");
const occupancy_grid_1 = require("../world/occupancy-grid");
const scene_1 = require("../world/scene");
const raycast_1 = require("../sense/raycast");
const voxel_map_1 = require("../world/voxel-map");
const world_model_1 = require("../world/world-model");
const explore_1 = require("../world/explore");
/** @description Where the arm base sits relative to the base frame origin (floor centre): 0.20 m forward, on the carriage. */
exports.ARM_MOUNT_X = 0.20;
/** @description Node identifiers the sim exposes. */
exports.UNIT_NODE_ID = 'rover-arm-1';
exports.DRONE_NODE_ID = 'mini-drone-1';
/** @description Gripper stroke (m). */
exports.GRIPPER_MAX_WIDTH = 0.085;
/** @description How close the tool must be to an object's centroid to grasp it (m) — an 85 mm gripper forgives a mapped centroid a few centimetres off. */
exports.GRASP_TOLERANCE = 0.05;
/** @description The jaw hinge angles the gripper is commanded at on a physics arm (rad) — the printed gripper's own open and closed. */
exports.ARM_GRIP_OPEN_RAD = 0.05;
exports.ARM_GRIP_CLOSED_RAD = -0.6;
/** @description The fixed physics step (s). */
exports.STEP_S = 0.05;
/** @description Height of the LiDAR on the base (m) — the hardware design's Livox on the front face. */
exports.ROVER_LIDAR_Z = 0.35;
/** @description Around its own arm base the machine knows the space is its own; unknown voxels within this radius do not block the arm. */
exports.SELF_BUBBLE_M = 0.45;
/** @description Margin the drone keeps beyond its own hull from every mapped voxel (m). The hull itself is the fit's, from the parts model. */
exports.DRONE_CLEARANCE_MARGIN_M = 0.05;
/** A plant's arrival counts only inside the commanded voxel layer: within half a layer less this margin of the commanded altitude. */
exports.LAYER_HOLD_MARGIN_M = 0.005;
/** @description At its own altitude the drone does not pass beside air it has never seen within this radius. */
exports.DRONE_KNOWN_RING_M = 0.10;
/** @description The drone never flies further than this without registering a sweep — dead reckoning must not outrun the registration capture range. */
exports.MAX_UNREGISTERED_M = 2.0;
/** @description A drone that finds itself inside a clearance violation (the map grew under it) may fly this far to back out before the clearance rule applies again. */
exports.DRONE_BACKOUT_M = 0.3;
/** The most trail points a recovery flies back along (B14). */
exports.RECOVERY_TRAIL_MAX = 12;
const TRAIL_CAP = 64;
/** @description Exploration goals and routes stay this far inside the fence: a leg that overshoots by its drift must not end outside the geofence, where every next leg is refused. */
exports.FENCE_DRIFT_BUFFER_M = 0.1;
/** @description The radius under a downward camera that counts as "seen from here" when choosing where to fly next. */
exports.TOPS_FOOTPRINT_M = 0.6;
/** @description The least number of unseen columns a flight must promise the camera; below it, exploration is finished. */
exports.TOPS_MIN_GAIN_CELLS = 25;
/** @description The LiDAR sits on a mast above the drone's body centre; a sensor AT floor level on the pad would see nothing but the floor it touches. */
exports.DRONE_LIDAR_Z = 0.08;
/** @description The map extends this far beyond the room so the walls, floor and ceiling are mapped (and anchored) solids, not the edge of the world. */
exports.MAP_SHELL_M = 0.05;
/** @description A landing this close to the pad (true distance) gets the pad's fiducial fix: the belief snaps to the truth. */
exports.PAD_FIX_RADIUS = 0.30;
/** @description Joint-space interpolation step for the swept-volume check (rad). */
exports.SWEEP_STEP_RAD = 0.1;
/** @description What the gripper reports while it holds a door handle. */
const handleHold = (applianceId) => `handle:${applianceId}`;
exports.handleHold = handleHold;
/** @description The simulation environment. */
/** @description Cells whose centre lies outside the fence are never flown to and never count as unknown: the wall margin is the fence's, in metres, not a count of grid cells. */
function insetByFence(flight, fence, unknown, buffer = exports.FENCE_DRIFT_BUFFER_M) {
    for (let j = 0; j < flight.height; j += 1)
        for (let i = 0; i < flight.width; i += 1) {
            const x = flight.originX + (i + 0.5) * flight.res;
            const y = flight.originY + (j + 0.5) * flight.res;
            if (x < fence.minX + buffer || x > fence.maxX - buffer || y < fence.minY + buffer || y > fence.maxY - buffer) {
                flight.cells[j * flight.width + i] = 1;
                if (unknown)
                    unknown.cells[j * flight.width + i] = 0;
            }
        }
}
/** @description Mark the cells within `r` of a point flyable: the drone is where it is, and may back out of a pocket the map has since closed around it. */
function openBubble(flight, at, r) {
    const cells = Math.ceil(r / flight.res);
    const i0 = Math.floor((at.x - flight.originX) / flight.res);
    const j0 = Math.floor((at.y - flight.originY) / flight.res);
    for (let dj = -cells; dj <= cells; dj += 1)
        for (let di = -cells; di <= cells; di += 1) {
            if (di * di + dj * dj > cells * cells)
                continue;
            const i = i0 + di;
            const j = j0 + dj;
            if (i >= 0 && j >= 0 && i < flight.width && j < flight.height)
                flight.cells[j * flight.width + i] = 0;
        }
}
class WorldSim {
    scene;
    armSpec;
    baseLimits;
    droneLimits;
    intrinsics;
    sensorSet;
    /** Half-width of the drone's hull (m), from the parts model of the fit that carries the sensor set: prop tips plus the guard ring. A strike is measured against it on both truth models. */
    droneRadiusM;
    /** Lateral clearance every flight guard keeps from a mapped voxel: the hull plus the margin. */
    droneClearanceM;
    /** Vertical clearance: the hull's half-height plus the sensor mast plus the margin — a quad is wide and flat. */
    droneClearanceZM;
    timeMs = 0;
    unit;
    /** The drone as the machine BELIEVES it to be — what the autopilot flies and every guard reads. */
    drone;
    /** Where the drone really is. Sensors cast from here and the hidden scene is struck here; nothing else reads it. */
    truth;
    localization = { status: 'anchored', correctionM: 0, yawCorrectionRad: 0, matched: 0, residualM: 0, registrations: 0, observable: true, weakAxisRad: null, coverage: 0 };
    /** The believed positions at which a registration converged, oldest first (capped): the trail a lost drone flies back along (B14). */
    registeredTrail = [];
    /** Set when the true drone struck something its map said was clear; the drone is then on the floor and refuses everything. */
    droneDown = null;
    /** The physics plant behind the drone, when the world runs on one. */
    plant;
    /** The physics plant behind the ARM, when the world runs on one (B22). */
    armPlant;
    /** What the arm's servos exerted on the last stepped physics (N·m) and what a link touched. Null on the kinematic arm. */
    armTelemetry;
    /** The solid the arm was last reported touching, so one contact logs one event. */
    lastArmContact = null;
    /** On a plant: the setpoint the autopilot has ramped to so far — what the plant is told to fly. Null = in step with the belief (after a command or a correction). */
    cmd = null;
    gimbalPitch = -1.05;
    events = [];
    /** The world the machine has discovered — the only world its guards and plans read. */
    world;
    /** The latest picture per sensor and the latest LiDAR sweep, for the surface. */
    lastPictures = {};
    lastSweep = null;
    /** While set, mapped voxels within the radius of the centre are the thing being grasped or set down, not an obstacle. */
    contact = null;
    seq = 0;
    gridCache = null;
    constructor(opts = {}) {
        this.scene = opts.scene ?? (0, scenes_1.scenarioById)(opts.scenario);
        this.armSpec = opts.armSpec ?? arm_model_1.SIM_ARM_6;
        this.baseLimits = opts.baseLimits ?? diff_drive_1.DEFAULT_BASE_LIMITS;
        this.droneLimits = opts.droneLimits ?? quad_model_1.DEFAULT_DRONE_LIMITS;
        this.intrinsics = opts.intrinsics ?? camera_model_1.DEFAULT_INTRINSICS;
        this.sensorSet = opts.sensorSet ?? sensor_set_1.RECON_3D;
        const hull = (0, mjcf_1.dronePlant)((0, parts_model_1.fitForSensorSet)(this.sensorSet.id));
        this.droneRadiusM = hull.hullHalfXyM;
        this.droneClearanceM = hull.hullHalfXyM + exports.DRONE_CLEARANCE_MARGIN_M;
        this.droneClearanceZM = hull.hullHalfZM + hull.mastM + exports.DRONE_CLEARANCE_MARGIN_M;
        const room = this.scene.room;
        // One voxel beyond the room on every side: a hit on a wall, the floor or the ceiling is recorded 2 mm INSIDE
        // that solid, and those shells are the biggest things a sweep can register against.
        this.world = new world_model_1.WorldModel({ minX: room.minX - exports.MAP_SHELL_M, maxX: room.maxX + exports.MAP_SHELL_M, minY: room.minY - exports.MAP_SHELL_M, maxY: room.maxY + exports.MAP_SHELL_M, minZ: -exports.MAP_SHELL_M, maxZ: room.ceiling + exports.MAP_SHELL_M });
        // The mission altitude sits at the CENTRE of a voxel layer, never on a boundary: the guards read one layer and
        // a millimetre of drift must not flip it. A single scan plane depends on it; every set benefits.
        this.droneLimits = { ...this.droneLimits, cruiseAlt: this.world.map.voxelCentreZ(this.sensorSet.cruiseAltM ?? this.droneLimits.cruiseAlt) };
        const park = this.scene.basePark;
        this.unit = { base: { x: park.x, y: park.y, yaw: park.yaw, v: 0, w: 0, liftZ: this.baseLimits.liftMin }, q: [...arm_model_1.STOW_Q], qTarget: null, gripper: { width: exports.GRIPPER_MAX_WIDTH, holding: null }, enabled: true, estop: false, driveGoal: null, jog: null, liftTarget: null, phase: 'idle' };
        this.drone = (0, quad_model_1.landedDrone)(this.scene.droneHome, 0);
        this.truth = { x: this.drone.x, y: this.drone.y, z: this.drone.z, yaw: 0 };
        this.plant = opts.plant ?? null;
        this.armPlant = opts.armPlant ?? null;
        this.armTelemetry = null;
        if (this.armPlant && this.armPlant.dh.length) {
            // A belief computed from one arm's link lengths over another arm's physics has NO symptom until the tool point
            // misses, so the two are compared before a single step is taken.
            const mismatch = (0, arm_plant_1.armSpecMismatch)(this.armPlant, this.armSpec.joints.map((j) => [j.d, j.a, j.alpha]));
            if (mismatch)
                throw new Error(`refused: the arm plant is not this arm — ${mismatch}`);
        }
    }
    /** @description A deep copy for rehearsal: same scene state, same time, independent afterwards. */
    clone() {
        const copy = new WorldSim({ scene: JSON.parse(JSON.stringify(this.scene)), armSpec: this.armSpec, baseLimits: this.baseLimits, droneLimits: this.droneLimits, intrinsics: this.intrinsics, sensorSet: this.sensorSet, plant: this.plant?.clone() ?? undefined, armPlant: this.armPlant?.clone() ?? undefined });
        copy.timeMs = this.timeMs;
        copy.unit = JSON.parse(JSON.stringify(this.unit));
        copy.drone = JSON.parse(JSON.stringify(this.drone));
        copy.truth = { ...this.truth };
        copy.localization = { ...this.localization };
        copy.registeredTrail = this.registeredTrail.map((p) => [...p]);
        copy.droneDown = this.droneDown;
        copy.cmd = this.cmd ? { ...this.cmd } : null;
        copy.gimbalPitch = this.gimbalPitch;
        copy.seq = this.seq;
        copy.world = this.world.clone();
        return copy;
    }
    // ── Sensing (the only way the machine learns the room) ─────────────────────
    /** @description What a sensor can hit: the hidden scene's solids, doors, unheld objects, floor, walls and ceiling — never the machine or the drone. */
    sensingSolids() {
        const paintOf = (o) => (o.name.endsWith('-door') ? 'door' : o.kind === 'counter' || o.kind === 'island' ? 'counter' : o.kind === 'fixture' ? 'fixture' : o.kind === 'table' ? 'table' : 'appliance');
        const out = (0, scene_1.sceneSolids)(this.scene).map((o) => ({ name: o.name, min: o.min, max: o.max, paint: paintOf(o) }));
        for (const o of this.scene.objects) {
            if (o.location.kind === 'gripper')
                continue;
            const s = scene_1.OBJECT_CLASSES[o.cls].size;
            out.push({ name: o.id, min: [o.pose.x - s.l / 2, o.pose.y - s.w / 2, o.pose.z - s.h / 2], max: [o.pose.x + s.l / 2, o.pose.y + s.w / 2, o.pose.z + s.h / 2], paint: o.cls });
        }
        const r = this.scene.room;
        out.push({ name: 'floor', min: [r.minX, r.minY, -0.05], max: [r.maxX, r.maxY, 0], paint: 'floor' });
        out.push({ name: 'wall-south', min: [r.minX, r.minY - 0.05, 0], max: [r.maxX, r.minY, r.ceiling], paint: 'wall' });
        out.push({ name: 'wall-north', min: [r.minX, r.maxY, 0], max: [r.maxX, r.maxY + 0.05, r.ceiling], paint: 'wall' });
        out.push({ name: 'wall-west', min: [r.minX - 0.05, r.minY, 0], max: [r.minX, r.maxY, r.ceiling], paint: 'wall' });
        out.push({ name: 'wall-east', min: [r.maxX, r.minY, 0], max: [r.maxX + 0.05, r.maxY, r.ceiling], paint: 'wall' });
        out.push({ name: 'ceiling', min: [r.minX, r.minY, r.ceiling], max: [r.maxX, r.maxY, r.ceiling + 0.05], paint: 'wall' });
        return out;
    }
    /** @description The wrist camera: at the tool, looking along the tool axis. */
    wristCamera() {
        const T = (0, transform_1.multiply)(this.armBaseTransform(), (0, arm_model_1.forwardKinematics)(this.armSpec, this.unit.q).tcp);
        const z = [T[2], T[6], T[10]];
        return { position: [T[3], T[7], T[11]], yaw: Math.atan2(z[1], z[0]), pitch: Math.asin(Math.max(-1, Math.min(1, z[2]))) };
    }
    /** @description The drone's LiDAR sweep from where it is. Integrates into the map. */
    scanDrone(opts = {}) {
        if (this.droneDown)
            throw new Error(`drone is down: ${this.droneDown}`);
        const set = this.sensorSet;
        const solids = this.sensingSolids();
        const { sensed, nadirM } = this.plant ? this.plantSensing(solids) : this.kinematicSensing(set, { ...this.truth }, solids);
        // Everything was measured in the BODY frame of the pose the sensing reports (a plant tells where it sensed from,
        // and a vehicle's own estimate moves between steps); each sensor keeps its own origin for the carving.
        const truth = { ...this.truth };
        const bodies = sensed.map((s) => (0, register_1.toBodyFrame)(s, truth));
        this.registerDrone((0, register_1.concatBody)(bodies), nadirM, opts.wide === true);
        const belief = { x: this.drone.x, y: this.drone.y, z: this.drone.z, yaw: this.drone.yaw };
        const placed = bodies.map((b) => (0, register_1.fromBodyFrame)(b, belief));
        const loc = this.localization;
        // A sweep the machine cannot place is not integrated: a map built from a lost pose is worse than a gap.
        if (loc.status !== 'lost') {
            this.world.map.integrateSweeps(placed);
            this.world.refresh();
        }
        const sweep = { origin: placed[0].origin, hits: placed.flatMap((p) => p.hits), misses: placed.flatMap((p) => p.misses) };
        this.lastSweep = sweep;
        this.record(exports.DRONE_NODE_ID, `${opts.wide ? 'wide ' : ''}${set.id} sweep: ${sweep.hits.length} returns, map ${(0, vec_1.round)(this.world.stats().knownFraction * 100, 0)}% known, localisation ${loc.status}${loc.status === 'tracking' ? ` (corrected ${(0, vec_1.round)(loc.correctionM * 100, 1)} cm, ${loc.matched} matches)` : ''}`, loc.status === 'lost' ? 'warn' : 'info');
        return sweep;
    }
    /** @description The drone's sensors cast by the kinematic raycaster from the true pose: ring (with the zenith cone), depth camera, nadir ranger. */
    kinematicSensing(set, truth, solids) {
        const sensed = [(0, raycast_1.lidarSweep)([truth.x, truth.y, truth.z + this.droneMast()], truth.yaw, solids, set.lidar)];
        if (set.depthCamera)
            sensed.push(this.depthCameraSweep(set.depthCamera, truth, solids));
        let nadirM = null;
        if (set.nadirRangerM !== null) {
            const ray = (0, raycast_1.lidarSweep)([truth.x, truth.y, truth.z - this.underDrop()], truth.yaw, solids, { azimuthCount: 1, elevationsDeg: [-90], maxRange: set.nadirRangerM });
            sensed.push(ray);
            if (ray.hits.length && ray.hits[0].name === 'floor')
                nadirM = ray.hits[0].t;
        }
        return { sensed, nadirM };
    }
    /** @description The drone's sensors as the physics plant casts them from its true pose, painted by the solid struck. */
    plantSensing(solids) {
        const frames = this.plant.sense((0, plant_1.senseSpec)(this.sensorSet, this.intrinsics));
        this.truth = { x: frames.truth.x, y: frames.truth.y, z: frames.truth.z, yaw: frames.truth.yaw };
        const { sweeps, nadirM } = (0, plant_1.framesToSweeps)(frames, solids);
        return { sensed: sweeps, nadirM };
    }
    /** @description Height of the drone's LiDAR above its body reference: the mast in flight, the pad plate's worth on the ground. */
    droneMast() {
        return this.drone.mode === 'landed' ? this.sensorSet.groundMastM + this.sensorSet.padPlateM : this.sensorSet.mastM;
    }
    /** @description How far under the body reference the downward sensors hang; on the pad the plate keeps them above the floor. */
    underDrop() {
        return this.drone.mode === 'landed' ? this.sensorSet.underDropM - this.sensorSet.padPlateM : this.sensorSet.underDropM;
    }
    /** @description The downward depth camera's frame as a sweep: one ray per rendered pixel from the lens under the body. */
    depthCameraSweep(spec, body, solids) {
        const intr = { ...this.intrinsics, fx: this.intrinsics.width / (2 * Math.tan(((spec.fovHDeg / 2) * Math.PI) / 180)), fy: this.intrinsics.height / (2 * Math.tan(((spec.fovVDeg / 2) * Math.PI) / 180)) };
        const pic = (0, raycast_1.renderDepthPicture)(intr, { position: [body.x, body.y, body.z - this.underDrop()], yaw: body.yaw, pitch: -Math.PI / 2 + 1e-3 }, solids, spec.maxRange, spec.stride);
        return pic.sweep;
    }
    /**
     * @description Scan-to-map registration. The sweep was measured in the drone's own frame; the belief
     * of where that frame was has drifted since the last fix. With a map to match against, the belief is
     * pulled onto it; on the pad with an empty map the belief is anchored by definition. A registration
     * that does not converge leaves the belief as it is and marks the drone lost — flight is then refused.
     */
    registerDrone(body, nadirM, wide = false) {
        const map = this.world.map;
        const guess = { x: this.drone.x, y: this.drone.y, z: this.drone.z, yaw: this.drone.yaw };
        const opts = this.sensorSet.registration === 'planar' ? register_1.PLANAR_REGISTER : register_1.DEFAULT_REGISTER;
        const airborne = this.drone.mode !== 'landed';
        if (map.anchorCount === 0) {
            this.localization = { ...this.localization, status: airborne ? 'dead-reckoned' : 'anchored' };
            return;
        }
        if (wide) {
            this.relocalizeDrone(body, guess, opts);
            return;
        }
        const reg = (0, register_1.registerSweep)(map, body, guess, opts);
        if (reg.unobservable) {
            this.localization = { ...this.localization, status: 'dead-reckoned', matched: reg.matched, residualM: reg.residualM };
            this.record(exports.DRONE_NODE_ID, `registration: nothing to match yet (${reg.matched} usable matches) — dead reckoning${nadirM !== null ? ', altitude from the nadir ranger' : ''}`);
            return;
        }
        if (!reg.converged) {
            this.localization = { ...this.localization, status: 'lost', matched: reg.matched, residualM: reg.residualM };
            this.record(exports.DRONE_NODE_ID, `registration did not converge (${reg.matched} matches) — localisation lost; land and re-anchor`, 'warn');
            return;
        }
        this.drone = { ...this.drone, x: reg.pose.x, y: reg.pose.y, z: reg.pose.z, yaw: reg.pose.yaw };
        this.cmd = null;
        this.localization = { status: 'tracking', correctionM: reg.correctionM, yawCorrectionRad: reg.yawCorrectionRad, matched: reg.matched, residualM: reg.residualM, registrations: this.localization.registrations + 1, observable: reg.observable, weakAxisRad: reg.weakAxisRad, coverage: reg.coverage };
        if (!reg.observable)
            this.record(exports.DRONE_NODE_ID, `registration: the shift along ${(0, vec_1.round)(((reg.weakAxisRad ?? 0) * 180) / Math.PI, 0)}° could not be measured (one face seen head-on) — dead reckoning stands along it`);
        this.registeredTrail.push([reg.pose.x, reg.pose.y, reg.pose.z]);
        if (this.registeredTrail.length > TRAIL_CAP)
            this.registeredTrail.splice(0, this.registeredTrail.length - TRAIL_CAP);
    }
    /**
     * @description The recovery sweep (B14): a global search around the belief instead of a capture-bounded fit. Accepted only
     * when the best pose scores enough, stands clearly above any other, refines to a converged and observable registration and
     * stays inside the window; an ambiguous room stays lost — a sweep is not a fiducial, the pad is.
     */
    relocalizeDrone(body, guess, opts) {
        const r = (0, register_1.relocalize)(this.world.map, body, guess, opts);
        const reg = r.registration;
        const detail = `best ${(0, vec_1.round)(r.best.score * 100, 0)} % at (${(0, vec_1.round)(r.best.pose.x, 2)}, ${(0, vec_1.round)(r.best.pose.y, 2)}), runner-up ${r.second ? (0, vec_1.round)(r.second.score * 100, 0) : 0} %`;
        if (!r.accepted) {
            this.localization = { ...this.localization, status: 'lost', matched: reg.matched, residualM: reg.residualM, coverage: reg.coverage, observable: reg.observable, weakAxisRad: reg.weakAxisRad };
            this.record(exports.DRONE_NODE_ID, `relocalisation refused: ${r.unique ? 'the best pose did not refine to a fit' : 'no pose stood clearly above the rest'} (${detail}) — still lost`, 'warn');
            return;
        }
        const moved = Math.hypot(reg.pose.x - guess.x, reg.pose.y - guess.y, reg.pose.z - guess.z);
        this.drone = { ...this.drone, x: reg.pose.x, y: reg.pose.y, z: reg.pose.z, yaw: reg.pose.yaw };
        this.cmd = null;
        this.localization = { status: 'tracking', correctionM: moved, yawCorrectionRad: reg.pose.yaw - guess.yaw, matched: reg.matched, residualM: reg.residualM, registrations: this.localization.registrations + 1, observable: reg.observable, weakAxisRad: reg.weakAxisRad, coverage: reg.coverage };
        this.registeredTrail.push([reg.pose.x, reg.pose.y, reg.pose.z]);
        this.record(exports.DRONE_NODE_ID, `relocalised: belief moved ${(0, vec_1.round)(moved * 100, 1)} cm (${detail})`);
    }
    /** @description Where the machine believes its LiDAR is: the believed body pose plus the sensor mast. */
    droneSensorBelief() {
        return { x: this.drone.x, y: this.drone.y, z: this.drone.z + this.droneMast(), yaw: this.drone.yaw };
    }
    /** @description Sim-only ground truth: the gap between the believed and the true drone pose. */
    localizationError() {
        const dyaw = Math.atan2(Math.sin(this.drone.yaw - this.truth.yaw), Math.cos(this.drone.yaw - this.truth.yaw));
        return { positionM: Math.hypot(this.drone.x - this.truth.x, this.drone.y - this.truth.y, this.drone.z - this.truth.z), yawRad: Math.abs(dyaw) };
    }
    /** @description The base LiDAR sweep from the machine's front. Integrates into the map. */
    scanRover() {
        const b = this.unit.base;
        const sweep = (0, raycast_1.lidarSweep)([b.x + 0.3 * Math.cos(b.yaw), b.y + 0.3 * Math.sin(b.yaw), exports.ROVER_LIDAR_Z], b.yaw, this.sensingSolids(), raycast_1.DEFAULT_LIDAR);
        this.world.map.integrateSweep(sweep);
        this.world.refresh();
        this.lastSweep = sweep;
        this.record(exports.UNIT_NODE_ID, `base LiDAR sweep: ${sweep.hits.length} returns, map ${(0, vec_1.round)(this.world.stats().knownFraction * 100, 0)}% known`);
        return sweep;
    }
    /** @description A depth picture from the wrist camera, integrated into the map (close range, dense). */
    scanWrist() {
        const pic = (0, raycast_1.renderDepthPicture)(this.intrinsics, this.wristCamera(), this.sensingSolids(), 2.5, 4);
        this.world.map.integrateSweep(pic.sweep);
        this.world.refresh();
        this.lastPictures.wrist = pic;
        this.record(exports.UNIT_NODE_ID, `wrist depth picture: ${pic.sweep.hits.length} returns`);
        return pic;
    }
    /** @description A picture from a camera, NOT integrated — what the surface shows as the live view. */
    picture(sensor) {
        const cam = sensor === 'wrist' ? this.wristCamera() : sensor === 'drone' ? this.droneCamera() : { position: [this.unit.base.x + 0.3 * Math.cos(this.unit.base.yaw), this.unit.base.y + 0.3 * Math.sin(this.unit.base.yaw), exports.ROVER_LIDAR_Z], yaw: this.unit.base.yaw, pitch: 0 };
        const pic = (0, raycast_1.renderDepthPicture)(this.intrinsics, cam, this.sensingSolids(), sensor === 'wrist' ? 2.5 : 6, 4);
        this.lastPictures[sensor] = pic;
        return pic;
    }
    /** @description Is a point clear for the drone in the discovered map: known free, nothing occupied within 5 cm sideways or 15 cm above or below. */
    droneClear(p, knownRing = true) {
        const map = this.world.map;
        const s = map.stateAt(p);
        if (s === voxel_map_1.UNKNOWN)
            return 'unknown space';
        if (s === voxel_map_1.OCCUPIED)
            return 'a mapped obstacle';
        const cells = Math.ceil(this.droneClearanceM / map.res);
        const layers = Math.ceil(this.droneClearanceZM / map.res);
        const ring = Math.ceil(exports.DRONE_KNOWN_RING_M / map.res);
        for (let dk = -layers; dk <= layers; dk += 1)
            for (let dj = -cells; dj <= cells; dj += 1)
                for (let di = -cells; di <= cells; di += 1) {
                    if (di * di + dj * dj > cells * cells)
                        continue;
                    const v = map.stateAt([p[0] + di * map.res, p[1] + dj * map.res, p[2] + dk * map.res]);
                    if (v === voxel_map_1.OCCUPIED)
                        return 'a mapped obstacle';
                    if (knownRing && dk === 0 && v === voxel_map_1.UNKNOWN && di * di + dj * dj <= ring * ring)
                        return 'unknown space beside the path';
                }
        return null;
    }
    /** @description The next place the drone should look from: the nearest frontier at its altitude, held back into known space, with the legs to fly there through known-free cells. */
    nextExplorationGoal(scannedFrom = []) {
        // Legs fly at the MISSION altitude, not wherever the estimate has drifted to: registration corrects the
        // estimate, the next command restores the altitude. Flying "level at the current estimate" ratchets down.
        const alt = this.droneLimits.cruiseAlt;
        const flight = this.world.map.flightGrid(alt, this.droneClearanceM, exports.DRONE_KNOWN_RING_M, this.droneClearanceZM);
        const unknown = this.sensorSet.frontier === 'tops' ? this.world.map.topUnknownGrid() : this.world.map.unknownGrid(alt, exports.DRONE_KNOWN_RING_M);
        // The drone keeps the fence's wall margin: those cells are never goals, and never frontiers.
        insetByFence(flight, this.fence, unknown);
        const here = { x: this.drone.x, y: this.drone.y };
        openBubble(flight, here, exports.DRONE_BACKOUT_M); // the drone is where it is, and may back out of a spot the map has since closed around
        if (this.sensorSet.frontier === 'tops') {
            // A downward camera learns only what it flies over: go where the most unseen tops fit under its footprint, nearest first.
            const gain = (0, explore_1.gainFrontier)(flight, unknown, here, Math.round(exports.TOPS_FOOTPRINT_M / flight.res), exports.TOPS_MIN_GAIN_CELLS, 2, scannedFrom.map((p) => ({ x: p[0], y: p[1] })));
            if (!gain)
                return null;
            const legs = (0, occupancy_grid_1.simplifyPath)(flight, gain.path, true).slice(1).map((q) => [q.x, q.y, alt]);
            return { point: [gain.goal.x, gain.goal.y, alt], legs: legs.length ? legs : [[gain.goal.x, gain.goal.y, alt]], frontierCount: gain.frontierCount };
        }
        const goal = (0, explore_1.nextFrontier)(flight, unknown, here);
        if (!goal)
            return null;
        const p = (0, explore_1.standBack)(goal);
        const end = goal.path.findIndex((q) => q.x === p.x && q.y === p.y);
        const legs = (0, occupancy_grid_1.simplifyPath)(flight, goal.path.slice(0, end + 1), true).slice(1).map((q) => [q.x, q.y, alt]);
        return { point: [p.x, p.y, alt], legs: legs.length ? legs : [[p.x, p.y, alt]], frontierCount: goal.frontierCount };
    }
    /**
     * @description Waypoints from the drone to a target through cells the flight grid shows flyable at the
     * drone's altitude (breadth-first, then simplified) — a straight line is only a route when the map says so.
     * Falls back to the straight line when no route exists; the guard then refuses it honestly.
     */
    flightLegs(target) {
        const flight = this.world.map.flightGrid(target[2], this.droneClearanceM, exports.DRONE_KNOWN_RING_M, this.droneClearanceZM);
        insetByFence(flight, this.fence);
        const here = { x: this.drone.x, y: this.drone.y };
        openBubble(flight, here, exports.DRONE_BACKOUT_M);
        const goal = { x: target[0], y: target[1] };
        const path = (0, occupancy_grid_1.planPath)(flight, here, goal);
        if (!path)
            return [target];
        const pts = (0, occupancy_grid_1.simplifyPath)(flight, path, true).slice(1);
        if (!pts.length)
            return [target];
        const legs = pts.map((p) => [p.x, p.y, target[2]]);
        legs[legs.length - 1] = target;
        return legs;
    }
    // ── Solids that move ───────────────────────────────────────────────────────
    /** @description Every solid right now, doors included at their current swing. */
    solids() {
        return (0, scene_1.sceneSolids)(this.scene);
    }
    /** @description The navigation grid from the DISCOVERED map (unknown ground is blocked), rebuilt when the map changes. */
    get grid() {
        const key = this.world.map.version;
        if (!this.gridCache || this.gridCache.key !== key)
            this.gridCache = { key, grid: this.world.map.navGrid() };
        return this.gridCache.grid;
    }
    /** @description The drone fence for the current solids. */
    get fence() {
        const r = this.scene.room;
        return { minX: r.minX + 0.3, maxX: r.maxX - 0.3, minY: r.minY + 0.3, maxY: r.maxY - 0.3, ceiling: r.ceiling - 0.2, keepOut: this.solids(), margin: 0.3 };
    }
    // ── Geometry ───────────────────────────────────────────────────────────────
    /**
     * @description Where the arm's base stands in the world right now: the carriage pose plus the lift. This is what a
     * physics arm is mounted at, so the model in the container stands exactly where the kinematic sim says it does.
     * @returns The mount pose.
     */
    armMount() {
        const b = this.unit.base;
        return { x: b.x + exports.ARM_MOUNT_X * Math.cos(b.yaw), y: b.y + exports.ARM_MOUNT_X * Math.sin(b.yaw), z: b.liftZ, yaw: b.yaw };
    }
    /** @description World-from-arm-base transform for the current base pose and lift. */
    armBaseTransform() {
        const b = this.unit.base;
        return (0, transform_1.multiply)((0, transform_1.multiply)((0, transform_1.translation)(b.x, b.y, b.liftZ), (0, transform_1.rotationRpy)(0, 0, b.yaw)), (0, transform_1.translation)(exports.ARM_MOUNT_X, 0, 0));
    }
    /** @description The tool centre point in the world frame. */
    tcpWorld() {
        return (0, transform_1.toPose)((0, transform_1.multiply)(this.armBaseTransform(), (0, arm_model_1.forwardKinematics)(this.armSpec, this.unit.q).tcp));
    }
    /** @description Express a world pose in the arm base frame. */
    worldToArmFrame(pose) {
        const b = this.unit.base;
        const inv = (0, transform_1.multiply)((0, transform_1.translation)(-exports.ARM_MOUNT_X, 0, 0), (0, transform_1.multiply)((0, transform_1.rotationRpy)(0, 0, -b.yaw), (0, transform_1.translation)(-b.x, -b.y, -b.liftZ)));
        return (0, transform_1.multiply)(inv, (0, transform_1.fromPose)(pose));
    }
    /** @description The joint origins in the world frame (for drawing and collision checks). */
    armPointsWorld(q = this.unit.q) {
        const T = this.armBaseTransform();
        return (0, arm_model_1.jointOrigins)(this.armSpec, q).map((p) => (0, transform_1.applyToPoint)(T, p));
    }
    // ── Stability ──────────────────────────────────────────────────────────────
    /** @description The lumped masses in the base frame for the current configuration. */
    massItems(q = this.unit.q, payloadKg = this.heldMass()) {
        const arm = (0, arm_model_1.armCenterOfMass)(this.armSpec, q);
        const lift = this.unit.base.liftZ;
        const items = [...stability_1.HARDWARE_BASE_ITEMS, { name: 'arm', mass: arm.mass, com: [exports.ARM_MOUNT_X + arm.com[0], arm.com[1], lift + arm.com[2]] }];
        if (payloadKg > 0) {
            const tcp = (0, arm_model_1.forwardKinematics)(this.armSpec, q).tcp;
            items.push({ name: 'payload', mass: payloadKg, com: [exports.ARM_MOUNT_X + tcp[3], tcp[7], lift + tcp[11]] });
        }
        return items;
    }
    /** @description The live tip budget. */
    tipBudget(q = this.unit.q, payloadKg = this.heldMass()) {
        return (0, stability_1.tipBudget)(this.massItems(q, payloadKg), stability_1.HARDWARE_FOOTPRINT);
    }
    /** @description Mass of whatever the gripper holds (a door handle carries no payload). */
    heldMass() {
        const id = this.unit.gripper.holding;
        if (!id || id.startsWith('handle:'))
            return 0;
        return scene_1.OBJECT_CLASSES[(0, scene_1.objectById)(this.scene, id).cls].mass;
    }
    /** @description The appliance whose handle the gripper holds, or null. */
    heldAppliance() {
        const id = this.unit.gripper.holding;
        return id && id.startsWith('handle:') ? id.slice('handle:'.length) : null;
    }
    // ── Guards shared by the primitives ─────────────────────────────────────────
    requireLive() {
        if (this.unit.estop)
            throw new Error('refused: e-stop is latched — a human must reset it');
        if (!this.unit.enabled)
            throw new Error('refused: the unit is disabled');
    }
    record(node, text, level = 'info') {
        this.seq += 1;
        this.events.push({ seq: this.seq, tMs: this.timeMs, node, text, level });
        if (this.events.length > 400)
            this.events.splice(0, this.events.length - 400);
    }
    // ── Base primitives ────────────────────────────────────────────────────────
    /**
     * @description Drive a straight leg to a goal pose. Refused when the goal cell or the straight
     * line to it crosses an inflated obstacle, or the speed the lift allows fails the energy rule.
     * @param goal - Goal pose.
     */
    driveTo(goal) {
        this.requireLive();
        const b = this.unit.base;
        if (!(0, occupancy_grid_1.isFree)(this.grid, goal))
            throw new Error(`refused: goal (${(0, vec_1.round)(goal.x, 2)}, ${(0, vec_1.round)(goal.y, 2)}) is inside an inflated obstacle`);
        if (!(0, occupancy_grid_1.lineClear)(this.grid, b, goal))
            throw new Error('refused: the straight leg crosses an obstacle');
        const check = (0, stability_1.speedCheck)(this.tipBudget(), this.unit.base.liftZ <= this.baseLimits.liftMin + 0.01 ? this.baseLimits.vStowed : this.baseLimits.vLifted);
        if (!check.ok)
            throw new Error(`refused: travel speed fails the tip budget (factor ${(0, vec_1.round)(check.factor, 2)})`);
        this.unit.driveGoal = { ...goal };
        this.unit.jog = null;
        this.unit.phase = 'driving';
        this.record(exports.UNIT_NODE_ID, `drive to (${(0, vec_1.round)(goal.x, 2)}, ${(0, vec_1.round)(goal.y, 2)}) heading ${(0, vec_1.round)(goal.yaw, 2)}`);
    }
    /**
     * @description Manual velocity jog for a bounded time. The predicted end point must be free.
     * @param v - Forward speed (clamped to the lift-dependent limit).
     * @param w - Turn rate.
     * @param seconds - Duration, at most 2 s per command.
     */
    jog(v, w, seconds) {
        this.requireLive();
        const dur = Math.min(2, Math.max(0.05, seconds));
        const b = this.unit.base;
        const vLimit = b.liftZ <= this.baseLimits.liftMin + 0.01 ? this.baseLimits.vStowed : this.baseLimits.vLifted;
        const vc = Math.max(-vLimit, Math.min(vLimit, v));
        const predicted = { x: b.x + vc * Math.cos(b.yaw) * dur, y: b.y + vc * Math.sin(b.yaw) * dur };
        if (!(0, occupancy_grid_1.isFree)(this.grid, predicted) || !(0, occupancy_grid_1.lineClear)(this.grid, b, predicted))
            throw new Error('refused: the jog would enter an obstacle');
        const check = (0, stability_1.speedCheck)(this.tipBudget(), vc);
        if (!check.ok)
            throw new Error(`refused: jog speed fails the tip budget (factor ${(0, vec_1.round)(check.factor, 2)})`);
        this.unit.driveGoal = null;
        this.unit.jog = { v: vc, w, untilMs: this.timeMs + dur * 1000 };
        this.unit.phase = 'jogging';
    }
    /** @description Stop the base (confirm-exempt). */
    stopBase() {
        this.unit.driveGoal = null;
        this.unit.jog = null;
        this.unit.base = { ...this.unit.base, v: 0, w: 0 };
        this.unit.phase = 'idle';
    }
    /** @description Move the lift to a height (clamped to travel). */
    setLift(z) {
        this.requireLive();
        if (!Number.isFinite(z))
            throw new Error('refused: lift height must be a number');
        this.unit.liftTarget = Math.min(this.baseLimits.liftMax, Math.max(this.baseLimits.liftMin, z));
        this.record(exports.UNIT_NODE_ID, `lift to ${(0, vec_1.round)(this.unit.liftTarget, 2)} m`);
    }
    // ── Arm primitives ─────────────────────────────────────────────────────────
    /**
     * @description Move the tool to a world pose. Solves inverse kinematics from the current
     * configuration, refuses an unreachable pose, a target configuration that puts the tool or an
     * elbow inside an obstacle, or one whose tip budget cannot carry the held payload with the
     * required factor. Sets the joint target; motion happens over the following steps.
     * @param pose - Target tool pose in the world frame.
     * @param expectedForceN - Horizontal force the task will apply at the tool (0 for free motion).
     * @returns The inverse-kinematics result.
     */
    moveArmToWorldPose(pose, expectedForceN = 0, contactRadius = 0) {
        this.requireLive();
        this.contact = contactRadius > 0 ? { center: [pose.x, pose.y, pose.z], radius: contactRadius } : null;
        const ik = this.chooseClearSolution(pose);
        const budget = this.tipBudget(ik.q);
        const check = (0, stability_1.wrenchCheck)(budget, expectedForceN, 0, pose.z);
        if (!check.ok)
            throw new Error(`refused: tip budget factor ${(0, vec_1.round)(check.factor, 2)} at the ${check.edge} edge for ${(0, vec_1.round)(expectedForceN, 0)} N at ${(0, vec_1.round)(pose.z, 2)} m`);
        this.unit.qTarget = ik.q;
        this.unit.phase = 'arm-moving';
        this.record(exports.UNIT_NODE_ID, `tool to (${(0, vec_1.round)(pose.x, 2)}, ${(0, vec_1.round)(pose.y, 2)}, ${(0, vec_1.round)(pose.z, 2)})`);
        return ik;
    }
    /** @description Move the joints to a configuration (must be clear of obstacles). */
    moveArmJoints(q) {
        this.requireLive();
        if (q.length !== this.armSpec.joints.length)
            throw new Error('refused: wrong joint count');
        this.assertArmConfigurationClear(q);
        this.assertSweepClear(this.unit.q, q);
        this.unit.qTarget = [...q];
        this.unit.phase = 'arm-moving';
        this.record(exports.UNIT_NODE_ID, 'joints to a named configuration');
    }
    /**
     * @description Among every inverse-kinematics solution for a world pose, pick the one clear of
     * obstacles that moves the joints least from where they are. Refuses when the pose is
     * unreachable or every solution collides, naming what it would hit.
     */
    chooseClearSolution(pose) {
        const { solutions, bestFailure } = (0, inverse_kinematics_1.ikSolutions)(this.armSpec, this.worldToArmFrame(pose), this.unit.q);
        if (!solutions.length)
            throw new Error(`refused: tool pose unreachable (${bestFailure?.reason ?? 'no convergence'}, ${(0, vec_1.round)(bestFailure?.positionError ?? 0, 3)} m off)`);
        let firstHit = null;
        const clear = solutions.filter((s) => { const hit = this.configurationCollision(s.q); if (hit && !firstHit)
            firstHit = hit; return !hit; });
        if (!clear.length)
            throw new Error(`refused: the arm would pass through ${firstHit}`);
        const jointDistance = (q) => q.reduce((sum, v, i) => sum + Math.abs(v - this.unit.q[i]), 0);
        clear.sort((a, b) => jointDistance(a.q) - jointDistance(b.q));
        let sweepHit = null;
        for (const s of clear) {
            const hit = this.sweepCollision(this.unit.q, s.q);
            if (!hit)
                return s;
            if (!sweepHit)
                sweepHit = hit;
        }
        throw new Error(`refused: the arm would sweep through ${sweepHit} on the way`);
    }
    /**
     * @description The obstacle (or 'the floor') a configuration's links pass through, or null when
     * clear. Every link is sampled along its length at ≤ 5 cm, not just at the joints, so a forearm
     * crossing a cabinet wall between two clear joints is caught.
     */
    configurationCollision(q) {
        const pts = this.armPointsWorld(q);
        const base = pts[0];
        // A door the gripper holds moves with the tool: its (stale) voxels are not an obstacle to the arm.
        const held = this.heldAppliance();
        const heldDoor = held ? (0, scene_1.doorSlices)((0, scene_1.applianceById)(this.scene, held).door, (0, scene_1.applianceById)(this.scene, held).angle, `${held}-door`) : [];
        const inHeldDoor = (p) => heldDoor.some((s) => p[0] >= s.min[0] - 0.06 && p[0] <= s.max[0] + 0.06 && p[1] >= s.min[1] - 0.06 && p[1] <= s.max[1] + 0.06 && p[2] >= s.min[2] && p[2] <= s.max[2]);
        for (let i = 1; i < pts.length; i += 1) {
            const a = pts[i - 1];
            const b = pts[i];
            const n = Math.max(1, Math.ceil((0, vec_1.distance)(a, b) / 0.05));
            for (let k = i === 1 ? n : 1; k <= n; k += 1) {
                const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n];
                if (p[2] < 0.02)
                    return 'the floor';
                if (inHeldDoor(p))
                    continue;
                if (this.contact && (0, vec_1.distance)(p, this.contact.center) <= this.contact.radius)
                    continue;
                const s = this.world.map.stateAt(p);
                if (s === voxel_map_1.OCCUPIED)
                    return `a mapped obstacle at (${(0, vec_1.round)(p[0], 2)}, ${(0, vec_1.round)(p[1], 2)}, ${(0, vec_1.round)(p[2], 2)})`;
                if (s === voxel_map_1.UNKNOWN && (0, vec_1.distance)(p, base) > exports.SELF_BUBBLE_M)
                    return `unknown space at (${(0, vec_1.round)(p[0], 2)}, ${(0, vec_1.round)(p[1], 2)}, ${(0, vec_1.round)(p[2], 2)})`;
            }
        }
        return null;
    }
    /** @description Refuse a configuration whose links pass through an obstacle. Surfaces objects rest on are not solids above their top. */
    assertArmConfigurationClear(q) {
        const hit = this.configurationCollision(q);
        if (hit)
            throw new Error(`refused: the arm would pass through ${hit}`);
    }
    /**
     * @description Swept-volume check: the straight joint-space path from `from` to `to`, sampled
     * every {@link SWEEP_STEP_RAD} on the largest joint delta, must be clear at every sample. Both
     * endpoints being clear is not enough — the elbow can cut through a counter between them.
     */
    assertSweepClear(from, to) {
        const hit = this.sweepCollision(from, to);
        if (hit)
            throw new Error(`refused: the arm would sweep through ${hit} on the way`);
    }
    /** @description The first solid the interpolated joint path passes through, or null when the sweep is clear. */
    sweepCollision(from, to) {
        const span = Math.max(...to.map((v, i) => Math.abs(v - from[i])));
        const n = Math.max(1, Math.ceil(span / exports.SWEEP_STEP_RAD));
        for (let k = 1; k < n; k += 1) {
            const q = from.map((v, i) => v + ((to[i] - v) * k) / n);
            const hit = this.configurationCollision(q);
            if (hit)
                return hit;
        }
        return null;
    }
    // ── Door handles ───────────────────────────────────────────────────────────
    /** @description Where the gripper must be to hold an appliance's handle right now. */
    handleTarget(applianceId) {
        const a = (0, scene_1.applianceById)(this.scene, applianceId);
        if (!a.door)
            throw new Error(`refused: ${applianceId} has no door`);
        return (0, scene_1.handleGrasp)(a.door, a.angle);
    }
    /**
     * @description Close the gripper on an appliance handle. The tool must be within the grasp
     * tolerance of the handle's grasp point. From then on the door follows the tool along its arc.
     * @param applianceId - The appliance.
     */
    graspHandle(applianceId) {
        this.requireLive();
        if (this.unit.gripper.holding)
            throw new Error('refused: the gripper already holds something');
        const { point } = this.handleTarget(applianceId);
        const tcp = this.tcpWorld();
        if ((0, vec_1.distance)([tcp.x, tcp.y, tcp.z], point) > exports.GRASP_TOLERANCE)
            throw new Error(`refused: the tool is ${(0, vec_1.round)((0, vec_1.distance)([tcp.x, tcp.y, tcp.z], point), 3)} m from the ${applianceId} handle`);
        this.unit.gripper = { width: 0.03, holding: (0, exports.handleHold)(applianceId) };
        this.record(exports.UNIT_NODE_ID, `took the ${applianceId} handle`);
    }
    /** @description Let go of the handle; the door stays where it is. */
    releaseHandle() {
        this.requireLive();
        const id = this.heldAppliance();
        if (!id)
            return null;
        this.unit.gripper = { width: exports.GRIPPER_MAX_WIDTH, holding: null };
        const a = (0, scene_1.applianceById)(this.scene, id);
        this.record(exports.UNIT_NODE_ID, `released the ${id} handle at ${(0, vec_1.round)(a.angle * 180 / Math.PI, 0)}°`);
        return id;
    }
    /**
     * @description Close the gripper. An unheld, unenclosed object whose centroid lies within the
     * grasp tolerance of the tool is attached and travels with it.
     * @returns The grasped object id.
     */
    grasp() {
        this.requireLive();
        if (this.unit.gripper.holding)
            throw new Error('refused: the gripper already holds an object');
        const tcp = this.tcpWorld();
        const here = [tcp.x, tcp.y, tcp.z];
        const candidate = this.scene.objects.find((o) => o.location.kind === 'surface' && !(0, scene_1.isEnclosed)(this.scene, o) && (0, vec_1.distance)(here, [o.pose.x, o.pose.y, o.pose.z]) <= exports.GRASP_TOLERANCE);
        if (!candidate)
            throw new Error('refused: nothing within grasp tolerance of the tool');
        candidate.location = { kind: 'gripper', nodeId: exports.UNIT_NODE_ID };
        this.unit.gripper = { width: Math.min(scene_1.OBJECT_CLASSES[candidate.cls].size.w, exports.GRIPPER_MAX_WIDTH), holding: candidate.id };
        // The machine knows it lifted whatever it had mapped under the tool: drop it from the world.
        const known = this.world.objects.map((o) => ({ o, d: (0, vec_1.distance)(here, o.centroid) })).filter((x) => x.d <= 0.12).sort((a, b) => a.d - b.d)[0];
        if (known)
            this.world.lift(known.o.id);
        this.record(exports.UNIT_NODE_ID, `grasped ${candidate.id}${known ? ` (mapped as ${known.o.id})` : ''}`);
        return candidate.id;
    }
    /** @description The discovered object nearest the tool, within a radius. */
    discoveredNearTool(radius = 0.12) {
        const tcp = this.tcpWorld();
        const here = [tcp.x, tcp.y, tcp.z];
        const best = this.world.objects.map((o) => ({ o, d: (0, vec_1.distance)(here, o.centroid) })).filter((x) => x.d <= radius).sort((a, b) => a.d - b.d)[0];
        return best ? best.o.id : null;
    }
    /**
     * @description Open the gripper. A held object comes to rest on the surface under the tool when
     * one is within 35 cm below; otherwise it falls to the floor and the event says so.
     * @returns Where the object ended up, or null when nothing was held.
     */
    release() {
        this.requireLive();
        if (this.heldAppliance()) {
            const id = this.releaseHandle();
            return { objectId: (0, exports.handleHold)(id), surfaceId: null };
        }
        const id = this.unit.gripper.holding;
        this.unit.gripper = { width: exports.GRIPPER_MAX_WIDTH, holding: null };
        if (!id)
            return null;
        const o = (0, scene_1.objectById)(this.scene, id);
        const tcp = this.tcpWorld();
        const surface = this.surfaceUnder(tcp.x, tcp.y, tcp.z);
        if (surface) {
            o.pose = { x: tcp.x, y: tcp.y, z: (0, scene_1.restingZ)(o.cls, surface.z), yaw: tcp.yaw };
            o.location = { kind: 'surface', surfaceId: surface.id };
            this.rememberPlaced(o);
            this.record(exports.UNIT_NODE_ID, `placed ${id} on ${surface.name}`);
            return { objectId: id, surfaceId: surface.id };
        }
        o.pose = { x: tcp.x, y: tcp.y, z: scene_1.OBJECT_CLASSES[o.cls].size.h / 2, yaw: tcp.yaw };
        o.location = { kind: 'floor' };
        this.rememberPlaced(o);
        this.record(exports.UNIT_NODE_ID, `DROPPED ${id} on the floor`, 'warn');
        return { objectId: id, surfaceId: null };
    }
    /** @description The machine knows where it set something down: mark its box in the map (a later scan confirms it). */
    rememberPlaced(o) {
        const s = scene_1.OBJECT_CLASSES[o.cls].size;
        this.world.map.markBox([o.pose.x - s.l / 2, o.pose.y - s.w / 2, o.pose.z - s.h / 2 + 0.005], [o.pose.x + s.l / 2, o.pose.y + s.w / 2, o.pose.z + s.h / 2]);
        this.world.refresh();
    }
    /**
     * @description The highest resting place under (x, y) at or below z within 35 cm: a declared
     * surface, or the top face of any solid (a counter top is a real place to set things down
     * whether or not the scene named it). Doors are not resting places.
     */
    surfaceUnder(x, y, z) {
        const declared = this.scene.surfaces.filter((s) => (0, scene_1.pointOnSurface)(s, x, y) && s.z <= z + 0.005 && z - s.z <= 0.35).map((s) => ({ id: s.id, name: s.name, z: s.z }));
        const tops = this.solids()
            .filter((b) => !(b.name ?? '').endsWith('-door') && x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && b.max[2] <= z + 0.005 && z - b.max[2] <= 0.35)
            .map((b) => ({ id: `top:${b.name ?? 'solid'}`, name: `the top of ${b.name ?? 'a solid'}`, z: b.max[2] }));
        const candidates = [...declared, ...tops].sort((a, b) => b.z - a.z);
        return candidates[0] ?? null;
    }
    /** @description Latch the e-stop: every target is cleared, motion stops, the arm holds. Confirm-exempt. */
    eStop() {
        this.unit.estop = true;
        this.unit.driveGoal = null;
        this.unit.jog = null;
        this.unit.liftTarget = null;
        this.unit.qTarget = null;
        this.unit.base = { ...this.unit.base, v: 0, w: 0 };
        this.unit.phase = 'e-stop';
        this.record(exports.UNIT_NODE_ID, 'E-STOP latched', 'warn');
    }
    /** @description Release the latch. The control layer only calls this on a human's explicit reset. */
    resetEstop() {
        this.unit.estop = false;
        this.unit.phase = 'idle';
        this.record(exports.UNIT_NODE_ID, 'e-stop reset by a human');
    }
    /** @description Stop every unit motion without latching (abort). */
    abortUnit() {
        this.stopBase();
        this.unit.liftTarget = null;
        this.unit.qTarget = null;
    }
    // ── Drone primitives ───────────────────────────────────────────────────────
    /** @description Take off to cruise altitude through a column the map shows clear. */
    droneTakeoff() {
        if (this.droneDown)
            throw new Error(`drone is down: ${this.droneDown}`);
        for (let z = this.drone.z + 0.4; z <= this.droneLimits.cruiseAlt; z += 0.05) {
            const why = this.droneClear([this.drone.x, this.drone.y, z], false);
            if (why)
                throw new Error(`takeoff refused: ${why} at ${(0, vec_1.round)(z, 2)} m — scan first`);
        }
        this.drone = (0, quad_model_1.takeoff)(this.drone, this.droneLimits);
        this.cmd = null;
        this.record(exports.DRONE_NODE_ID, 'takeoff');
    }
    /** @description Fly to a point inside the room along a straight line that the DISCOVERED map shows clear. */
    droneGoto(target, opts = {}) {
        if (this.droneDown)
            throw new Error(`drone is down: ${this.droneDown}`);
        if (this.localization.status === 'lost' && !opts.recovering)
            throw new Error('goto refused: localisation lost — land and re-anchor on the pad');
        if (this.drone.mode === 'landed')
            throw new Error('goto refused: the drone is not airborne — take off first');
        const roomOnly = { ...this.fence, keepOut: [] };
        const from = [this.drone.x, this.drone.y, this.drone.z];
        const len = (0, vec_1.distance)(from, target);
        const n = Math.max(1, Math.ceil(len / 0.05));
        // Where the drone already stands may have become too close once the map grew under it; it may back out.
        const stuck = this.droneClear(from) !== null;
        for (let i = 1; i <= n; i += 1) {
            const p = [from[0] + ((target[0] - from[0]) * i) / n, from[1] + ((target[1] - from[1]) * i) / n, from[2] + ((target[2] - from[2]) * i) / n];
            if (stuck && (0, vec_1.distance)(p, from) <= exports.DRONE_BACKOUT_M)
                continue;
            const why = this.droneClear(p);
            if (why)
                throw new Error(`goto refused: path through ${why} at (${(0, vec_1.round)(p[0], 2)}, ${(0, vec_1.round)(p[1], 2)}, ${(0, vec_1.round)(p[2], 2)})`);
        }
        this.drone = (0, quad_model_1.gotoPoint)(this.drone, target, roomOnly, this.droneLimits);
        this.cmd = null;
        this.record(exports.DRONE_NODE_ID, `goto (${(0, vec_1.round)(target[0], 2)}, ${(0, vec_1.round)(target[1], 2)}, ${(0, vec_1.round)(target[2], 2)})`);
    }
    /** @description Land straight down (confirm-exempt) — refused over a mapped obstacle, never over unknown floor by an executor plan (abort still lands). */
    droneLand(force = false) {
        if (!force && this.drone.mode !== 'landed') {
            for (let z = this.drone.z - 0.05; z >= 0.4; z -= 0.05) {
                if (this.world.map.stateAt([this.drone.x, this.drone.y, z]) === voxel_map_1.OCCUPIED)
                    throw new Error(`land refused: a mapped obstacle below at ${(0, vec_1.round)(z, 2)} m`);
            }
        }
        this.drone = (0, quad_model_1.land)(this.drone);
        this.cmd = null;
        this.record(exports.DRONE_NODE_ID, 'land');
    }
    /**
     * @description The way back for a lost drone (B14): the registered trail in reverse at cruise altitude, points closer than
     * 15 cm to each other or to the drone dropped, then the column above the pad — at most RECOVERY_TRAIL_MAX points.
     */
    recoveryTrail() {
        const here = [this.drone.x, this.drone.y, this.drone.z];
        const cruise = this.droneLimits.cruiseAlt;
        const trail = [];
        for (const p of [...this.registeredTrail].reverse()) {
            const q = [p[0], p[1], cruise];
            if ((0, vec_1.distance)(q, here) > 0.15 && (!trail.length || (0, vec_1.distance)(trail[trail.length - 1], q) > 0.15))
                trail.push(q);
        }
        const home = this.scene.droneHome;
        trail.push([home[0], home[1], cruise]);
        return trail.slice(-exports.RECOVERY_TRAIL_MAX);
    }
    /** @description A lost drone that cannot recover lands where it is and declares itself grounded: the plan fails, a person decides. */
    groundLost(reason) {
        if (this.drone.mode !== 'landed')
            this.droneLand(true);
        this.droneDown = `grounded: ${reason}`;
        this.record(exports.DRONE_NODE_ID, this.droneDown, 'warn');
    }
    /** @description The camera pose for the current drone pose and gimbal pitch. */
    droneCamera() {
        return { position: [this.truth.x, this.truth.y, this.truth.z], yaw: this.truth.yaw, pitch: this.gimbalPitch };
    }
    /** @description The camera pose the MACHINE believes it has — what it back-projects detections with. The picture itself forms at the true pose. */
    believedDroneCamera() {
        return { position: [this.drone.x, this.drone.y, this.drone.z], yaw: this.drone.yaw, pitch: this.gimbalPitch };
    }
    /**
     * @description Take one observation: every unenclosed object in the camera's view, plus the
     * scene outlines the surface draws. Point the gimbal first with `pitch`.
     * @param pitch - Gimbal pitch (rad, negative down); omitted keeps the current one.
     * @param yaw - Drone heading to observe with; omitted keeps the current one.
     * @returns The frame.
     */
    droneObserve(pitch, yaw) {
        if (typeof pitch === 'number')
            this.gimbalPitch = pitch;
        if (typeof yaw === 'number') {
            this.truth = { ...this.truth, yaw: this.truth.yaw + (yaw - this.drone.yaw) };
            this.drone = { ...this.drone, yaw };
        }
        const frame = this.viewFrame();
        this.record(exports.DRONE_NODE_ID, `observed ${frame.detections.length} object(s)`);
        return frame;
    }
    /** @description The camera's current view with no side effect — what the surface renders as the live picture. */
    viewFrame() {
        const cam = this.droneCamera();
        const observable = this.scene.objects.map((o) => ({ id: o.id, cls: o.cls, center: [o.pose.x, o.pose.y, o.pose.z], size: scene_1.OBJECT_CLASSES[o.cls].size, enclosed: (0, scene_1.isEnclosed)(this.scene, o) || o.location.kind === 'gripper' }));
        const detections = (0, camera_model_1.observe)(this.intrinsics, cam, observable);
        const T = (0, camera_model_1.cameraToWorld)(cam);
        const outlines = this.solids().map((b) => (0, camera_model_1.projectBoxOutline)(this.intrinsics, T, b));
        return { intrinsics: this.intrinsics, camera: this.believedDroneCamera(), detections, outlines, simulated: true };
    }
    /**
     * @description Place a detection in the world from one camera: intersect the pixel ray with the
     * plane through the centroid of an object of that class resting on each candidate surface, and
     * accept the first surface whose area contains the hit.
     * @param det - The detection.
     * @param cam - The camera pose the detection was taken with.
     * @returns The estimated centroid and the surface it rests on, or null.
     */
    localize(det, cam) {
        const cls = det.cls;
        if (!(cls in scene_1.OBJECT_CLASSES))
            return null;
        const ordered = [...this.scene.surfaces].sort((a, b) => b.z - a.z);
        for (const s of ordered) {
            const hit = (0, camera_model_1.localizeOnPlane)(this.intrinsics, cam, det.u, det.v, (0, scene_1.restingZ)(cls, s.z));
            if (hit && (0, scene_1.pointOnSurface)(s, hit[0], hit[1]))
                return { position: hit, surfaceId: s.id };
        }
        return null;
    }
    // ── Stepping ───────────────────────────────────────────────────────────────
    /**
     * @description Advance the world by a duration in fixed 50 ms steps.
     * @param ms - Milliseconds to advance (rounded up to whole steps).
     */
    advance(ms) {
        const steps = Math.max(0, Math.ceil(ms / (exports.STEP_S * 1000)));
        for (let i = 0; i < steps; i += 1) {
            this.timeMs += exports.STEP_S * 1000;
            this.stepBase();
            this.stepLift();
            this.stepArm();
            this.stepDrone();
        }
    }
    /** @description Fly the BELIEF one step; move the truth by the odometry model; strike the hidden scene if the truth is inside it; take the pad fix on landing. */
    stepDrone() {
        const before = this.drone;
        const struck = this.plant ? this.stepPlant(before) : this.stepKinematic(before);
        if (this.drone === before)
            return;
        if (before.mode === 'landing' && this.drone.mode === 'landed') {
            this.padFix();
            return;
        }
        if (this.drone.mode !== 'landed')
            this.altitudeHold();
        if (!struck)
            return;
        const p = this.truth;
        this.droneDown = `struck ${struck} at true position (${(0, vec_1.round)(p.x, 2)}, ${(0, vec_1.round)(p.y, 2)}, ${(0, vec_1.round)(p.z, 2)}) while it believed it was at (${(0, vec_1.round)(this.drone.x, 2)}, ${(0, vec_1.round)(this.drone.y, 2)}, ${(0, vec_1.round)(this.drone.z, 2)})`;
        this.drone = { ...this.drone, mode: 'landed', target: null };
        this.record(exports.DRONE_NODE_ID, this.droneDown, 'warn');
    }
    /** @description The kinematic drone: the belief flies the autopilot's ramp, the odometry model moves the truth; a strike is the true body inside an unmapped solid. */
    stepKinematic(before) {
        this.drone = (0, quad_model_1.droneStep)(before, this.droneLimits, exports.STEP_S);
        if (this.drone === before)
            return null;
        this.truth = (0, quad_model_1.propagateTruth)(this.truth, before, this.drone, this.droneLimits.odometry);
        if (this.drone.mode === 'landed' || this.truth.z < this.droneLimits.minMovingAlt)
            return null;
        const p = [this.truth.x, this.truth.y, this.truth.z];
        const hit = this.sensingSolids().find((b) => b.max[2] > 0.05 && (0, quad_model_1.insideBox)(p, { min: b.min, max: b.max }, this.droneRadiusM));
        return hit ? hit.name : null;
    }
    /**
     * @description The physics truth: the plant flies toward the pose the autopilot commands (the belief); a strike is a
     * contact the plant reports. A phase the belief has finished (arrived, climbed, landed) is held until the plant
     * has settled there — the node says when it has arrived, the belief does not assume it.
     */
    stepPlant(before) {
        // The autopilot ramps a SETPOINT; the plant chases it and lags. The belief dead-reckons the commanded motion and is
        // corrected by the sensors; a corrected belief does not pull the setpoint back, or a lagging plant would crawl.
        const cmd = this.cmd ?? { x: before.x, y: before.y, z: before.z, yaw: before.yaw };
        const ramp = (0, quad_model_1.droneStep)({ ...before, ...cmd }, this.droneLimits, exports.STEP_S);
        if (before.mode === 'landed' && ramp.mode === 'landed')
            return null;
        this.cmd = { x: ramp.x, y: ramp.y, z: ramp.z, yaw: ramp.yaw };
        this.drone = { ...ramp, x: before.x + (ramp.x - cmd.x), y: before.y + (ramp.y - cmd.y), z: before.z + (ramp.z - cmd.z), yaw: before.yaw + (ramp.yaw - cmd.yaw) };
        const phase = before.mode;
        const r = this.plant.step(this.cmd, phase, exports.STEP_S);
        this.truth = r.pose;
        // A phase the ramp has finished (arrived, climbed, landed) is held until the plant has settled there: the node says when it
        // has arrived — and the map says whether that is inside the commanded voxel layer. A climb that overshoots by 3.4 cm was
        // "settled" to the plant's 5 cm tolerance, and the first scan carved the layer ABOVE the mission altitude while the
        // mission layer around the pad stayed unknown (found on MuJoCo over the node rail): a hover is reached only within the
        // layer's half-height, less a margin, of the commanded altitude.
        const finished = before.mode !== this.drone.mode && (this.drone.mode === 'hover' || this.drone.mode === 'landed');
        const inLayer = this.drone.mode !== 'hover' || Math.abs(r.pose.z - this.cmd.z) < this.world.map.res / 2 - exports.LAYER_HOLD_MARGIN_M;
        if (finished && !(r.settled && inLayer))
            this.drone = { ...this.drone, mode: before.mode, target: before.target };
        return r.contact;
    }
    /**
     * @description A nadir ranger is an altitude hold: every step in flight the believed altitude is the ranger's
     * reading plus what the map says is under the drone (the column's discovered top; the floor when nothing is).
     * Over a column whose top is unknown the reading cannot be placed and dead reckoning stands.
     */
    altitudeHold() {
        const range = this.sensorSet.nadirRangerM;
        if (range === null)
            return;
        const drop = this.underDrop();
        const hit = (0, raycast_1.castRay)([this.truth.x, this.truth.y, this.truth.z - drop], [0, 0, -1], this.sensingSolids(), range);
        if (!hit)
            return;
        // The ranger does not say WHAT it is reading. Candidates: the floor, or any discovered top within one cell of
        // where the drone believes it is (an edge is a cell boundary). Take the one that moves the belief least; a
        // reading no candidate explains within half a metre is left alone — dead reckoning stands.
        const map = this.world.map;
        const candidates = [0];
        const [i0, j0] = map.toCell([this.drone.x, this.drone.y, 0]);
        for (let dj = -1; dj <= 1; dj += 1)
            for (let di = -1; di <= 1; di += 1) {
                const i = i0 + di;
                const j = j0 + dj;
                if (i < 0 || j < 0 || i >= map.nx || j >= map.ny)
                    continue;
                const t = map.topWithClearance(j * map.nx + i);
                if (Number.isFinite(t) && t > 0)
                    candidates.push(t);
            }
        let best = Number.NaN;
        let bestGap = 0.5;
        for (const t of candidates) {
            const z = hit.t + drop + t;
            const gap = Math.abs(z - this.drone.z);
            if (gap < bestGap) {
                bestGap = gap;
                best = z;
            }
        }
        if (Number.isNaN(best))
            return;
        this.drone = { ...this.drone, z: best };
    }
    /** @description Landing within reach of the pad's fiducial: the machine learns exactly where it sits and the belief snaps to the truth. */
    padFix() {
        const home = this.scene.droneHome;
        const onPad = Math.hypot(this.truth.x - home[0], this.truth.y - home[1]) <= exports.PAD_FIX_RADIUS;
        if (!onPad)
            return;
        const err = this.localizationError();
        this.truth = { ...this.truth, z: home[2] };
        this.drone = { ...this.drone, x: this.truth.x, y: this.truth.y, z: this.truth.z, yaw: this.truth.yaw, home: [this.truth.x, this.truth.y, this.truth.z] };
        this.cmd = null;
        this.localization = { ...this.localization, status: 'anchored', correctionM: err.positionM, yawCorrectionRad: err.yawRad };
        this.registeredTrail = [];
        this.record(exports.DRONE_NODE_ID, `pad fix: belief corrected ${(0, vec_1.round)(err.positionM * 100, 1)} cm, ${(0, vec_1.round)((err.yawRad * 180) / Math.PI, 2)}°`);
    }
    stepBase() {
        const u = this.unit;
        if (u.jog) {
            if (this.timeMs >= u.jog.untilMs) {
                this.stopBase();
                return;
            }
            u.base = (0, diff_drive_1.integrateUnicycle)(u.base, u.jog.v, u.jog.w, exports.STEP_S, this.baseLimits);
            return;
        }
        if (!u.driveGoal)
            return;
        const r = (0, diff_drive_1.driveStep)(u.base, u.driveGoal, this.baseLimits, exports.STEP_S);
        u.base = r.next;
        u.phase = r.phase === 'done' ? 'idle' : `driving:${r.phase}`;
        if (r.done) {
            u.driveGoal = null;
            this.record(exports.UNIT_NODE_ID, 'arrived');
        }
    }
    stepLift() {
        const u = this.unit;
        if (u.liftTarget === null)
            return;
        const r = (0, diff_drive_1.liftStep)(u.base, u.liftTarget, this.baseLimits, exports.STEP_S);
        u.base = r.next;
        if (r.done)
            u.liftTarget = null;
    }
    /**
     * @description The arm's truth on a physics plant: the servos are commanded the angles the planner asked for and the
     * joints report back where they REALLY are. A position servo settles short of its command by its load over its gain,
     * so `q` is what the plant measured and never the command echoed back — the guards, the tool point and the tip budget
     * all read the measurement. Arrival is the plant's, not the ramp's: a node says when it got there.
     */
    stepArmPlant() {
        const u = this.unit;
        const plant = this.armPlant;
        const command = u.qTarget ?? u.q;
        const grip = u.gripper.holding ? exports.ARM_GRIP_CLOSED_RAD : exports.ARM_GRIP_OPEN_RAD;
        const r = plant.step(command, grip, exports.STEP_S);
        u.q = r.q.slice(0, this.armSpec.joints.length);
        this.armTelemetry = { torqueNm: r.torqueNm, contact: r.contact, grip: r.grip };
        if (r.contact && r.contact !== this.lastArmContact) {
            this.lastArmContact = r.contact;
            this.record(exports.UNIT_NODE_ID, `the arm touched ${r.contact}`, 'warn');
        }
        else if (!r.contact)
            this.lastArmContact = null;
        if (u.qTarget && r.settled) {
            u.qTarget = null;
            if (u.phase === 'arm-moving')
                u.phase = 'idle';
        }
    }
    stepArm() {
        const u = this.unit;
        if (this.armPlant)
            this.stepArmPlant();
        else if (u.qTarget) {
            const r = (0, arm_model_1.stepJoints)(this.armSpec, u.q, u.qTarget, exports.STEP_S);
            u.q = r.q;
            if (r.arrived) {
                u.qTarget = null;
                if (u.phase === 'arm-moving')
                    u.phase = 'idle';
            }
        }
        const appliance = this.heldAppliance();
        if (appliance) {
            const a = (0, scene_1.applianceById)(this.scene, appliance);
            const tcp = this.tcpWorld();
            if (a.door) {
                const before = a.angle;
                a.angle = (0, scene_1.doorAngleFromPoint)(a.door, tcp.x, tcp.y);
                if (Math.abs(a.angle - before) > 1e-6)
                    this.relocateDoor(a.id, before, a.angle);
            }
        }
        else if (u.gripper.holding) {
            const o = (0, scene_1.objectById)(this.scene, u.gripper.holding);
            const tcp = this.tcpWorld();
            o.pose = { x: tcp.x, y: tcp.y, z: tcp.z, yaw: tcp.yaw };
        }
        for (const a of this.scene.appliances)
            if (a.door)
                a.open = a.angle >= a.door.openThreshold;
    }
    /** @description The machine moved a door it holds: its old panel voxels are known free now and the new ones occupied. */
    relocateDoor(applianceId, from, to) {
        const a = (0, scene_1.applianceById)(this.scene, applianceId);
        if (!a.door)
            return;
        const d = a.door;
        this.world.map.markPanel([d.hinge.x, d.hinge.y], (0, scene_1.doorDirection)(d, from), (0, scene_1.doorNormal)(d, from), d.width, d.thickness, d.height, voxel_map_1.FREE);
        this.world.map.markPanel([d.hinge.x, d.hinge.y], (0, scene_1.doorDirection)(d, to), (0, scene_1.doorNormal)(d, to), d.width, d.thickness, d.height, voxel_map_1.OCCUPIED);
        this.gridCache = null;
    }
    // ── Snapshot ───────────────────────────────────────────────────────────────
    /** @description True when nothing is in motion or pending. */
    isSettled() {
        const u = this.unit;
        return !u.driveGoal && !u.jog && u.liftTarget === null && !u.qTarget && (this.drone.mode === 'landed' || this.drone.mode === 'hover');
    }
    /** @description A plain-data view for the surface and the routes. */
    snapshot() {
        const budget = this.tipBudget();
        const tcp = this.tcpWorld();
        const objects = this.scene.objects.map((o) => ({ ...o, enclosed: (0, scene_1.isEnclosed)(this.scene, o) }));
        return {
            simulated: true,
            timeMs: this.timeMs,
            scenario: this.scene.name,
            scene: { name: this.scene.name, room: this.scene.room, obstacles: this.scene.obstacles, solids: this.solids(), surfaces: this.scene.surfaces, zones: this.scene.zones, appliances: this.scene.appliances.map((a) => ({ ...a, handle: a.door ? (0, scene_1.handleGrasp)(a.door, a.angle).point : null })) },
            objects,
            unit: { nodeId: exports.UNIT_NODE_ID, ...this.unit, tcp, armPoints: this.armPointsWorld(), tipBudget: budget, payloadKg: this.heldMass(), stowed: this.unit.base.liftZ <= this.baseLimits.liftMin + 0.01, speedLimit: this.unit.base.liftZ <= this.baseLimits.liftMin + 0.01 ? this.baseLimits.vStowed : this.baseLimits.vLifted, backend: this.armPlant ? this.armPlant.backend : 'kinematic', plant: this.armPlant ? { engine: this.armPlant.engine, version: this.armPlant.version, seed: this.armPlant.seed } : null, node: (0, arm_plant_1.isArmNode)(this.armPlant) ? { nodeId: this.armPlant.nodeId, link: this.armPlant.link, endpoint: this.armPlant.endpoint } : null, servos: this.armTelemetry },
            drone: { nodeId: exports.DRONE_NODE_ID, ...this.drone, gimbalPitch: this.gimbalPitch, down: this.droneDown, sensorSet: this.sensorSet.id, radiusM: this.droneRadiusM, clearanceM: this.droneClearanceM, clearanceZM: this.droneClearanceZM, backend: this.plant ? ((0, plant_1.isDroneNode)(this.plant) && this.plant.link === 'rail' ? 'node' : 'physics') : 'kinematic', plant: this.plant ? { engine: this.plant.engine, version: this.plant.version, seed: this.plant.seed, controller: this.plant.controller } : null, node: (0, plant_1.isDroneNode)(this.plant) ? { nodeId: this.plant.nodeId, link: this.plant.link, endpoint: this.plant.endpoint } : null, truth: { ...this.truth, simOnly: true }, localization: { ...this.localization, errorM: this.localizationError().positionM, yawErrorRad: this.localizationError().yawRad, trail: this.registeredTrail.length } },
            world: this.world.snapshot(),
            lastSweep: this.lastSweep ? { origin: this.lastSweep.origin, points: this.lastSweep.hits.filter((_, i) => i % 4 === 0).map((h) => h.point.map((v) => (0, vec_1.round)(v, 3))) } : null,
            events: this.events.slice(-40),
        };
    }
    /** @description The base pose as a Pose2. */
    basePose() {
        const b = this.unit.base;
        return { x: b.x, y: b.y, yaw: b.yaw };
    }
}
exports.WorldSim = WorldSim;
//# sourceMappingURL=world-sim.js.map