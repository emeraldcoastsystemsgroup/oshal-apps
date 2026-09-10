"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Expose the caller's previously saved digest on Home without mailbox reads or generation.
 */
const express_1 = require("express");
const session_crypto_1 = require("./session-crypto");
/** @description Read a bounded cached digest in the caller's session. @param ctx Package context. @returns Summary router. */
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
        try {
            const row = (await ctx.pool.query('SELECT summary, updated_at FROM oshal_email_digests WHERE user_sub = $1', [String(sub)])).rows[0];
            const summary = row?.summary ? (0, session_crypto_1.decryptSessionValue)(row.summary).replace(/\s+/g, ' ').trim() : '';
            const now = new Date();
            const at = summary && row?.updated_at ? new Date(row.updated_at).getTime() : NaN;
            const validTime = Number.isFinite(at) && at <= now.getTime();
            const metrics = [
                { id: 'cached-digest', label: 'Saved email digest', value: summary ? 'Available' : 'Not saved', tone: 'neutral' },
                { id: 'digest-age', label: 'Digest generated', value: validTime ? `${Math.floor((now.getTime() - at) / 60000)}m ago` : summary ? 'Unknown' : 'Not recorded', tone: 'neutral' },
            ];
            const items = [
                { metricId: 'cached-digest', text: summary ? summary.slice(0, 120) : 'No digest saved. Open My Day to generate one from your connected mailbox.', detail: summary.slice(120, 520), tone: 'neutral', fix: 'email-myday',
                    actions: summary ? ['prepare-document', 'review-sales'].map(integration => ({ integration, context: { title: 'Review my saved email digest', notes: summary.slice(0, 2000) } })) : [] },
                { metricId: 'digest-age', text: validTime ? `Saved ${new Date(at).toISOString()}; this is generation time, not current inbox freshness.` : 'Cached digest only; unread counts and current inbox freshness are not available here.', tone: 'neutral', fix: 'email-myday' },
            ];
            res.json({ tiles: metrics, metrics, items, asOf: now.toISOString(), generatedAt: validTime ? new Date(at).toISOString() : null });
        }
        catch {
            res.status(503).json({ error: 'The saved email digest cannot be read.' });
        }
    });
    return router;
}
