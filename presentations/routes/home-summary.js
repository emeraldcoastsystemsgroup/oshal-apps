"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved presentations evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five FROM oshal_presentations WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours'",
            "SELECT title, format, provider, created_at, outline FROM oshal_presentations WHERE user_sub = $1 AND created_at <= $2 ORDER BY created_at DESC, id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "day", "saved-24h", "Documents saved / 24h"], [0, "five", "saved-5d", "Documents saved / 5d"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "presentations-studio", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => {
            const outline = Array.isArray(r.outline) ? r.outline.slice(0, 8).map((s) => typeof s === 'object' && s ? clip(s.title, 120) + ': ' + clip(s.content ?? (Array.isArray(s.bullets) ? s.bullets.join('; ') : ''), 220) : '').join('\n') : '';
            item(r.title, 'Saved ' + clip(r.format) + ' document · ' + date(r.created_at) + ' · ' + clip(r.provider || 'destination not recorded'), outline || 'No saved outline preview.', ['prepare-campaign', 'prepare-post', 'prepare-video', 'prepare-episode']);
        });
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "presentations-studio" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "presentations-studio" });
        items.push({ text: "Counts are saved document records in rolling 24/120 hours. Storage availability is checked when you open the document. Preparation copies a bounded saved outline; it does not send or render.", tone: 'neutral', fix: "presentations-studio" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map