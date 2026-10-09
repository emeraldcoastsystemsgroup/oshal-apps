"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFuturesSchwabProbeRoutes = createFuturesSchwabProbeRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose an operator-only, owner-token Schwab Futures bar capability check without market-data payloads or writes.
 */
const express_1 = require("express");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const trading_futures_schwab_probe_1 = require("@/app/trading-futures-schwab-probe");
const authz_1 = require("@/shared/middleware/authz");
/** @description Read-only owner-bound check; never accepts a caller-supplied bearer or account identity. */
function createFuturesSchwabProbeRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        const sub = req.oidc?.user?.sub;
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (!(0, authz_1.isOperatorIdentity)(sub)) {
            res.status(403).json({ error: 'operator_only' });
            return;
        }
        if (!ctx?.pool) {
            res.status(503).json({ error: 'schwab_probe_unavailable' });
            return;
        }
        try {
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'schwab');
            if (!token) {
                res.status(409).json({ error: 'schwab_connection_not_available' });
                return;
            }
            res.setHeader('Cache-Control', 'no-store');
            res.json(await (0, trading_futures_schwab_probe_1.probeSchwabFuturesBars)(token));
        }
        catch {
            res.status(503).json({ error: 'schwab_probe_unavailable' });
        }
    });
    return router;
}
//# sourceMappingURL=trading-futures-schwab-probe-routes.js.map