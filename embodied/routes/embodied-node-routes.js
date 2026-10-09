"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the node rail's api side (ADR-099, BACKLOG B20), mounted at /api/embodied/nodes under `auth: service` in the manifest: the mounter admits only a caller presenting the swarm service secret (a NODE identity, never a browser), exactly as the drone and camera packages take their nodes' heartbeats. POST /heartbeat feeds the process-wide fleet the world routes read; GET / lists it for machines. No identity, no owner scoping: a node belongs to the box, a world to its owner.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The owner of a heartbeat is the trusted service user sub the mounter resolved (oshalCallerSub) — the node's owner under ADR-114; recorded on the fleet.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-175 (B20 option D): the mount is `auth: node`. A heartbeat is accepted only from the device its credential was enrolled for (body nodeId === req.oshalNodeToken.clientId, else 403 node_binding_mismatch); the owner is the credential's verified owner, never a header.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The listing is the caller's own nodes (fleet.list scoped to the credential's owner): a device credential no longer lists every owner's nodes, endpoints and telemetry. The heartbeat reply carries the node's command key.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmbodiedNodeRoutes = createEmbodiedNodeRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const node_path_1 = __importDefault(require("node:path"));
const build_hash_1 = require("./engine/physics/build-hash");
const node_fleet_1 = require("./engine/node/node-fleet");
const embodied_routes_1 = require("./embodied-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'embodied-node-routes' });
/**
 * @description The node id the request's device credential is bound to (stamped by core's PAT middleware, ADR-175).
 * @param req - The request.
 * @returns The bound clientId, or null when the request carries no device credential.
 */
function boundNodeId(req) {
    const id = req.oshalNodeToken?.clientId;
    return typeof id === 'string' && id.length > 0 ? id : null;
}
/**
 * @description Build the `/api/embodied/nodes` router. The manifest mounts it with `auth: node` (ADR-175): core admits only a
 * device-bound node credential here and stamps `req.oshalNodeToken`; the owner arrives as the verified principal. It must
 * not be mounted anywhere else.
 * @param ctx - The per-package AppContext (`appPackageDir` is read for the engine tree hash).
 * @param opts - Spec overrides.
 * @returns The composed router.
 */
function createEmbodiedNodeRoutes(ctx, opts = {}) {
    const now = opts.now ?? (() => Date.now());
    const fleet = opts.fleet ?? (0, node_fleet_1.sharedNodeFleet)();
    const expectedBuildHash = (0, build_hash_1.engineBuildHash)(node_path_1.default.join(ctx.appPackageDir ?? process.cwd(), 'engine'));
    const router = (0, express_1.Router)();
    router.post('/heartbeat', (req, res) => {
        const bound = boundNodeId(req);
        const declared = req.body && typeof req.body === 'object' ? req.body.nodeId : undefined;
        if (!bound || declared !== bound) {
            logger.warn({ bound, declared: typeof declared === 'string' ? declared.slice(0, 64) : null }, 'Refused a heartbeat for a node its credential does not name');
            res.status(403).json({ error: 'node_binding_mismatch', message: 'A heartbeat speaks only for the device its credential was enrolled for.' });
            return;
        }
        try {
            const r = fleet.ingest(req.body, now(), (0, embodied_routes_1.callerSub)(req));
            res.json({ ok: true, ...r });
        }
        catch (error) {
            if (error instanceof node_fleet_1.NodeValidationError) {
                res.status(400).json({ error: 'invalid_heartbeat', message: error.message });
                return;
            }
            logger.error({ err: error }, 'Node heartbeat ingest failed');
            res.status(500).json({ error: 'heartbeat_failed' });
        }
    });
    router.get('/', (req, res) => {
        res.json({ nodes: fleet.list(now(), expectedBuildHash, (0, embodied_routes_1.callerSub)(req)), expectedBuildHash });
    });
    return router;
}
//# sourceMappingURL=embodied-node-routes.js.map