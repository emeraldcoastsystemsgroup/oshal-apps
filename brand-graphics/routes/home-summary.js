"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved brand-graphics evidence. GET is owner-scoped, bounded, and side-effect free. */
const express_1 = require("express");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
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
        const result = await Promise.allSettled([
            "SELECT count(*) FILTER (WHERE status IN ('queued','running'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed, count(*) FILTER (WHERE status='done' AND updated_at > $2::timestamptz - interval '120 hours')::text AS five FROM vids_jobs WHERE user_sub = $1 AND insert_mode='brand' AND created_at <= $2 AND updated_at <= $2",
            "SELECT idea, status, updated_at FROM vids_jobs WHERE user_sub = $1 AND insert_mode='brand' AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, job_id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "active", "brand-active", "Brand jobs in progress"], [0, "failed", "brand-failed", "Failed brand jobs"], [0, "five", "brand-done-5d", "Done jobs updated / 5d"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "brand-graphics", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => item(r.idea, clip(r.status) + ' · updated ' + date(r.updated_at), clip(r.idea, 1500), ['prepare-document', 'prepare-episode'], r.status === 'failed' ? 'warn' : 'neutral'));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "brand-graphics" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "brand-graphics" });
        items.push({ text: "Only Vids jobs explicitly attributed as brand builds are counted. Completion is a saved worker result, not a publication. Review or edit the brand brief before explicitly starting a render; a connected draft consumes no rendering credits.", tone: 'neutral', fix: "brand-graphics" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
