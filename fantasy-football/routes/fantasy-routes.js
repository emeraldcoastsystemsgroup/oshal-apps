"use strict";
/**
 * Fantasy Football routes — /api/fantasy-football.
 *
 * OWNERSHIP IS PER PERSON (ADR-146 Q2, operator decision 2026-09-27): "only i can control my team..
 * no one else can see my team and connection." Three things make that true here, and each is
 * enforced below the handler as well as in it:
 *   - every table is user_sub-keyed under FORCED exact-owner row-level security (fantasy-store.ts,
 *     migrations/001-002), so even a handler that forgot the owner would read nothing;
 *   - the ESPN connection used is the caller's OWN personal connection (fantasy-context.ts);
 *   - a caller only ever sees the team their own ESPN account owns in a league, or their own
 *     hand-typed league.
 *
 * EVERY RECOMMENDATION IS REGISTERED BEFORE KICKOFF. `GET /lineup` writes the start/sit calls and the
 * week's decision (advised lineup, highest-projected lineup, both win probabilities, the swaps) into
 * the caller's ledgers, and grades whatever of the caller's completed weeks is due before it builds.
 *
 * Mounted behind oidc per the manifest; handlers ALSO self-gate via callerSub, so a mounting
 * mistake cannot expose a person's league anonymously.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — moved from sports-edge (sports-fantasy-routes.ts SEQ 1-5: status, league link/unlink with the caller's own team resolved from their SWID, the P(win) lineup advisor registered before kickoff, the graded record) into the fantasy-football package (ADR-146 D1) under its own router factory and surface. Per-user ownership (Q2): the ESPN connection used is the caller's own personal one, never a household-shared one; the projection cache and completed weeks are per person; grading reads and writes only the caller's own ledger. The season default is this package's own rule instead of an import from sports-edge's refresh loop.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The lineup reads its league through fantasy-context.ts, so a hand-typed league (?manualId=) gets the same P(win) lineup as a connected one with no connector consulted; the credential rule, the unreachable-ESPN answer and the feed cache moved to fantasy-context.ts and fantasy-feed.ts. The lineup now records the week's decision (ff_weeks) and grades the caller's completed weeks first; POST /grade grades weeks from stored actuals (ff_player_weeks) against the lineup actually started — ESPN's lineup for that week, or the one recorded for a hand-typed league — instead of from a projection cache that stops refreshing once its week has passed; GET /record adds the week ledger. The management routes (season value, waivers, trades, hand-typed leagues) mount from fantasy-manage-routes.ts.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The stored player-week history read in the lineup builder now logs its error at ERROR before degrading, through historyRowsOrNone; the catch came over from sports-edge swallowing it. The fallback is unchanged: no history weighs the projections alone. (The schedule read it sat beside moved to fantasy-context.ts, which logs its own.)
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | GET /lineup is a pure read: it computes the advice, grades nothing, records nothing and does not write the projection cache (the native kernel admits a GET as a reader and refused the recording with 'SQL mutation requires original writer admission', so every lineup answered 502). The completed weeks the live feed carried are weighed in memory. POST /lineup/record grades the caller's due weeks, then serves the same lineup and records the week's decision and its start/sit calls. When no projection is available the body carries projectionFeed {ok:false, reason} and no lineup numbers, and nothing is recorded, instead of a lineup of zero-point projections. Guard: tests/fantasy-lineup-readonly.test.js.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Where the runtime cannot carry ESPN's sign-in cookies (credentialUnsupported() in fantasy-context.ts), /status names that limit as its connectHint with credentialSupported false (the field is absent where the skill reports nothing), a private league's link refusal says it instead of "Connect ESPN Fantasy first", and a link that matches no team carries teamNote saying why. Unchanged where a connection can help. Guard: tests/fantasy-native-credential.test.js.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | GET /record?leagueKey=<ESPN league id or manual:<id>> reads only that league's weeks for the 'Week by week' record (the board passes the league it shows). Sweep 8: a new league's record listed other leagues' rows. Guard: tests/fantasy-week-record-league.test.js.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | GET /record?leagueKey also splits the graded record and the call list by league, not only the week ledger: the record under a league counted and listed every league's start/sit calls. Guard: tests/fantasy-week-record-league.test.js and the real-PostgreSQL tests/fantasy-isolation.spec.ts.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | A league whose scoring gives every stat 0 points answers scoring {ok:false, reason} and no lineup numbers, and records nothing, instead of advising on all-0.0 projections (sweep 9: "Your lineup is already the best legal one"). Guard: tests/fantasy-zero-scoring.test.js.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | The lineup body carries openSlots: recommended starters for slots the lineup as set leaves empty (fantasy-scoring openSlotStarts), so the page can name them instead of calling the lineup the best legal one beside a positive gain (sweep 13). Not recorded as calls: a call is graded against the benched player. Guard: tests/fantasy-open-slot.test.js.
 *
 * @module fantasy-routes
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
exports.createFantasyFootballRoutes = createFantasyFootballRoutes;
exports.gradeDue = gradeDue;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const fantasy_leagues_1 = require("@/features/fantasy-leagues");
const fantasy_winprob_1 = require("./fantasy-winprob");
const fantasy_roster_1 = require("./fantasy-roster");
const fantasy_scoring_1 = require("./fantasy-scoring");
const fantasy_store_1 = require("./fantasy-store");
const fantasy_context_1 = require("./fantasy-context");
const fantasy_http_1 = require("./fantasy-http");
const fantasy_feed_1 = require("./fantasy-feed");
const fantasy_grading_1 = require("./fantasy-grading");
const fantasy_manual_1 = require("./fantasy-manual");
const fantasy_manage_routes_1 = require("./fantasy-manage-routes");
const log = (0, logger_1.createChildLogger)({ module: 'fantasy-football-routes' });
/** Package dir captured at load, as a fallback when ctx does not carry one. */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Locate the directory holding the surface HTML.
 * @param appPackageDir - Package directory from the app context, when present.
 * @returns Directory containing fantasy-football.html.
 */
