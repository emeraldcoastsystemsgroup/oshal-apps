"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** App-owned saved spotify evidence. Read-only; no provider calls or schema creation. */
const express_1 = require("express");
const queries = [
    "SELECT favorite_genres, favorite_artists, updated_at FROM spotify_profile WHERE user_sub = $1 AND updated_at <= $2"
];
const definitions = [];
const clip = (value, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const stamp = (value) => { const at = new Date(String(value)); return Number.isFinite(at.getTime()) ? at.toISOString() : 'date unknown'; };
function item(row) { const genres = Array.isArray(row.favorite_genres) ? row.favorite_genres.slice(0, 8).map((x) => clip(x, 60)) : []; const artists = Array.isArray(row.favorite_artists) ? row.favorite_artists.slice(0, 8).map((x) => clip(x, 60)) : []; if (!genres.length && !artists.length)
    return null; const notes = clip([genres.length ? 'Genres: ' + genres.join(', ') : '', artists.length ? 'Artists: ' + artists.join(', ') : ''].filter(Boolean).join('. '), 400); return { text: 'Your music preferences', detail: notes + ' · Saved ' + stamp(row.updated_at), context: { title: 'Plan around my music preferences', notes } }; }
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
        const results = await Promise.allSettled(queries.map(text => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 })));
        const metrics = definitions.map(([index, key, id, label]) => { const result = results[index]; return { id, label, value: result.status === 'fulfilled' ? String(result.value.rows[0]?.[key] ?? '0') : 'Unavailable', tone: 'neutral' }; });
        const recent = results[0];
        const items = recent.status === 'fulfilled' ? recent.value.rows.map(item).filter(Boolean).slice(0, 3).map(({ context, ...entry }) => ({ ...entry, tone: 'neutral', fix: "spotify-concierge", actions: ["plan-movie", "plan-meal"].map(integration => ({ integration, context })) })) : [];
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed)
            items.push({ text: 'Some saved data cannot be checked.', tone: 'warn', fix: "spotify-concierge" });
        else if (!items.length)
            items.push({ text: "No saved music preferences yet.", tone: 'neutral', fix: "spotify-concierge" });
        items.push({ text: "Saved music preferences only. Playback and playlists are checked in Spotify when you open it.", tone: 'neutral', fix: "spotify-concierge" });
        res.status(failed === results.length ? 503 : 200).json({ metrics, tiles: metrics.slice(0, 4), items, asOf: now.toISOString(), partial: failed > 0 });
    });
    return router;
}
