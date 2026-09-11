"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Saved financial evidence for the caller; never links, syncs, generates analysis or moves money. */
const express_1 = require("express");
const clip = (v, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const stamp = (v) => { const n = new Date(String(v)).getTime(); return Number.isFinite(n) ? new Date(n).toISOString() : 'date unknown'; };
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
        const read = (text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 });
        const [linked, saved, transfers] = await Promise.allSettled([
            read('SELECT count(*)::text AS count FROM oshal_finance_items WHERE user_sub = $1 AND linked_at <= $2'),
            read('SELECT aggregate, brief, synced_at, brief_at FROM oshal_finance_data WHERE user_sub = $1 AND synced_at <= $2'),
            read("SELECT transfer_id, provider, amount_cents::text, currency, payee, description, status, test_mode, created_at, updated_at FROM oshal_finance_payments WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2 AND created_at > $2::timestamptz - interval '120 hours' ORDER BY created_at DESC, transfer_id LIMIT 2"),
        ]);
        const row = saved.status === 'fulfilled' ? saved.value.rows[0] : null;
        const agg = row?.aggregate && typeof row.aggregate === 'object' ? row.aggregate : null;
        const environment = ['sandbox', 'development', 'production'].includes(agg?.sourceEnvironment) ? agg.sourceEnvironment : 'mode not recorded';
        const currencies = new Set(Array.isArray(agg?.accounts) ? agg.accounts.map((a) => a.currency).filter(Boolean) : []);
        const currency = typeof agg?.currency === 'string' && /^[A-Z]{3}$/.test(agg.currency) ? agg.currency : null;
        const validNet = typeof agg?.netWorth?.net === 'number' && Number.isFinite(agg.netWorth.net) && currency && currencies.size <= 1 && (!currencies.size || currencies.has(currency));
        const net = saved.status === 'rejected' ? 'Unavailable' : !agg ? 'Not synced' : currencies.size > 1 ? 'Mixed currencies' : validNet ? currency + ' ' + agg.netWorth.net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Unknown';
        const metrics = [{ id: 'linked-institutions', label: 'Saved bank links', value: linked.status === 'fulfilled' ? String(linked.value.rows[0]?.count ?? '0') : 'Unavailable' },
            { id: 'cached-net-worth', label: 'Cached net worth', value: net },
            { id: 'snapshot-mode', label: 'Snapshot source', value: agg ? environment : saved.status === 'rejected' ? 'Unavailable' : 'Not synced' },
            { id: 'snapshot-age', label: 'Accounts last synced', value: row ? stamp(row.synced_at) : saved.status === 'rejected' ? 'Unavailable' : 'Not synced' }];
        const items = [];
        if (row && typeof row.brief === 'string' && row.brief.trim() && row.brief_at && new Date(row.brief_at) <= now) {
            const notes = clip('Saved finance analysis (' + environment + '), generated ' + stamp(row.brief_at) + ', account snapshot ' + stamp(row.synced_at) + '. ' + row.brief, 2000);
            items.push({ text: 'Your saved finance brief', detail: clip(notes), tone: 'neutral', fix: 'finance-home', actions: [{ integration: 'prepare-document', context: { title: 'Review my saved finance brief', notes } }] });
        }
        else if (agg)
            items.push({ text: 'Your saved account snapshot', detail: 'Source: ' + environment + ' · Synced ' + stamp(row.synced_at) + '. Open Finance to review balances and request analysis.', tone: 'neutral', fix: 'finance-home' });
        if (transfers.status === 'fulfilled')
            for (const t of transfers.value.rows) {
                const notes = clip((t.test_mode ? 'TEST' : 'LIVE') + ' transfer ' + t.transfer_id + ' via ' + t.provider + ': ' + t.amount_cents + ' cents (' + t.currency + '), recorded status ' + t.status + '. Updated ' + stamp(t.updated_at) + '. ' + clip(t.description), 2000);
                items.push({ text: clip((t.test_mode ? 'Test' : 'Live') + ' transfer: ' + t.status, 120), detail: clip(notes), tone: t.status === 'failed' ? 'warn' : 'neutral', highlight: t.status === 'failed', fix: 'finance-home', actions: [{ integration: 'prepare-document', context: { title: 'Review a recorded transfer', notes } }] });
            }
        const failed = [linked, saved, transfers].filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved financial sources cannot be checked.', tone: 'warn', fix: 'finance-home' });
        else if (!items.length)
            items.push({ text: 'Connect and sync accounts to build your financial overview.', tone: 'neutral', fix: 'finance-home' });
        items.push({ text: 'Saved evidence only. Bank links do not prove current connectivity; transfer status is the last recorded provider result.', tone: 'neutral', fix: 'finance-home' });
        res.status(failed === 3 ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
