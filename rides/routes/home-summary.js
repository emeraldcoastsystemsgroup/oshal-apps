"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** App-owned saved rides evidence. Read-only; no provider calls or schema creation. */
const express_1 = require("express");
const queries = [
    "SELECT count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five_days FROM rides_requests WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours' ",
    "SELECT pickup, dropoff, created_at FROM rides_requests WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours' ORDER BY created_at DESC, request_id LIMIT 3"
];
const definitions = [[0, "day", "ride-handoffs-24h", "Ride links / 24h"], [0, "five_days", "ride-handoffs-5d", "Ride links / 5 days"]];
const clip = (value, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const stamp = (value) => { const at = new Date(String(value)); return Number.isFinite(at.getTime()) ? at.toISOString() : 'date unknown'; };
function item(row) { if (!row.dropoff)
    return null; const notes = clip('Destination: ' + clip(row.dropoff, 350) + '; Pickup: ' + clip(row.pickup, 350) + '; Saved handoff ' + stamp(row.created_at) + '; booking not confirmed.', 1200); return { text: clip(row.dropoff, 120), detail: 'Ride preparation · ' + stamp(row.created_at), context: { title: 'Plan around my saved ride request', notes } }; }
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const oidc = req.oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const now = new Date();
        const results = await Promise.allSettled(queries.map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const metrics = definitions.map(([index, key, id, label]) => { const result = results[index]; return { id, label, value: result.status === 'fulfilled' ? String(result.value.rows[0]?.[key] ?? '0') : 'Unavailable', tone: 'neutral' }; });
        const recent = results[1];
        const items = recent.status === 'fulfilled' ? recent.value.rows.map(item).filter(Boolean).slice(0, 3).map(({ context, ...entry }) => ({ ...entry, tone: 'neutral', fix: "rides-concierge", actions: ["plan-meal", "plan-trip"].map(integration => ({ integration, context })) })) : [];
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved data cannot be checked.', tone: 'warn', fix: "rides-concierge" });
        else if (!items.length)
            items.push({ text: "No saved preparation items to review yet.", tone: 'neutral', fix: "rides-concierge" });
        items.push({ text: "Saved ride handoff requests, not confirmed bookings or completed rides.", tone: 'neutral', fix: "rides-concierge" });
        res.status(failed === results.length ? 503 : 200).json({ metrics, tiles: metrics.slice(0, 4), items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map