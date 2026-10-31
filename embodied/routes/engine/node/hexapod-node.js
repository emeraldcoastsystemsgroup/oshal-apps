"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 (lane L4): the TypeScript seam a spider-18 node presents
 *                     |                             | to the brain — the HexapodNode interface (hello, walk, stop,
 *                     |                             | pose, flip, jump, sense, sit, estop, tick), the reply shapes the
 *                     |                             | Python node answers (the brief's section 3.2 state plus the
 *                     |                             | node's own status, the LiDAR on sense), and RailHexapodNode,
 *                     |                             | which sends {id, command, args} envelopes to a node that
 *                     |                             | heartbeated in, over the same node-rail bridge RailDroneNode
 *                     |                             | uses (the node's own command key, never the service secret),
 *                     |                             | with every argument checked here before an envelope leaves.
 *                     |                             | Also the spider-18's capability manifest for kind `hexapod`.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A refusal decided at home (a bad argument, another kind, a closed
 *                     |                             | seam) carries its message as `reason` too, so a route's 503 body
 *                     |                             | and a suite's check read the same explanation as a node refusal.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPIDER_18_MANIFEST = exports.RailHexapodNode = exports.HEXAPOD_COMMANDS = exports.HEXAPOD_ACTUATOR_COUNT = exports.HEXAPOD_KIND = void 0;
exports.validateWalkCommand = validateWalkCommand;
exports.validateTargets = validateTargets;
exports.isNoSpring = isNoSpring;
exports.isBusy = isBusy;
exports.isHexapodNode = isHexapodNode;
const bridge_client_1 = require("../physics/bridge-client");
/** The node kind the spider heartbeats as. */
exports.HEXAPOD_KIND = 'hexapod';
/** Eighteen targets, always, in ACTUATOR_ORDER (hexapod-spec.ts). */
exports.HEXAPOD_ACTUATOR_COUNT = 18;
/** Every command the Python node answers; the brief's section 3.3 set plus estop, tick, load and reset. */
exports.HEXAPOD_COMMANDS = ['hello', 'status', 'walk', 'stop', 'pose', 'flip', 'jump', 'sense', 'sit', 'land', 'estop', 'tick', 'load', 'reset'];
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** A refusal decided here, before any envelope leaves: the message is the reason (the route layer reports `reason`). */
const refuse = (message) => new bridge_client_1.EngineFailure('engine_error', message, message);
/** @description A walk command checked before it leaves: three finite numbers. @param cmd - Untrusted. @returns The command. */
function validateWalkCommand(cmd) {
    const c = (cmd ?? {});
    for (const key of ['vxMps', 'vyMps', 'yawRateRadS'])
        if (!finite(c[key]))
            throw refuse(`walk needs a finite ${key}`);
    return { vxMps: c.vxMps, vyMps: c.vyMps, yawRateRadS: c.yawRateRadS };
}
/** @description Eighteen finite targets or a refusal; the node clamps them to the contract's limits. @param targets - Untrusted. @returns A copy. */
function validateTargets(targets) {
    if (!Array.isArray(targets) || targets.length !== exports.HEXAPOD_ACTUATOR_COUNT || !targets.every(finite)) {
        throw refuse(`pose needs ${exports.HEXAPOD_ACTUATOR_COUNT} finite targets in ACTUATOR_ORDER`);
    }
    return [...targets];
}
/** @description Whether a failure is the body's no_spring refusal (a legs-hop model asked to jump). @param error - Anything thrown. @returns True for no_spring. */
function isNoSpring(error) {
    return error instanceof bridge_client_1.EngineFailure && /^no_spring\b/.test(error.reason ?? '');
}
/** @description Whether a failure is the node's busy refusal (a flip in progress). @param error - Anything thrown. @returns True for busy. */
function isBusy(error) {
    return error instanceof bridge_client_1.EngineFailure && /^busy\b/.test(error.reason ?? '');
}
/** @description Whether a value carries the hexapod seam. @param p - Anything. @returns True for a HexapodNode. */
function isHexapodNode(p) {
    const n = p;
    return Boolean(n && typeof n.nodeId === 'string' && n.link === 'rail' && typeof n.walk === 'function' && typeof n.sense === 'function');
}
/**
 * @description A spider on the rail: one bridge per node over its declared endpoint, each method one envelope.
 * `connect` asks the node `hello` first and refuses a node of another kind, so a drone or a plant cannot be walked.
 */
class RailHexapodNode {
    bridge;
    helloSeen;
    link = 'rail';
    nodeId;
    endpoint;
    backend;
    closed = false;
    constructor(bridge, record, helloSeen) {
        this.bridge = bridge;
        this.helloSeen = helloSeen;
        this.nodeId = record.nodeId;
        this.endpoint = record.endpointUrl;
        this.backend = helloSeen.backend;
    }
    /**
     * @description Open the node's command channel and check it is a hexapod.
     * @param record - The fleet's record (an online node; the fleet refuses an offline one before this).
     * @param opts - The per-request timeout (a serial jump winds for seconds; the default allows it).
     * @returns The node.
     */
    static connect(record, opts = {}) {
        const bridge = new bridge_client_1.SyncBridge({ transport: 'http', endpoint: record.endpointUrl, commandKey: record.commandKey, hello: record.hello, nodeId: record.nodeId, expectedBuildHash: null, timeoutMs: opts.timeoutMs ?? 10_000 });
        try {
            const hello = bridge.call('hello');
            if (hello.kind !== exports.HEXAPOD_KIND || !['fake', 'plant', 'serial'].includes(hello.backend)) {
                throw refuse(`node ${record.nodeId} is not a hexapod (kind ${String(hello.kind)}, backend ${String(hello.backend)})`);
            }
            return new RailHexapodNode(bridge, record, hello);
        }
        catch (error) {
            bridge.close();
            throw error;
        }
    }
    call(command, args = {}) {
        if (this.closed)
            throw new bridge_client_1.EngineFailure('capability_unavailable', `node ${this.nodeId} was closed`, 'the seam was closed');
        return this.bridge.call(command, args);
    }
    hello() { return this.helloSeen; }
    walk(command) { return this.call('walk', { ...validateWalkCommand(command) }); }
    stop() { return this.call('stop'); }
    pose(targetsRad, raw = false) { return this.call('pose', { targetsRad: validateTargets(targetsRad), raw }); }
    flip(side = 'right') {
        if (side !== 'left' && side !== 'right')
            throw refuse("flip side must be 'left' or 'right'");
        return this.call('flip', { side });
    }
    jump() { return this.call('jump'); }
    sense() { return this.call('sense'); }
    sit() { return this.call('sit'); }
    estop() { return this.call('estop'); }
    tick(dtS) {
        if (dtS !== undefined && !(finite(dtS) && dtS > 0 && dtS <= 1))
            throw refuse('tick dtS must be in (0, 1]');
        return this.call('tick', dtS === undefined ? {} : { dtS });
    }
    /** @description End the channel; every later call fails closed. */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.bridge.close();
    }
}
exports.RailHexapodNode = RailHexapodNode;
/**
 * @description The spider-18's capability manifest (ADR-151 D1 shape, kind `hexapod`). The envelope numbers are the
 * contract's (hexapod-spec.ts) and the gait player's cap: 0.2 m/s is the stride cap over the stance time, the lane's
 * starting choice, not a measurement.
 */
exports.SPIDER_18_MANIFEST = Object.freeze({
    nodeId: 'embodied-hexapod',
    kind: 'hexapod',
    model: 'spider-18',
    safetyClass: 2,
    senses: ['pose', 'imu', 'joint-state', 'foot-contact', 'lidar', 'spring'],
    acts: ['walk', 'stop', 'pose', 'flip', 'jump', 'sit', 'e-stop'],
    envelope: { legs: 6, actuators: exports.HEXAPOD_ACTUATOR_COUNT, standHeightMm: 90, massTargetG: 1900, springStoredJ: 3.61, maxSpeedMps: 0.2, tickHz: 50 },
});
//# sourceMappingURL=hexapod-node.js.map