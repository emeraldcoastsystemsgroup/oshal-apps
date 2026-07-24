"use strict";
/**
 * Feeds Routes — the Feeds app surface API (mounted /api/feeds, requiresAuth).
 *
 * Serves the Feeds dashboard and reads the durable index (feed_messages) built by
 * feeds-indexing. Reading is cheap (DB only); opening the surface triggers a stale-check
 * sync (maybeSyncOnView) so the feed warms right after login. First-ever open does one
 * synchronous index so the user isn't staring at an empty board.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-20 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — dashboard + status +
 *            | messages (indexed, with first-open backfill) + settings GET/PUT + manual sync.
 * 2026-07-19 21:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into
 *            | the feeds app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx)
 *            | factory; the dashboard serves from ctx.appPackageDir/tools (load-time env fallback,
 *            | D10). Shared core helpers import via @/ aliases: the feeds-indexing ENGINE
 *            | (getFeedSettings/updateFeedSettings/indexUserFeed/maybeSyncOnView) and the token
 *            | broker's getValidAccessToken. The feeds-indexing engine + cron, scripts/oshal-feeds.js,
 *            | 045-feeds-platform.sql, the feeds-curator inline node, and the 'slack' connector
 *            | stay framework-resident (ADR-093).
 * ---------------------------------------------------------------------------
 * @module feeds-routes
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFeedsRoutes = createFeedsRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = require("@/shared/logger");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const feeds_indexing_1 = require("@/app/routes/feeds-indexing");
const logger = (0, logger_1.createChildLogger)({ module: 'feeds-routes' });
const MSG_DEFAULT = 200;
const MSG_MAX = 500;
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * Resolve the Feeds page from the package's tools/ dir (ctx.appPackageDir, captured at
 * factory time per D10), with the load-time env fallback and a final cwd fallback to the
 * framework-resident /feeds page (which stays framework-served for the default toolbar tile).
 */
function feedsIndexHtml(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools', 'feeds.html') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', 'feeds.html') : '',
        path.resolve(__dirname, '../tools/feeds.html'),
        path.resolve(process.cwd(), 'src/pages/feeds/index.html'),
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}
/** The authenticated caller's OIDC sub (never client-supplied). */
function callerSub(req) {
    const oidc = req.oidc;
    if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
        const sub = (oidc.user || {}).sub || (oidc.user || {}).oid;
        if (sub)
            return String(sub);
    }
    return null;
}
/**
 * @description Feeds app sub-router.
 * @param ctx - app context (db pool + appPackageDir for the surface)
 * @returns an Express router
 */
function createFeedsRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetHtml = feedsIndexHtml(ctx.appPackageDir);
    /** GET /api/feeds/dashboard — the surface (loaded in the cockpit iframe + standalone). */
    router.get(['/', '/dashboard'], (_req, res) => {
        res.sendFile(assetHtml, (err) => {
            if (err) {
                logger.error({ err }, 'feeds dashboard serve failed');
                res.status(404).send('Feeds page not found');
            }
        });
    });
    /** GET /api/feeds/status — connected? + settings + last sync. */
    router.get('/status', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not authenticated' });
            return;
        }
        try {
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'slack');
            const settings = await (0, feeds_indexing_1.getFeedSettings)(ctx.pool, sub);
            res.json({ connected: !!token, settings, connectUrl: '/api/connect/slack/start' });
        }
        catch (err) {
            logger.error({ err }, 'feeds status failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/feeds/messages?limit=N — the indexed feed, newest-first (with first-open backfill). */
    router.get('/messages', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not authenticated' });
            return;
        }
        const limit = Math.min(MSG_MAX, Math.max(1, parseInt(String(req.query.limit || ''), 10) || MSG_DEFAULT));
        try {
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'slack');
            if (!token) {
                res.json({
                    connected: false,
                    count: 0,
                    messages: [],
                    connectUrl: '/api/connect/slack/start',
                    error: 'not connected',
                });
                return;
            }
            let rows = await readMessages(ctx, sub, limit);
            // First-ever open: index synchronously so the board isn't empty, then re-read.
            if (rows.length === 0) {
                await (0, feeds_indexing_1.indexUserFeed)(ctx, sub).catch((err) => logger.warn({ err, sub }, 'first-open index failed'));
                rows = await readMessages(ctx, sub, limit);
            }
            else {
                (0, feeds_indexing_1.maybeSyncOnView)(ctx, sub); // warm in the background if stale
            }
            const settings = await (0, feeds_indexing_1.getFeedSettings)(ctx.pool, sub);
            res.json({ count: rows.length, messages: rows, lastSyncedAt: settings.lastSyncedAt, sentimentEnabled: settings.sentimentEnabled });
        }
        catch (err) {
            logger.error({ err }, 'feeds messages failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/feeds/settings — the caller's feed settings. */
    router.get('/settings', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not authenticated' });
            return;
        }
        try {
            res.json(await (0, feeds_indexing_1.getFeedSettings)(ctx.pool, sub));
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    /** PUT /api/feeds/settings — update the caller's feed settings. */
    router.put('/settings', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not authenticated' });
            return;
        }
        const b = req.body || {};
        try {
            const next = await (0, feeds_indexing_1.updateFeedSettings)(ctx.pool, sub, {
                pollEnabled: typeof b.pollEnabled === 'boolean' ? b.pollEnabled : undefined,
                pollIntervalMinutes: b.pollIntervalMinutes != null ? Number(b.pollIntervalMinutes) : undefined,
                maxChannels: b.maxChannels != null ? Number(b.maxChannels) : undefined,
                perChannel: b.perChannel != null ? Number(b.perChannel) : undefined,
                sentimentEnabled: typeof b.sentimentEnabled === 'boolean' ? b.sentimentEnabled : undefined,
            });
            res.json(next);
        }
        catch (err) {
            logger.error({ err }, 'feeds settings update failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/feeds/sync — force an index now; returns the row count seen. */
    router.post('/sync', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not authenticated' });
            return;
        }
        try {
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'slack');
            if (!token) {
                res.status(404).json({ error: 'not connected' });
                return;
            }
            const stored = await (0, feeds_indexing_1.indexUserFeed)(ctx, sub);
            const settings = await (0, feeds_indexing_1.getFeedSettings)(ctx.pool, sub);
            res.json({ ok: true, stored, lastSyncedAt: settings.lastSyncedAt });
        }
        catch (err) {
            logger.error({ err }, 'feeds sync failed');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
/** Read the indexed feed for a user, newest-first, in the shape the surface expects. */
async function readMessages(ctx, userSub, limit) {
    const rows = (await ctx.pool.query(`SELECT channel_id, channel_name, channel_type, author_id, author_name, text, ts, posted_at, sentiment, sentiment_label
       FROM feed_messages WHERE user_sub = $1 AND source = 'slack'
       ORDER BY posted_at DESC LIMIT $2`, [userSub, limit])).rows;
    return rows.map((r) => ({
        channelId: r.channel_id,
        channel: r.channel_name || r.channel_id,
        type: r.channel_type || 'channel',
        userId: r.author_id,
        user: r.author_name || r.author_id,
        text: r.text || '',
        ts: r.ts,
        time: new Date(r.posted_at).toISOString(),
        sentiment: r.sentiment != null ? Number(r.sentiment) : null,
        sentimentLabel: r.sentiment_label || null,
    }));
}
//# sourceMappingURL=feeds-routes.js.map