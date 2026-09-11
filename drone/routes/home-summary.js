"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved drone evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*) FILTER(WHERE status='draft')::text AS drafts,count(*) FILTER(WHERE status='flown' AND last_flown_at<=$2 AND last_flown_at>$2::timestamptz-interval '120 hours')::text AS started FROM drone_missions WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2",
            "SELECT count(*) FILTER(WHERE outcome='rejected')::text AS rejected FROM drone_command_log WHERE user_sub = $1 AND created_at<=$2 AND created_at>$2::timestamptz-interval '120 hours'",
            "SELECT name,status,source,updated_at,last_flown_at FROM drone_missions WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY updated_at DESC,mission_id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "drafts", "draft-missions", "Mission drafts"], [0, "started", "started-5d", "Execution starts / 5d"], [1, "rejected", "rejected-5d", "Rejected commands / 5d"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "drone-ops", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(2).forEach(r => item(r.name, clip(r.status) + ' / updated ' + date(r.updated_at), 'Saved plan origin: ' + clip(r.source) + '. The flown flag is written when execution starts, not when a flight completes. Simulation/hardware outcomes are not separated by this record. No coordinates or commands are transferred.', ['prepare-document']));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "drone-ops" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "drone-ops" });
        items.push({ text: "Saved mission drafts and recorded execution starts. The source writes flown immediately after startMission, so Home calls this execution starts, never completed flights. Diagnostic handoff carries plan name and recorded state only; flight approval stays in Drone Ops.", tone: 'neutral', fix: "drone-ops" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
