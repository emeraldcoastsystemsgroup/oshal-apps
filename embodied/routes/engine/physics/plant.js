"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the PhysicsPlant seam (ADR-152 D3): what the simulation asks of a plant (step the truth toward the commanded setpoint, sense from the true pose, clone for a rehearsal, drop), the sensor specification built from the same sensor set and intrinsics the kinematic raycaster uses, the conversion of the plant's compact frames into the LidarSweeps the map integrates (paint looked up by the solid's name, exactly as the kinematic sensors paint), and RemotePlant, the plant behind the engine container's bridge.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A ControllerSpec on load (the plant's own controller or a trained policy the container holds, residual or absolute); the plant names its controller. B19.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B20: a plant is a DroneNode when it has an identity on the swarm (nodeId, link, endpoint) — RemotePlant is one over either link; `clone()` may answer null (a real body has one instance) and the rehearsal then runs on the kinematic twin from the plant's last reported truth.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | B19: a policy's `interface` (motors | ctbr) rides the ControllerSpec and the load result; the plant flies a ctbr policy through its own rate loop.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | B6: a node's own flight stack names itself (`controller: 'px4'`); anything but a policy is reported by its kind.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemotePlant = exports.controllerName = void 0;
exports.isDroneNode = isDroneNode;
exports.senseSpec = senseSpec;
exports.framesToSweeps = framesToSweeps;
const node_crypto_1 = require("node:crypto");
/** @description The controller as the plant names it: `pid` or `policy:<file>`. */
const controllerName = (c) => (c && c.kind === 'policy' ? `policy:${c.file}` : 'pid');
exports.controllerName = controllerName;
/** @description Whether a plant carries a node identity. @param p - Any plant. @returns True for a DroneNode. */
function isDroneNode(p) {
    return Boolean(p && typeof p.nodeId === 'string' && typeof p.link === 'string');
}
/** @description The sensor specification for a set, with the depth camera's pinhole built exactly as the kinematic depth picture builds it. */
function senseSpec(set, intr) {
    const spec = { ring: { azimuthCount: set.lidar.azimuthCount, elevationsDeg: set.lidar.elevationsDeg, maxRange: set.lidar.maxRange } };
    if (set.lidar.zenith)
        spec.zenith = { ...set.lidar.zenith };
    if (set.depthCamera) {
        const c = set.depthCamera;
        spec.depth = { fx: intr.width / (2 * Math.tan(((c.fovHDeg / 2) * Math.PI) / 180)), fy: intr.height / (2 * Math.tan(((c.fovVDeg / 2) * Math.PI) / 180)), cx: intr.cx, cy: intr.cy, width: intr.width, height: intr.height, stride: c.stride, maxRange: c.maxRange, pitch: -Math.PI / 2 + 1e-3 };
    }
    if (set.nadirRangerM !== null)
        spec.nadir = { maxRange: set.nadirRangerM };
    return spec;
}
function toSweep(f, names, paint) {
    const hits = [];
    for (let i = 0; i < f.t.length; i += 1) {
        const name = names[f.geom[i]] ?? 'unknown';
        hits.push({ t: f.t[i], point: [f.p[3 * i], f.p[3 * i + 1], f.p[3 * i + 2]], normal: [f.n[3 * i], f.n[3 * i + 1], f.n[3 * i + 2]], name, paint: paint.get(name) ?? 'unknown' });
    }
    const misses = [];
    for (let i = 0; i < f.misses.length; i += 3)
        misses.push([f.misses[i], f.misses[i + 1], f.misses[i + 2]]);
    return { origin: [f.origin[0], f.origin[1], f.origin[2]], hits, misses };
}
/** @description The plant's frames as the sweeps the map integrates, one per sensor, in the order the kinematic scan builds them (ring, depth camera, nadir), plus the nadir range when it read the floor. */
function framesToSweeps(frames, solids) {
    const paint = new Map(solids.map((s) => [s.name, s.paint]));
    const sweeps = [];
    if (frames.ring) {
        const ring = toSweep(frames.ring, frames.names, paint);
        if (frames.zenith) {
            const z = toSweep(frames.zenith, frames.names, paint);
            ring.hits.push(...z.hits);
            ring.misses.push(...z.misses);
        }
        sweeps.push(ring);
    }
    if (frames.depth)
        sweeps.push(toSweep(frames.depth, frames.names, paint));
    let nadirM = null;
    if (frames.nadir) {
        const n = toSweep(frames.nadir, frames.names, paint);
        sweeps.push(n);
        if (n.hits.length && n.hits[0].name === 'floor')
            nadirM = n.hits[0].t;
    }
    return { sweeps, nadirM };
}
/** @description The plant behind a bridge — the engine container we dial, or a node on the rail — one session per world (a rehearsal clone is its own session). */
class RemotePlant {
    bridge;
    session;
    seed;
    loaded;
    engine;
    version;
    controller;
    nodeId;
    link;
    endpoint;
    dropped = false;
    constructor(bridge, session, seed, loaded) {
        this.bridge = bridge;
        this.session = session;
        this.seed = seed;
        this.loaded = loaded;
        const h = bridge.hello();
        this.engine = h.engine;
        this.version = h.version;
        this.nodeId = bridge.nodeId;
        this.link = bridge.link;
        this.endpoint = bridge.endpoint;
        this.controller = loaded.controller && loaded.controller.kind === 'policy' ? `policy:${loaded.controller.file ?? ''}` : (loaded.controller?.kind ?? 'pid');
    }
    /** @description Load an MJCF into a fresh session, flown by the plant's own controller or a policy the container holds. */
    static load(bridge, mjcf, seed, controller = { kind: 'pid' }) {
        const session = (0, node_crypto_1.randomUUID)();
        const loaded = bridge.call('load', { session, mjcf, seed, controller });
        return new RemotePlant(bridge, session, seed, loaded);
    }
    step(setpoint, phase, dt) {
        const r = this.bridge.call('step', { session: this.session, setpoint, phase, dt });
        return { pose: { x: r.x, y: r.y, z: r.z, yaw: r.yaw }, tiltRad: r.tiltRad, speed: r.speed, contact: r.contact, settled: r.settled, motorsN: r.motorsN };
    }
    sense(spec) {
        return this.bridge.call('sense', { session: this.session, spec });
    }
    clone() {
        const session = (0, node_crypto_1.randomUUID)();
        this.bridge.call('clone', { session, from: this.session });
        return new RemotePlant(this.bridge, session, this.seed, this.loaded);
    }
    drop() {
        if (this.dropped)
            return;
        this.dropped = true;
        try {
            this.bridge.call('drop', { session: this.session });
        }
        catch { /* a bridge that is already gone has nothing to drop */ }
    }
}
exports.RemotePlant = RemotePlant;
//# sourceMappingURL=plant.js.map