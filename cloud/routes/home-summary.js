"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** GCP connection posture without fetching inventory or starting cloud operations. */
const express_1 = require("express");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        const oidc = req.oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        try {
            const now = Date.now(), rows = (await (0, connector_tenancy_1.accessibleConnections)(ctx.pool, String(sub))).filter(r => r.provider === 'gcp');
            const expired = rows.filter(r => (0, connector_tenancy_1.isConnectionExpired)(r, now)).length;
            const metrics = [{ id: 'gcp-accounts', label: 'Saved GCP accounts', value: String(rows.length) }, { id: 'gcp-reconnect', label: 'Need reconnect', value: String(expired), tone: expired ? 'warn' : 'neutral' }];
            const detail = rows.length ? 'Saved authorization metadata; inventory and billing have not been refreshed.' : 'Connect a GCP account to inspect projects and resources.';
            res.json({ metrics, tiles: metrics, items: [{ text: detail, tone: 'neutral', fix: 'cloud-accounts' }], partial: false, asOf: new Date(now).toISOString() });
        }
        catch {
            res.status(503).json({ error: 'Cloud connection metadata is unavailable.' });
        }
    });
    return router;
}
