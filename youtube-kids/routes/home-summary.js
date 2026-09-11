"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved youtube-kids evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*)::text AS imports,coalesce(max(total_watched),0)::text AS watched,count(*) FILTER(WHERE nullif(trim(brief),'') IS NOT NULL AND brief_at<=$2)::text AS briefs FROM oshal_youtube_activity WHERE user_sub = $1 AND uploaded_at<=$2",
            "SELECT uploaded_at,brief_at,left(brief,1400) AS excerpt,total_watched FROM oshal_youtube_activity WHERE user_sub = $1 AND uploaded_at<=$2"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "imports", "saved-import", "Saved history import"], [0, "watched", "imported-records", "Imported watch records"], [0, "briefs", "saved-brief", "Saved parent brief"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "youtube-kids", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => item('Kid Lens history', 'Imported ' + date(r.uploaded_at), r.brief_at && new Date(r.brief_at) <= now && r.excerpt ? 'Saved AI parent brief from ' + date(r.brief_at) + ': ' + clip(r.excerpt, 1400) + ' Review interests and choose a gift budget/age range yourself.' : 'No saved parent brief. Open Kid Lens to request one explicitly.', r.brief_at && new Date(r.brief_at) <= now && r.excerpt ? ['plan-gift', 'prepare-document'] : []));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "youtube-kids" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "youtube-kids" });
        items.push({ text: "Shows the latest caller-uploaded history snapshot and already-saved parent brief. Imported watch records are not recent screen time; brief age and import age are separate. Explicit gift planning shares a bounded saved brief with Shopping for review, never raw watch history, and does not buy anything or generate a new profile.", tone: 'neutral', fix: "youtube-kids" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
