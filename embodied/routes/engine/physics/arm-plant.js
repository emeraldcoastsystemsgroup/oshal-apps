"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteArmPlant = exports.ARM_DH_TOLERANCE = void 0;
exports.isArmNode = isArmNode;
exports.armSpecMismatch = armSpecMismatch;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (B22, half a) — the arm plant seam, the drone
 *                     |                             | plant's counterpart: the simulation commands joint angles and a
 *                     |                             | grip and is told back what the joints REALLY did, what each
 *                     |                             | servo exerted doing it, and what the arm touched. Synchronous,
 *                     |                             | like the drone's, because the simulation's step is. `backend`
 *                     |                             | says which body answered: 'physics' for the engine container we
 *                     |                             | dial, 'node' for an arm that dialled us over the swarm rail
 *                     |                             | (B22 half b, blocked on the core ADR-149 decision recorded in
 *                     |                             | B20 — no package code can open that gate).
 */
const node_crypto_1 = require("node:crypto");
/**
 * @description Whether an arm plant carries a node identity.
 * @param p - Any arm plant.
 * @returns True for an ArmNode.
 */
function isArmNode(p) {
    return Boolean(p && typeof p.nodeId === 'string' && typeof p.link === 'string');
}
/** @description The tolerance the plant's joint table must match the simulation's arm within (m, rad). */
exports.ARM_DH_TOLERANCE = 1e-6;
/**
 * @description Whether an arm plant's model was built from the same arm the simulation believes it is driving.
 * @param plant - The plant.
 * @param dh - The simulation's own joint table.
 * @returns The reason they differ, or null when they are the same arm.
 */
function armSpecMismatch(plant, dh) {
    if (plant.dh.length !== dh.length)
        return `the plant has ${plant.dh.length} joints, the simulation's arm has ${dh.length}`;
    for (let i = 0; i < dh.length; i += 1) {
        for (let k = 0; k < 3; k += 1) {
            if (Math.abs(plant.dh[i][k] - dh[i][k]) > exports.ARM_DH_TOLERANCE)
                return `joint ${i + 1} differs (${['d', 'a', 'alpha'][k]}: plant ${plant.dh[i][k]}, simulation ${dh[i][k]})`;
        }
    }
    return null;
}
/**
 * @description The arm plant behind a bridge — the engine container we dial — one session per world, a rehearsal clone
 * being its own session. The MJCF is built on this side (the room the arm stands in) and sent once at load, exactly the
 * way the drone's is: the container holds physics, never a picture of the world.
 */
class RemoteArmPlant {
    bridge;
    session;
    seed;
    mjcf;
    loaded;
    engine;
    version;
    backend = 'physics';
    dh;
    dropped = false;
    constructor(bridge, session, seed, mjcf, loaded, dh) {
        this.bridge = bridge;
        this.session = session;
        this.seed = seed;
        this.mjcf = mjcf;
        this.loaded = loaded;
        this.dh = dh;
        const h = bridge.hello();
        this.engine = h.engine;
        this.version = h.version;
    }
    /**
     * @description Load an arm model into a fresh session on the bridge.
     * @param bridge - The bridge to the engine container.
     * @param mjcf - The arm's model, in the room it stands in.
     * @param seed - The plant's seed.
     * @param dh - The joint table the model was built from.
     * @returns The loaded plant.
     */
    static load(bridge, mjcf, seed = 0, dh = []) {
        const session = (0, node_crypto_1.randomUUID)();
        const loaded = bridge.call('arm-load', { session, mjcf, seed });
        return new RemoteArmPlant(bridge, session, seed, mjcf, loaded, dh);
    }
    step(qTarget, grip, dt) {
        const r = this.bridge.call('arm-step', { session: this.session, q: [...qTarget], grip, dt });
        return { q: r.q, torqueNm: r.torqueNm, grip: r.grip, contact: r.contact ?? null, settled: Boolean(r.settled) };
    }
    clone() {
        const session = (0, node_crypto_1.randomUUID)();
        this.bridge.call('arm-clone', { session, from: this.session });
        return new RemoteArmPlant(this.bridge, session, this.seed, this.mjcf, this.loaded, this.dh);
    }
    drop() {
        if (this.dropped)
            return;
        this.dropped = true;
        try {
            this.bridge.call('arm-drop', { session: this.session });
        }
        catch { /* a bridge that is already gone has nothing to drop */ }
    }
}
exports.RemoteArmPlant = RemoteArmPlant;
//# sourceMappingURL=arm-plant.js.map