function surfaceDir(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
        path.resolve(__dirname, '../tools'),
    ].filter(Boolean);
    return candidates.find((d) => fs.existsSync(path.join(d, 'fantasy-football.html'))) || candidates[candidates.length - 1];
}
/**
 * @description Build the package's router.
 * @param ctx - App context supplying the pool and package directory.
 * @returns The mounted router.
 */
function createFantasyFootballRoutes(ctx) {
    const pool = ctx.pool;
    const router = (0, express_1.Router)();
    (0, fantasy_store_1.ensureFantasySchema)(pool).catch((err) => log.error({ err }, 'fantasy-football schema ensure failed'));
    router.get('/', (0, trading_routes_helpers_1.servePage)(surfaceDir(ctx.appPackageDir), 'fantasy-football.html'));
    registerAccountRoutes(router, pool);
    registerLineupRoute(router, pool);
    registerRecordRoutes(router, pool);
    (0, fantasy_manage_routes_1.registerManageRoutes)(router, pool);
    return router;
}
/**
 * @description Connection status and league link/unlink.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerAccountRoutes(router, pool) {
    router.get('/status', async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        try {
            const { cred, sharedOnly } = await (0, fantasy_context_1.credentialFor)(pool, sub);
            res.json({
                connected: Boolean(cred),
                // The SWID identifies the account and is not a secret; espn_s2 is NEVER returned.
                swid: cred?.swid || null,
                season: (0, fantasy_feed_1.seasonOf)(req.query.season),
                leagues: await (0, fantasy_store_1.listLeagues)(pool, sub),
                // Present (false) only where the runtime says it cannot carry ESPN's cookies; connecting cannot
                // help there. Absent where the skill says nothing, rather than claiming support nobody reported.
                ...((0, fantasy_context_1.credentialUnsupported)() ? { credentialSupported: false } : {}),
                connectHint: cred ? null : (0, fantasy_context_1.credentialUnsupported)() || (sharedOnly
                    ? 'Only a household-shared ESPN connection is available, and this app uses your own account only. Connect your own ESPN Fantasy on the connectors page, or type your league in by hand.'
                    : 'Connect ESPN Fantasy on the connectors page (SWID in the account field, espn_s2 as the token), or type your league in by hand.'),
            });
        }
        catch (err) {
            log.error({ err }, 'fantasy status failed');
            res.status(500).json({ error: 'could not read fantasy status' });
        }
    });
    router.post('/link', async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (sub)
            await linkHandler(pool, sub, req, res);
    });
    router.delete('/leagues/:season/:leagueId', async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        try {
            const removed = await (0, fantasy_store_1.unlinkLeague)(pool, sub, (0, fantasy_feed_1.seasonOf)(req.params.season), String(req.params.leagueId));
            res.json({ ok: true, removed, leagues: await (0, fantasy_store_1.listLeagues)(pool, sub) });
        }
        catch (err) {
            log.error({ err }, 'fantasy unlink failed');
            res.status(500).json({ error: 'could not unlink that league' });
        }
    });
}
/**
 * @description Link a league to the caller, resolving their own team from their SWID.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param req - Request carrying leagueId and season.
 * @param res - Response.
 * @returns Nothing.
 */
