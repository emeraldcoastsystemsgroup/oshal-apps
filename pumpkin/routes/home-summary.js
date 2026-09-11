"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved pumpkin evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*)::text AS presets FROM pumpkin_presets WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2",
            "SELECT count(*)::text AS lines,count(*) FILTER(WHERE pinned)::text AS pinned FROM pumpkin_responses WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2",
            "SELECT say,expression,source,updated_at FROM pumpkin_responses WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY pinned DESC,updated_at DESC,id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "presets", "saved-looks", "Saved custom looks"], [1, "lines", "saved-lines", "Saved response lines"], [1, "pinned", "pinned-lines", "Pinned response lines"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "pumpkin-control", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(2).forEach(r => item(clip(r.say, 100), clip(r.expression) + ' / saved ' + date(r.updated_at), 'Saved prop line: ' + clip(r.say, 1300) + ' Source: ' + clip(r.source) + '. Adapt this into a reviewed video brief; saved dialogue does not prove it played on a projector.', ['prepare-clip']));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "pumpkin-control" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "pumpkin-control" });
        items.push({ text: "Shows caller-saved custom looks and dialogue, with pinned lines first. No current projector liveness is claimed from saved settings. Selected dialogue can prepare a Vids clip draft; Home does not speak, animate, record audio or trigger the physical prop.", tone: 'neutral', fix: "pumpkin-control" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
