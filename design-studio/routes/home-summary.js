"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203, lane @ds-app: the ADR-145 Home tile. Caller-owned project
 *                     |                             | counts, phases closed, and the three most recently changed
 *                     |                             | products, metadata only: no engine is read and nothing is
 *                     |                             | written. Import-free apart from express and the app context
 *                     |                             | type, per the Home summary contract; sorting is done in code.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
const express_1 = require("express");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
/**
 * @description Build the Home summary route.
 * @param ctx - The per-package AppContext (pool).
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
            'SELECT id, name, phases, updated_at FROM design_project WHERE owner_sub = $1',
            'SELECT project_id, phase, step FROM design_closure WHERE owner_sub = $1',
        ].map((text) => ctx.pool.query({ text, values: [String(sub)], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const projects = rows(0).sort((a, b) => (String(a.updated_at) < String(b.updated_at) ? 1 : -1));
        const closures = rows(1);
        const closedPhases = new Set(closures.filter((c) => c.step === null || c.step === undefined).map((c) => `${c.project_id}:${c.phase}`));
        const phaseCount = projects.reduce((n, p) => n + parse(p.phases).length, 0);
        const value = (i, v) => (result[i].status === 'fulfilled' ? String(v) : 'Unavailable');
        const metrics = [
            { id: 'products-total', label: 'Products', value: value(0, projects.length) },
            { id: 'phases-total', label: 'Phases in chains', value: value(0, phaseCount) },
            { id: 'phases-closed', label: 'Phases closed', value: value(1, closedPhases.size) },
            { id: 'build-steps-ticked', label: 'Build steps ticked', value: value(1, closures.filter((c) => c.step).length) },
        ];
        const items = [];
        projects.slice(0, 3).forEach((p) => {
            const phases = parse(p.phases);
            const closed = phases.filter((ph) => closedPhases.has(`${p.id}:${ph.kind}`)).length;
            items.push({ text: clip(p.name, 120), detail: clip(`${closed} of ${phases.length} phases closed / ${date(p.updated_at)}`), tone: 'neutral', fix: 'design-studio' });
        });
        const failed = result.filter((r) => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'design-studio' });
        else if (!items.length)
            items.push({ text: 'No products yet. Open Design Studio and press New product.', tone: 'neutral', fix: 'design-studio' });
        items.push({ text: 'Caller-owned products, their phase chains and closures. Home reads metadata only; it never reads an engine.', tone: 'neutral', fix: 'design-studio' });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map