async function linkHandler(pool, sub, req, res) {
    const season = (0, fantasy_feed_1.seasonOf)(req.body?.season);
    const leagueId = String(req.body?.leagueId || '').trim();
    if (!/^\d+$/.test(leagueId)) {
        res.status(400).json({ error: 'leagueId must be the numeric id from your league URL' });
        return;
    }
    try {
        const { cred } = await (0, fantasy_context_1.credentialFor)(pool, sub);
        const { settings, failure } = await (0, fantasy_leagues_1.readLeagueSettingsOutcome)(season, leagueId, cred, fantasy_context_1.espn);
        if (!settings) {
            if ((0, fantasy_context_1.answerUnreachable)(res, failure))
                return;
            res.status(cred ? 404 : 403).json({
                error: cred
                    ? 'ESPN would not return that league — check the id and season, and that this ESPN account is in it.'
                    : (0, fantasy_context_1.credentialUnsupported)() || 'That league is private. Connect ESPN Fantasy first, then link it — or type the league in by hand.',
            });
            return;
        }
        const teams = await (0, fantasy_leagues_1.readTeams)(season, leagueId, settings.scoringPeriodId, cred, fantasy_context_1.espn);
        const own = cred ? (0, fantasy_leagues_1.findOwnTeam)(teams, cred.swid) : null;
        await (0, fantasy_store_1.linkLeague)(pool, sub, {
            season, leagueId, leagueName: settings.name, teamId: own?.teamId ?? null, teamName: own?.name ?? null,
        });
        log.info({ season, leagueId, teams: teams.length, ownTeam: own?.teamId ?? null }, 'fantasy league linked');
        res.json({
            ok: true, league: settings.name, teamName: own?.name || null, teams: teams.length,
            // Linked, but no team could be matched: say why rather than leave a blank team.
            teamNote: own ? null : (cred ? 'No team in that league belongs to this ESPN account.' : (0, fantasy_context_1.credentialUnsupported)()),
            leagues: await (0, fantasy_store_1.listLeagues)(pool, sub),
        });
    }
    catch (err) {
        log.error({ err, season, leagueId }, 'fantasy link failed');
        res.status(502).json({ error: 'could not reach ESPN to link that league' });
    }
}
/**
 * @description The lineup advisor: the P(win)-optimal lineup for the caller's own team — from their
 * ESPN league or their hand-typed one — and the swaps that get there. GET only computes it (a reader
 * request writes nothing); POST /lineup/record grades the due weeks first and records the week's
 * decision and calls, which is the forward test the record screen shows.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerLineupRoute(router, pool) {
    router.get('/lineup', async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        await serveLineup(res, pool, sub, (0, fantasy_http_1.leagueRequestOf)(req.query), false);
    });
    router.post('/lineup/record', async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const request = (0, fantasy_http_1.leagueRequestOf)({ ...req.query, ...(req.body || {}) });
        // Grade what is due first, so the ledger shown beside the lineup is current. A grading failure is
        // logged and never costs the caller the lineup.
        await gradeDue(pool, sub, request.season).catch((err) => log.error({ err }, 'opportunistic grading failed'));
        await serveLineup(res, pool, sub, request, true);
    });
}
/**
 * @description Resolve the league and answer the lineup, recording it only when asked.
 * @param res - Response.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param request - The league request.
 * @param record - Whether to record the week's decision and calls (writer requests only).
 * @returns Nothing.
 */
async function serveLineup(res, pool, sub, request, record) {
    try {
        const result = await (0, fantasy_context_1.resolveLeagueContext)(pool, sub, request);
        if (!result.ok) {
            (0, fantasy_http_1.sendContextFailure)(res, result);
            return;
        }
        res.json(await buildLineup(pool, sub, result.ctx, record));
    }
    catch (err) {
        log.error({ err, season: request.season, record }, 'lineup failed');
        res.status(502).json({ error: 'could not build the lineup' });
    }
}
/**
 * @description The opponent's own best lineup, as moments — deliberately THEIR optimal lineup, the
 * only assumption about an opponent that cannot flatter us.
 * @param opponent - The opposing team, or null when the schedule gave no opponent.
 * @param projections - The projection feed.
 * @param settings - The league's rules.
 * @param history - Weekly point totals per player id.
 * @returns Their moments, or null when there is nobody to play.
 */
