"use strict";
/**
 * The refresh loop — ratings, previews, and grading, all off the request path.
 *
 * A preview costs several external reads and a rating rebuild costs around thirty, so neither can
 * happen while someone is waiting for a page. That lesson is already written down in this codebase
 * in blood: the Kalshi scan used to run on the request path and every cold open paid a
 * twenty-three second feed walk. This module keeps everything warm in Postgres and the surface
 * reads a cached row.
 *
 * THE GRADER IS THE HALF THAT MATTERS. Registering predictions is easy and feels productive;
 * grading them is what turns a pile of opinions into evidence. Every pass looks for calls whose
 * game has finished, reads the final score and the closing prices, and writes back the outcome,
 * both Brier scores, closing-line value and profit. A call that is never graded is a call that
 * never has to be right, and this package's whole premise is that it does.
 *
 * SEASONS ARE KEYED THE WAY ESPN KEYS THEM, which differs by league and is a genuine trap: the NFL
 * season is keyed by the year it STARTS, the NBA season by the year it ENDS. Getting this wrong
 * silently rates teams on the wrong year's tape and produces confident nonsense, so it is one
 * function with the rule written down rather than an inline expression in three places.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Capture the line for EVERY upcoming game every pass, not just followed teams: capture is one scoreboard call per league and its data cannot be backfilled, so skipping an unfollowed game loses that opener permanently. Runs first in the pass for the same reason.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — season keying per league, cached rating rebuilds, horizon game listing for followed teams, preview build/cache with pre-kickoff registration, the settlement grader, and the interval loop the route factory starts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A failed ESPN read now logs at WARN (the box runs LOG_LEVEL=info, so a debug-level failure is invisible exactly when someone asks why the surface is empty) and followedGames returns upstreamOk alongside the rows, so the caller can tell "no games" apart from "could not reach the schedule service".
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The pass now feeds followed teams, their injury wire and their upcoming matchups into the shared World Intelligence layer instead of this package growing a news reader of its own. Subject NAMING lives here; fetching, dedup, classification and the time series stay in World, which is what stops two applications pulling the same wire twice and disagreeing about what it said. Runs LAST — it is the only step whose work can be caught up on a later pass.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Resolve current head coaches from followed ESPN team IDs only when their team is due, then use the same shared World ingest, persistent cooldown and pass budget.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | No timer. The pass ran from a setInterval the route factory started, outside any request, so on the native kernel every pass failed before its first query ("Unbound application request is unavailable in this native runtime" / "SQL connection requires an active admitted request") and the surface never refreshed. A pass now runs only inside an admitted request: runRefreshPass is called by POST /refresh/run, which the manifest's `refresh-pass` schedule fires as the person who activated it, so the pass works over that person's own followed teams. Loading this module starts nothing. Guard: tests/sports-refresh-schedule.test.js.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | upcomingGames reads the scoreboard by month (dates=YYYYMM) and filters to the window: ESPN now answers every day range with HTTP 400 "Failed to get events endpoint" (measured 2026-10-11 for NFL, NBA and college football, past and future ranges alike), so line capture, previews and the followed-games list found no game at all. Guard: tests/sports-refresh-schedule.test.js.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | A requested pass is bounded by the deployment's refreshIntervalMinutes: runRefreshPass reads the caller's last pass start (sports_settings scope `__refresh_pass__:<sub>`) and answers skipped 'not_due' with nextDueAt until the interval (less a 10-minute slack for the schedule's own jitter) has passed; only an operator's {force:true} skips the check. POST /refresh/run had no brake but the in-process `running` flag, so any signed-in caller could run back-to-back passes, each a full line capture, grading, preview and World ingest, and a stale-ratings rebuild (~30 ESPN reads) on every call while ratings stayed stale. The pass also reads only the caller's own followed teams (WHERE user_sub = $1), which is what the schedule offer says and what the native kernel's per-person SQL scope already gave it. Guard: tests/sports-refresh-schedule.test.js.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Export FOLLOWED_GAMES_HORIZON_DAYS so GET /games can name the window an empty Games list covers.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Item A (0.12.3): retire unused World wire ingest in refreshWorld after walk-forward evaluation against the current ensemble found zero historical coverage on completed 2025 seasons (0/1,942 games) and no Brier/MAE improvement on the 2026 SEA+ARK archived wire series (de-biased sentiment delta and injury-wire burst both worsened Brier and MAE despite 16,581 classifications). refreshWorld now returns {subjects:0,newItems:0} at zero ingest/roster/DB cost.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Item C (0.12.4): adaptive open-window capture cadence. Inside any league's expected open window, runRefreshPass polls line capture every 15 minutes (only for the active-window leagues, without rebuilding previews or grading); outside all open windows it stays on the slow refreshIntervalMinutes (180m) cadence with zero ESPN reads between intervals.
 *
 * @module sports-refresh
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFRESH_SCHEDULE = exports.WORLD_WIRE_INGEST_RETIRED = exports.FOLLOWED_GAMES_HORIZON_DAYS = void 0;
exports.currentSeason = currentSeason;
exports.refreshRatings = refreshRatings;
exports.getRatings = getRatings;
exports.monthsCovering = monthsCovering;
exports.upcomingGames = upcomingGames;
exports.followedGames = followedGames;
exports.previewFor = previewFor;
exports.ensembleMayStake = ensembleMayStake;
exports.gradeDue = gradeDue;
exports.captureLines = captureLines;
exports.refreshWorld = refreshWorld;
exports.refreshStatus = refreshStatus;
exports.refreshPass = refreshPass;
exports.passKey = passKey;
exports.linePollKey = linePollKey;
exports.lastPassAt = lastPassAt;
exports.lastLinePollAt = lastLinePollAt;
exports.currentCaptureCadence = currentCaptureCadence;
exports.nextDueAt = nextDueAt;
exports.runRefreshPass = runRefreshPass;
const logger_1 = require("@/shared/logger");
const sports_preview_1 = require("./sports-preview");
const sports_ledger_1 = require("./sports-ledger");
const sports_espn_1 = require("./sports-espn");
const sports_store_1 = require("./sports-store");
const sports_line_store_1 = require("./sports-line-store");
const open_windows_1 = require("./open-windows");
const log = (0, logger_1.createChildLogger)({ module: 'sports-refresh' });
/**
 * ESPN client options wired to this module's logger. A FAILED read logs at warn, not debug: the box
 * runs at LOG_LEVEL=info, so a debug-level failure is invisible exactly when someone is asking why
 * the surface is empty.
 */
