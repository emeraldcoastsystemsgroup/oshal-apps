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
 *
 * @module sports-refresh
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentSeason = currentSeason;
exports.refreshRatings = refreshRatings;
exports.getRatings = getRatings;
exports.upcomingGames = upcomingGames;
exports.followedGames = followedGames;
exports.previewFor = previewFor;
exports.ensembleMayStake = ensembleMayStake;
exports.gradeDue = gradeDue;
exports.captureLines = captureLines;
exports.refreshWorld = refreshWorld;
exports.refreshStatus = refreshStatus;
exports.refreshPass = refreshPass;
exports.startSportsRefresh = startSportsRefresh;
const logger_1 = require("@/shared/logger");
const world_data_1 = require("@/features/world-data");
const sports_preview_1 = require("./sports-preview");
const sports_ledger_1 = require("./sports-ledger");
const sports_espn_1 = require("./sports-espn");
const sports_store_1 = require("./sports-store");
const sports_line_store_1 = require("./sports-line-store");
const sports_world_1 = require("./sports-world");
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
/** Bounds on how much work one refresh pass will do, so a wide follow list cannot run unbounded. */
const MAX_PREVIEWS_PER_PASS = 40;
/** Leagues whose lines are captured every pass. Capture is one scoreboard call per league. */
const CAPTURE_LEAGUES = ['nfl', 'nba', 'ncaaf'];
/** How far ahead to capture lines. Wider than the preview horizon on purpose — see captureLines. */
const CAPTURE_HORIZON_DAYS = 21;
/**
 * Hours between World pulls of the same subject.
 *
 * Six matches the shared layer's own depth refresh, which is not a coincidence: pulling a team more
 * often than the archive is refreshed buys nothing but classification cost. The injury wire is the
 * one thing that genuinely moves faster, and it gets the same cool-down anyway — a pass runs every
 * three hours, so a scratched starter is picked up within a cycle of the news breaking.
 */
const WORLD_COOLDOWN_HOURS = 6;
/**
 * Subjects pulled per pass. The cap is what keeps a long follow list from turning the loop into a
 * feed crawler: the pass also has lines to capture and settled calls to grade, and those have
 * deadlines that news coverage does not.
 */
const MAX_WORLD_SUBJECTS_PER_PASS = 12;
/** Items per feed variant. Matches the World route's own default. */
const WORLD_ITEM_LIMIT = 15;
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
 * @description Every scheduled game in a league within the horizon. One request per league covers
 * the whole window, because the scoreboard accepts a date range.
 * @param league - League to list.
 * @param days - How far ahead to look.
 * @param opts - ESPN options; pass a tracked set to learn whether the read actually succeeded.
 * @returns Scheduled games with whatever prices the scoreboard carried.
 */
