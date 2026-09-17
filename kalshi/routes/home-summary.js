"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved personal alerts and placement records; no scan, forecast, trade or provider refresh. */
const express_1 = require("express");
const clip = (value, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const oidc = req.oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const now = new Date(), read = (text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 });
        const [counts, alerts, orders] = await Promise.allSettled([
            read(`SELECT count(*) FILTER (WHERE created_at > $2::timestamptz-interval '24 hours')::text AS day,
        count(*)::text AS five, count(*) FILTER (WHERE delivered)::text AS delivered
        FROM kalshi_scan_alerts WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz-interval '120 hours'`),
            read(`SELECT ticker, strength, delivered, created_at FROM kalshi_scan_alerts WHERE user_sub = $1
        AND created_at <= $2 AND created_at > $2::timestamptz-interval '120 hours' ORDER BY created_at DESC, id DESC LIMIT 2`),
            read(`SELECT env, ticker, side, action, count, kalshi_status, created_at FROM kalshi_orders WHERE user_sub = $1
        AND created_at <= $2 AND created_at > $2::timestamptz-interval '120 hours' ORDER BY created_at DESC, id DESC LIMIT 2`),
        ]);
        const metrics = [['day', 'recorded-alerts-24h', 'Recorded alerts / 24h'], ['five', 'recorded-alerts-5d', 'Recorded alerts / 5 days'], ['delivered', 'delivered-alerts-5d', 'Delivered alerts / 5 days']].map(([key, id, label]) => ({
            id, label, value: counts.status === 'fulfilled' ? String(counts.value.rows[0]?.[key] ?? '0') : 'Unavailable',
        }));
        const actions = (title, notes) => ['review-finance', 'prepare-document', 'review-research'].map(integration => ({ integration, context: { title, notes } }));
        const items = alerts.status === 'fulfilled' ? alerts.value.rows.map((a) => {
            const notes = clip(`Recorded market alert ${a.ticker}, strength ${a.strength || 'not recorded'}, first seen ${new Date(a.created_at).toISOString()}. ${a.delivered ? 'Marked delivered.' : 'Delivery not confirmed.'} This alert is a research signal, not an order, position, settlement or realized profit.`, 2000);
            return { text: clip(a.ticker, 120), detail: clip(notes), tone: 'neutral', fix: 'kalshi-home', actions: actions('Research a recorded market alert', notes) };
        }) : [];
        if (orders.status === 'fulfilled')
            for (const o of orders.value.rows) {
                const notes = clip(`${o.env} placement record: ${o.action} ${o.count} ${o.side} contracts for ${o.ticker}, status at placement ${o.kalshi_status || 'not recorded'}, recorded ${new Date(o.created_at).toISOString()}. Current fill/settlement is not checked.`, 2000);
                items.push({ text: clip(o.env + ' · ' + o.ticker, 120), detail: clip(notes), tone: 'neutral', fix: 'kalshi-home', actions: actions('Review a market placement record', notes).slice(0, 2) });
            }
        const failed = [counts, alerts, orders].filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved market records cannot be checked.', tone: 'warn', fix: 'kalshi-home' });
        else if (!items.length)
            items.push({ text: 'No personal alerts or placement records in the last five days.', tone: 'neutral', fix: 'kalshi-home' });
        res.status(failed === 3 ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map