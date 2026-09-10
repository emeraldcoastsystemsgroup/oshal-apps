"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Summarize recorded editorial and confirmed-reply states across the caller's own workspaces.
 */
const express_1 = require("express");
/** @description Read saved publishing/outbox state, without providers or schema writes. @param ctx Package context. @returns Summary router. */
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const oidc = req.oidc;
        const sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const now = new Date();
        const [posts, replies] = await Promise.allSettled([
            ctx.pool.query(`SELECT
        count(*) FILTER (WHERE state = 'in_review')::text AS review,
        count(*) FILTER (WHERE state = 'scheduled')::text AS scheduled,
        count(*) FILTER (WHERE state = 'scheduled' AND scheduled_at <= $2::timestamptz)::text AS overdue,
        count(*) FILTER (WHERE state = 'failed')::text AS failed
        FROM oshal_switchboard_stream_posts WHERE user_sub = $1`, [String(sub), now]),
            ctx.pool.query(`SELECT
        count(*) FILTER (WHERE status IN ('pending', 'sending'))::text AS pending,
        count(*) FILTER (WHERE status = 'failed')::text AS failed,
        count(*) FILTER (WHERE status = 'uncertain')::text AS uncertain
        FROM oshal_switchboard_reply_outbox WHERE user_sub = $1`, [String(sub)]),
        ]);
        const p = posts.status === 'fulfilled' ? posts.value.rows[0] : null;
        const r = replies.status === 'fulfilled' ? replies.value.rows[0] : null;
        const metric = (id, label, value, warn = false) => ({ id, label, value: value ?? 'Unavailable', tone: warn && Number(value) > 0 ? 'warn' : 'neutral' });
        const metrics = [
            metric('posts-in-review', 'Posts awaiting review', p?.review, true),
            metric('posts-scheduled', 'Posts scheduled', p?.scheduled),
            metric('posts-overdue', 'Scheduled posts due', p?.overdue, true),
            metric('posts-failed', 'Failed posts', p?.failed, true),
            metric('replies-pending', 'Replies pending/sending', r?.pending),
            metric('replies-failed', 'Failed replies', r?.failed, true),
            metric('replies-uncertain', 'Replies unconfirmed', r?.uncertain, true),
        ];
        const items = [];
        if (posts.status === 'rejected')
            items.push({ text: 'Publishing state cannot be checked.', tone: 'warn', fix: 'switchboard-streams' });
        if (replies.status === 'rejected')
            items.push({ text: 'Reply outbox state cannot be checked.', tone: 'warn', fix: 'switchboard-threads' });
        if (Number(r?.uncertain) > 0)
            items.push({ metricId: 'replies-uncertain', text: 'Some replies have an uncertain delivery result. Check Threads before retrying.', tone: 'warn', fix: 'switchboard-threads' });
        items.push({ text: 'Saved state across all your workspaces. Pending includes sending; it does not mean delivered.', tone: 'neutral', fix: 'switchboard-threads' });
        items.push({ text: 'Review, schedule and failure counts refer to Streams posts. Open Streams for details.', tone: 'neutral', fix: 'switchboard-streams' });
        res.status(posts.status === 'rejected' && replies.status === 'rejected' ? 503 : 200).json({
            tiles: metrics.slice(0, 4), metrics, items, asOf: now.toISOString(), scope: 'all-own-workspaces',
            partial: posts.status === 'rejected' || replies.status === 'rejected',
        });
    });
    return router;
}
