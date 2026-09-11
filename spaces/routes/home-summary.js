"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved spaces evidence. GET is owner-scoped, bounded, and side-effect free. */
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
            "SELECT count(*) FILTER(WHERE status IN ('queued','reconstructing'))::text AS active,count(*) FILTER(WHERE status='failed')::text AS failed,count(*) FILTER(WHERE status='ready' AND (provider='sim' OR source_kind='sim-mission'))::text AS simulated,count(*) FILTER(WHERE status='ready' AND provider IN ('edge','import') AND source_kind<>'sim-mission')::text AS ready FROM spatial_scans WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2",
            "SELECT title,status,source_kind,provider,gaussian_count,updated_at FROM spatial_scans WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY updated_at DESC,id LIMIT 3"
        ].map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const rows = (i) => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
        const metrics = [[0, "active", "scans-active", "Scans in progress"], [0, "failed", "scans-failed", "Failed scans"], [0, "ready", "scans-ready", "Ready imports / captures"], [0, "simulated", "sim-ready", "Ready simulations"]].map(([i, key, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable' }));
        const items = [];
        const item = (title, detail, body, actions, tone = 'neutral') => {
            const text = clip(title, 120), notes = clip(detail + '\n' + body, 2000);
            items.push({ text, detail: clip(detail), tone, fix: "spaces-viewer", actions: actions.map(integration => ({ integration, context: { title: text, notes } })) });
        };
        rows(1).forEach(r => item(r.title, clip(r.status) + ' / ' + clip(r.provider || 'provider pending') + ' / ' + date(r.updated_at), 'Source: ' + clip(r.source_kind) + '. ' + (r.provider === 'sim' || r.source_kind === 'sim-mission' ? 'SIMULATED scene; not measured geometry.' : 'Saved reconstruction metadata; verify scale and coverage in Spaces.') + ' Recorded Gaussian count: ' + clip(r.gaussian_count ?? 'unavailable') + '. No model file is transferred.', ['prepare-document'], r.status === 'failed' ? 'warn' : 'neutral'));
        const failed = result.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: "spaces-viewer" });
        else if (!items.length)
            items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: "spaces-viewer" });
        items.push({ text: "Caller-owned reconstruction queue and saved artifacts. Imported/edge captures and simulated scenes have separate ready counts. Home reads metadata only; it never starts reconstruction, a scan mission, or retrieves raw model files.", tone: 'neutral', fix: "spaces-viewer" });
        res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