function opponentMoments(opponent, projections, settings, history) {
    if (!opponent)
        return null;
    const roster = (0, fantasy_roster_1.joinRoster)(opponent.entries, projections, history);
    const best = (0, fantasy_scoring_1.optimiseLineup)(roster, settings.slots, settings.scoring);
    return (0, fantasy_winprob_1.lineupMoments)(best.starters.map((a) => a.player), settings.scoring);
}
/**
 * @description The caller's stored weekly lines for these players before the week being set. A
 * failed read is logged and served as no history, which leaves the projections alone.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param at - Season, league key (for the log) and the week being set.
 * @param playerIds - Both rosters' player ids.
 * @returns The stored lines, or none after logging the error.
 */
async function historyRowsOrNone(pool, sub, at, playerIds) {
    return (0, fantasy_store_1.readPlayerWeeks)(pool, sub, at.season, at.week, playerIds).catch((err) => {
        log.error({ err, ...at }, 'player-week history read failed; weighing projections alone');
        return [];
    });
}
/**
 * @description Build the lineup response: read the opponent, score both rosters with their
 * histories and optimise for P(win). With no projection available it answers the feed's failure and
 * no numbers. Only a recording request writes (the calls and the week's decision, before kickoff).
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param ctx - The league, from either source.
 * @param record - Whether this request may write.
 * @returns The response body.
 */
async function buildLineup(pool, sub, ctx, record) {
    const { season, week, settings, teams, own } = ctx;
    const zero = (0, fantasy_manual_1.zeroScoringReason)(settings.scoring);
    if (zero) {
        log.warn({ source: ctx.source, season, week }, 'lineup refused: the league scoring scores nothing');
        return (0, fantasy_manual_1.scoringRefusedBody)(ctx, zero);
    }
    const started = Date.now();
    const read = await (0, fantasy_feed_1.projectionsFor)(pool, sub, season, week, { persist: record });
    const fixture = (0, fantasy_leagues_1.opponentOutcomeFor)(ctx.matchups, own.teamId, week);
    const opponent = fixture.opponentTeamId === null ? null : teams.find((t) => t.teamId === fixture.opponentTeamId) || null;
    if (!Object.keys(read.players).length)
        return unavailableBody(ctx, read.feed, opponent);
    const ids = [...own.rosterPlayerIds, ...(opponent?.rosterPlayerIds || [])];
    // Strictly before the week being set: a player who has not kicked off would enter as a zero.
    const stored = await historyRowsOrNone(pool, sub, { season, leagueKey: ctx.key, week }, ids);
    const history = (0, fantasy_roster_1.historyFor)(mergeWeeks(stored, read.weeks, week, ids), settings.scoring);
    const roster = (0, fantasy_roster_1.joinRoster)(own.entries, read.players, history);
    const theirs = opponentMoments(opponent, read.players, settings, history);
    const win = (0, fantasy_winprob_1.optimiseForWin)(roster, settings.slots, settings.scoring, theirs);
    const calls = (0, fantasy_scoring_1.startSitCalls)(own.startingPlayerIds, win.lineup, settings.scoring, roster);
    const currentTotal = currentLineupTotal(own.startingPlayerIds, roster, settings.scoring);
    const registered = record ? await recordLineup(pool, sub, ctx, { win, theirs, calls, currentTotal }) : 0;
    log.info({
        source: ctx.source, season, week, roster: roster.length, calls: calls.length, registered, record,
        playersWithHistory: roster.filter((p) => p.pointsHistory?.length).length,
        posture: theirs ? win.posture : 'no-opponent', winProbability: theirs ? win.winProbability : null,
        varianceSwaps: win.swaps.length, feed: read.feed.source, ms: Date.now() - started,
    }, 'lineup served');
    const openSlots = (0, fantasy_scoring_1.openSlotStarts)(own.startingPlayerIds, win.lineup);
    const body = lineupBody(ctx, { players: read.players, generatedAt: read.generatedAt, opponent, theirs, win, calls, openSlots, currentTotal, schedule: fixture });
    return { ...body, projectionFeed: read.feed, recorded: record };
}
/**
 * @description Record the week's decision and its start/sit calls in the caller's own ledger.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param ctx - The league.
 * @param r - The computed lineup.
 * @returns How many calls were registered.
 */
