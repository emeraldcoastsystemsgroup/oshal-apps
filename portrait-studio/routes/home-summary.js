"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Restrict saved summary evidence to exact verified owners and current read permission.
 */
const express_1 = require("express");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
/** @description Read saved summary facts under exact owner and current app permission.
 * @param ctx Bound package context. @returns The read-only summary router.
 */
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const actor = ctx.authorization?.currentActor(), sub = actor?.sub;
        if (!sub || !actor?.isActive) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const now = new Date();
        const result = await Promise.allSettled([
            "SELECT count(*) FILTER (WHERE status IN ('queued','generating'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed, count(*) FILTER (WHERE status='done' AND updated_at > $2::timestamptz - interval '120 hours')::text AS five FROM ps_portraits WHERE user_sub = $1 AND owner_issuer = $3 AND created_at <= $2 AND updated_at <= $2",
            "SELECT mode, style, status, updated_at FROM ps_portraits WHERE user_sub = $1 AND owner_issuer = $3 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, portrait_id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now, actor.issuer], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "active", "portraits-active", "Portraits generating"], [0, "failed", "portraits-failed", "Failed portraits"], [0, "five", "portraits-done-5d", "Portraits done / 5d"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "portrait-studio", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => item(clip(r.mode) + ' portrait', clip(r.style) + ' · ' + clip(r.status) + ' · updated ' + date(r.updated_at), 'Prepare a profile or brand document. This handoff contains portrait metadata, not the image file. Open Portrait Studio to review and export the image.', ['prepare-document'], r.status === 'failed' ? 'warn' : 'neutral'));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "portrait-studio" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "portrait-studio" });
        items.push({ text: "Saved generation states distinguish work in progress, failed work and completed portraits. The five-day window uses the last update, not a separate completion timestamp. Existing image review/export remains in Portrait Studio; document preparation sends only selected metadata.", tone: 'neutral', fix: "portrait-studio" });
        for (const permission of ['portrait.view', 'portrait.read']) {
            if (!(await ctx.authorization.authorize({ permission })).allowed) {
                res.status(403).json({ error: 'portrait_permission_denied' });
                return;
            }
        }
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
