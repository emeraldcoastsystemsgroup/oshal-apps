"use strict";
/**
 * The public projection feed, per person — fetched once however many people ask, cached in each
 * caller's own rows, and read back week by week for the season plan.
 *
 * The feed is public (no credential) and identical for everybody, but ownership here is per person
 * (ADR-146 Q2), so the durable cache is each caller's own ff_projections rows; only the in-flight
 * fetch is shared, and nothing is retained after it settles. ESPN returns ~39MB per read and ignores
 * the filter's limit, so a caller's cache is refreshed at most every few hours and never per click.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the per-person projection cache and the shared in-flight fetch moved out of fantasy-routes.ts so the lineup and the management routes share them, plus the cached-weeks read the season plan is built from and the season defaults.
 *
 * @module fantasy-feed
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentNflSeason = currentNflSeason;
exports.seasonOf = seasonOf;
exports.projectionsFor = projectionsFor;
exports.seasonFeeds = seasonFeeds;
const logger_1 = require("@/shared/logger");
const fantasy_leagues_1 = require("@/features/fantasy-leagues");
const fantasy_context_1 = require("./fantasy-context");
const fantasy_store_1 = require("./fantasy-store");
const log = (0, logger_1.createChildLogger)({ module: 'fantasy-football-feed' });
/** Hours before a person's cached projection feed is considered stale enough to refetch. */
const PROJECTION_MAX_AGE_HOURS = 6;
/** In-flight public feed fetches, keyed by season and week, shared across callers while in flight. */
const inflight = new Map();
/**
 * @description The NFL season ESPN keys fantasy by: the year the season STARTS, so January's
 * playoffs still belong to the previous year's season.
 * @param now - Instant to resolve as of.
 * @returns The season year.
 */
function currentNflSeason(now = new Date()) {
    return now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
/**
 * @description Parse a season, defaulting to the current NFL season.
 * @param value - Raw input.
 * @returns A season year.
 */
function seasonOf(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 2000 && n < 2100 ? n : currentNflSeason();
}
/**
 * @description The public feed for one week, fetched once however many people ask at the same time.
 * @param season - Season year.
 * @param week - Scoring period.
 * @returns The distilled feed.
 */
function sharedFeedFetch(season, week) {
    const key = `${season}:${week}`;
    let pending = inflight.get(key);
    if (!pending) {
        pending = (0, fantasy_leagues_1.fetchProjections)(season, week, fantasy_context_1.espn).finally(() => { inflight.delete(key); });
        inflight.set(key, pending);
    }
    return pending;
}
/**
 * @description Read the caller's cached projection feed, refreshing it when missing or stale. A
 * stale cache still beats nothing when ESPN is down, and the response says how old it is.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @param week - Scoring period.
 * @returns Players keyed by id (possibly empty when ESPN is unreachable) and the cache age.
 */
async function projectionsFor(pool, sub, season, week) {
    const cached = await (0, fantasy_store_1.readProjections)(pool, sub, season, week);
    const ageHours = cached ? (Date.now() - Date.parse(cached.generatedAt)) / 3600000 : Infinity;
    if (cached && ageHours < PROJECTION_MAX_AGE_HOURS) {
        return { players: cached.players, generatedAt: cached.generatedAt };
    }
    try {
        const started = Date.now();
        const { players, weeks } = await sharedFeedFetch(season, week);
        if (Object.keys(players).length)
            await (0, fantasy_store_1.writeProjections)(pool, sub, season, week, players, Date.now() - started);
        // The completed weeks came back in the SAME response, so accumulating them costs no extra read.
        const stored = weeks.length ? await (0, fantasy_store_1.writePlayerWeeks)(pool, sub, season, weeks) : 0;
        log.info({ season, week, players: Object.keys(players).length, playerWeeks: stored, ms: Date.now() - started }, 'projection feed refreshed');
    }
    catch (err) {
        log.error({ err, season, week }, 'projection refresh failed');
    }
    const use = (await (0, fantasy_store_1.readProjections)(pool, sub, season, week)) || cached;
    return { players: (use?.players || {}), generatedAt: use?.generatedAt || null };
}
/**
 * @description The caller's cached feeds for a range of weeks, current week refreshed first, for
 * the season plan. Weeks never read are simply absent — the plan prices them from a rate and says so.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @param currentWeek - The current week (refreshed when stale).
 * @param lastWeek - The last week of the plan.
 * @returns Feeds keyed by week, and the current week's cache age.
 */
async function seasonFeeds(pool, sub, season, currentWeek, lastWeek) {
    const current = await projectionsFor(pool, sub, season, currentWeek);
    const feeds = new Map();
    for (const [week, players] of await (0, fantasy_store_1.readProjectionWeeks)(pool, sub, season, Math.max(1, currentWeek - 1), lastWeek)) {
        feeds.set(week, players);
    }
    feeds.set(currentWeek, current.players);
    return { feeds, generatedAt: current.generatedAt };
}
//# sourceMappingURL=fantasy-feed.js.map