async function upcomingGames(league, days, opts = espn) {
    const from = new Date();
    const to = new Date(from.getTime() + days * 86400000);
    const stamp = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const games = await (0, sports_espn_1.scoreboard)(league, opts, `${stamp(from)}-${stamp(to)}`);
    return games.filter((g) => Date.parse(g.date) >= from.getTime() - 6 * 3600000);
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
 * @description Capture the current line for every upcoming game in every league, whether or not
 * anyone follows the teams.
 *
 * PREVIEWS ARE SELECTIVE; CAPTURE IS NOT, and the asymmetry is deliberate. A preview costs several
 * external reads per game, so it is built only for followed teams. Capture costs ONE scoreboard
 * call per league for the entire slate — and the data it collects cannot be backfilled. Skipping a
 * game because nobody follows it today means that when someone follows that team next week, its
 * opener is already gone forever. So capture takes the whole board, and the horizon is wider than
 * the preview horizon for the same reason: lines post well before anyone is looking at the game.
 * @param pool - Postgres pool.
 * @returns Counts by outcome, for the log line.
 */
async function captureLines(pool) {
    const tally = { 'no-price': 0, unchanged: 0, 'first-capture': 0, moved: 0, games: 0 };
    for (const league of CAPTURE_LEAGUES) {
        for (const game of await upcomingGames(league, CAPTURE_HORIZON_DAYS, espn)) {
            tally.games += 1;
            try {
                const result = await (0, sports_line_store_1.captureQuote)(pool, {
                    league,
                    eventId: game.eventId,
                    gameDate: game.date || null,
                    homeTeam: game.homeTeam,
                    awayTeam: game.awayTeam,
                }, game.quote);
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
/** @description Find conflicting stored ESPN IDs without choosing whichever owner's row happened to arrive first.
 * @param rows Followed rows from the existing deployment-wide public archive query.
 * @returns Subject IDs for which coach discovery must wait for a consistent team selection.
 */
function conflictingCoachTeams(rows) {
    const ids = new Map();
    for (const row of rows) {
        const entity = (0, sports_world_1.teamEntityId)(row.league, row.team);
        if (!ids.has(entity))
            ids.set(entity, new Set());
        ids.get(entity).add(String(row.team_id));
    }
    return new Set([...ids].filter(([, values]) => values.size > 1).map(([entity]) => entity));
}
/**
 * @description Pull this deployment's followed teams — and the games they are about to play —
 * through the shared World Intelligence layer.
 *
 * THIS PACKAGE DOES NOT READ FEEDS. It names subjects and hands them over, which is the operator's
 * standard and the reason it is worth the indirection: World fetches once, dedupes by content hash,
 * classifies against one rubric, and stores a time series every other application can read. A
 * second news reader in here would pull the same wire a second time, classify it a second time, and
 * produce a second answer nobody could reconcile with the first.
 *
 * The whole thing is a NO-OP when the layer is switched off (ENABLE_WORLD_INTELLIGENCE, TSDB_URL,
 * ARANGO_URL) — a deployment without it keeps a working odds maker, just without the wires.
 * @param pool - Postgres pool.
 * @param lastPulled - Persistent subject timestamps shared with the ingest pass.
 * @returns Followed team, injury and known-coach subjects within the pass budget.
 */
async function followedWorldSubjects(pool, lastPulled) {
    const followed = await pool.query('SELECT DISTINCT league, team, team_id, display_name FROM sports_followed_teams ORDER BY league, team, team_id, display_name');
    const subjects = [];
    const seen = new Set();
    const conflicts = conflictingCoachTeams(followed.rows);
    for (const row of followed.rows) {
        const team = (0, sports_world_1.teamSubjects)({
            league: row.league,
            team: String(row.team),
            displayName: row.display_name ? String(row.display_name) : null,
        });
        if (seen.has(team[0].entity))
            continue;
        seen.add(team[0].entity);
        // Keep a whole team/injury/coach group together; slicing away only its coach could starve it.
        if ((0, sports_world_1.dueSubjects)(subjects, lastPulled, WORLD_COOLDOWN_HOURS).length > MAX_WORLD_SUBJECTS_PER_PASS - 3)
            break;
        subjects.push(...team);
        if (!(0, sports_world_1.dueSubjects)([team[0]], lastPulled, WORLD_COOLDOWN_HOURS).length)
            continue;
        if (conflicts.has(team[0].entity)) {
            log.warn({ entity: team[0].entity }, 'Conflicting followed ESPN team IDs; coach discovery skipped');
            continue;
        }
        const current = await (0, sports_espn_1.teamHeadCoach)(row.league, String(row.team_id ?? ''), String(row.team), espn);
        const coach = current ? (0, sports_world_1.coachSubject)(current.name, current.teamName, row.league) : null;
        if (coach)
            subjects.push(coach);
    }
    return subjects;
}
/** @description Ingest deployment-public sports subjects through the existing shared World service.
 * @param pool Current deployment database pool. @returns Actual subject and new-item counts.
 */
async function refreshWorld(pool) {
    const svc = (0, world_data_1.createWorldIntelligenceService)();
    if (!svc)
        return { subjects: 0, newItems: 0 };
    const lastPulled = await (0, sports_store_1.worldPullTimes)(pool);
    const subjects = await followedWorldSubjects(pool, lastPulled);
    // The matchup subjects come from previews already built this pass, so a game nobody follows never
    // gets a subject — the same team-first discipline the rest of the package is built on.
    const upcoming = await pool.query(`SELECT league, event_id, home_team, away_team FROM sports_previews
     WHERE game_date > now() AND game_date < now() + interval '8 days'`);
    for (const row of upcoming.rows) {
        subjects.push((0, sports_world_1.matchupSubject)(row.league, String(row.event_id), String(row.home_team), String(row.away_team)));
    }
    const due = (0, sports_world_1.dueSubjects)((0, sports_world_1.dedupeSubjects)(subjects), lastPulled, WORLD_COOLDOWN_HOURS)
        .slice(0, MAX_WORLD_SUBJECTS_PER_PASS);
    const ingest = (query, entity, label, sources, opts) => (0, world_data_1.ingestFeeds)(svc, query, entity, label, sources, opts);
    let newItems = 0;
    for (const subject of due) {
        const result = await (0, sports_world_1.ingestSubject)(ingest, subject, WORLD_ITEM_LIMIT);
        newItems += result.newItems;
        if (result.error)
            log.warn({ entity: subject.entity, err: result.error }, 'world subject ingest failed');
        await (0, sports_store_1.recordWorldPull)(pool, subject, result);
    }
    if (due.length)
        log.info({ subjects: due.length, newItems, feeds: sports_world_1.SPORTS_FEED_IDS.length }, 'world subjects refreshed');
    return { subjects: due.length, newItems };
}
/** Module-level loop state, so a package reload cannot start a second timer. */
let timer = null;
let lastRun = null;
let lastError = null;
let running = false;
/**
 * @description Current state of the background loop, for the status panel.
 * @returns Whether the loop is armed, when it last ran, and its last error.
 */
function refreshStatus() {
    return { armed: timer !== null, lastRun, lastError, running };
}
/**
 * @description One full pass: grade what has finished, then rebuild previews for games starting
 * inside the horizon. Bounded by `MAX_PREVIEWS_PER_PASS` so a long follow list cannot turn one
 * pass into an unbounded crawl.
 * @param pool - Postgres pool.
 * @returns Counts, for the log line.
 */
async function refreshPass(pool) {
    const settings = { ...DEFAULTS, ...(await (0, sports_store_1.readSettings)(pool, sports_store_1.DEPLOYMENT_SCOPE)) };
    // Capture FIRST. It is the cheapest thing in the pass and the only thing whose data cannot be
    // recovered if the pass later fails on something else.
    const lines = await captureLines(pool);
    const graded = await gradeDue(pool);
    let previews = 0;
    // Only games someone follows are previewed; this package never sweeps a whole board.
    const followedRows = await pool.query('SELECT DISTINCT league, team FROM sports_followed_teams');
    const byLeague = new Map();
    for (const r of followedRows.rows) {
        const league = r.league;
        if (!byLeague.has(league))
            byLeague.set(league, new Set());
        byLeague.get(league).add(r.team);
    }
    for (const [league, teams] of byLeague) {
        for (const game of await upcomingGames(league, settings.previewHorizonDays, espn)) {
            if (previews >= MAX_PREVIEWS_PER_PASS)
                break;
            if (!teams.has(game.homeTeam) && !teams.has(game.awayTeam))
                continue;
            await buildAndRecord(pool, league, game);
            previews += 1;
        }
    }
    // Last in the pass, and deliberately so: it is the only step whose work can be caught up later.
    // A missed line capture is gone forever and an ungraded call is evidence not yet recorded, but a
    // news pull deferred by three hours is a news pull three hours late.
    const world = await refreshWorld(pool).catch((err) => {
        log.warn({ err }, 'world refresh failed');
        return { subjects: 0, newItems: 0 };
    });
    return { graded, previews, lines, world };
}
/**
 * @description Start the background loop. Idempotent per process — a package reload re-invokes the
 * route factory, and a second timer would double every external read.
 * @param ctx - App context supplying the pool.
 * @returns Nothing.
 */
function startSportsRefresh(ctx) {
    if (timer)
        return;
    const pool = ctx.pool;
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            await (0, sports_store_1.ensureSchema)(pool);
            await (0, sports_line_store_1.ensureLineSchema)(pool);
            const settings = { ...DEFAULTS, ...(await (0, sports_store_1.readSettings)(pool, sports_store_1.DEPLOYMENT_SCOPE)) };
            if (!settings.refreshEnabled) {
                lastRun = new Date().toISOString();
                return;
            }
            const result = await refreshPass(pool);
            lastRun = new Date().toISOString();
            lastError = null;
            log.info({ ...result }, 'refresh pass complete');
        }
        catch (err) {
            lastError = err.message;
            log.error({ err }, 'refresh pass failed');
        }
        finally {
            running = false;
        }
    };
    // A first pass shortly after start, so a freshly deployed box is warm without waiting a cadence.
    setTimeout(() => { void tick(); }, 45000).unref?.();
    timer = setInterval(() => { void tick(); }, DEFAULTS.refreshIntervalMinutes * 60000);
    timer.unref?.();
    log.info({ intervalMinutes: DEFAULTS.refreshIntervalMinutes }, 'sports-edge refresh loop armed');
}
//# sourceMappingURL=sports-refresh.js.map