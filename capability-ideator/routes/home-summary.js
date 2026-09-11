"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Discovery work remains attributed to the caller's existing Studio workflow. */
const express_1 = require("express");
const authz_1 = require("@/shared/middleware/authz");
function createHomeSummaryRoutes(ctx) {
    const r = (0, express_1.Router)();
    r.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const o = req.oidc, sub = o?.user?.sub;
        if (!sub || o?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (!(0, authz_1.isOperator)(req)) {
            res.status(403).json({ error: 'Operator access required' });
            return;
        }
        const now = new Date();
        const queries = [
            "SELECT count(*) FILTER(WHERE status='running')::text AS running,count(*) FILTER(WHERE status IN ('suspended','escalated','error'))::text AS review,count(*) FILTER(WHERE status='completed' AND finished_at>$2::timestamptz-interval '120 hours' AND finished_at<=$2)::text AS completed FROM workflow_runs WHERE owner_sub = $1 AND ticket_type='capability-ideation' AND started_at<=$2",
            "SELECT r.workflow_name,r.status,r.started_at,s.node_title,left(s.output_summary::text,1200) AS excerpt FROM workflow_runs r LEFT JOIN LATERAL (SELECT node_title,output_summary FROM workflow_run_steps s WHERE s.run_id=r.run_id AND s.owner_sub = $1 AND s.created_at<=$2 ORDER BY s.seq DESC LIMIT 1) s ON true WHERE r.owner_sub = $1 AND r.ticket_type='capability-ideation' AND r.started_at<=$2 ORDER BY r.started_at DESC,r.run_id LIMIT 3"
        ];
        const result = await Promise.allSettled(queries.map(text => ctx.pool.query({ text, values: [sub, now], query_timeout: 1800 })));
        const rows = (i) => result[i].status === 'fulfilled' ? result[i].value.rows : [];
        const metrics = [['running', 'Discovery runs active'], ['review', 'Runs needing review'], ['completed', 'Runs completed / 5d']].map(([id, label]) => ({ id, label, value: result[0].status === 'fulfilled' ? String(rows(0)[0]?.[id] ?? '0') : 'Unavailable' }));
        const items = rows(1).map(v => ({ text: String(v.workflow_name || 'Capability discovery').slice(0, 120), detail: v.status + ' / ' + new Date(v.started_at).toISOString(), fix: 'capability-ideator-review', actions: ['prepare-document', 'explore-venture'].map(integration => ({ integration, context: { title: 'Review capability discovery', notes: ('Recorded workflow state: ' + v.status + '. Latest step: ' + v.node_title + '. Saved, redacted step output: ' + (v.excerpt || 'No saved output') + '. This is workflow evidence, not proof that a proposed tool exists, is connected, or has been implemented. Review sources and requirements before planning.').slice(0, 2000) } })) }));
        const failed = result.filter(r => r.status === 'rejected').length;
        items.push({ text: failed ? 'Some discovery evidence cannot be checked.' : 'Open discovery to inspect loaded app actions and connection requirements, then develop a sourced process proposal.', fix: 'capability-ideator-review', tone: failed ? 'warn' : 'neutral' });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, partial: failed > 0, asOf: now.toISOString() });
    });
    return r;
}
