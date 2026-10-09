"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCalendarSyncRoutes = createCalendarSyncRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve optional sync dependencies only after authentication and explicit confirmation so independent screens remain available.
 */
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const log = (0, logger_1.createChildLogger)({ module: 'calendar.sync' });
/** Explicit sync uses only the caller's Google credentials; no deployment token fallback. */
function createCalendarSyncRoutes(ctx) {
    const r = (0, express_1.Router)();
    r.post('/', async (req, res) => {
        const o = req.oidc, sub = o?.user?.sub;
        if (!sub || o?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (req.body?.confirm !== true) {
            res.status(400).json({ error: 'Confirm calendar sync' });
            return;
        }
        try {
            const { getValidAccessToken } = require('@/app/routes/connectors-routes');
            const { GoogleCalendarService } = require('@/features/google-calendar');
            const token = await getValidAccessToken(ctx.pool, sub, 'google');
            if (!token) {
                res.status(409).json({ error: 'Connect Google in Identity with Calendar read access, then retry.' });
                return;
            }
            const service = new GoogleCalendarService(async () => token), now = new Date();
            const events = (await service.listUpcoming({ calendarId: 'primary', timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 30 * 86400000).toISOString(), maxResults: 250 })).slice(0, 250).map(e => ({ id: e.id, title: e.summary.slice(0, 120), start: e.start, end: e.end, allDay: e.allDay, url: e.htmlLink }));
            await ctx.pool.query('INSERT INTO calendar_preparation_snapshots(user_sub,events,synced_at) VALUES($1,$2,$3) ON CONFLICT(user_sub) DO UPDATE SET events=EXCLUDED.events,synced_at=EXCLUDED.synced_at WHERE calendar_preparation_snapshots.synced_at<=EXCLUDED.synced_at', [sub, JSON.stringify(events), now]);
            res.json({ ok: true, count: events.length, syncedAt: now.toISOString(), coverage: 'Primary calendar, next 30 days, at most 250 events' });
        }
        catch (err) {
            log.error({ err }, 'Calendar sync failed');
            res.status(502).json({ error: 'Calendar sync failed. Check Google Calendar access and retry; the previous snapshot was retained.' });
        }
    });
    return r;
}
//# sourceMappingURL=sync.js.map