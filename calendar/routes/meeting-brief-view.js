"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storedBrief = storedBrief;
exports.createMeetingBriefViewRoutes = createMeetingBriefViewRoutes;
/**
 * Calendar Preparation — the caller's view of their own meeting briefs.
 *
 * This route returns the STORED brief rows, and the surface renders `deliveryText` from each row
 * unchanged. It does not re-assemble, re-render or re-word anything: the string here is the string
 * the notification carried, which is what makes "what you read" and "what was delivered" the same
 * bytes rather than two renderings of one idea.
 *
 * Owner-scoped twice over: the handler refuses without an authenticated subject and pins every
 * query to it, with the migration's forced owner RLS underneath as the backstop.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the caller's stored meeting briefs verbatim so the surface shows the delivered bytes.
 *
 * @module meeting-brief-view
 */
const express_1 = require("express");
const QUERY_TIMEOUT_MS = 1_800;
const MAX_ROWS = 20;
/**
 * @description Project one stored row into the surface shape without re-rendering its text. A row
 * whose stored document is unreadable is dropped rather than shown with invented fields.
 * @param row - The `calendar_meeting_briefs` row.
 * @returns The projected brief, or null when the stored document is unusable.
 */
function storedBrief(row) {
    const document = row.brief && typeof row.brief === 'object' ? row.brief : null;
    const deliveryText = typeof document?.deliveryText === 'string' ? document.deliveryText : '';
    const eventId = typeof row.event_id === 'string' ? row.event_id : '';
    if (!deliveryText.trim() || !eventId)
        return null;
    const claims = Array.isArray(document?.claims) ? document.claims : [];
    return {
        eventId,
        title: String(row.title ?? ''),
        startsAt: new Date(String(row.starts_at)).toISOString(),
        builtAt: new Date(String(row.built_at)).toISOString(),
        hasHistory: document?.hasHistory === true,
        citations: claims.length,
        deliveryText,
    };
}
/**
 * @description Serve the authenticated caller's own stored meeting briefs, newest meeting first.
 * @param ctx - Package-bound framework context.
 * @returns Router exposing GET / for the Calendar Preparation surface.
 */
function createMeetingBriefViewRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const oidc = req.oidc;
        const sub = oidc?.user?.sub;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const result = await ctx.pool.query({
                text: `SELECT event_id,title,starts_at,built_at,brief FROM calendar_meeting_briefs
          WHERE user_sub = $1 ORDER BY starts_at DESC LIMIT $2`,
                values: [sub, MAX_ROWS], query_timeout: QUERY_TIMEOUT_MS,
            });
            const briefs = result.rows.map(storedBrief).filter((brief) => brief !== null);
            res.json({ briefs, note: 'Each brief is the exact text that was delivered for that meeting.' });
        }
        catch {
            res.status(503).json({ error: 'Meeting briefs are unavailable' });
        }
    });
    return router;
}
//# sourceMappingURL=meeting-brief-view.js.map