async function recordLineup(pool, sub, ctx, r) {
    const { season, week, own } = ctx;
    const { win, theirs } = r;
    const registered = await (0, fantasy_store_1.recordCalls)(pool, sub, season, ctx.key, week, r.calls);
    await (0, fantasy_grading_1.recordWeek)(pool, sub, {
        season, leagueKey: ctx.key, week, source: ctx.source,
        advised: win.lineup.starters.map((s) => s.player.playerId), meanLineup: win.meanLineup.starters.map((s) => s.player.playerId),
        started: own.startingPlayerIds, swaps: win.swaps, winProbability: theirs ? win.winProbability : null,
        meanWinProbability: theirs ? win.meanWinProbability : null, projectedAdvised: win.lineup.total, projectedStarted: r.currentTotal,
    });
    return registered;
}
/**
 * @description The stored completed weeks plus the ones the live feed just carried (not stored on a
 * read), restricted to these players and to weeks before the one being set; a fetched line wins.
 * @param stored - Lines read from the caller's store.
 * @param fetched - Lines the live feed carried.
 * @param week - The week being set.
 * @param ids - Both rosters' player ids.
 * @returns The merged lines.
 */
function mergeWeeks(stored, fetched, week, ids) {
    const wanted = new Set(ids);
    const byKey = new Map();
    for (const line of [...stored, ...fetched]) {
        if (line.week < week && wanted.has(line.playerId))
            byKey.set(`${line.playerId}:${line.week}`, line);
    }
    return [...byKey.values()].sort((a, b) => a.week - b.week);
}
/**
 * @description The answer when no projection exists for the week: the league, the team, who they
 * play, and why there are no numbers. No lineup is built from zero-point projections.
 * @param ctx - The league.
 * @param feed - The feed state, carrying the reason.
 * @param opponent - The opposing team, if scheduled.
 * @returns The body.
 */
function unavailableBody(ctx, feed, opponent) {
    log.warn({ season: ctx.season, week: ctx.week, reason: feed.reason }, 'lineup served without projections');
    return {
        source: ctx.source,
        league: { name: ctx.settings.name, leagueId: ctx.key, season: ctx.season, week: ctx.week },
        team: { teamId: ctx.own.teamId, name: ctx.own.name },
        matchup: { opponentTeamId: opponent?.teamId ?? null, opponentName: opponent?.name ?? null },
        projectionFeed: feed,
        projectionsAvailable: 0,
        optimal: null,
        meanOptimal: null,
        calls: [],
        openSlots: [],
        recorded: false,
    };
}
/**
 * @description The lineup response body.
 * @param ctx - The league.
 * @param r - What buildLineup computed.
 * @returns The body.
 */
function lineupBody(ctx, r) {
    const { win, theirs, opponent } = r;
    return {
        source: ctx.source,
        league: { name: ctx.settings.name, leagueId: ctx.key, season: ctx.season, week: ctx.week },
        team: { teamId: ctx.own.teamId, name: ctx.own.name },
        scoringRules: ctx.settings.scoring.length,
        slots: ctx.settings.slots,
        optimal: win.lineup,
        calls: r.calls,
        // Recommended starters for slots the lineup as set leaves empty (no one to sit, so not a call).
        openSlots: r.openSlots,
        matchup: {
            opponentTeamId: opponent?.teamId ?? null,
            opponentName: opponent?.name ?? null,
            // WHY there is no opponent: a bye, an unscheduled week and an unreadable schedule differ.
            opponentReason: opponent ? 'opponent' : (ctx.scheduleFailure ? 'unreadable' : r.schedule.reason),
            scheduleError: ctx.scheduleFailure ? ctx.scheduleFailure.reason : null,
            opponentProjected: theirs?.mean ?? null,
            opponentSpread: theirs?.sd ?? null,
            yourProjected: win.moments.mean,
            yourSpread: win.moments.sd,
            winProbability: theirs ? win.winProbability : null,
            meanWinProbability: theirs ? win.meanWinProbability : null,
            posture: theirs ? win.posture : null,
            swaps: win.swaps,
            meanFallback: win.meanFallback,
        },
        meanOptimal: win.meanLineup,
        currentTotal: r.currentTotal,
        projectionsGeneratedAt: r.generatedAt,
        projectionsAvailable: Object.keys(r.players).length,
    };
}
/**
 * @description What the lineup the manager actually set is projected to score.
 * @param startingIds - Player ids currently started.
 * @param roster - The whole roster.
 * @param scoring - The league's rules.
 * @returns Projected points for the lineup as set.
 */
