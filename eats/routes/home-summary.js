"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** App-owned saved eats evidence. Read-only; no provider calls or schema creation. */
const express_1 = require("express");
const queries = [
    "SELECT count(*)::text AS pending FROM eats_cart_items i JOIN eats_carts c ON c.cart_id=i.cart_id AND c.user_sub=i.user_sub WHERE i.user_sub = $1 AND c.user_sub = $1 AND c.status='active' AND i.status='pending' AND i.created_at <= $2",
    "SELECT i.title, i.quantity, c.store_name, i.created_at FROM eats_cart_items i JOIN eats_carts c ON c.cart_id=i.cart_id AND c.user_sub=i.user_sub WHERE i.user_sub = $1 AND c.user_sub = $1 AND c.status='active' AND i.status='pending' AND i.created_at <= $2 ORDER BY i.created_at DESC, i.row_id LIMIT 3",
    "SELECT count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five_days FROM eats_orders WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours' "
];
const definitions = [[0, "pending", "pending-meal-items", "Meal items to review"], [2, "day", "meal-handoffs-24h", "Checkout links / 24h"], [2, "five_days", "meal-handoffs-5d", "Checkout links / 5 days"]];
const clip = (value, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const stamp = (value) => { const at = new Date(String(value)); return Number.isFinite(at.getTime()) ? at.toISOString() : 'date unknown'; };
function item(row) { if (!row.title)
    return null; const notes = clip('Meal choice to discuss: ' + clip(row.title, 200) + '; quantity ' + row.quantity + (row.store_name ? ' from ' + clip(row.store_name, 100) : '') + '. This is a cart item, not a placed order.', 700); return { text: clip(row.title, 120), detail: 'In your meal cart · ' + stamp(row.created_at), context: { title: 'Prepare for my meal choice', notes } }; }
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
        const items = recent.status === 'fulfilled' ? recent.value.rows.map(item).filter(Boolean).slice(0, 3).map(({ context, ...entry }) => ({ ...entry, tone: 'neutral', fix: "eats-concierge", actions: ["plan-shopping", "plan-movie", "plan-music"].map(integration => ({ integration, context })) })) : [];
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved data cannot be checked.', tone: 'warn', fix: "eats-concierge" });
        else if (!items.length)
            items.push({ text: "No saved preparation items to review yet.", tone: 'neutral', fix: "eats-concierge" });
        items.push({ text: "Pending items in your active meal carts. Checkout links do not confirm an order or delivery.", tone: 'neutral', fix: "eats-concierge" });
        res.status(failed === results.length ? 503 : 200).json({ metrics, tiles: metrics.slice(0, 4), items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
