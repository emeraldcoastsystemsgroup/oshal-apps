"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENED = void 0;
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * App-owned saved eats evidence for the Home summary: the Uber Eats links the diner opened. Read-only; no
 * provider calls or schema creation.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.0: the summary counts and lists the Uber Eats hand-offs (eats_orders) instead of cart items; the package no longer keeps a cart, because a menu it cannot read is not something to price.
 */
const express_1 = require("express");
const queries = [
    "SELECT count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five_days FROM eats_orders WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours'",
    "SELECT store_name, handoff_url, created_at FROM eats_orders WHERE user_sub = $1 AND created_at <= $2 ORDER BY created_at DESC, order_id LIMIT 3",
    "SELECT count(DISTINCT store_id)::text AS restaurants FROM eats_orders WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '720 hours'",
];
const definitions = [[0, 'day', 'meal-handoffs-24h', 'Uber Eats links / 24h'], [0, 'five_days', 'meal-handoffs-5d', 'Uber Eats links / 5 days'], [2, 'restaurants', 'meal-restaurants-30d', 'Restaurants opened / 30 days']];
/** The detail prefix of a hand-off item; the family audience view reads the stamp after it. */
exports.OPENED = 'Opened in Uber Eats · ';
const clip = (value, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const stamp = (value) => { const at = new Date(String(value)); return Number.isFinite(at.getTime()) ? at.toISOString() : 'date unknown'; };
function item(row) {
    if (!row.store_name)
        return null;
    const store = clip(row.store_name, 120);
    const notes = clip(`Restaurant opened in Uber Eats: ${store} on ${stamp(row.created_at)}. Opening the link is not a placed order; the dishes, address and payment are chosen in Uber Eats.`, 700);
    return { text: store, detail: exports.OPENED + stamp(row.created_at), context: { title: `Prepare for my meal from ${store}`, notes } };
}
/**
 * @description The Home summary route: three counts over the hand-offs and the three newest as items.
 * @param ctx - The app context (its pool).
 * @returns The router.
 */
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
        const results = await Promise.allSettled(queries.map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const metrics = definitions.map(([index, key, id, label]) => { const result = results[index]; return { id, label, value: result.status === 'fulfilled' ? String(result.value.rows[0]?.[key] ?? '0') : 'Unavailable', tone: 'neutral' }; });
        const recent = results[1];
        const items = recent.status === 'fulfilled' ? recent.value.rows.map(item).filter(Boolean).slice(0, 3).map(({ context, ...entry }) => ({ ...entry, tone: 'neutral', fix: 'eats-concierge', actions: ['plan-shopping', 'plan-movie', 'plan-music'].map((integration) => ({ integration, context })) })) : [];
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved data cannot be checked.', tone: 'warn', fix: 'eats-concierge' });
        else if (!items.length)
            items.push({ text: 'No saved Uber Eats links yet.', tone: 'neutral', fix: 'eats-concierge' });
        items.push({ text: 'Uber Eats links opened from Eats. Opening a link does not confirm an order or delivery.', tone: 'neutral', fix: 'eats-concierge' });
        res.status(failed === results.length ? 503 : 200).json({ metrics, tiles: metrics.slice(0, 4), items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
