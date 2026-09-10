"use strict";
/**
 * Sports Edge routes — /api/sports-edge.
 *
 * The surface is deliberately narrow because the app is: you follow teams, you look at their next
 * games, and you read the preview behind one of them. Everything else on these routes exists to
 * keep that honest — the scorecard that says whether any of this beats the market, and the ledger
 * that shows every call that has ever been made.
 *
 * THERE IS NO ORDER ROUTE, AND THAT IS THE POINT. Phase 1 stakes nothing. The Kelly numbers are
 * computed and recorded so the forward test is real, but there is no endpoint that moves money and
 * no code path that could. When the ledger earns a PROVEN verdict, the rail is Kalshi's existing
 * confirm-gated order path, not something new here.
 *
 * Mounted behind service-or-oidc per the manifest; handlers ALSO self-gate via callerSub, so a
 * mounting mistake cannot expose a person's followed teams anonymously.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — surface, team picker, follow/unfollow, upcoming games for followed teams, the full game preview with an on-demand rebuild, the scorecard's strategy verdicts, the ledger read, and scoped settings.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Mount the line-capture reads: GET /lines/status (how long we have been watching, which cannot be improved retroactively) and GET /lines/:eventId (the observation series plus its movement summary).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Mount the fantasy routes (/fantasy/*): ESPN Fantasy league link, the lineup advisor, and its graded record.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | GET /games returns upstreamOk, so an unreachable schedule service is never rendered as "your team is not playing" — an empty list is only an answer when the read actually succeeded.
 *
 * @module sports-routes
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
exports.createSportsEdgeRoutes = createSportsEdgeRoutes;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const authz_1 = require("@/shared/middleware/authz");
const sports_ledger_1 = require("./sports-ledger");
const sports_store_1 = require("./sports-store");
const sports_espn_1 = require("./sports-espn");
const sports_refresh_1 = require("./sports-refresh");
const sports_fantasy_routes_1 = require("./sports-fantasy-routes");
const sports_line_history_1 = require("./sports-line-history");
const sports_line_store_1 = require("./sports-line-store");
const log = (0, logger_1.createChildLogger)({ module: 'sports-routes' });
/** Leagues this package will answer for. Anything else is a 400, never a silent empty result. */
const LEAGUES = ['nfl', 'ncaaf', 'nba'];
/** Package dir captured at load, as a fallback when ctx does not carry one. */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Locate the directory holding the surface HTML, tolerating the three places a
 * package can be mounted from.
 * @param appPackageDir - Package directory from the app context, when present.
 * @returns Directory containing sports-edge.html.
 */
function surfaceDir(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
        path.resolve(__dirname, '../tools'),
    ].filter(Boolean);
    return candidates.find((d) => fs.existsSync(path.join(d, 'sports-edge.html'))) || candidates[candidates.length - 1];
}
/** Rejects an unknown league rather than returning an empty result that reads like "no games". */
function parseLeague(value, res) {
    const league = String(value || '').toLowerCase();
    if (!LEAGUES.includes(league)) {
        res.status(400).json({ error: `league must be one of ${LEAGUES.join(', ')}` });
        return null;
    }
    return league;
}
/** Resolves the caller or answers 401. Returns null when it has already answered. */
function requireSub(req, res) {
    const sub = (0, trading_routes_helpers_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'authentication required' });
        return null;
    }
    return sub;
}
/**
 * @description Build the package's router.
 * @param ctx - App context supplying the pool and package directory.
 * @returns The mounted router.
 */
