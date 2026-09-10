"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identitySummary = identitySummary;
exports.createIdentitySummaryRoutes = createIdentitySummaryRoutes;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Read existing accessible connection metadata for a deterministic configurable Home summary.
 */
const express_1 = require("express");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
/** @description Produce bounded counts without provider calls, token refresh or AI reasoning.
 * @param rows Connections already filtered by the canonical access helper. @param now Evaluation time.
 * @returns Public metadata only; never serializes connection rows or credentials. */
function identitySummary(rows, now = Date.now()) {
    const expired = rows.filter(r => (0, connector_tenancy_1.isConnectionExpired)(r, now)).length;
    const expiring = rows.filter(r => {
        if (!r.expiry || r.refresh_token)
            return false;
        const at = new Date(r.expiry).getTime();
        return Number.isFinite(at) && at > now && at <= now + 7 * 86400000;
    }).length;
    const metrics = [
        { id: 'saved-accounts', label: 'Saved accounts', value: String(rows.length), tone: 'neutral' },
        { id: 'reconnect', label: 'Need reconnect', value: String(expired), tone: expired ? 'warn' : 'neutral' },
        { id: 'expires-7d', label: 'Expire within 7 days', value: String(expiring), tone: expiring ? 'warn' : 'neutral' },
        { id: 'shared-accounts', label: 'Shared accounts', value: String(rows.filter(r => r.tenant_id).length), tone: 'neutral' },
        { id: 'providers', label: 'Providers saved', value: String(new Set(rows.map(r => r.provider)).size), tone: 'neutral' },
    ];
    const items = [];
    if (!rows.length)
        items.push({ text: 'No accounts saved. Open Identity to connect the services you use.', tone: 'neutral', fix: 'identity-home' });
    if (expired)
        items.push({ metricId: 'reconnect', text: `${expired} authorization(s) have expired and cannot renew automatically.`, tone: 'warn', fix: 'identity-home' });
    if (expiring)
        items.push({ metricId: 'expires-7d', text: `${expiring} nonrenewable authorization(s) expire within seven days.`, tone: 'warn', fix: 'identity-home' });
    items.push({ text: 'Saved metadata only; provider availability was not tested. Renewable access-token expiry needs no action.', tone: 'neutral' });
    return { tiles: metrics.slice(0, 4), metrics, items, asOf: new Date(now).toISOString() };
}
/** @description Session-owned summary route; GET performs only the existing access-filtered SELECTs.
 * @param ctx Package application context. @returns Router mounted below /api/identity. */
function createIdentitySummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/summary', async (req, res) => {
        const oidc = req.oidc;
        const sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        try {
            res.json(identitySummary(await (0, connector_tenancy_1.accessibleConnections)(ctx.pool, String(sub))));
        }
        catch {
            res.status(503).json({ error: 'Connection metadata cannot be checked.' });
        }
    });
    return router;
}
//# sourceMappingURL=identity-summary.js.map