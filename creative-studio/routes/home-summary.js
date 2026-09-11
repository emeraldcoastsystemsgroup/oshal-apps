"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved creative-studio evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*) FILTER (WHERE status IN ('queued','running'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed, count(*) FILTER (WHERE status='done' AND updated_at > $2::timestamptz - interval '120 hours')::text AS five FROM vids_jobs WHERE user_sub = $1 AND insert_mode='story' AND created_at <= $2 AND updated_at <= $2",
            "SELECT idea, status, updated_at FROM vids_jobs WHERE user_sub = $1 AND insert_mode='story' AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, job_id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "active", "stories-active", "Story jobs in progress"], [0, "failed", "stories-failed", "Failed story jobs"], [0, "five", "stories-done-5d", "Stories done / 5d"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "creative-studio", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => item(r.idea, clip(r.status) + ' · updated ' + date(r.updated_at), clip(r.idea, 1500), ['prepare-document', 'prepare-episode'], r.status === 'failed' ? 'warn' : 'neutral'));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "creative-studio" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "creative-studio" });
        items.push({ text: "Shows only the caller’s Vids story pipeline jobs, never generic clip or brand jobs. A completed story job records the worker outcome; it does not prove social publication or current remote file availability. Prepare an editable next episode or production document.", tone: 'neutral', fix: "creative-studio" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
