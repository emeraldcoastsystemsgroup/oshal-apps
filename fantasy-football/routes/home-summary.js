"use strict";
/**
 * Fantasy Football's Home summary — the caller's own linked leagues and start/sit ledger, as tiles.
 *
 * GET only, owner-scoped, bounded and side-effect free: it never refreshes a projection, reads
 * ESPN, or changes a lineup. Every statement names `user_sub = $1`, and the tables it reads are
 * under forced exact-owner row-level security besides, so a Home shell can only ever show a person
 * their own team. A source that cannot be read says "Unavailable" rather than inventing a zero.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — linked leagues, ungraded calls and calls graded in the last five days, read from the caller's own ff_leagues and ff_calls rows (the fantasy metrics sports-edge's summary carried before the move).
 *
 * @module home-summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
const express_1 = require("express");
/** The owner-scoped reads, each bounded by the request instant. */
const READS = [
    'SELECT count(*)::text AS leagues FROM ff_leagues WHERE user_sub = $1 AND linked_at<=$2',
    "SELECT count(*) FILTER(WHERE settled=false)::text AS pending,count(*) FILTER(WHERE settled=true AND graded_at<=$2 AND graded_at>$2::timestamptz-interval '120 hours')::text AS graded FROM ff_calls WHERE user_sub = $1 AND created_at<=$2",
];
/** [read index, column, metric id, label]. */
const METRICS = [
    [0, 'leagues', 'fantasy-leagues', 'Linked fantasy leagues'],
    [1, 'pending', 'calls-ungraded', 'Ungraded start/sit calls'],
    [1, 'graded', 'graded-5d', 'Start/sit calls graded/5d'],
];
/**
 * @description Mount the summary route.
 * @param ctx - App context supplying the pool.
 * @returns The router.
 */
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
        const result = await Promise.allSettled(READS.map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const metrics = METRICS.map(([i, key, id, label]) => {
            const r = result[i];
            return { id, label, value: r.status === 'fulfilled' ? String(r.value.rows[0]?.[key] ?? '0') : 'Unavailable' };
        });
        const failed = result.filter((r) => r.status === 'rejected').length;
        const items = [];
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'fantasy-football' });
        items.push({
            text: 'Shows your own linked fantasy leagues and the grading state of the start/sit calls registered for your team. '
                + 'Opening this never reads ESPN, changes a lineup or submits a claim — the app advises, you act.',
            tone: 'neutral', fix: 'fantasy-football',
        });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map