const espn = {
    log: (event, fields) => (event === 'espn.request.ok' ? log.debug(fields, event) : log.warn(fields, event)),
    timeoutMs: 20000,
};
/** Builds per-call options that record whether the upstream read ultimately failed. */
function tracked() {
    let failed = false;
    return {
        opts: { ...espn, onError: (url, reason) => { failed = true; log.warn({ url, reason }, 'espn read failed after retries'); } },
        ok: () => !failed,
    };
}
/** Shipped defaults; a deployment row overrides them. Mirrors the manifest's settings.schema. */
const DEFAULTS = { refreshEnabled: true, refreshIntervalMinutes: 180, ratingsRefreshHours: 24, previewHorizonDays: 8 };
/** How many days ahead the followed-games list looks; the Games screen names it when the list is empty. */
exports.FOLLOWED_GAMES_HORIZON_DAYS = DEFAULTS.previewHorizonDays;
/** Bounds on how much work one refresh pass will do, so a wide follow list cannot run unbounded. */
const MAX_PREVIEWS_PER_PASS = 40;
/** Leagues whose lines are captured every pass. Capture is one scoreboard call per league. */
const CAPTURE_LEAGUES = ['nfl', 'nba', 'ncaaf'];
/** How far ahead to capture lines. Wider than the preview horizon on purpose — see captureLines. */
const CAPTURE_HORIZON_DAYS = 21;
/**
 * Unused World wire ingest retired in 0.12.3 (BACKLOG Item A).
 * Walk-forward evaluation against the current ensemble found zero historical coverage on completed
 * 2025 seasons (0/1,942 games) and no Brier or MAE improvement on the 2026 archived wire series
 * despite 16,581 classifications, so refreshWorld no longer triggers feed pulls or LLM classification.
 */
