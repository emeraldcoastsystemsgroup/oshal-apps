"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the ADR-145 Home tile. Import-free (express
 *                     |                             | only) so the store Home harness can load it with no framework
 *                     |                             | resolution; session gate is isAuthenticated() === true plus a
 *                     |                             | bound owner subject; SELECT only with a query timeout; a failed
 *                     |                             | source is 503 with no error text echoed. Reads task metadata
 *                     |                             | only — never the world, never a node.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | K4: overlay the owner's queued task outcomes (pendingTaskStatuses from task-store). On the native kernel a GET cannot write, so a task the timer finished stays `executing` in the store until the owner's next POST; Home now moves such a task (matched by id against the stored executing rows) to completed or stopped in the counts and shows its outcome in the recent items, instead of 0 completed. Still SELECT only; the executing-row lookup runs only while an outcome is queued.
 */
const express_1 = require("express");
const task_store_1 = require("./task-store");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
/**
 * @description Saved embodied-task evidence for the cockpit Home. GET is owner-scoped, bounded,
 * and side-effect free.
 * @param ctx - The per-package context; only `pool` is read.
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
        const pending = (0, task_store_1.pendingTaskStatuses)(String(sub));
        const result = await Promise.allSettled([
            "SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'done')::text AS done, count(*) FILTER (WHERE status IN ('failed', 'aborted'))::text AS stopped, count(*) FILTER (WHERE status = 'executing')::text AS executing FROM embodied_task WHERE owner_sub = $1 AND created_at <= $2",
            'SELECT task_id, title, status, current_step, failure, updated_at FROM embodied_task WHERE owner_sub = $1 AND created_at <= $2 ORDER BY updated_at DESC, task_id LIMIT 3',
            "SELECT count(*)::text AS refused FROM embodied_command_log WHERE owner_sub = $1 AND created_at <= $2 AND created_at > $2 - interval '7 days' AND outcome = 'refused'",
            ...(pending.length ? ["SELECT task_id FROM embodied_task WHERE owner_sub = $1 AND created_at <= $2 AND status = 'executing' LIMIT 50"] : []),
        ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r?.status === 'fulfilled' ? r.value.rows : []; };
        // A task the live world finished but the store still holds as executing (a GET cannot write natively).
        const stored = new Set(rows(3).map((r) => String(r.task_id)));
        const outcomes = result[3]?.status === 'fulfilled' ? pending.filter((o) => stored.has(o.taskId)) : [];
        if (result[0].status === 'fulfilled' && outcomes.length && rows(0)[0]) {
            const c = rows(0)[0];
            const moved = (status) => outcomes.filter((o) => (status === 'done' ? o.status === 'done' : o.status !== 'done')).length;
            c.done = String(Number(c.done || 0) + moved('done'));
            c.stopped = String(Number(c.stopped || 0) + moved('stopped'));
            c.executing = String(Math.max(0, Number(c.executing || 0) - outcomes.length));
        }
        rows(1).forEach((r) => {
            const o = outcomes.find((x) => x.taskId === String(r.task_id));
            if (o)
                Object.assign(r, { status: o.status, current_step: o.stepIndex, failure: o.failure });
        });
        const metric = (i, key, id, label) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
        const metrics = [metric(0, 'total', 'tasks-total', 'Physical tasks drafted'), metric(0, 'done', 'tasks-done', 'Completed in simulation'), metric(0, 'stopped', 'tasks-stopped', 'Failed or aborted'), metric(2, 'refused', 'commands-refused', 'Commands refused (7 days)')];
        const items = [];
        rows(1).forEach((r) => {
            const text = clip(r.title, 120);
            const detail = clip(`${r.status} / step ${Number(r.current_step) + 1} / ${date(r.updated_at)}`);
            items.push({ text, detail, tone: r.status === 'failed' ? 'warn' : 'neutral', fix: 'embodied', notes: clip(r.failure ?? '', 400) });
        });
        const failed = result.filter((r) => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'embodied' });
        else if (!items.length)
            items.push({ text: 'No physical task drafted yet. Open the app to run the simulation.', tone: 'neutral', fix: 'embodied' });
        items.push({ text: 'Simulation only: every task here ran against the simulated kitchen, never a real arm or drone. Home reads task metadata only.', tone: 'neutral', fix: 'embodied' });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map