function createSportsEdgeRoutes(ctx) {
    const pool = ctx.pool;
    const toolsDir = surfaceDir(ctx.appPackageDir);
    const router = (0, express_1.Router)();
    (0, sports_store_1.ensureSchema)(pool).catch((err) => log.error({ err }, 'sports-edge schema ensure failed'));
    (0, sports_line_store_1.ensureLineSchema)(pool).catch((err) => log.error({ err }, 'sports-edge line schema ensure failed'));
    // Started here, by the app's own factory, so the refresh loop exists exactly while this package
    // is installed and active — never on a deployment that does not have it.
    (0, sports_refresh_1.startSportsRefresh)(ctx);
    router.get('/', (0, trading_routes_helpers_1.servePage)(toolsDir, 'sports-edge.html'));
    router.get('/ui', (0, trading_routes_helpers_1.servePage)(toolsDir, 'sports-edge.html'));
    registerTeamRoutes(router, pool);
    registerGameRoutes(router, pool);
    registerRecordRoutes(router, pool);
    registerSettingsRoutes(router, pool);
    // The fantasy half. Its reads need the caller's ESPN cookies, resolved per request from the
    // connector broker; the public projection feed it leans on needs no credential at all.
    registerLineRoutes(router, pool);
    (0, sports_fantasy_routes_1.registerFantasyRoutes)(router, pool);
    return router;
}
/**
 * @description The line-capture reads: how much history exists, and one game's movement.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerLineRoutes(router, pool) {
    router.get('/lines/status', async (req, res) => {
        if (!requireSub(req, res))
            return;
        try {
            const stats = await (0, sports_line_store_1.captureStats)(pool);
            // "since" is the honest headline: this dataset's whole value is how long we have been
            // watching, and it cannot be improved retroactively.
            res.json({ ...stats, note: 'Opening lines cannot be backfilled — this history starts when capture started.' });
        }
        catch (err) {
            log.error({ err }, 'line status failed');
            res.status(500).json({ error: 'could not read the capture status' });
        }
    });
    router.get('/lines/:eventId', async (req, res) => {
        if (!requireSub(req, res))
            return;
        try {
            const book = typeof req.query.book === 'string' && req.query.book ? req.query.book : undefined;
            const rows = await (0, sports_line_store_1.observationsFor)(pool, String(req.params.eventId), book);
            if (!rows.length) {
                res.status(404).json({ error: 'no line history captured for that game' });
                return;
            }
            res.json({
                eventId: String(req.params.eventId),
                observations: rows,
                movement: (0, sports_line_history_1.summariseMovement)(rows, typeof req.query.kickoff === 'string' ? req.query.kickoff : null),
            });
        }
        catch (err) {
            log.error({ err, eventId: req.params.eventId }, 'line history failed');
            res.status(500).json({ error: 'could not read the line history' });
        }
    });
}
/**
 * @description Team discovery and the follow list — the app's entry point, since nothing else
 * happens until a team is followed.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerTeamRoutes(router, pool) {
    router.get('/teams', async (req, res) => {
        if (!requireSub(req, res))
            return;
        const league = parseLeague(req.query.league, res);
        if (!league)
            return;
        try {
            const teams = await (0, sports_espn_1.listTeams)(league, { log: (e, f) => log.debug(f, e) });
            res.json({ league, teams });
        }
        catch (err) {
            log.error({ err, league }, 'team list failed');
            res.status(502).json({ error: 'could not reach the schedule service' });
        }
    });
    router.get('/follow', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        try {
            res.json({ teams: await (0, sports_store_1.listFollowed)(pool, sub) });
        }
        catch (err) {
            log.error({ err }, 'followed list failed');
            res.status(500).json({ error: 'could not read followed teams' });
        }
    });
    router.post('/follow', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        const league = parseLeague(req.body?.league, res);
        if (!league)
            return;
        const team = String(req.body?.team || '').toUpperCase().trim();
        const teamId = String(req.body?.teamId || '').trim();
        if (!team || !teamId) {
            res.status(400).json({ error: 'team and teamId are required' });
            return;
        }
        try {
            await (0, sports_store_1.followTeam)(pool, sub, { league, team, teamId, displayName: req.body?.displayName || null });
            log.info({ sub, league, team }, 'team followed');
            res.json({ ok: true, teams: await (0, sports_store_1.listFollowed)(pool, sub) });
        }
        catch (err) {
            log.error({ err, league, team }, 'follow failed');
            res.status(500).json({ error: 'could not follow that team' });
        }
    });
    router.delete('/follow/:league/:team', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        try {
            const removed = await (0, sports_store_1.unfollowTeam)(pool, sub, String(req.params.league), String(req.params.team).toUpperCase());
            res.json({ ok: true, removed, teams: await (0, sports_store_1.listFollowed)(pool, sub) });
        }
        catch (err) {
            log.error({ err }, 'unfollow failed');
            res.status(500).json({ error: 'could not unfollow that team' });
        }
    });
}
/**
 * @description The games and previews — what a followed team plays next, and the full picture
 * behind one of those games.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerGameRoutes(router, pool) {
    router.get('/games', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        const started = Date.now();
        try {
            const followed = await (0, sports_store_1.listFollowed)(pool, sub);
            if (!followed.length) {
                res.json({ teams: [], games: [], awaitingFollow: true });
                return;
            }
            const { rows, upstreamOk } = await (0, sports_refresh_1.followedGames)(pool, followed, Number(req.query.days) || undefined);
            log.info({ sub, teams: followed.length, games: rows.length, upstreamOk, ms: Date.now() - started }, 'games served');
            // `upstreamOk` is what stops an unreachable schedule service from rendering as "your team is
            // not playing". An empty list is only an ANSWER when the read actually succeeded.
            res.json({ teams: followed, games: rows, awaitingFollow: false, upstreamOk });
        }
        catch (err) {
            log.error({ err, sub }, 'games failed');
            res.status(500).json({ error: 'could not assemble upcoming games' });
        }
    });
    router.get('/preview/:eventId', async (req, res) => {
        if (!requireSub(req, res))
            return;
        const league = parseLeague(req.query.league, res);
        if (!league)
            return;
        try {
            const built = await (0, sports_refresh_1.previewFor)(pool, league, String(req.params.eventId), req.query.refresh === '1');
            if (!built) {
                res.status(404).json({ error: 'that game is not on the upcoming schedule' });
                return;
            }
            const calls = await (0, sports_store_1.predictionsForEvent)(pool, String(req.params.eventId));
            res.json({ ...built, calls });
        }
        catch (err) {
            log.error({ err, eventId: req.params.eventId }, 'preview failed');
            res.status(502).json({ error: 'could not build the preview' });
        }
    });
    router.get('/status', async (req, res) => {
        if (!requireSub(req, res))
            return;
        res.json({ season: { nfl: (0, sports_refresh_1.currentSeason)('nfl'), nba: (0, sports_refresh_1.currentSeason)('nba') }, refresh: (0, sports_refresh_1.refreshStatus)() });
    });
    router.post('/ratings/refresh', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        if (!(0, authz_1.isOperator)(req)) {
            res.status(403).json({ error: 'rebuilding ratings is operator-only' });
            return;
        }
        const league = parseLeague(req.body?.league, res);
        if (!league)
            return;
        try {
            const built = await (0, sports_refresh_1.refreshRatings)(pool, league);
            res.json({ ok: true, league, games: built.games, carriedOver: built.carriedOver });
        }
        catch (err) {
            log.error({ err, league }, 'ratings refresh failed');
            res.status(502).json({ error: 'could not rebuild ratings' });
        }
    });
}
/**
 * @description The record — the scorecard's verdicts and the raw ledger. These are the routes that
 * make the package answerable rather than merely opinionated.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerRecordRoutes(router, pool) {
    router.get('/scorecard', async (req, res) => {
        if (!requireSub(req, res))
            return;
        try {
            const rows = await (0, sports_store_1.gradedRows)(pool);
            const byStrategy = new Map();
            for (const r of rows) {
                if (!byStrategy.has(r.strategy))
                    byStrategy.set(r.strategy, []);
                byStrategy.get(r.strategy).push(r);
            }
            const verdicts = [...byStrategy.entries()]
                .map(([strategy, rs]) => (0, sports_ledger_1.classify)((0, sports_ledger_1.rollup)(strategy, rs)))
                .sort((a, b) => a.rollup.brier - b.rollup.brier);
            res.json({ verdicts, settledCalls: rows.length });
        }
        catch (err) {
            log.error({ err }, 'scorecard failed');
            res.status(500).json({ error: 'could not read the scorecard' });
        }
    });
    router.get('/ledger', async (req, res) => {
        if (!requireSub(req, res))
            return;
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        try {
            const r = await pool.query(`SELECT strategy, league, event_id, game_date, home_team, away_team, market, side, selection,
                model_prob, market_prob, edge, price_at_pick, stake_fraction, settled, won, brier,
                market_brier, clv, pnl_units, graded_at, created_at
         FROM sports_predictions ORDER BY created_at DESC LIMIT $1`, [limit]);
            res.json({ rows: r.rows });
        }
        catch (err) {
            log.error({ err }, 'ledger failed');
            res.status(500).json({ error: 'could not read the ledger' });
        }
    });
}
/**
 * @description Settings, split by scope: cadence knobs are operator-only because one refresh
 * serves everyone, while horizon and alert knobs are the caller's own.
 * @param router - Router to extend.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerSettingsRoutes(router, pool) {
    const DEPLOYMENT_KEYS = new Set(['refreshEnabled', 'refreshIntervalMinutes', 'ratingsRefreshHours']);
    router.get('/settings', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        try {
            res.json({
                deployment: await (0, sports_store_1.readSettings)(pool, sports_store_1.DEPLOYMENT_SCOPE),
                user: await (0, sports_store_1.readSettings)(pool, sub),
                canEditDeployment: (0, authz_1.isOperator)(req),
            });
        }
        catch (err) {
            log.error({ err }, 'settings read failed');
            res.status(500).json({ error: 'could not read settings' });
        }
    });
    router.put('/settings', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        const patch = (req.body && typeof req.body === 'object') ? req.body : {};
        const deployment = {};
        const user = {};
        for (const [k, v] of Object.entries(patch))
            (DEPLOYMENT_KEYS.has(k) ? deployment : user)[k] = v;
        if (Object.keys(deployment).length && !(0, authz_1.isOperator)(req)) {
            res.status(403).json({ error: 'the refresh cadence is operator-only' });
            return;
        }
        try {
            if (Object.keys(deployment).length)
                await (0, sports_store_1.writeSettings)(pool, sports_store_1.DEPLOYMENT_SCOPE, deployment);
            if (Object.keys(user).length)
                await (0, sports_store_1.writeSettings)(pool, sub, user);
            log.info({ sub, deployment: Object.keys(deployment), user: Object.keys(user) }, 'settings updated');
            res.json({ ok: true, deployment: await (0, sports_store_1.readSettings)(pool, sports_store_1.DEPLOYMENT_SCOPE), user: await (0, sports_store_1.readSettings)(pool, sub) });
        }
        catch (err) {
            log.error({ err }, 'settings write failed');
            res.status(500).json({ error: 'could not save settings' });
        }
    });
}
//# sourceMappingURL=sports-routes.js.map