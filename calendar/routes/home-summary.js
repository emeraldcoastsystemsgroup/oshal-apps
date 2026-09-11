"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarEvidence = calendarEvidence;
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Personal event preparation from an explicit, caller-owned calendar snapshot. */
const express_1 = require("express");
function calendarEvidence(snapshot, now = new Date()) {
    const saved = snapshot && Number.isFinite(new Date(snapshot.synced_at).getTime()) && new Date(snapshot.synced_at) <= now;
    const events = saved && Array.isArray(snapshot.events) ? snapshot.events : [];
    const upcoming = events.filter(e => e && typeof e.title === 'string' && typeof e.start === 'string' && Number.isFinite(Date.parse(e.start)) && Date.parse(e.start) >= (e.allDay ? Date.parse(now.toISOString().slice(0, 10)) : now.getTime()) && Date.parse(e.start) < now.getTime() + 30 * 86400000).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const metrics = [{ id: 'upcoming-5d', label: 'Saved events / 5d', value: saved ? String(upcoming.filter(e => Date.parse(e.start) < now.getTime() + 5 * 86400000).length) : 'Not synced' }, { id: 'upcoming-30d', label: 'Saved events / 30d', value: saved ? String(upcoming.length) : 'Not synced' }];
    const items = upcoming.slice(0, 3).map(e => { const title = e.title.slice(0, 120), detail = e.start + (e.allDay ? ' / all day' : '') + ' / synced ' + new Date(snapshot.synced_at).toISOString(); return { text: title, detail, fix: 'calendar-review', actions: ['plan-gift', 'plan-meal', 'plan-trip', 'prepare-meeting'].map(integration => ({ integration, context: { title, notes: (detail + '. Prepare for this event. Confirm the occasion, preferences, budget, timing and participants with me. Do not assume a gift is appropriate.').slice(0, 2000), ...(typeof e.url === 'string' && /^https:\/\/calendar\.google\.com\//.test(e.url) ? { sourceUrl: e.url } : {}) } })) }; });
    items.push({ text: saved ? 'Saved primary-calendar snapshot, up to 250 events. Sync explicitly for changes; this is not a complete multi-calendar agenda.' : 'Connect Google in Identity, then open Calendar and sync upcoming events.', fix: 'calendar-review', tone: 'neutral' });
    return { metrics, tiles: metrics, items, asOf: now.toISOString(), partial: false };
}
function createHomeSummaryRoutes(ctx) {
    const r = (0, express_1.Router)();
    r.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const o = req.oidc, sub = o?.user?.sub;
        if (!sub || o?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const q = await ctx.pool.query({ text: 'SELECT events,synced_at FROM calendar_preparation_snapshots WHERE user_sub = $1', values: [sub], query_timeout: 1800 });
            res.json(calendarEvidence(q.rows[0]));
        }
        catch {
            res.status(503).json({ error: 'Calendar snapshot unavailable' });
        }
    });
    return r;
}
