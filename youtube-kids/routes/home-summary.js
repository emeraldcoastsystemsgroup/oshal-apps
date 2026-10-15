"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plainBrief = plainBrief;
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 7: the gift hand-off draft carried the saved brief's raw Markdown flattened into one line ('## Top interests - **Aerospace & Physics**: ...'). plainBrief() states the brief as plain sentences (a heading ends with a colon, a list item or line with a full stop, emphasis, code marks and link targets dropped) before it is clipped. Guard: tests/home-summary-dates.test.cjs.
 */
/** Saved youtube-kids evidence. GET is owner-scoped, bounded, and side-effect free. */
const express_1 = require("express");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
/** Inline Markdown as text: link labels kept, code and emphasis marks dropped. */
const plainInline = (t) => t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`+/g, '').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, '$1$2').trim();
/** A sentence ends with one mark; a heading reads as a label with a colon. */
const ended = (t, mark) => (/[.!?:]$/.test(t) ? t : t + mark);
/** The saved brief (Markdown from the brief bot) as plain sentences for a hand-off draft a person reads and edits. */
function plainBrief(md) {
    return String(md ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^([-*_]\s*){3,}$/.test(line)).map((line) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading)
            return ended(plainInline(heading[1]), ':');
        const item = /^(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(line);
        return ended(plainInline((item ? item[1] : line).replace(/^>\s*/, '')), '.');
    }).filter((t) => t && t !== '.' && t !== ':').join(' ');
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
/** A date a person reads in a hand-off draft ("Oct 12, 2026 00:05 UTC"), never a raw ISO stamp. */
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC' : 'date unavailable'; };
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
        rows(1).forEach(r => item('Kid Lens history', 'Imported ' + date(r.uploaded_at), r.brief_at && new Date(r.brief_at) <= now && r.excerpt ? 'Saved AI parent brief from ' + date(r.brief_at) + ': ' + clip(plainBrief(r.excerpt), 1400) + ' Review interests and choose a gift budget/age range yourself.' : 'No saved parent brief. Open Kid Lens to request one explicitly.', r.brief_at && new Date(r.brief_at) <= now && r.excerpt ? ['plan-gift', 'prepare-document'] : []));
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
//# sourceMappingURL=home-summary.js.map