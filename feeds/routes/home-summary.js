"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Read the caller's existing Slack index and recorded sync for Home; no provider or indexing work.
 */
const express_1 = require("express");
/** @description Read-only, session-scoped Home endpoint. @param ctx Package context. @returns Summary router. */
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
        const [index, settings, recent] = await Promise.allSettled([
            ctx.pool.query(`SELECT
        count(*) FILTER (WHERE posted_at > $2::timestamptz - interval '24 hours' AND posted_at <= $2::timestamptz)::text AS day,
        count(*) FILTER (WHERE posted_at > $2::timestamptz - interval '120 hours' AND posted_at <= $2::timestamptz)::text AS five_days,
        count(DISTINCT channel_id)::text AS channels
        FROM feed_messages WHERE user_sub = $1 AND source = 'slack'`, [String(sub), now]),
            ctx.pool.query('SELECT last_synced_at FROM feed_settings WHERE user_sub = $1', [String(sub)]),
            ctx.pool.query(`SELECT channel_name, text, posted_at FROM feed_messages
        WHERE user_sub = $1 AND source = 'slack' AND posted_at <= $2::timestamptz
        AND posted_at > $2::timestamptz - interval '120 hours' AND length(trim(text)) > 0
        ORDER BY posted_at DESC LIMIT 3`, [String(sub), now]),
        ]);
        const row = index.status === 'fulfilled' ? index.value.rows[0] : null;
        const rawSync = settings.status === 'fulfilled' ? settings.value.rows[0]?.last_synced_at : null;
        const sync = rawSync ? new Date(rawSync).getTime() : NaN;
        const validSync = Number.isFinite(sync) && sync <= now.getTime();
        const metrics = [
            { id: 'indexed-24h', label: 'Indexed Slack / 24h', value: row?.day ?? 'Unavailable', tone: 'neutral' },
            { id: 'indexed-5d', label: 'Indexed Slack / 5 days', value: row?.five_days ?? 'Unavailable', tone: 'neutral' },
            { id: 'indexed-channels', label: 'Channels in index', value: row?.channels ?? 'Unavailable', tone: 'neutral' },
            { id: 'sync-age', label: 'Last recorded sync', value: validSync ? `${Math.floor((now.getTime() - sync) / 60000)}m ago` : settings.status === 'rejected' ? 'Unavailable' : rawSync ? 'Unknown' : 'Not recorded', tone: 'neutral' },
        ];
        const items = [];
        if (recent.status === 'fulfilled')
            for (const entry of recent.value.rows) {
                const text = typeof entry.text === 'string' ? entry.text.trim() : '';
                if (!text)
                    continue;
                const channel = String(entry.channel_name || 'Slack').slice(0, 100);
                const at = new Date(entry.posted_at).getTime();
                const notes = `${channel}${Number.isFinite(at) ? ' · ' + new Date(at).toISOString() : ''}\n${text}`.slice(0, 2000);
                items.push({ text: `${channel}: ${text}`.slice(0, 120), detail: text.slice(0, 400), tone: 'neutral', fix: 'feeds-dashboard',
                    actions: ['prepare-document', 'prepare-post'].map(integration => ({ integration, context: { title: 'Review a saved feed entry', notes } })) });
            }
        else
            items.push({ text: 'Recent feed entries cannot be checked.', tone: 'warn', fix: 'feeds-dashboard' });
        if (index.status === 'rejected')
            items.push({ text: 'The saved Slack index cannot be checked.', tone: 'warn', fix: 'feeds-dashboard' });
        if (settings.status === 'rejected')
            items.push({ metricId: 'sync-age', text: 'The last feed sync cannot be checked.', tone: 'warn', fix: 'feeds-dashboard' });
        else
            items.push({ metricId: 'sync-age', text: validSync ? `Last recorded sync: ${new Date(sync).toISOString()}.` : 'No valid sync time is recorded. Open Feeds to connect or sync Slack.', tone: 'neutral', fix: 'feeds-dashboard' });
        items.push({ text: 'Saved Slack index only. Counts use rolling 24/120 hours; they are not unread counts or all Slack history.', tone: 'neutral', fix: 'feeds-dashboard' });
        res.status(index.status === 'rejected' && settings.status === 'rejected' ? 503 : 200).json({
            tiles: metrics.slice(0, 4), metrics, items, asOf: now.toISOString(),
            lastSyncedAt: validSync ? new Date(sync).toISOString() : null,
            partial: index.status === 'rejected' || settings.status === 'rejected' || recent.status === 'rejected',
        });
    });
    return router;
}
