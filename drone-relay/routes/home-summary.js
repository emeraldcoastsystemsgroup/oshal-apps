"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-145 Home summary for drone-relay: import-free (express only)
 *                     |                             | so the store Home harness can load it with no framework
 *                     |                             | resolution; session gate is isAuthenticated() === true plus a
 *                     |                             | bound owner subject; SELECT only with a query timeout; a failed
 *                     |                             | source is 503 with no error text echoed. Reads plan metadata
 *                     |                             | and the last run's verdict only — never runs a simulation.
 */
const express_1 = require("express");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
/**
 * @description Saved relay-chain designs for the cockpit Home. GET is owner-scoped, bounded, and
 * side-effect free.
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
        const result = await Promise.allSettled([
            "SELECT count(*)::text AS total, count(*) FILTER (WHERE (plan->>'feasible') = 'true')::text AS feasible, count(*) FILTER (WHERE last_sim IS NOT NULL)::text AS simulated, count(*) FILTER (WHERE (last_sim->'metrics'->>'verdict') IN ('held', 'restored'))::text AS holding FROM drone_relay_plan WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2",
            "SELECT title, spec, plan, (last_sim->'metrics') AS last_metrics, updated_at FROM drone_relay_plan WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, plan_id LIMIT 3",
        ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metric = (i, key, id, label) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
        const metrics = [metric(0, 'total', 'plans-total', 'Relay chains'), metric(0, 'feasible', 'plans-feasible', 'Feasible plans'), metric(0, 'simulated', 'plans-simulated', 'Simulated'), metric(0, 'holding', 'plans-holding', 'Held or restored')];
        const items = [];
        rows(1).forEach((r) => {
            const plan = r.plan && typeof r.plan === 'object' ? r.plan : {};
            const spec = r.spec && typeof r.spec === 'object' ? r.spec : {};
            const m = r.last_metrics && typeof r.last_metrics === 'object' ? r.last_metrics : null;
            const text = clip(r.title, 120);
            const detail = clip(`${spec.transport ?? 'transport?'} / ${plan.relaysNeeded ?? '?'} relays at ${plan.hopM ?? '?'} m / ${m ? `last run ${m.verdict}, outage ${m.tipOutageS} s` : 'not simulated'} / ${date(r.updated_at)}`);
            const notes = clip(`${detail}\nCorridor ${plan.pathLengthM ?? '?'} m, ${plan.hops ?? '?'} hops, margin ${plan.perHopMarginDb ?? '?'} dB at the hop, ${Math.max(0, plan.sparesAvailable ?? 0)} spares. ${plan.feasible === false ? `Not feasible: ${clip((plan.reasons || []).join('; '), 300)}` : ''} Home reads metadata only.`, 2000);
            items.push({ text, detail, tone: plan.feasible === false || (m && m.verdict === 'lost') ? 'warn' : 'neutral', fix: 'drone-relay', actions: [{ integration: 'prepare-document', context: { title: text, notes } }] });
        });
        const failed = result.filter((r) => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'drone-relay' });
        else if (!items.length)
            items.push({ text: 'No relay chains designed yet. Open the app to size one.', tone: 'neutral', fix: 'drone-relay' });
        items.push({ text: 'Caller-owned relay-chain designs and their last simulated run. Home reads metadata only; it never simulates or commands a vehicle.', tone: 'neutral', fix: 'drone-relay' });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map