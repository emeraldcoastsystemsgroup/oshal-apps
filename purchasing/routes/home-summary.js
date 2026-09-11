"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** App-owned saved purchasing evidence. Read-only; no provider calls or schema creation. */
const express_1 = require("express");
const queries = [
    "SELECT count(*)::text AS lists FROM shop_lists WHERE user_sub = $1 AND status='active' AND created_at <= $2",
    "SELECT i.title, i.quantity, l.name, i.created_at FROM shop_list_items i JOIN shop_lists l ON l.list_id=i.list_id AND l.user_sub=i.user_sub WHERE i.user_sub = $1 AND l.user_sub = $1 AND l.status='active' AND i.status='pending' AND i.created_at <= $2 ORDER BY i.created_at DESC, i.item_id LIMIT 3",
    "SELECT count(*)::text AS pending FROM shop_list_items i JOIN shop_lists l ON l.list_id=i.list_id AND l.user_sub=i.user_sub WHERE i.user_sub = $1 AND l.user_sub = $1 AND l.status='active' AND i.status='pending' AND i.created_at <= $2",
    "SELECT count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five_days FROM shop_purchase_history WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours' "
];
const definitions = [[0, "lists", "active-shopping-lists", "Active lists"], [2, "pending", "pending-shopping-items", "Items to review"], [3, "day", "shopping-handoffs-24h", "Checkout links / 24h"], [3, "five_days", "shopping-handoffs-5d", "Checkout links / 5 days"]];
const clip = (value, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const stamp = (value) => { const at = new Date(String(value)); return Number.isFinite(at.getTime()) ? at.toISOString() : 'date unknown'; };
function item(row) { if (!row.title)
    return null; return { text: clip(row.title, 120), detail: clip(row.name, 100) + ' · Saved ' + stamp(row.created_at), context: { title: 'Discuss a meal from my shopping list', notes: clip('Selected shopping item: ' + clip(row.title, 300) + '; quantity ' + row.quantity + '. Decide whether this item is relevant to a meal; it has not been purchased.', 700) } }; }
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
        const items = recent.status === 'fulfilled' ? recent.value.rows.map(item).filter(Boolean).slice(0, 3).map(({ context, ...entry }) => ({ ...entry, tone: 'neutral', fix: "shop-concierge", actions: ["plan-meal"].map(integration => ({ integration, context })) })) : [];
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved data cannot be checked.', tone: 'warn', fix: "shop-concierge" });
        else if (!items.length)
            items.push({ text: "No saved preparation items to review yet.", tone: 'neutral', fix: "shop-concierge" });
        items.push({ text: "Saved active lists and pending items. Checkout handoffs are not confirmed purchases.", tone: 'neutral', fix: "shop-concierge" });
        res.status(failed === results.length ? 503 : 200).json({ metrics, tiles: metrics.slice(0, 4), items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