exports.WORLD_WIRE_INGEST_RETIRED = true;
/**
 * @description The season year ESPN uses for a league right now. The NFL keys a season by the year
 * it STARTS; the NBA keys it by the year it ENDS. Getting this backwards rates teams on the wrong
 * tape and produces confident nonsense, so the rule lives here and nowhere else.
 * @param league - League to resolve.
 * @param now - Instant to resolve as of; defaults to now.
 * @returns ESPN's season year.
 */
function currentSeason(league, now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    if (league === 'nba')
        return month >= 9 ? year + 1 : year;
    // Both football leagues are keyed by the year the season STARTS.
    return month >= 8 ? year : year - 1;
}
/**
 * @description Rebuild and store a league's season ratings. Around thirty external reads, so this
 * is called by the loop and by an operator, never by a page.
 * @param pool - Postgres pool.
 * @param league - League to rebuild.
 * @returns The freshly built ratings.
 */
async function refreshRatings(pool, league) {
    const started = Date.now();
    const season = currentSeason(league);
    const ratings = await (0, sports_preview_1.buildSeasonRatings)(league, season, espn);
    await (0, sports_store_1.writeRatings)(pool, ratings, Date.now() - started);
    log.info({ league, season, games: ratings.games, carriedOver: ratings.carriedOver, ms: Date.now() - started }, 'ratings rebuilt');
    return ratings;
}
/**
 * @description Read cached ratings, rebuilding when they are missing or older than the configured
 * age.
 * @param pool - Postgres pool.
 * @param league - League to read.
 * @param maxAgeHours - Age beyond which a rebuild is triggered.
 * @returns Ratings, cached or fresh.
 */
async function getRatings(pool, league, maxAgeHours = DEFAULTS.ratingsRefreshHours) {
    const cached = await (0, sports_store_1.readRatings)(pool, league, currentSeason(league));
    if (cached) {
        const ageHours = (Date.now() - Date.parse(cached.generatedAt)) / 3600000;
        if (ageHours < maxAgeHours)
            return cached.ratings;
    }
    return refreshRatings(pool, league);
}
/**
 * @description The calendar months (ESPN's `YYYYMM` scoreboard key) a window touches, in order.
 * @param from - Window start.
 * @param to - Window end.
 * @returns One `YYYYMM` per month from the start's month to the end's, in UTC.
 */
