"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved merchant payment evidence; exact caller scope, no provider status refresh or charge. */
const express_1 = require("express");
const clip = (v, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
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
        const [counts, recent] = await Promise.allSettled([
            read(`SELECT count(*) FILTER (WHERE NOT test_mode AND status='completed' AND created_at > $2::timestamptz-interval '24 hours')::text AS completed_day,
    count(*) FILTER (WHERE NOT test_mode AND status='completed' AND created_at > $2::timestamptz-interval '120 hours')::text AS completed_five,
    count(*) FILTER (WHERE NOT test_mode AND status='pending')::text AS pending,
    count(*) FILTER (WHERE NOT test_mode AND status='failed' AND created_at > $2::timestamptz-interval '120 hours')::text AS failed,
    count(*) FILTER (WHERE test_mode AND created_at > $2::timestamptz-interval '120 hours')::text AS test_records
    FROM oshal_merchant_payments WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2`),
            read("SELECT charge_id, provider, amount_cents::text, currency, status, test_mode, note, created_at, updated_at FROM oshal_merchant_payments WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2 AND created_at > $2::timestamptz-interval '120 hours' ORDER BY created_at DESC, charge_id LIMIT 3"),
        ]);
        const row = counts.status === 'fulfilled' ? counts.value.rows[0] : null;
        const definitions = [['completed_day', 'live-charges-24h', 'Completed live charges / 24h'], ['completed_five', 'live-charges-5d', 'Completed live charges / 5 days'], ['pending', 'live-charges-pending', 'Live charges awaiting payment'], ['failed', 'live-charges-failed-5d', 'Failed live charges / 5 days'], ['test_records', 'test-charges-5d', 'Test charges / 5 days']];
        const metrics = definitions.map(([key, id, label]) => ({ id, label, value: counts.status === 'fulfilled' ? String(row?.[key] ?? '0') : 'Unavailable' }));
        const items = recent.status === 'fulfilled' ? recent.value.rows.map((r) => { const notes = clip((r.test_mode ? 'TEST' : 'LIVE') + ' charge ' + r.charge_id + ' via ' + r.provider + ': ' + r.amount_cents + ' cents (' + r.currency + '), recorded status ' + r.status + '. Last recorded ' + new Date(r.updated_at).toISOString() + '. ' + clip(r.note), 2000); return { text: clip((r.test_mode ? 'Test' : 'Live') + ' payment: ' + r.status, 120), detail: clip(notes), tone: r.status === 'failed' ? 'warn' : 'neutral', highlight: !r.test_mode && r.status === 'failed', fix: 'payments-home', actions: ['review-finance', 'prepare-document'].map(integration => ({ integration, context: { title: 'Review a recorded merchant payment', notes } })) }; }) : [];
        const failed = [counts, recent].filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved payments cannot be checked.', tone: 'warn', fix: 'payments-home' });
        else if (!items.length)
            items.push({ text: 'No payment records created in the last five days.', tone: 'neutral', fix: 'payments-home' });
        items.push({ text: 'Charge creation cohorts, rolling 24/120 hours. Completed is the recorded status; completion may occur later than creation. Test charges are separate.', tone: 'neutral', fix: 'payments-home' });
        res.status(failed === 2 ? 503 : 200).json({ metrics, tiles: metrics.slice(0, 4), items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map