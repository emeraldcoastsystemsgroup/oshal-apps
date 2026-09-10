"use strict";
/**
 * The game preview — the whole package in one object, for one game.
 *
 * This is what the operator actually asked for: "really know the game that's about to be played."
 * A preview is built bottom-up for a single fixture — both teams' season tape, both injury reports
 * weighted by what those players genuinely produce, rest and travel, the unit matchup, the wire —
 * folded into a line, and then measured against the book's price for a straight-up or
 * against-the-spread call.
 *
 * PRODUCTION-WEIGHTED INJURIES ARE THE EXPENSIVE PART, AND THEY ARE WORTH IT. For every player on
 * an injury report whose position has a meaningful counting stat, this module fetches that
 * player's season statistics and the team's totals in the same category, and divides. A receiver
 * with 31% of his team's receiving yards and a receiver with 4% stop costing the same number, and
 * the denominator is the team's real total rather than an assumed league-average team.
 *
 * The lookups are bounded — an injury report is a handful of players, not a roster — and they are
 * cached per (team, season) inside one build so a twelve-player report costs one team-totals read.
 * Positions with no box-score footprint, offensive line most of all, fall back to positional
 * leverage alone: an honest "we cannot measure this" beats a plausible invented number.
 *
 * WHAT A PREVIEW DELIBERATELY DOES NOT DO. It does not call an LLM. Every number here is a pure
 * function of public data, so the same inputs always produce the same line and a bad call can be
 * traced to a model rather than to a sentence. The wire headlines ride along for the reader; they
 * are displayed, never parsed into a secret adjustment.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — season ratings assembly with prior-season carry-over, production-weighted injury enrichment against real team totals, rest-day derivation from the schedule, and the assembled preview with its straight-up and against-the-spread candidates.
 *
 * @module sports-preview
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_GAMES_STANDALONE = void 0;
exports.buildSeasonRatings = buildSeasonRatings;
exports.enrichInjuries = enrichInjuries;
exports.restFrom = restFrom;
exports.buildPreview = buildPreview;
const sports_ratings_1 = require("./sports-ratings");
const sports_adjustments_1 = require("./sports-adjustments");
const sports_ensemble_1 = require("./sports-ensemble");
const sports_espn_1 = require("./sports-espn");
/**
 * Games a season must have before it can rate teams without help from the previous one. Below this
 * every rating is mostly noise, and a Week 1 line built on three games of tape would be presented
 * with a confidence it has not earned.
 */
exports.MIN_GAMES_STANDALONE = { nfl: 48, nba: 150, ncaaf: 250 };
/**
 * @description Build a league's rating tables for a season, seeding Elo from the prior season when
 * the current one is too young to stand alone. The carry-over is regressed toward the mean first,
 * because last season's rating describes a roster that has since turned over.
 * @param league - League to rate.
 * @param season - Season year.
 * @param opts - ESPN client options.
 * @returns The three rating tables plus how much tape they were fit on.
 */
async function buildSeasonRatings(league, season, opts = {}) {
    const games = await (0, sports_espn_1.leagueResults)(league, season, opts);
    let seed;
    let carriedOver = false;
    if (games.length < exports.MIN_GAMES_STANDALONE[league]) {
        const prior = await (0, sports_espn_1.leagueResults)(league, season - 1, opts);
        if (prior.length) {
            seed = (0, sports_ratings_1.carryOverElo)((0, sports_ratings_1.computeElo)(prior, league), league);
            carriedOver = true;
            opts.log?.('sports.ratings.carriedOver', { league, season, priorGames: prior.length, games: games.length });
        }
    }
    // The power and unit models have no carry-over equivalent — they are averages, and an average of
    // zero games is no rating at all. They therefore ABSTAIN from the ensemble until games exist
    // rather than reporting a zero that would read as "these teams are even"; the ensemble
    // renormalises over whatever actually has data. Early in a season that is Elo alone, carried over
    // from last year, which is the honest answer rather than a gap.
    return {
        league, season, games: games.length, carriedOver,
        elo: (0, sports_ratings_1.computeElo)(games, league, seed),
        power: (0, sports_ratings_1.computePowerRatings)(games, league),
        units: (0, sports_adjustments_1.computeUnitRatings)(games, league),
    };
}
/**
 * @description Attach each injured player's real share of his team's production, so the
 * availability model sizes a loss by what the player actually does rather than by his position
 * alone. Players whose position has no counting stat are returned untouched and fall back to
 * positional leverage.
 * @param league - League the team plays in.
 * @param teamId - ESPN team id, for the team totals denominator.
 * @param injuries - The team's injury report.
 * @param season - Season year whose statistics apply.
 * @param opts - ESPN client options.
 * @returns The same report with `productionShare` filled in where it could be measured.
 */
