"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Serves
 *                     |                             | the bundled surface, keeps ONE simulated world per signed-in
 *                     |                             | owner (advanced by wall-clock on every read, and on a timer
 *                     |                             | while a plan executes so it proceeds unwatched), publishes the
 *                     |                             | two nodes' capability manifests (validated at mount — the
 *                     |                             | vocabulary guard), drafts a plan with its rehearsal into a
 *                     |                             | task row, executes it only behind `confirm: true` after a
 *                     |                             | FRESH rehearsal on the live world, and exposes take / release /
 *                     |                             | e-stop / reset / manual command. Every command any actor
 *                     |                             | issues lands in the owner's command log with its outcome.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The discovered world over HTTP: GET /world (map statistics, surfaces, objects), GET /world/voxels (occupied indices for the 3-D view), GET /picture?sensor= (a simulated depth picture, not integrated), POST /scan {sensor} through the command authority, POST /world/label {id,label}; the `explore` task in the draft dispatch; capabilities list the sensors.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | `POST /tasks/draft {task:"explore", droneFirst:true}` sends the drone blind with the rover parked; the state snapshot now carries the drone's localisation (status, last correction, matches, sim-only truth and error).
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | `POST /world/reset {sensorSet}` picks what the drone carries (`recon-3d` | `recon-mini`); `/capabilities` lists the sets; the state names the active one.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | `GET /build/drone?fit=` (the design), `/build/drone/parts/:id` (a part with its CAD Studio program and the body to post to `/api/cad-studio/models`), `/build/drone/design.md` (the design document tables); capabilities list the fits.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | The physics backend (ADR-152): `POST /world/reset {backend:'physics', seed}` loads the MJCF generated for the set's fit into the engine container through one synchronous bridge (503 `physics_unavailable` with the install command when it is down, stale or unreachable); `GET /physics/status` (hello, build hashes, install hint), `GET /physics/mjcf?fit=` (the model), `GET /physics/reports` (training reports from the container); a session's plant is dropped on reset. Specs inject a plant factory.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | B19: the certification gate — POST /physics/certify {file, which} replays a report's recorded flight through THIS owner's fence and map guards and remembers a passing policy per owner; POST /world/reset {backend:'physics', controller:'policy:<file>'} loads that policy as the plant's flight controller only after it passed (409 otherwise); GET /physics/reports carries each report's verdict for the owner. Specs inject a report reader.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | B20: backend 'node' — POST /world/reset {backend:'node', node:'<id>'} gives the world a node that joined the rail by heartbeat (the process-wide fleet the /api/embodied/nodes mount feeds), refused 404 unknown / 503 node_offline before any command; GET /physics/status lists the fleet and whether the rail is configured. Specs inject the fleet and the secret.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | A node belongs to one owner: the fleet is listed and handed out per caller (another owner's node is 404 unknown_node).
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | B4: `POST /world/reset {scenario}` starts the world from a named hidden scene (400 unknown_scenario), `/capabilities.scenarios` lists them, the plant is generated for the chosen scene.
 * 11 | maintainer@emeraldcoastsystemsgroup.com   | B19: a certified report's mode decides the plant interface the policy flies with (ctbr reports fly collective thrust + body rates).
 * 12 | maintainer@emeraldcoastsystemsgroup.com   | The printed arm (ADR-152 D5 task 3): /build/arm, its document and parts, /physics/arm/mjcf and /physics/arm/check — the check runs in the container without blocking the api.
 * 13 | maintainer@emeraldcoastsystemsgroup.com   | B23: fly a scanned room — `POST /world/scenes/import-artifact {ref}` is the ADR-139 `accepts` destination for `application/vnd.oshal.embodied-scene+json`. It redeems the handle through the shared kernel relay as this caller, refuses anything but that MIME (415), reads the `{scene, stats, scanId, title}` envelope against the engine's bounds and `validateScene` (a 4xx naming the rule broken — nothing is registered on a refusal), and registers the scene per owner under `scan:<scanId>`. `POST /world/reset {scenario}` takes an owner's imported id and `/capabilities.scenarios` lists them after the built-ins; the discovery code is unchanged, because it never reads the scene.
 * 14 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S1 "the boat falls": `GET /physics/media` (the three medium records, the force models' declared requirements and validity envelopes, the named refusals), `GET /physics/hull?medium=` (the explorer hull as one solid dropped in a chosen medium: the analytic fall the plant must reproduce, the MJCF it loads, and the flotation question refused by name in the same answer) and `GET /physics/hull/mjcf?medium=`. A medium this lab does not implement is 400 `unknown_medium` and is never substituted; a refusal is 422 carrying its own name (`model_not_valid_in_medium`, `medium_property_unavailable`, `medium_outside_validity`).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArmMountRefused = exports.NODE_MANIFESTS = void 0;
exports.callerSub = callerSub;
exports.createEmbodiedRoutes = createEmbodiedRoutes;
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const embodied_arm_routes_1 = require("./embodied-arm-routes");
const logger_1 = require("@/shared/logger");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const artifact_exchange_1 = require("@/shared/artifact-exchange");
const surface_files_1 = require("./surface-files");
const scenes_1 = require("./engine/world/scenes");
const imported_scenes_1 = require("./engine/world/imported-scenes");
const node_fleet_1 = require("./engine/node/node-fleet");
const rail_node_1 = require("./engine/node/rail-node");
const task_store_1 = require("./task-store");
const engine_1 = require("./engine");
const logger = (0, logger_1.createChildLogger)({ module: 'embodied-routes' });
/** @description The scripts the surface loads, served from one `/assets` mount. */
const SURFACE_SCRIPTS = ['embodied.js'];
/** @description Wall-clock advance is capped per request so a long idle never jumps the world. */
const MAX_ADVANCE_MS = 2000;
/** @description The timer cadence while a plan executes. */
const TICK_MS = 250;
/** @description The tasks the planner knows. `clear-surface` takes DISCOVERED surface ids. */
const TASKS = ['explore', 'clear-surface', 'fetch-from-appliance'];
/** @description Sensors a picture or a manual scan can name. */
const SENSORS = ['drone', 'rover', 'wrist'];
/** @description The two simulated nodes' manifests — validated at mount, published on /capabilities. */
exports.NODE_MANIFESTS = [
    { nodeId: engine_1.UNIT_NODE_ID, kind: 'mobile-manipulator', model: 'sim-6 arm on a differential base with a lift (simulated)', safetyClass: 2, senses: ['pose', 'joint-state', 'lift', 'gripper', 'tip-budget'], acts: ['drive-to', 'jog', 'stop', 'lift', 'move-to-pose', 'move-joints', 'grasp', 'release', 'abort', 'e-stop'], envelope: { reachM: (0, engine_1.maxReach)(engine_1.SIM_ARM_6), vStowedMps: engine_1.DEFAULT_BASE_LIMITS.vStowed, vLiftedMps: engine_1.DEFAULT_BASE_LIMITS.vLifted, liftMinM: engine_1.DEFAULT_BASE_LIMITS.liftMin, liftMaxM: engine_1.DEFAULT_BASE_LIMITS.liftMax } },
    { nodeId: engine_1.DRONE_NODE_ID, kind: 'drone', model: 'indoor mini quad with a pitched camera (simulated)', safetyClass: 2, senses: ['pose', 'battery', 'camera'], acts: ['takeoff', 'goto', 'hover', 'land', 'observe', 'abort'], envelope: { maxSpeedMps: engine_1.DEFAULT_DRONE_LIMITS.maxSpeed, cruiseAltM: engine_1.DEFAULT_DRONE_LIMITS.cruiseAlt, minMovingAltM: engine_1.DEFAULT_DRONE_LIMITS.minMovingAlt } },
];
/**
 * @description Resolve the authenticated caller's sub. The mount is `auth: oidc`; a service-rail
 * caller resolved by the mounter arrives as `oshalCallerSub` and is honoured too.
 * @param req - The request.
 * @returns The sub, or null when the request carries no identity.
 */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
/** @description The truth models a world can run on. */
const BACKENDS = ['kinematic', 'physics', 'node'];
/** @description Which body answers for the ARM (B22). 'node' is declared and refused: it is blocked by core ADR-149 (BACKLOG B20), not by anything the package can change. */
const ARM_BACKENDS = ['kinematic', 'physics', 'node'];
/** @description The arm fit a world stands up: the printed desk arm the sizing check measures. */
const DEFAULT_ARM_FIT = 'desk-6';
/**
 * @description The PRINTED arm's kinematics. A world running the physics arm must believe the arm it is actually
 * driving: the simulation's stock `SIM_ARM_6` is a different machine (a 0.35 m upper arm against the printed 0.16 m),
 * and a belief built on the wrong link lengths misses the tool point with no symptom at all.
 * @returns The printed arm's spec.
 */
const printedArmSpec = () => (0, engine_1.buildArm)(DEFAULT_ARM_FIT).spec;
/** @description A mount the geometry refuses — outside the room, or standing inside a solid. Carried to the route as a 422, never as an engine failure: nothing is wrong with the engine. */
class ArmMountRefused extends Error {
    constructor(message) { super(message); this.name = 'ArmMountRefused'; }
}
exports.ArmMountRefused = ArmMountRefused;
/** @description Reads a plain string body field. */
const str = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
/**
 * @description Build the `/api/embodied` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @param opts - Spec overrides.
 * @returns The composed router.
 */
function createEmbodiedRoutes(ctx, opts = {}) {
    for (const m of exports.NODE_MANIFESTS) {
        const v = (0, engine_1.validateManifest)(m);
        if (!v.ok)
            throw new Error(`embodied: node manifest ${m.nodeId} is invalid: ${v.issues.join('; ')}`);
    }
    const pool = ctx.pool;
    const now = opts.now ?? (() => Date.now());
    const sessions = new Map();
    /** Per owner: the policies whose recorded flight passed this owner's guards. Survives a world reset — that is what a reset consumes. */
    const certifiedBySub = new Map();
    /** B23: the scenes this process's owners have imported from outside, beside their sessions. */
    const imported = new imported_scenes_1.ImportedSceneStore();
    const fleet = opts.fleet ?? (0, node_fleet_1.sharedNodeFleet)();
    const serviceSecret = opts.serviceSecret ?? (() => (process.env.SWARM_SERVICE_SECRET ?? '').trim());
    const router = (0, express_1.Router)();
    // ── The physics engine (ADR-152): one synchronous bridge per process, opened on first use ──────
    const engineDir = node_path_1.default.join(ctx.appPackageDir ?? process.cwd(), 'engine');
    const expectedBuildHash = (0, engine_1.engineBuildHash)(engineDir);
    const engineAddr = opts.engineAddr ?? process.env.EMBODIED_ENGINE_ADDR ?? engine_1.DEFAULT_ENGINE_ADDR;
    let bridge = null;
    const getBridge = () => {
        if (!bridge)
            bridge = new engine_1.SyncBridge({ ...(0, engine_1.parseEngineAddr)(engineAddr), expectedBuildHash, timeoutMs: 30000 });
        return bridge;
    };
    const dropBridge = () => { if (bridge) {
        bridge.close();
        bridge = null;
    } };
    /** An honest 503: what failed, why, and the command that installs the container. */
    const physicsFailure = (error) => {
        const e = error instanceof engine_1.EngineFailure ? error : new engine_1.EngineFailure('engine_error', error instanceof Error ? error.message : String(error));
        if (e.code !== 'engine_error')
            dropBridge();
        logger.warn({ code: e.code, reason: e.reason, engineAddr }, 'Physics engine unavailable');
        return { status: 503, body: { error: 'physics_unavailable', code: e.code, message: e.message, reason: e.reason ?? null, installHint: engine_1.DEFAULT_INSTALL_HINT, engineAddr } };
    };
    /** The plant for a physics world: the MJCF generated from the parts model for the set's fit, loaded into the container. */
    const makePlant = (set, seed, controller, node, sub, scenario, scene) => {
        const probe = new engine_1.WorldSim({ sensorSet: set, scenario, scene });
        const fit = Object.values(engine_1.DRONE_FITS).find((f) => f.sensorSet === set.id)?.id ?? 'recon-mini';
        const solids = probe.sensingSolids();
        const mjcf = (0, engine_1.droneMjcf)(fit, solids, probe.scene.droneHome);
        if (node)
            return rail_node_1.RailDroneNode.load(fleet.get(node, now(), sub ?? null), mjcf, seed, controller, { secret: serviceSecret(), expectedBuildHash, timeoutMs: 30000 });
        return opts.plantFactory ? opts.plantFactory(mjcf, seed, solids, probe.scene.droneHome, controller) : engine_1.RemotePlant.load(getBridge(), mjcf, seed, controller);
    };
    /**
     * The arm plant for a world whose arm runs on physics (B22): the same arm the sizing check measures, standing where
     * the carriage parks in THIS scene, with the scene's own solids around it. The mount is refused before any model is
     * built — an arm outside the room or inside the furniture would load and report torques for a machine that is not
     * the one in the room. `ArmMountRefused` carries the reason to the route.
     */
    const makeArmPlant = (set, seed, scenario, scene) => {
        const probe = new engine_1.WorldSim({ sensorSet: set, armSpec: printedArmSpec(), scenario, scene });
        const mount = probe.armMount();
        const solids = probe.sensingSolids();
        const refusal = (0, engine_1.armMountRefusal)(probe.scene.room, solids, mount);
        if (refusal)
            throw new ArmMountRefused(refusal);
        const mjcf = (0, engine_1.armRoomMjcf)(DEFAULT_ARM_FIT, solids, mount);
        const dh = (0, engine_1.armPlant)(DEFAULT_ARM_FIT).dh;
        return opts.armPlantFactory ? opts.armPlantFactory(mjcf, seed, mount, dh) : engine_1.RemoteArmPlant.load(getBridge(), mjcf, seed, dh);
    };
    /** An honest refusal for a node on the rail: which node, what failed, why — no install hint, the node is not ours to install. */
    const railFailure = (error, node) => {
        if (error instanceof node_fleet_1.NodeOffline)
            return { status: error.known ? 503 : 404, body: { error: error.known ? 'node_offline' : 'unknown_node', nodeId: error.nodeId, lastSeenMs: error.lastSeenMs, message: error.message } };
        const e = error instanceof engine_1.EngineFailure ? error : new engine_1.EngineFailure('engine_error', error instanceof Error ? error.message : String(error));
        logger.warn({ code: e.code, reason: e.reason, node }, 'Rail node unavailable');
        return { status: 503, body: { error: 'node_unavailable', code: e.code, nodeId: node, message: e.message, reason: e.reason ?? null } };
    };
    const readReports = () => (opts.reportReader ? opts.reportReader() : getBridge().call('reports'));
    const certifiedOf = (sub) => { let m = certifiedBySub.get(sub); if (!m) {
        m = new Map();
        certifiedBySub.set(sub, m);
    } return m; };
    /** `pid`, or `policy:<file>` for a policy this owner has certified; anything else is refused with the reason. */
    const controllerFor = (sub, requested) => {
        const text = typeof requested === 'string' ? requested.trim() : 'pid';
        if (!text || text === 'pid')
            return { spec: { kind: 'pid' } };
        if (!text.startsWith('policy:'))
            return { error: 'unknown_controller', message: 'controller must be "pid" or "policy:<file>"' };
        const file = text.slice('policy:'.length);
        const cert = certifiedOf(sub).get(file);
        if (!cert || !cert.certification.ok)
            return { error: 'policy_not_certified', message: `policy ${file} has not passed this world's certification gate — POST /physics/certify first` };
        return { spec: { kind: 'policy', file, residual: cert.residual, interface: cert.interface } };
    };
    const surface = (0, surface_files_1.surfaceFile)(ctx.appPackageDir, 'embodied.html');
    logger.info({ surface, appPackageDir: ctx.appPackageDir }, 'Resolved the embodied surface');
    router.get('/app', (0, surface_files_1.serveSurfaceFile)(surface, 'html'));
    const assets = (0, express_1.Router)();
    for (const file of SURFACE_SCRIPTS)
        assets.get(`/${file}`, (0, surface_files_1.serveSurfaceFile)((0, surface_files_1.surfaceFile)(ctx.appPackageDir, file), 'application/javascript'));
    router.use('/assets', assets);
    /** The owner's session, created on first touch. */
    const session = (sub, sensorSetId, backend = 'kinematic', seed = 0, controller = { kind: 'pid' }, node, scenario, scene, armBackend = 'kinematic') => {
        let s = sessions.get(sub);
        if (s)
            return s;
        const set = (0, engine_1.sensorSetById)(sensorSetId);
        const sim = new engine_1.WorldSim({ sensorSet: set, armSpec: armBackend === 'kinematic' ? undefined : printedArmSpec(), scenario, scene, plant: backend === 'kinematic' ? undefined : makePlant(set, seed, controller, backend === 'node' ? node : undefined, sub, scenario, scene), armPlant: armBackend === 'kinematic' ? undefined : makeArmPlant(set, seed, scenario, scene) });
        const holder = { current: null };
        const sink = (record) => {
            const taskId = holder.current?.taskId ?? null;
            void (0, task_store_1.insertLog)(pool, sub, taskId, record).catch((error) => logger.error({ err: error, sub, command: record.command }, 'Command log insert failed'));
        };
        s = { sim, control: new engine_1.ControlAuthority(sim, sink), taskId: null, lastWallMs: now(), timer: null };
        holder.current = s;
        sessions.set(sub, s);
        return s;
    };
    /** Advance a session by the wall-clock elapsed (capped) and drive the executor. */
    const advance = (sub, s) => {
        const t = now();
        const elapsed = Math.min(MAX_ADVANCE_MS, Math.max(0, t - s.lastWallMs));
        s.lastWallMs = t;
        if (elapsed > 0)
            s.sim.advance(elapsed);
        const before = s.control.executor.state;
        s.control.tick();
        const after = s.control.executor.state;
        if (before === 'running' && after !== 'running' && s.taskId) {
            const status = after === 'done' ? 'done' : after === 'failed' ? 'failed' : after === 'aborted' ? 'aborted' : 'executing';
            if (status !== 'executing') {
                void (0, task_store_1.updateTaskStatus)(pool, sub, s.taskId, status, s.control.executor.stepIndex, s.control.executor.failure).catch((error) => logger.error({ err: error, sub }, 'Task status update failed'));
                s.taskId = null;
                stopTimer(s);
            }
        }
    };
    const stopTimer = (s) => { if (s.timer) {
        clearInterval(s.timer);
        s.timer = null;
    } };
    const startTimer = (sub, s) => {
        if (opts.noTimer || s.timer)
            return;
        s.timer = setInterval(() => { try {
            advance(sub, s);
        }
        catch (error) {
            logger.error({ err: error, sub }, 'Execution tick failed');
        } }, TICK_MS);
        if (typeof s.timer === 'object' && s.timer && 'unref' in s.timer)
            s.timer.unref();
    };
    const controlView = (s) => ({
        mode: s.control.mode, holder: s.control.holder, executor: s.control.executor.state, taskId: s.taskId,
        stepIndex: s.control.executor.stepIndex, currentStep: s.control.executor.currentStep?.label ?? null, stepsTotal: s.control.executor.current?.steps.length ?? 0,
        failure: s.control.executor.failure, lastObservation: s.control.executor.lastObservation,
    });
    const withSub = (req, res) => {
        const sub = callerSub(req);
        if (!sub)
            res.status(401).json({ error: 'not_authenticated' });
        return sub;
    };
    router.get('/capabilities', (req, res) => {
        const scene = new engine_1.WorldSim().scene;
        const mine = callerSub(req);
        res.json({
            app: 'embodied', simulated: true, nodes: exports.NODE_MANIFESTS, tasks: TASKS, sensors: SENSORS,
            sensorSets: Object.values(engine_1.DRONE_SENSOR_SETS).map((d) => ({ id: d.id, label: d.label, registration: d.registration, sensingMassG: d.sensingMassG })),
            fits: Object.values(engine_1.DRONE_FITS).map((f) => ({ id: f.id, label: f.label, sensorSet: f.sensorSet, propIn: f.propIn, cells: f.cells, mAh: f.mAh })),
            backends: BACKENDS,
            armBackends: ARM_BACKENDS,
            scenarios: [...(0, scenes_1.listScenarios)(), ...(mine ? imported.list(mine) : [])],
            sceneImport: { accepts: imported_scenes_1.EMBODIED_SCENE_TYPE, endpoint: '/api/embodied/world/scenes/import-artifact', limits: imported_scenes_1.SCENE_LIMITS },
            taskNotes: { explore: 'the base LiDAR and the drone map the room; run this first — {droneFirst:true} keeps the rover parked and sends the drone blind (upward ranger + scan-to-map registration)', 'clear-surface': 'from/to are DISCOVERED surface ids (GET /world)', 'fetch-from-appliance': 'the fridge door is a taught fixture; drives use the discovered map' },
            scene: scene.zones.map((z) => ({ id: z.id, name: z.name })),
            appliances: scene.appliances.map((a) => ({ id: a.id, name: a.name, hasDoor: Boolean(a.door) })),
            objects: scene.objects.map((o) => ({ id: o.id, cls: o.cls })),
            limits: { base: engine_1.DEFAULT_BASE_LIMITS, drone: engine_1.DEFAULT_DRONE_LIMITS }, tickMs: TICK_MS,
        });
    });
    router.get('/state', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const s = session(sub);
        advance(sub, s);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ...s.sim.snapshot(), control: controlView(s) });
    });
    router.get('/camera', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const s = session(sub);
        advance(sub, s);
        res.setHeader('Cache-Control', 'no-store');
        res.json(s.sim.viewFrame());
    });
    router.get('/world', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const s = session(sub);
        advance(sub, s);
        s.sim.world.refresh();
        res.setHeader('Cache-Control', 'no-store');
        res.json({ simulated: true, ...s.sim.world.snapshot() });
    });
    /** The drone designer: the design for a fit, one part's CAD program, or the design as markdown. Public within the app; nothing owner-scoped in it. */
    router.get('/build/drone', (req, res) => {
        const fit = (0, engine_1.fitById)(typeof req.query.fit === 'string' ? req.query.fit : 'recon-mini');
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits: Object.keys(engine_1.DRONE_FITS) });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ simulated: true, generated: true, ...(0, engine_1.buildDrone)(fit) });
    });
    router.get('/build/drone/design.md', (req, res) => {
        const fit = (0, engine_1.fitById)(typeof req.query.fit === 'string' ? req.query.fit : 'recon-mini');
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits: Object.keys(engine_1.DRONE_FITS) });
            return;
        }
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send((0, engine_1.designMarkdown)(fit));
    });
    router.get('/build/drone/parts/:partId', (req, res) => {
        const fit = (0, engine_1.fitById)(typeof req.query.fit === 'string' ? req.query.fit : 'recon-mini');
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits: Object.keys(engine_1.DRONE_FITS) });
            return;
        }
        const part = (0, engine_1.buildDrone)(fit).parts.find((p) => p.id === req.params.partId);
        if (!part) {
            res.status(404).json({ error: 'unknown_part' });
            return;
        }
        res.json({ fit, part, cadStudio: { title: `${part.name} — ${fit}`, base: part.cad.base, features: part.cad.features, source: { package: 'embodied', fit, partId: part.id, qty: part.qty, material: part.material } } });
    });
    router.get('/world/voxels', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const s = session(sub);
        const map = s.sim.world.map;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ res: map.res, bounds: map.bounds, version: map.version, occupied: map.occupiedList(), stats: map.stats() });
    });
    router.get('/picture', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const sensor = String(req.query.sensor ?? 'drone');
        if (!SENSORS.includes(sensor)) {
            res.status(400).json({ error: 'unknown_sensor', sensors: SENSORS });
            return;
        }
        const s = session(sub);
        advance(sub, s);
        const pic = s.sim.picture(sensor);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ simulated: true, sensor, width: pic.width, height: pic.height, rgb: Buffer.from(pic.rgb).toString('base64'), camera: pic.camera, returns: pic.sweep.hits.length });
    });
    router.post('/scan', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const sensor = str(body.sensor, 'rover');
        if (!SENSORS.includes(sensor)) {
            res.status(400).json({ error: 'unknown_sensor', sensors: SENSORS });
            return;
        }
        const s = session(sub);
        advance(sub, s);
        try {
            const result = s.control.manual({ nodeId: sensor === 'drone' ? engine_1.DRONE_NODE_ID : engine_1.UNIT_NODE_ID, command: 'scan', params: { sensor } }, sub);
            res.json({ ok: true, result, world: s.sim.world.snapshot() });
        }
        catch (error) {
            res.status(409).json({ error: 'scan_refused', message: error instanceof Error ? error.message : String(error) });
        }
    });
    router.post('/world/label', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const s = session(sub);
        const id = str(body.id, '');
        const label = str(body.label, '').slice(0, 40) || null;
        const target = s.sim.world.surface(id) ?? s.sim.world.object(id);
        if (!target) {
            res.status(404).json({ error: 'not_discovered', id });
            return;
        }
        target.label = label;
        logger.info({ sub, id, label }, 'Discovered entity labelled');
        res.json({ ok: true, id, label });
    });
    /**
     * B23 — the ADR-139 `accepts` destination for a Spaces scan. `{ref}` is redeemed through the
     * shared kernel relay AS THIS CALLER (the handle is owner-bound, so another owner's scan cannot
     * be pulled in), the MIME must be the scene type, and the payload must pass the engine's bounds
     * and this world's scene rules before anything is registered — a refusal names the rule it broke
     * and leaves the owner's scenarios exactly as they were.
     */
    router.post('/world/scenes/import-artifact', async (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const ref = String(req.body?.ref ?? '');
        const redeemed = await (0, artifact_exchange_1.redeemArtifactViaRelay)({ port: req.socket.localPort, callerSub: sub, ref, maxBytes: imported_scenes_1.MAX_SCENE_BYTES });
        if (!redeemed.ok) {
            res.status(redeemed.status).json({ error: 'artifact_not_redeemed', rule: 'ref', message: redeemed.error });
            return;
        }
        if (redeemed.type !== imported_scenes_1.EMBODIED_SCENE_TYPE) {
            res.status(415).json({ error: 'unsupported_type', rule: 'type', message: `this destination takes ${imported_scenes_1.EMBODIED_SCENE_TYPE} (a Spaces scene), not ${redeemed.type}`, accepts: imported_scenes_1.EMBODIED_SCENE_TYPE });
            return;
        }
        let scene;
        try {
            scene = (0, imported_scenes_1.readSceneArtifact)(redeemed.buffer);
        }
        catch (error) {
            if (!(error instanceof imported_scenes_1.SceneImportError)) {
                logger.error({ err: error, sub, ref }, 'Scene import failed unexpectedly');
                res.status(500).json({ error: 'scene_import_failed', message: 'the scene could not be read' });
                return;
            }
            logger.warn({ sub, ref, rule: error.rule, issues: error.issues.length }, 'Scene import refused');
            res.status(error.status).json({ error: 'scene_refused', rule: error.rule, message: error.message, issues: error.issues.slice(0, 10), limits: imported_scenes_1.SCENE_LIMITS });
            return;
        }
        imported.put(sub, scene);
        logger.info({ sub, scenario: scene.id, scanId: scene.scanId, solids: scene.scene.obstacles.length }, 'Scene imported as a scenario');
        res.status(201).json({
            ok: true, scenario: scene.id, name: scene.title, scanId: scene.scanId, stats: scene.stats,
            room: scene.scene.room, solids: scene.scene.obstacles.length,
            message: `"${scene.title}" is ready — reset the world onto ${scene.id} to fly it.`,
        });
    });
    router.post('/world/reset', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const s = sessions.get(sub);
        if (s && s.control.executor.state === 'running') {
            res.status(409).json({ error: 'task_executing', message: 'Abort or finish the running task before resetting the world.' });
            return;
        }
        const requested = (req.body ?? {});
        const sensorSetId = typeof requested.sensorSet === 'string' ? requested.sensorSet : undefined;
        if (sensorSetId && !(sensorSetId in engine_1.DRONE_SENSOR_SETS)) {
            res.status(400).json({ error: 'unknown_sensor_set', sensorSets: Object.keys(engine_1.DRONE_SENSOR_SETS) });
            return;
        }
        const scenario = typeof requested.scenario === 'string' ? requested.scenario : undefined;
        let importedScene;
        if (scenario && !(scenario in scenes_1.SCENARIOS)) {
            importedScene = imported.get(sub, scenario) ?? undefined;
            if (!importedScene) {
                res.status(400).json({ error: 'unknown_scenario', scenarios: [...Object.keys(scenes_1.SCENARIOS), ...imported.list(sub).map((i) => i.id)] });
                return;
            }
        }
        const backend = requested.backend === undefined ? 'kinematic' : requested.backend;
        if (!BACKENDS.includes(backend)) {
            res.status(400).json({ error: 'unknown_backend', backends: BACKENDS });
            return;
        }
        const node = typeof requested.node === 'string' ? requested.node.trim() : '';
        if (backend === 'node' && !node) {
            res.status(400).json({ error: 'node_required', message: 'backend "node" needs the id of a node on the rail (GET /physics/status lists them)', nodes: fleet.list(now(), expectedBuildHash, sub).filter((n) => n.online).map((n) => n.nodeId) });
            return;
        }
        const seed = Number.isInteger(requested.seed) ? requested.seed : 0;
        const controller = controllerFor(sub, requested.controller);
        if ('error' in controller) {
            res.status(controller.error === 'policy_not_certified' ? 409 : 400).json(controller);
            return;
        }
        if (backend === 'kinematic' && controller.spec.kind === 'policy') {
            res.status(400).json({ error: 'controller_needs_physics', message: 'a policy flies the physics plant; choose backend "physics" or a node' });
            return;
        }
        const armBackend = requested.arm === undefined ? 'kinematic' : requested.arm;
        if (!ARM_BACKENDS.includes(armBackend)) {
            res.status(400).json({ error: 'unknown_arm_backend', arm: ARM_BACKENDS });
            return;
        }
        if (armBackend === 'node') {
            res.status(501).json({ error: 'arm_node_unavailable', message: 'an arm on the swarm rail (B22 half b) is blocked by the core ADR-149 identity gate recorded in BACKLOG B20; the package cannot open it', arm: ARM_BACKENDS });
            return;
        }
        if (s) {
            stopTimer(s);
            s.sim.plant?.drop();
            s.sim.armPlant?.drop();
        }
        sessions.delete(sub);
        let fresh;
        try {
            fresh = session(sub, sensorSetId, backend, seed, controller.spec, node || undefined, scenario, importedScene, armBackend);
        }
        catch (error) {
            if (error instanceof ArmMountRefused) {
                res.status(422).json({ error: 'arm_mount_refused', message: error.message });
                return;
            }
            const f = backend === 'node' ? railFailure(error, node) : physicsFailure(error);
            res.status(f.status).json(f.body);
            return;
        }
        logger.info({ sub, scenario: fresh.sim.scene.name, sensorSet: fresh.sim.sensorSet.id, backend, arm: armBackend, node: node || null, seed, controller: (0, engine_1.controllerName)(controller.spec) }, 'World reset');
        res.json({ ok: true, ...fresh.sim.snapshot(), control: controlView(fresh) });
    });
    router.get('/physics/status', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        let engine;
        try {
            engine = { connected: true, ...getBridge().hello() };
        }
        catch (error) {
            const f = physicsFailure(error);
            engine = { connected: false, code: f.body.code, reason: f.body.reason };
        }
        res.json({ backends: BACKENDS, engine: { ...engine, addr: engineAddr, expectedBuildHash, installHint: engine_1.DEFAULT_INSTALL_HINT }, nodes: fleet.list(now(), expectedBuildHash, sub), rail: { serviceSecretConfigured: Boolean(serviceSecret()), heartbeat: 'POST /api/embodied/nodes/heartbeat (X-Service-Secret)', command: 'POST <endpointUrl>/api/drone-node/command (X-Service-Secret)' } });
    });
    // ── ADR-160 S1, the medium as a parameter: choose a medium, drop the explorer hull ────────────────
    /** @description Resolve `?medium=` or answer 400 naming the media this lab implements — a medium is never silently substituted. */
    const chosenMedium = (req, res) => {
        const id = typeof req.query.medium === 'string' && req.query.medium ? req.query.medium : 'air';
        const m = (0, engine_1.mediumById)(id);
        if (!m) {
            res.status(400).json({ error: 'unknown_medium', asked: id, media: engine_1.MEDIUM_IDS, message: 'this package implements these media and substitutes none of them for another' });
            return null;
        }
        return m;
    };
    /** @description Send a named medium refusal as 422 with the code, the refusal string and the reason. */
    const sendRefusal = (res, error) => {
        if (!(error instanceof engine_1.MediumRefused))
            return false;
        res.status(422).json(error.toJSON());
        return true;
    };
    router.get('/physics/media', (req, res) => {
        if (!withSub(req, res))
            return;
        res.json({
            schema: engine_1.MEDIUM_PROPERTIES_SCHEMA,
            media: (0, engine_1.allMedia)().map(engine_1.mediumView),
            forceModels: [engine_1.RIGID_BODY_PLANT, engine_1.HULL_FLOTATION].map((m) => ({ id: m.id, label: m.label, requires: m.requires, validIn: m.validIn, envelopeWhy: m.envelopeWhy })),
            refusals: {
                medium_property_unavailable: 'the model needs something this medium does not carry — a refusal, never a quiet zero',
                model_not_valid_in_medium: "every property is present and the model still declines, because the model author's own validity envelope excludes this medium",
                medium_outside_validity: 'the coordinate is outside the band the medium can answer over; it refuses rather than extrapolating',
            },
        });
    });
    router.get('/physics/hull', (req, res) => {
        if (!withSub(req, res))
            return;
        const m = chosenMedium(req, res);
        if (!m)
            return;
        const dropHeightM = Number.isFinite(Number(req.query.dropHeightM)) && req.query.dropHeightM !== undefined ? Number(req.query.dropHeightM) : undefined;
        try {
            res.json({ ...(0, engine_1.dropExplorerHull)(m, dropHeightM === undefined ? {} : { dropHeightM }), provenance: engine_1.EXPLORER_HULL_PROVENANCE, simulated: true });
        }
        catch (error) {
            if (sendRefusal(res, error)) {
                logger.info({ medium: m.id, refusal: error.refusal }, 'Hull drop refused by name');
                return;
            }
            throw error;
        }
    });
    router.get('/physics/hull/mjcf', (req, res) => {
        if (!withSub(req, res))
            return;
        const m = chosenMedium(req, res);
        if (!m)
            return;
        const dropHeightM = Number.isFinite(Number(req.query.dropHeightM)) && req.query.dropHeightM !== undefined ? Number(req.query.dropHeightM) : undefined;
        try {
            res.type('application/xml').send((0, engine_1.explorerHullMjcf)(m, dropHeightM === undefined ? {} : { dropHeightM }));
        }
        catch (error) {
            if (sendRefusal(res, error))
                return;
            throw error;
        }
    });
    router.get('/physics/mjcf', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const fit = (0, engine_1.fitById)(typeof req.query.fit === 'string' ? req.query.fit : 'recon-mini');
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits: Object.keys(engine_1.DRONE_FITS) });
            return;
        }
        const probe = new engine_1.WorldSim({ sensorSet: engine_1.DRONE_SENSOR_SETS[engine_1.DRONE_FITS[fit].sensorSet] });
        res.type('application/xml').send((0, engine_1.droneMjcf)(fit, probe.sensingSolids(), probe.scene.droneHome));
    });
    // ── The printed arm (ADR-152 D5 task 3): its design, its model, and the check the container runs ──────
    (0, embodied_arm_routes_1.registerArmRoutes)(router, {
        withSub,
        physicsFailure,
        checkArm: async (input) => (opts.armChecker
            ? opts.armChecker(input)
            : getBridge().callAsync('arm-check', input, embodied_arm_routes_1.ARM_CHECK_TIMEOUT_MS)),
    });
    router.get('/physics/reports', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        try {
            const listing = readReports();
            const certified = certifiedOf(sub);
            res.json({ ...listing, reports: listing.reports.map((r) => ({ ...r, certified: r.report?.policyFile ? (certified.get(r.report.policyFile)?.certification ?? null) : null })) });
        }
        catch (error) {
            const f = physicsFailure(error);
            res.status(f.status).json(f.body);
        }
    });
    router.post('/physics/certify', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const file = str(body.file, '');
        if (!file) {
            res.status(400).json({ error: 'file_required', message: 'the report file to certify (from GET /physics/reports)' });
            return;
        }
        const which = body.which === 'baseline' ? 'baseline' : 'policy';
        let listing;
        try {
            listing = readReports();
        }
        catch (error) {
            const f = physicsFailure(error);
            res.status(f.status).json(f.body);
            return;
        }
        const entry = listing.reports.find((r) => r.file === file);
        if (!entry || !entry.report) {
            res.status(404).json({ error: 'report_not_found', file });
            return;
        }
        const trajectory = entry.report[which]?.trajectory;
        if (!Array.isArray(trajectory) || !trajectory.length) {
            res.status(422).json({ error: 'no_trajectory', message: `the report has no ${which} flight path to replay` });
            return;
        }
        const s = session(sub);
        advance(sub, s);
        const certification = (0, engine_1.certifyFlight)(s.sim, trajectory);
        const policyFile = which === 'policy' ? entry.report.policyFile : undefined;
        if (policyFile)
            certifiedOf(sub).set(policyFile, { certification, residual: entry.report.mode === 'residual', interface: entry.report.mode === 'ctbr' ? 'ctbr' : 'motors', reportFile: file });
        logger.info({ sub, file, which, ok: certification.ok, refused: certification.refusedCount }, 'Flight certified');
        res.json({ file, which, policyFile: policyFile ?? null, beatsBaseline: entry.report.policyBeatsBaseline ?? null, mapKnownFraction: s.sim.world.stats().knownFraction, certification });
    });
    router.post('/tasks/draft', async (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const task = str(body.task, 'clear-surface');
        if (!TASKS.includes(task)) {
            res.status(400).json({ error: 'unknown_task', tasks: TASKS });
            return;
        }
        const s = session(sub);
        advance(sub, s);
        let plan;
        try {
            plan = task === 'explore' ? (0, engine_1.planExplore)(s.sim, Math.min(30, Math.max(1, Number(body.maxScans) || 12)), { droneFirst: body.droneFirst === true })
                : task === 'fetch-from-appliance' ? (0, engine_1.planFetchFromAppliance)(s.sim, str(body.appliance, 'fridge'), str(body.object, 'milk-1'), str(body.to, 'island'))
                    : (0, engine_1.planClearSurface)(s.sim, str(body.from, ''), str(body.to, ''));
        }
        catch (error) {
            res.status(422).json({ error: 'plan_refused', message: error instanceof Error ? error.message : String(error) });
            return;
        }
        const rehearsal = (0, engine_1.validatePlan)(s.sim, plan);
        try {
            const row = await (0, task_store_1.insertTask)(pool, sub, plan, rehearsal);
            logger.info({ sub, taskId: row.task_id, steps: plan.steps.length, ok: rehearsal.ok }, 'Drafted a physical task');
            res.status(201).json(row);
        }
        catch (error) {
            logger.error({ err: error, sub }, 'Task insert failed');
            res.status(500).json({ error: 'task_store_failed' });
        }
    });
    router.get('/tasks', async (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        try {
            res.json(await (0, task_store_1.listTasks)(pool, sub));
        }
        catch (error) {
            logger.error({ err: error, sub }, 'Task list failed');
            res.status(500).json({ error: 'task_store_failed' });
        }
    });
    router.get('/tasks/:id', async (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const row = await (0, task_store_1.getTask)(pool, sub, String(req.params.id)).catch(() => null);
        if (!row) {
            res.status(404).json({ error: 'task_not_found' });
            return;
        }
        res.json(row);
    });
    router.post('/tasks/:id/execute', async (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('embodied-execute', 'Executing a physical task'));
            return;
        }
        const row = await (0, task_store_1.getTask)(pool, sub, String(req.params.id)).catch(() => null);
        if (!row) {
            res.status(404).json({ error: 'task_not_found' });
            return;
        }
        if (row.status !== 'draft') {
            res.status(409).json({ error: 'task_not_draft', status: row.status });
            return;
        }
        const s = session(sub);
        advance(sub, s);
        const rehearsal = (0, engine_1.validatePlan)(s.sim, row.plan);
        if (!rehearsal.ok) {
            res.status(409).json({ error: 'rehearsal_failed', rehearsal });
            return;
        }
        try {
            s.control.execute(row.plan, sub);
        }
        catch (error) {
            res.status(409).json({ error: 'execute_refused', message: error instanceof Error ? error.message : String(error) });
            return;
        }
        s.taskId = row.task_id;
        await (0, task_store_1.updateTaskStatus)(pool, sub, row.task_id, 'executing', 0, null).catch((error) => logger.error({ err: error, sub }, 'Task status update failed'));
        startTimer(sub, s);
        logger.info({ sub, taskId: row.task_id }, 'Executing a physical task after a fresh rehearsal');
        res.json({ ok: true, taskId: row.task_id, rehearsal, control: controlView(s) });
    });
    router.post('/tasks/:id/abort', async (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const s = session(sub);
        if (s.taskId !== String(req.params.id)) {
            res.status(409).json({ error: 'task_not_executing' });
            return;
        }
        s.control.abort(sub);
        advance(sub, s);
        res.json({ ok: true, control: controlView(s) });
    });
    const controlAction = (action) => (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const s = session(sub);
        advance(sub, s);
        try {
            s.control[action](sub);
            if (action === 'estop' && s.taskId) {
                void (0, task_store_1.updateTaskStatus)(pool, sub, s.taskId, 'aborted', s.control.executor.stepIndex, 'e-stop').catch(() => undefined);
                s.taskId = null;
                stopTimer(s);
            }
            res.json({ ok: true, control: controlView(s) });
        }
        catch (error) {
            res.status(409).json({ error: `${action}_refused`, message: error instanceof Error ? error.message : String(error), control: controlView(s) });
        }
    };
    router.post('/control/take', controlAction('take'));
    router.post('/control/release', controlAction('release'));
    router.post('/control/estop', controlAction('estop'));
    router.post('/control/reset', controlAction('reset'));
    router.post('/control/command', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const s = session(sub);
        advance(sub, s);
        try {
            const result = s.control.manual({ nodeId: str(body.nodeId, ''), command: str(body.command, ''), params: (body.params && typeof body.params === 'object' ? body.params : {}) }, sub);
            res.json({ ok: true, result, control: controlView(s) });
        }
        catch (error) {
            res.status(409).json({ error: 'command_refused', message: error instanceof Error ? error.message : String(error), control: controlView(s) });
        }
    });
    router.get('/log', async (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
        try {
            res.json(await (0, task_store_1.listLog)(pool, sub, limit));
        }
        catch (error) {
            logger.error({ err: error, sub }, 'Log list failed');
            res.status(500).json({ error: 'task_store_failed' });
        }
    });
    return router;
}
//# sourceMappingURL=embodied-routes.js.map