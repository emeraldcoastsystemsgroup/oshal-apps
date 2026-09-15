"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the DroneNode a node on the swarm rail is (ADR-099, B20), the core RemoteDroneProvider's shape: built from the fleet's record of a node that joined by heartbeat, commanded at the endpoint it declared over the swarm service secret (one bridge per world, closed on drop), its hello checked like a dialled one (the build hash for a plant node, whose engine tree must be this package's). `load` is what a plant node accepts and a real body refuses; a `clone` the node refuses (cannot_clone: one body) is null, and the rehearsal runs on the kinematic twin. The sim flies it through the same seam as the dialled plant.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RailDroneNode = void 0;
const bridge_client_1 = require("../physics/bridge-client");
const plant_1 = require("../physics/plant");
/** @description A node on the rail as the simulation's drone: the same seam as the dialled plant, over the node's own command channel. */
class RailDroneNode {
    plant;
    bridge;
    link = 'rail';
    nodeId;
    endpoint;
    kind;
    engine;
    version;
    seed;
    controller;
    dropped = false;
    constructor(plant, bridge, record) {
        this.plant = plant;
        this.bridge = bridge;
        this.nodeId = record.nodeId;
        this.endpoint = record.endpointUrl;
        this.kind = record.kind;
        this.engine = plant.engine;
        this.version = plant.version;
        this.seed = plant.seed;
        this.controller = plant.controller;
    }
    /**
     * @description Open the node's command channel and load the world's MJCF into a session there.
     * @param record - The fleet's record (an online node; the fleet refuses an offline one before this is reached).
     * @param mjcf - The scene and the drone, generated from the parts model. @param seed - The gust seed.
     * @param controller - The plant's controller or a certified policy. @param opts - Secret, expected build hash, timeout.
     * @returns The node, flying the session.
     */
    static load(record, mjcf, seed, controller, opts) {
        const bridge = new bridge_client_1.SyncBridge({ transport: 'http', endpoint: record.endpointUrl, secret: opts.secret, hello: record.hello, nodeId: record.nodeId, expectedBuildHash: record.kind === 'plant' ? opts.expectedBuildHash : null, timeoutMs: opts.timeoutMs ?? 30000 });
        try {
            const plant = plant_1.RemotePlant.load(bridge, mjcf, seed, controller);
            return new RailDroneNode(plant, bridge, record);
        }
        catch (error) {
            bridge.close();
            if (error instanceof bridge_client_1.EngineFailure && error.code === 'engine_error' && /^cannot_load/.test(error.reason ?? ''))
                throw new bridge_client_1.EngineFailure('engine_error', `node ${record.nodeId} is a body, not a simulator: it cannot load a scene (the real-node lane, BACKLOG B6)`, error.reason);
            throw error;
        }
    }
    /** The session id the node holds for this world (specs). */
    get session() { return this.plant.session; }
    step(setpoint, phase, dt) { return this.plant.step(setpoint, phase, dt); }
    sense(spec) { return this.plant.sense(spec); }
    /** @description A copy for a rehearsal, or null when the node says it is one body (cannot_clone): the rehearsal then runs on the kinematic twin. */
    clone() {
        try {
            return this.plant.clone();
        }
        catch (error) {
            if (error instanceof bridge_client_1.EngineFailure && error.code === 'engine_error' && /^cannot_clone/.test(error.reason ?? ''))
                return null;
            throw error;
        }
    }
    drop() {
        if (this.dropped)
            return;
        this.dropped = true;
        this.plant.drop();
        this.bridge.close();
    }
}
exports.RailDroneNode = RailDroneNode;
//# sourceMappingURL=rail-node.js.map