async function enrichInjuries(league, teamId, injuries, season, opts = {}) {
    const relevant = injuries.filter((i) => i.athleteId && (0, sports_espn_1.productionStatFor)(league, i.position));
    if (!relevant.length)
        return injuries;
    const teamTotals = await (0, sports_espn_1.teamSeasonStats)(league, teamId, season, opts);
    const out = [];
    for (const inj of injuries) {
        const stat = inj.athleteId ? (0, sports_espn_1.productionStatFor)(league, inj.position) : null;
        if (!stat) {
            out.push(inj);
            continue;
        }
        const denom = teamTotals[stat.teamStat];
        if (!denom || denom <= 0) {
            out.push(inj);
            continue;
        }
        const playerStats = await (0, sports_espn_1.athleteSeasonStats)(league, inj.athleteId, season, opts);
        const value = playerStats[stat.athleteStat];
        if (!Number.isFinite(value)) {
            out.push(inj);
            continue;
        }
        out.push({ ...inj, productionShare: Math.max(0, Math.min(1, value / denom)) });
    }
    return out;
}
/**
 * @description Days between a team's previous finished game and this one. Falls back to a normal
 * week when the schedule cannot say, which keeps the rest adjustment neutral rather than inventing
 * an advantage.
 * @param results - The team's finished games, any order.
 * @param gameDate - ISO date of the upcoming game.
 * @param league - League, whose normal turnaround is the fallback.
 * @returns Rest context for the adjustment model.
 */
function restFrom(results, gameDate, league) {
    const target = Date.parse(gameDate);
    const normal = league === 'nba' ? 2 : 7;
    if (!Number.isFinite(target))
        return { restDays: normal };
    let latest = -Infinity;
    for (const g of results) {
        const t = Date.parse(g.date);
        if (Number.isFinite(t) && t < target && t > latest)
            latest = t;
    }
    if (!Number.isFinite(latest))
        return { restDays: normal };
    return { restDays: Math.round((target - latest) / 86400000) };
}
/**
 * @description Build the full preview for one scheduled game. This is the function the poller and
 * the surface both call; everything else in the package either feeds it or records what it said.
 * @param game - The scheduled game, with whatever prices the scoreboard carried.
 * @param ratings - The league's cached season ratings.
 * @param tapes - Each side's finished games, keyed by team abbreviation, for rest days.
 * @param season - Season year whose statistics apply.
 * @param opts - ESPN client options.
 * @returns The assembled preview.
 */
async function buildPreview(game, ratings, tapes, season, opts = {}) {
    const summary = await (0, sports_espn_1.gameSummary)(ratings.league, game.eventId, opts);
    const rawHome = summary?.injuries?.[game.homeTeam] || [];
    const rawAway = summary?.injuries?.[game.awayTeam] || [];
    const homeInjuries = await enrichInjuries(ratings.league, game.homeTeamId, rawHome, season, opts);
    const awayInjuries = await enrichInjuries(ratings.league, game.awayTeamId, rawAway, season, opts);
    const homeRest = restFrom(tapes[game.homeTeam]?.results || [], game.date, ratings.league);
    const awayRest = restFrom(tapes[game.awayTeam]?.results || [], game.date, ratings.league);
    // The summary's price is the fresher of the two — the scoreboard's block can lag a line move.
    const quote = { ...game.quote, ...(summary?.quote || {}) };
    const line = (0, sports_ensemble_1.buildLine)({
        league: ratings.league, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
        neutralSite: game.neutralSite, elo: ratings.elo, power: ratings.power, units: ratings.units,
        homeInjuries, awayInjuries, homeRest, awayRest,
        marketHomeSpread: quote.homeSpread, espnHomeWinPct: summary?.espnHomeWinPct,
    });
    return {
        eventId: game.eventId, league: ratings.league, date: game.date, name: game.name,
        homeTeam: game.homeTeam, awayTeam: game.awayTeam, venue: game.venue, neutralSite: game.neutralSite,
        line, quote,
        edges: (0, sports_ensemble_1.evaluateEdges)(line, quote, ratings.league),
        context: {
            ats: summary?.ats || {}, form: summary?.form || {}, news: summary?.news || [],
            restDays: { home: homeRest.restDays, away: awayRest.restDays },
            espnHomeWinPct: summary?.espnHomeWinPct,
        },
        ratings: {
            [game.homeTeam]: ratingsFor(ratings, game.homeTeam),
            [game.awayTeam]: ratingsFor(ratings, game.awayTeam),
        },
        carriedOver: ratings.carriedOver,
        generatedAt: new Date().toISOString(),
    };
}
/** Collects one team's four headline ratings for the card header. */
function ratingsFor(r, team) {
    return {
        elo: Math.round(r.elo[team]?.elo ?? 1500),
        power: r.power[team]?.rating ?? 0,
        offense: r.units[team]?.offense ?? 0,
        defense: r.units[team]?.defense ?? 0,
    };
}
//# sourceMappingURL=sports-preview.js.map