function monthsCovering(from, to) {
    const months = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (cursor.getTime() <= to.getTime()) {
        months.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months;
}
/**
 * @description Every scheduled game in a league within the horizon. The scoreboard is read by MONTH
 * (`dates=YYYYMM`): since at least 2026-10-11 ESPN answers every day range (`YYYYMMDD-YYYYMMDD`, even a
 * two-day one) with HTTP 400 "Failed to get events endpoint", so a range read captured no game at all.
 * A window spanning two months costs two requests per league; games are merged by event id.
 * @param league - League to list.
 * @param days - How far ahead to look.
 * @param opts - ESPN options; pass a tracked set to learn whether the read actually succeeded.
 * @returns Scheduled games inside the window, earliest first, with whatever prices the scoreboard carried.
 */
async function upcomingGames(league, days, opts = espn, now = new Date()) {
    const from = now;
    const to = new Date(from.getTime() + days * 86400000);
    const byEvent = new Map();
    for (const month of monthsCovering(from, to)) {
        for (const game of await (0, sports_espn_1.scoreboard)(league, opts, month))
            byEvent.set(game.eventId, game);
    }
    return [...byEvent.values()]
        .filter((g) => Date.parse(g.date) >= from.getTime() - 6 * 3600000 && Date.parse(g.date) <= to.getTime())
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
/**
 * @description The upcoming games involving any followed team, newest first, with each game's
 * preview headline attached when one has been built.
 * @param pool - Postgres pool.
 * @param followed - The caller's followed teams.
 * @param days - Horizon in days.
 * @returns The rows, plus whether every upstream read succeeded. An empty list with `upstreamOk`
 * false means "we could not reach the schedule service", NOT "your team is not playing" — the
 * surface must say which, because an empty list rendered as an answer is one a person acts on.
 */
async function followedGames(pool, followed, days = DEFAULTS.previewHorizonDays) {
    const leagues = [...new Set(followed.map((f) => f.league))];
    const wanted = new Map();
    for (const f of followed) {
        if (!wanted.has(f.league))
            wanted.set(f.league, new Set());
        wanted.get(f.league).add(f.team);
    }
    const track = tracked();
    const out = [];
    for (const league of leagues) {
        const teams = wanted.get(league);
        for (const game of await upcomingGames(league, days, track.opts)) {
            const hits = [game.homeTeam, game.awayTeam].filter((t) => teams.has(t));
            if (!hits.length)
                continue;
            const cached = await (0, sports_store_1.readPreview)(pool, game.eventId);
            out.push({ game, followedTeams: hits, headline: cached ? headlineOf(cached.preview, cached.generatedAt) : undefined });
        }
    }
    out.sort((a, b) => a.game.date.localeCompare(b.game.date));
    return { rows: out, upstreamOk: track.ok() };
}
/** Condenses a preview into the one line the list view shows. */
function headlineOf(preview, generatedAt) {
    const top = preview.edges[0];
    return {
        projectedMargin: preview.line.projectedMargin,
        homeWinProbability: preview.line.homeWinProbability,
        topEdge: top ? { selection: top.selection, edge: top.edge, market: top.market } : null,
        generatedAt,
    };
}
/**
 * @description Build (or read) the preview for one game, and register its calls in the ledger
 * before kickoff. Registration happens here rather than in the route so a preview built by the
 * background loop is recorded identically to one a person opened.
 * @param pool - Postgres pool.
 * @param league - League the game belongs to.
 * @param eventId - ESPN event id.
 * @param force - Rebuild even when a cached preview exists.
 * @returns The preview and its age, or null when the game is not on the upcoming schedule.
 */
async function previewFor(pool, league, eventId, force = false) {
    if (!force) {
        const cached = await (0, sports_store_1.readPreview)(pool, eventId);
        if (cached)
            return cached;
    }
    const horizon = await upcomingGames(league, 30);
    const game = horizon.find((g) => g.eventId === eventId);
    if (!game)
        return null;
    const preview = await buildAndRecord(pool, league, game);
    return { preview, generatedAt: preview.generatedAt };
}
/**
 * @description Build a preview, store it, and register its calls. The stake written is zero unless
 * the ensemble has earned a PROVEN verdict, which in Phase 1 it has not — the gate is consulted
 * rather than assumed so the day it flips, nothing else has to change.
 * @param pool - Postgres pool.
 * @param league - League the game belongs to.
 * @param game - The scheduled game.
 * @returns The built preview.
 */
async function buildAndRecord(pool, league, game) {
    const ratings = await getRatings(pool, league);
    const season = currentSeason(league);
    const tapes = {};
    for (const [team, teamId] of [[game.homeTeam, game.homeTeamId], [game.awayTeam, game.awayTeamId]]) {
        const { results } = await (0, sports_espn_1.teamSchedule)(league, teamId, season, espn);
        tapes[team] = { teamId, results };
    }
    const preview = await (0, sports_preview_1.buildPreview)(game, ratings, tapes, season, espn);
    await (0, sports_store_1.writePreview)(pool, preview);
    const rows = (0, sports_ledger_1.predictionsFrom)(preview, await ensembleMayStake(pool));
    const written = await (0, sports_store_1.upsertPredictions)(pool, rows);
    log.info({ eventId: game.eventId, league, edges: preview.edges.length, registered: written }, 'preview built');
    return preview;
}
/**
 * @description Whether the voting ensemble has earned the right to size a stake. Reads the graded
 * ledger and applies the same gate the scorecard shows, so the surface and the writer can never
 * disagree about what is allowed.
 * @param pool - Postgres pool.
 * @returns True only on a PROVEN verdict.
 */
async function ensembleMayStake(pool) {
    const rows = (await (0, sports_store_1.gradedRows)(pool)).filter((r) => r.strategy === sports_ledger_1.ENSEMBLE_STRATEGY);
    return (0, sports_ledger_1.classify)((0, sports_ledger_1.rollup)(sports_ledger_1.ENSEMBLE_STRATEGY, rows)).mayStake;
}
/**
 * @description Grade every registered call whose game has finished. Reads the final score and the
 * closing prices once per game rather than once per row, since a game usually carries several
 * calls across strategies.
 * @param pool - Postgres pool.
 * @param now - Instant to treat as current.
 * @returns How many rows were graded.
 */
async function gradeDue(pool, now = new Date()) {
    // A game is only worth checking once enough time has passed for it to have ended.
    const cutoff = new Date(now.getTime() - 3 * 3600000);
    const open = await (0, sports_store_1.openPredictions)(pool, cutoff);
    if (!open.length)
        return 0;
    const finals = new Map();
    let graded = 0;
    for (const row of open) {
        if (!finals.has(row.eventId))
            finals.set(row.eventId, await (0, sports_espn_1.finalState)(row.league, row.eventId, espn));
        const fin = finals.get(row.eventId);
        if (!fin)
            continue;
        const closing = row.side === 'home' ? fin.closingQuote.homeMoneyline : fin.closingQuote.awayMoneyline;
        const opposing = row.side === 'home' ? fin.closingQuote.awayMoneyline : fin.closingQuote.homeMoneyline;
        const settle = {
            homeScore: fin.homeScore, awayScore: fin.awayScore,
            closingPrice: closing, closingOpposingPrice: opposing, closingSpread: fin.closingQuote.homeSpread,
        };
        await (0, sports_store_1.gradePrediction)(pool, row.id, (0, sports_ledger_1.gradeOne)(row, settle), settle);
        graded += 1;
    }
    if (graded)
        log.info({ graded, games: finals.size }, 'settled calls graded');
    return graded;
}
/**
 * @description Capture the current line for every upcoming game in the requested leagues (all
 * leagues by default), whether or not anyone follows the teams.
 *
 * PREVIEWS ARE SELECTIVE; CAPTURE IS NOT, and the asymmetry is deliberate. A preview costs several
 * external reads per game, so it is built only for followed teams. Capture costs ONE scoreboard
 * call per league for the entire slate — and the data it collects cannot be backfilled.
 * @param pool - Postgres pool.
 * @param opts - Optional league subset, clock instant, and ESPN options.
 * @returns Counts by outcome, for the log line.
 */
async function captureLines(pool, opts = {}) {
    const tally = { 'no-price': 0, unchanged: 0, 'first-capture': 0, moved: 0, games: 0 };
    const leagues = opts.leagues && opts.leagues.length ? opts.leagues : CAPTURE_LEAGUES;
    const now = opts.now ?? new Date();
    const clientOpts = opts.espnOpts ?? espn;
    for (const league of leagues) {
        for (const game of await upcomingGames(league, CAPTURE_HORIZON_DAYS, clientOpts, now)) {
            tally.games += 1;
            try {
                const result = await (0, sports_line_store_1.captureQuote)(pool, {
                    league,
                    eventId: game.eventId,
                    gameDate: game.date || null,
                    homeTeam: game.homeTeam,
                    awayTeam: game.awayTeam,
                }, game.quote, { capturedAt: now });
                tally[result] += 1;
                if (result === 'moved' || result === 'first-capture') {
                    log.info({ league, eventId: game.eventId, game: `${game.awayTeam}@${game.homeTeam}`, result, quote: game.quote }, 'line captured');
                }
            }
            catch (err) {
                log.error({ err, eventId: game.eventId }, 'line capture failed');
            }
        }
    }
    return tally;
}
/**
 * @description Retired World wire ingest hook (BACKLOG Item A, 0.12.3).
 *
 * Previously pulled followed teams, injury wires, coaches, and upcoming matchups into World
 * Intelligence while buildPreview never read world_items back. Walk-forward evaluation
 * (`tests/walk-forward-wire-signal.mjs`) found zero coverage on completed 2025 seasons and no
 * statistically or practically meaningful Brier/MAE improvement over the current ensemble on the
 * 2026 archived wire series. Returns zero counts without issuing ESPN roster reads, World feed
 * pulls, LLM classifications, or sports_world_pulls writes.
 * @param _pool - Unused; retained for call-site compatibility.
 * @param _sub - Unused; retained for call-site compatibility.
 * @returns Zero subject and new-item counts.
 */
async function refreshWorld(_pool, _sub) {
    return { subjects: 0, newItems: 0 };
}
/** The manifest's schedule (oshal-app.yaml `schedules:` refresh-pass) that fires a pass as the person who activated it. */
exports.REFRESH_SCHEDULE = Object.freeze({ app: 'sports-edge', name: 'refresh-pass', route: '/api/sports-edge/refresh/run' });
/** The last pass this process ran, for the status panel. Nothing here runs on its own. */
let lastRun = null;
let lastError = null;
let running = false;
/**
 * @description Current state of the scheduled refresh, for the status panel.
 * @returns The schedule that runs it, when this process last ran a pass, its last error, and whether one is running.
 */
function refreshStatus() {
    return { schedule: exports.REFRESH_SCHEDULE, lastRun, lastError, running };
}
/**
 * @description One full pass: grade what has finished, then rebuild previews for games starting
 * inside the horizon. Bounded by `MAX_PREVIEWS_PER_PASS` so a long follow list cannot turn one
 * pass into an unbounded crawl.
 * @param pool - Postgres pool.
 * @param sub - The person whose followed teams are previewed and named to World.
 * @returns Counts, for the log line.
 */
async function refreshPass(pool, sub, opts = {}) {
    const settings = { ...DEFAULTS, ...(await (0, sports_store_1.readSettings)(pool, sports_store_1.DEPLOYMENT_SCOPE)) };
    const now = opts.now ?? new Date();
    const clientOpts = opts.espnOpts ?? espn;
    // Capture FIRST. It is the cheapest thing in the pass and the only thing whose data cannot be
    // recovered if the pass later fails on something else.
    const lines = await captureLines(pool, { now, espnOpts: clientOpts });
    const graded = await gradeDue(pool, now);
    let previews = 0;
    // Only the caller's followed teams are previewed; this package never sweeps a whole board.
    const followedRows = await pool.query('SELECT DISTINCT league, team FROM sports_followed_teams WHERE user_sub = $1', [sub]);
    const byLeague = new Map();
    for (const r of followedRows.rows) {
        const league = r.league;
        if (!byLeague.has(league))
            byLeague.set(league, new Set());
        byLeague.get(league).add(r.team);
    }
    for (const [league, teams] of byLeague) {
        for (const game of await upcomingGames(league, settings.previewHorizonDays, clientOpts, now)) {
            if (previews >= MAX_PREVIEWS_PER_PASS)
                break;
            if (!teams.has(game.homeTeam) && !teams.has(game.awayTeam))
                continue;
            await buildAndRecord(pool, league, game);
            previews += 1;
        }
    }
    const world = await refreshWorld(pool, sub).catch((err) => {
        log.warn({ err }, 'world refresh failed');
        return { subjects: 0, newItems: 0 };
    });
    return { graded, previews, lines, world };
}
/**
 * Slack under the interval before a pass is due. The schedule fires on its cron and a pass is stamped
 * when it starts, so two fires exactly one interval apart can land a few seconds short of it; without
 * slack every second scheduled fire would answer not_due.
 */
const DUE_SLACK_MS = 10 * 60000;
/** @description The sports_settings scope that holds one person's last pass start. @param sub - Caller. @returns The key. */
function passKey(sub) {
    return `__refresh_pass__:${sub}`;
}
/** @description The deployment-wide sports_settings scope that holds the last line-capture poll start. */
function linePollKey() {
    return '__line_capture_poll__';
}
/**
 * @description When this person's last requested pass started, from the store (not this process, which
 * may not be the one that ran it).
 * @param pool - The request's Postgres pool.
 * @param sub - Caller.
 * @returns The ISO start of the last pass, or null when none is recorded.
 */
async function lastPassAt(pool, sub) {
    const stamp = (await (0, sports_store_1.readSettings)(pool, passKey(sub))).lastPassAt;
    return typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) ? stamp : null;
}
/**
 * @description When the last line-capture poll ran, from the store.
 * @param pool - The request's Postgres pool.
 * @returns The ISO start of the last line capture poll, or null when none is recorded.
 */
async function lastLinePollAt(pool) {
    const stamp = (await (0, sports_store_1.readSettings)(pool, linePollKey())).lastPollAt;
    return typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) ? stamp : null;
}
/**
 * @description Current adaptive line-capture cadence given the tracked upcoming games in storage.
 * @param pool - The request's Postgres pool.
 * @param slowMinutes - Slow cadence outside all open windows.
 * @param now - Current instant.
 * @returns Tight cadence, slow cadence, active cadence, and active open-window leagues.
 */
