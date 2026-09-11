"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** App-owned saved movies evidence. Read-only; no provider calls or schema creation. */
const express_1 = require("express");
const queries = [
    "SELECT count(*)::text AS saved FROM movies_watchlist WHERE user_sub = $1 AND status = 'want' AND created_at <= $2",
    "SELECT title, year, created_at FROM movies_watchlist WHERE user_sub = $1 AND status = 'want' AND created_at <= $2 ORDER BY created_at DESC, row_id LIMIT 3"
];
const definitions = [[0, "saved", "watchlist-titles", "Want to watch"]];
const clip = (value, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const stamp = (value) => { const at = new Date(String(value)); return Number.isFinite(at.getTime()) ? at.toISOString() : 'date unknown'; };
function item(row) { const title = clip(row.title, 100); if (!title)
    return null; return { text: title, detail: 'Saved to watchlist ' + stamp(row.created_at) + (row.year ? ' · ' + clip(row.year, 10) : ''), context: { title: 'Plan a movie night', notes: 'Selected saved movie: ' + title + '. Discuss suitable food or music for this viewing plan.' } }; }
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
        const items = recent.status === 'fulfilled' ? recent.value.rows.map(item).filter(Boolean).slice(0, 3).map(({ context, ...entry }) => ({ ...entry, tone: 'neutral', fix: "movies-concierge", actions: ["plan-meal", "plan-music"].map(integration => ({ integration, context })) })) : [];
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved data cannot be checked.', tone: 'warn', fix: "movies-concierge" });
        else if (!items.length)
            items.push({ text: "No saved preparation items to review yet.", tone: 'neutral', fix: "movies-concierge" });
        items.push({ text: "Your saved watchlist. A saved title is not viewing history.", tone: 'neutral', fix: "movies-concierge" });
        res.status(failed === results.length ? 503 : 200).json({ metrics, tiles: metrics.slice(0, 4), items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
