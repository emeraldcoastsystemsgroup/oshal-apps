"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the ADR-145 Home tile: caller-owned model
 *                     |                             | counts and the three most recent parts, metadata only (no
 *                     |                             | engine call, no file read). Import-free apart from express and
 *                     |                             | the app context type, per the Home summary contract.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
const express_1 = require("express");
const clip = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
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
            "SELECT count(*)::text AS total, count(*) FILTER (WHERE state = 'built')::text AS built, count(*) FILTER (WHERE state = 'failed')::text AS failed, coalesce(sum(revision), 0)::text AS revisions FROM cad_model WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2",
            'SELECT title, state, revision, report, source, updated_at FROM cad_model WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, model_id LIMIT 3',
        ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metric = (i, key, id, label) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
        const metrics = [metric(0, 'total', 'models-total', 'Parts'), metric(0, 'built', 'models-built', 'Built parts'), metric(0, 'revisions', 'revisions-total', 'Rebuilds'), metric(0, 'failed', 'models-failed', 'Failed rebuilds')];
        const items = [];
        rows(1).forEach((r) => {
            const report = r.report && typeof r.report === 'object' ? r.report : {};
            const size = report.extentsMm?.size ? report.extentsMm.size.map((v) => Number(v).toFixed(1)).join(' × ') + ' mm' : 'not built yet';
            const text = clip(r.title, 120);
            const detail = clip(`${r.state} / revision ${r.revision} / ${date(r.updated_at)}`);
            const notes = clip(`${detail}\nExtents ${size}. Volume ${report.volumeMm3 !== undefined ? (Number(report.volumeMm3) / 1000).toFixed(2) + ' cm³' : 'n/a'}. ${r.source?.kind === 'scan' ? 'From a Scan to Print job.' : ''} Home reads metadata only.`, 2000);
            items.push({ text, detail, tone: r.state === 'failed' ? 'warn' : 'neutral', fix: 'cad-studio', actions: [{ integration: 'prepare-document', context: { title: text, notes } }] });
        });
        const failed = result.filter((r) => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'cad-studio' });
        else if (!items.length)
            items.push({ text: 'No parts yet. Open CAD Studio to begin.', tone: 'neutral', fix: 'cad-studio' });
        items.push({ text: 'Caller-owned parametric parts and their revisions. Home reads metadata only; it never runs the kernel or reads a model file.', tone: 'neutral', fix: 'cad-studio' });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map