async function currentCaptureCadence(pool, slowMinutes = DEFAULTS.refreshIntervalMinutes, now = new Date()) {
    const slow = Math.max(30, Number(slowMinutes) || DEFAULTS.refreshIntervalMinutes);
    const [known, lastPoll] = await Promise.all([
        (0, sports_line_store_1.knownUpcomingGames)(pool, now).catch(() => []),
        lastLinePollAt(pool).catch(() => null),
    ]);
    const activeWindowLeagues = (0, open_windows_1.activeOpenWindowLeagues)(now, known);
    const currentMinutes = (0, open_windows_1.nextCaptureCadenceMinutes)(now, known, slow);
    return { tightMinutes: open_windows_1.TIGHT_CADENCE_MINUTES, slowMinutes: slow, currentMinutes, activeWindowLeagues, lastPollAt: lastPoll };
}
/**
 * @description Whether a pass is due for this person under the deployment's refresh interval.
 * @param last - The last pass start, or null.
 * @param intervalMinutes - The resolved refreshIntervalMinutes.
 * @param nowMs - Current epoch ms.
 * @returns null when due, else when it next will be.
 */
function nextDueAt(last, intervalMinutes, nowMs = Date.now()) {
    if (!last)
        return null;
    const due = Date.parse(last) + Math.max(30, Number(intervalMinutes) || DEFAULTS.refreshIntervalMinutes) * 60000 - DUE_SLACK_MS;
    return nowMs >= due ? null : new Date(due).toISOString();
}
/** Returns the earlier of two optional ISO timestamps. */
function earlierIso(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    return Date.parse(a) <= Date.parse(b) ? a : b;
}
/**
 * @description Run one refresh pass inside the caller's admitted request (POST /refresh/run, fired by
 * the `refresh-pass` 15-minute schedule). Enforces adaptive cadence:
 *   - Full pass (all-league capture, grading, followed-team previews) runs on refreshIntervalMinutes (180m).
 *   - Inside any league's expected open window, line capture alone polls every 15 minutes for the
 *     active-window leagues without rebuilding previews or grading.
 *   - Outside all open windows and inside the slow interval, answers not_due with zero ESPN reads.
 * @param pool - The request's Postgres pool.
 * @param sub - The caller, whose followed teams the pass covers.
 * @param opts - force (operator only, enforced by the route), plus optional test clock/client overrides.
 * @returns Whether a pass ran, its mode, adaptive cadence info, and counts.
 */
