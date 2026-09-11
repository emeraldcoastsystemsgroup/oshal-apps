"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved daily-trade-recap evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*) FILTER (WHERE status='running')::text AS active, count(*) FILTER (WHERE status IN ('suspended','escalated'))::text AS review, count(*) FILTER (WHERE status='error')::text AS failed, count(*) FILTER (WHERE status='completed' AND finished_at > $2::timestamptz - interval '120 hours' AND finished_at <= $2)::text AS five FROM workflow_runs WHERE owner_sub = $1 AND ticket_type='daily-trade-recap' AND started_at <= $2 AND updated_at <= $2",
            "SELECT r.workflow_name, r.status, r.started_at, r.finished_at, s.node_title, s.status AS step_status FROM workflow_runs r LEFT JOIN LATERAL (SELECT node_title, status FROM workflow_run_steps s WHERE s.run_id=r.run_id AND s.owner_sub = $1 AND s.created_at <= $2 ORDER BY seq DESC LIMIT 1) s ON true WHERE r.owner_sub = $1 AND r.ticket_type='daily-trade-recap' AND r.started_at <= $2 AND r.updated_at <= $2 ORDER BY r.started_at DESC, r.run_id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "active", "runs-active", "Recaps running"], [0, "review", "runs-review", "Recaps needing review"], [0, "failed", "runs-failed", "Failed recap runs"], [0, "five", "runs-completed-5d", "Runs completed / 5 days"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "recap-review", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => item(r.workflow_name || 'Daily trade recap', clip(r.status) + ' · started ' + date(r.started_at), 'Last recorded step: ' + clip(r.node_title || 'none') + ' / ' + clip(r.step_status || 'not recorded') + '. Workflow status is not proof of delivery or investment performance.', ['prepare-document', 'prepare-episode'], ['error', 'escalated', 'suspended'].includes(r.status) ? 'warn' : 'neutral'));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "recap-review" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "recap-review" });
        items.push({ text: "Counts exact-owner daily-trade-recap graph executions, with the latest same-owner recorded step. A completed workflow is not proof that an email arrived or a video was published. Review actions prepare a production handoff; Home never reruns the existing render/email pipeline.", tone: 'neutral', fix: "recap-review" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
