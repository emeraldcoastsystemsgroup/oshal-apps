"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The `/api/drone-relay` mount: serves the bundled surface and its
 *                     |                             | script from this package's tools/ (ctx.appPackageDir captured
 *                     |                             | at factory time — ADR-085 D10), publishes `/capabilities`
 *                     |                             | (the transport catalog, the SAME limits the plan routes
 *                     |                             | enforce, the defaults, the envelope constants), the transport
 *                     |                             | comparison and the single-link budget, and composes the plan
 *                     |                             | router. The manifest's `auth: oidc` wraps the whole mount;
 *                     |                             | every plan handler still re-derives the caller.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | `/capabilities` also lists the postures, the control-channel
 *                     |                             | choices and the packed heartbeat size the plan's air-time
 *                     |                             | figure assumes, so a tool reads them instead of guessing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | `/capabilities` lists the branch limits a tree is held to.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | ...and the limits a lattice's area is held to.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.createDroneRelayRoutes = createDroneRelayRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const engine_1 = require("./engine");
const plan_routes_1 = require("./plan-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'drone-relay-routes' });
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub).
 * @param req - The request.
 * @returns The sub, or null when the request carries no identity.
 */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
function packageFile(appPackageDir, ...rel) {
    const candidates = [appPackageDir ? node_path_1.default.join(appPackageDir, ...rel) : '', LOAD_TIME_PACKAGE_DIR ? node_path_1.default.join(LOAD_TIME_PACKAGE_DIR, ...rel) : '', node_path_1.default.resolve(__dirname, '..', ...rel)].filter(Boolean);
    return candidates.find((c) => node_fs_1.default.existsSync(c)) || candidates[candidates.length - 1];
}
function serveFile(filePath, contentType) {
    return (_req, res) => {
        try {
            const source = node_fs_1.default.readFileSync(filePath, 'utf8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.type(contentType).send(source);
        }
        catch (error) {
            logger.error({ err: error, filePath }, 'Bundled surface file is not readable');
            res.status(404).json({ error: 'surface_file_not_found' });
        }
    };
}
function budgetParams(source) {
    return {
        distanceM: (0, engine_1.numberIn)(source.distanceM, 'distanceM', 1, 100_000, 500),
        requiredMarginDb: (0, engine_1.numberIn)(source.requiredMarginDb ?? source.marginDb, 'requiredMarginDb', engine_1.SPEC_LIMITS.requiredMarginDb.min, engine_1.SPEC_LIMITS.requiredMarginDb.max, engine_1.SPEC_LIMITS.requiredMarginDb.default),
        exponent: (0, engine_1.numberIn)(source.exponent ?? source.pathLossExponent, 'pathLossExponent', engine_1.SPEC_LIMITS.pathLossExponent.min, engine_1.SPEC_LIMITS.pathLossExponent.max, engine_1.DEFAULT_PATH_LOSS_EXPONENT),
    };
}
function refuse(res, error) {
    if (error instanceof engine_1.SpecError) {
        res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message });
        return true;
    }
    return false;
}
/**
 * @description Build the `/api/drone-relay` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @returns The composed router.
 */
function createDroneRelayRoutes(ctx) {
    const appPackageDir = ctx.appPackageDir;
    const router = (0, express_1.Router)();
    const surface = packageFile(appPackageDir, 'tools', 'drone-relay.html');
    logger.info({ surface, appPackageDir }, 'Resolved the drone-relay surface');
    router.get('/app', serveFile(surface, 'html'));
    router.get('/assets/drone-relay.js', serveFile(packageFile(appPackageDir, 'tools', 'drone-relay.js'), 'application/javascript'));
    router.get('/capabilities', (_req, res) => {
        res.json({ app: 'drone-relay', transports: engine_1.TRANSPORTS, limits: engine_1.SPEC_LIMITS, groundNodes: engine_1.GROUND_NODE_LIMITS, branches: engine_1.BRANCH_LIMITS, lattice: engine_1.LATTICE_LIMITS, scenario: engine_1.SCENARIO_LIMITS, defaults: (0, engine_1.validateSpec)({}), gapPolicies: ['retreat', 'hold-degraded'], postures: engine_1.POSTURES, controlChannels: (0, engine_1.controlChannelIds)(), heartbeatBytes: engine_1.HEARTBEAT_BYTES, envelope: { maxRoute: engine_1.MAX_ROUTE, baseId: engine_1.BASE_ID }, model: 'log-distance path loss on datasheet numbers; the range test replaces it' });
    });
    router.get('/transports', (req, res) => {
        try {
            const p = budgetParams(req.query);
            res.json({ ...p, budgets: (0, engine_1.compareTransports)(p.distanceM, p.requiredMarginDb, p.exponent) });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
    router.post('/link-budget', (req, res) => {
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const transport = (0, engine_1.findTransport)(body.transport);
            if (!transport)
                throw new engine_1.SpecError('transport', `transport "${String(body.transport)}" is not in the catalog`);
            const p = budgetParams(body);
            res.json({ transport, budget: (0, engine_1.linkBudget)(transport, p.distanceM, p.requiredMarginDb, p.exponent) });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
    router.use((0, plan_routes_1.createPlanRoutes)({ pool: ctx.pool, callerSub }));
    return router;
}
//# sourceMappingURL=drone-relay-routes.js.map