function currentLineupTotal(startingIds, roster, scoring) {
    const byId = new Map(roster.map((p) => [p.playerId, p]));
    let total = 0;
    for (const id of startingIds) {
        const p = byId.get(id);
        if (p)
            total += (0, fantasy_scoring_1.applyScoring)(p.projectedStats, scoring);
    }
    return Math.round(total * 100) / 100;
}
/**
 * @description The graded record, the start/sit ledger and the week ledger, plus the caller's own
 * grading pass.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerRecordRoutes(router, pool) {
    router.get('/record', async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const leagueKey = typeof req.query.leagueKey === 'string' && req.query.leagueKey ? req.query.leagueKey.slice(0, 80) : undefined;
        try {
            res.json({
                record: await (0, fantasy_store_1.fantasyRecord)(pool, sub, leagueKey),
                calls: await (0, fantasy_store_1.listCalls)(pool, sub, Math.min(Math.max(Number(req.query.limit) || 100, 1), 500), leagueKey),
                weeks: await (0, fantasy_grading_1.weekRecord)(pool, sub, leagueKey),
            });
        }
        catch (err) {
            log.error({ err }, 'fantasy record failed');
            res.status(500).json({ error: 'could not read the fantasy record' });
        }
    });
    router.post('/grade', async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const season = (0, fantasy_feed_1.seasonOf)(req.body?.season);
        try {
            res.json({ ok: true, ...(await gradeDue(pool, sub, season)) });
        }
        catch (err) {
            log.error({ err, season }, 'fantasy grading failed');
            res.status(502).json({ error: 'could not grade the outstanding weeks' });
        }
    });
}
/**
 * @description Grade the caller's completed weeks (and the start/sit calls inside them) from their
 * stored actuals. For an ESPN league the lineup actually started is ESPN's for that week, read with
 * the caller's own credential; for a hand-typed league it is the one recorded. Only the caller's own
 * rows are read or written.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @returns How many weeks were graded and how many are still incomplete.
 */
async function gradeDue(pool, sub, season) {
    const currentWeek = await (0, fantasy_leagues_1.readCurrentScoringPeriod)(season, fantasy_context_1.espn);
    const open = await (0, fantasy_grading_1.openWeeks)(pool, sub, season, currentWeek);
    if (!open.length)
        return { graded: 0, incomplete: 0 };
    let cred;
    const rules = new Map();
    let graded = 0;
    let incomplete = 0;
    for (const week of open) {
        if (week.source === 'espn' && cred === undefined)
            cred = (await (0, fantasy_context_1.credentialFor)(pool, sub)).cred;
        if (!rules.has(week.leagueKey))
            rules.set(week.leagueKey, await scoringFor(pool, sub, season, week.leagueKey, cred ?? null));
        const scoring = rules.get(week.leagueKey);
        if (!scoring) {
            incomplete += 1;
            continue;
        }
        const startedIds = week.source === 'espn' ? await espnStarted(season, week.leagueKey, week.week, cred ?? null) : null;
        if ((await (0, fantasy_grading_1.gradeWeek)(pool, sub, week, { scoring, startedIds })) === 'graded')
            graded += 1;
        else
            incomplete += 1;
    }
    if (graded)
        log.info({ season, graded, incomplete }, 'fantasy weeks graded');
    return { graded, incomplete };
}
/**
 * @description A league's scoring rules, by ledger key.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @param key - ESPN league id or `manual:<id>`.
 * @param cred - The caller's own ESPN credential (ESPN leagues only).
 * @returns The rules, or null when the league cannot be read.
 */
async function scoringFor(pool, sub, season, key, cred) {
    if (key.startsWith('manual:'))
        return (await (0, fantasy_manual_1.readManualLeague)(pool, sub, Number(key.slice(7))))?.league.scoring || null;
    return (await (0, fantasy_leagues_1.readLeagueSettings)(season, key, cred, fantasy_context_1.espn))?.scoring || null;
}
/**
 * @description The lineup the caller's own ESPN team actually started in a week.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param week - The week.
 * @param cred - The caller's own credential.
 * @returns Player ids, or null when ESPN cannot say (the recorded lineup is used instead).
 */
async function espnStarted(season, leagueId, week, cred) {
    if (!cred)
        return null;
    const own = (0, fantasy_leagues_1.findOwnTeam)(await (0, fantasy_leagues_1.readTeams)(season, leagueId, week, cred, fantasy_context_1.espn), cred.swid);
    return own ? own.startingPlayerIds : null;
}
//# sourceMappingURL=fantasy-routes.js.map