async function runRefreshPass(pool, sub, opts = {}) {
    if (running)
        return { ran: false, skipped: 'already_running' };
    running = true;
    try {
        await (0, sports_store_1.ensureSchema)(pool);
        await (0, sports_line_store_1.ensureLineSchema)(pool);
        const now = opts.now ?? new Date();
        const nowIso = now.toISOString();
        const settings = { ...DEFAULTS, ...(await (0, sports_store_1.readSettings)(pool, sports_store_1.DEPLOYMENT_SCOPE)) };
        if (!settings.refreshEnabled) {
            lastRun = nowIso;
            return { ran: false, skipped: 'refresh_disabled' };
        }
        const [last, lastPoll, known] = await Promise.all([
            lastPassAt(pool, sub), lastLinePollAt(pool), (0, sports_line_store_1.knownUpcomingGames)(pool, now).catch(() => []),
        ]);
        const activeWindowLeagues = (0, open_windows_1.activeOpenWindowLeagues)(now, known);
        const cadenceMinutes = (0, open_windows_1.nextCaptureCadenceMinutes)(now, known, settings.refreshIntervalMinutes);
        const fullNext = opts.force ? null : nextDueAt(last, settings.refreshIntervalMinutes, now.getTime());
        if (!fullNext) {
            await (0, sports_store_1.writeSettings)(pool, passKey(sub), { lastPassAt: nowIso });
            await (0, sports_store_1.writeSettings)(pool, linePollKey(), { lastPollAt: nowIso });
            const result = await refreshPass(pool, sub, { now, espnOpts: opts.espnOpts });
            lastRun = nowIso;
            lastError = null;
            log.info({ mode: 'full', cadenceMinutes, activeWindowLeagues, ...result }, 'refresh pass complete');
            return { ran: true, mode: 'full', cadenceMinutes, activeWindowLeagues, result };
        }
        const linePollDue = activeWindowLeagues.length > 0
            && (0, open_windows_1.shouldPollLinesNow)(now, lastPoll || last, known, settings.refreshIntervalMinutes);
        if (linePollDue) {
            await (0, sports_store_1.writeSettings)(pool, linePollKey(), { lastPollAt: nowIso });
            const lines = await captureLines(pool, { leagues: activeWindowLeagues, now, espnOpts: opts.espnOpts });
            const result = { graded: 0, previews: 0, lines, world: { subjects: 0, newItems: 0 } };
            lastRun = nowIso;
            lastError = null;
            log.info({ mode: 'line-capture', cadenceMinutes, activeWindowLeagues, lines }, 'open-window line capture complete');
            return { ran: true, mode: 'line-capture', cadenceMinutes, activeWindowLeagues, result };
        }
        const lineNext = activeWindowLeagues.length > 0
            ? (0, open_windows_1.nextLinePollDueAt)(now, lastPoll || last, known, settings.refreshIntervalMinutes) : null;
        return {
            ran: false, skipped: 'not_due', lastPassAt: last,
            nextDueAt: earlierIso(fullNext, lineNext) || fullNext, cadenceMinutes, activeWindowLeagues,
        };
    }
    catch (err) {
        lastError = err.message;
        log.error({ err }, 'refresh pass failed');
        throw err;
    }
    finally {
        running = false;
    }
}
