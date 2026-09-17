"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add saved campaign evidence and a native review surface for explicit connected planning.
 */
/** Saved dnd evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*) FILTER(WHERE status='active')::text AS active,count(*) FILTER(WHERE status='archived')::text AS archived FROM dnd_campaigns WHERE (owner_sub = $1 OR $1=ANY(member_subs)) AND created_at<=$2 AND updated_at<=$2",
            "SELECT c.name,c.status,c.updated_at,a.content FROM dnd_campaigns c LEFT JOIN LATERAL (SELECT left(a.content,1300) AS content FROM dnd_archive a WHERE a.campaign_id=c.campaign_id AND a.owner_sub=c.owner_sub AND a.created_at<=$2 ORDER BY a.seq DESC LIMIT 1) a ON true WHERE (c.owner_sub = $1 OR $1=ANY(c.member_subs)) AND c.created_at<=$2 AND c.updated_at<=$2 ORDER BY c.updated_at DESC,c.campaign_id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "active", "campaigns-active", "Active campaigns"], [0, "archived", "campaigns-archived", "Archived campaigns"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "dnd-table", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => item(r.name, clip(r.status) + ' / saved ' + date(r.updated_at), 'Latest recorded story beat: ' + clip(r.content || 'none', 1300) + '. Prepare a session recap or discuss refreshments for the next session; no session date is implied.', ['prepare-document', 'plan-meal']));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "dnd-table" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "dnd-table" });
        items.push({ text: "Shows campaigns the caller owns or currently belongs to using the same campaign member ACL as the game. The latest archive beat must match that campaign owner. Shared story context can become an editable recap or meal plan; Home never rolls dice, advances combat, starts narration or shares an invitation code.", tone: 'neutral', fix: "dnd-table" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map