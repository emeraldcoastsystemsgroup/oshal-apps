"use strict";
/**
 * Team ratings — Elo and opponent-adjusted power ratings, computed from actual results.
 *
 * These are the two ratings that carry the ensemble. Both are pure functions of a list of finished
 * games, so a rating is always reproducible from the tape and never from a cached opinion.
 *
 * ELO is the well-tested one. A team starts at 1500, and every game moves the two teams by the
 * same amount in opposite directions, scaled by how surprising the result was. Two departures from
 * textbook Elo matter here and both are standard for sport:
 *   - MARGIN OF VICTORY. A one-point win is weak evidence and a thirty-point win is strong
 *     evidence, so the update is multiplied by a log of the margin. The multiplier is damped by
 *     the winner's pre-game rating edge, which is what stops good teams from inflating forever by
 *     running up the score on bad ones (the autocorrelation correction).
 *   - SEASON CARRY-OVER. Rosters, coaches and schemes turn over, so last season's rating is
 *     regressed a third of the way back to average before the new season starts. Without this, a
 *     Week 1 rating is a claim about a team that no longer exists.
 *
 * POWER RATINGS are a Simple Rating System: a team's rating is its average scoring margin plus the
 * average rating of the opponents it played. That is circular by construction, so it is solved by
 * iteration to a fixed point. It answers a different question from Elo — Elo is recency-weighted
 * and cares about sequence, SRS weights the whole season equally and cares about schedule strength
 * — which is exactly why both are in the ensemble instead of one.
 *
 * MARGINS ARE CAPPED. A 45-point blowout is not three times the evidence of a 15-point win; it is
 * mostly garbage time. Both models cap the margin they learn from (`MARGIN_CAP`), which is the
 * cheapest known defence against a single fluke result dominating a short season.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — MOV-adjusted Elo with autocorrelation damping and season carry-over regression, iterative SRS power ratings, and the league constants that convert a rating gap into points and a win probability. A seed materialises into the table before any game is read: teams were previously discovered only from the games, so a seeded call with an empty tape silently discarded every carried-over rating and sat the whole league at 1500.
 *
 * @module sports-ratings
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASE_ELO = exports.LEAGUE_CONSTANTS = void 0;
exports.eloExpectation = eloExpectation;
exports.movMultiplier = movMultiplier;
exports.computeElo = computeElo;
exports.carryOverElo = carryOverElo;
exports.computePowerRatings = computePowerRatings;
exports.eloToMargin = eloToMargin;
/**
 * League constants for Elo and power ratings.
 *
 * The NFL numbers are the long-published FiveThirtyEight set (K=20, 65 Elo of home field before it
 * was trimmed post-2020, 25 Elo per point, one-third offseason regression); home field is set to 55
 * because measured NFL home advantage has fallen to roughly 1.8-2.2 points in the 2020s and 65 is
 * now stale. The NBA set is the same family: 100 Elo of home court, 28 Elo per point, and a
 * shallower carry-over because NBA rosters are more stable year to year than NFL rosters.
 */
exports.LEAGUE_CONSTANTS = {
    nfl: { homeAdvantageElo: 55, kFactor: 20, eloPerPoint: 25, seasonRegression: 1 / 3, marginCap: 28, homeAdvantagePoints: 2.2 },
    nba: { homeAdvantageElo: 100, kFactor: 20, eloPerPoint: 28, seasonRegression: 0.25, marginCap: 25, homeAdvantagePoints: 2.9 },
    // College football. These differ from the NFL set for reasons specific to the sport, and every
    // one of them is a STARTING POINT validated by the walk-forward harness, not a published
    // constant lifted from somewhere:
    //   - a shorter season (12-13 games) means each result must move a rating further, so K is higher;
    //   - margins are far wider, so fewer Elo points buy a point of spread and the blowout cap is
    //     higher — a 45-point win over a directional school is routine, not evidence of dominance;
    //   - rosters turn over harder than any professional league (graduation plus the transfer
    //     portal), so more of last season is regressed away before the new one starts.
    ncaaf: { homeAdvantageElo: 65, kFactor: 24, eloPerPoint: 20, seasonRegression: 0.40, marginCap: 38, homeAdvantagePoints: 2.5 },
};
/** The rating every team starts from, and the mean that carry-over regresses toward. */
exports.BASE_ELO = 1500;
/**
 * @description Expected score (0..1) for a rating difference, the Elo logistic. A 400-point edge
 * means winning 10 times as often as losing.
 * @param eloDiff - Rating of the side in question minus its opponent's, home advantage included.
 * @returns Expected result in (0, 1).
 */
function eloExpectation(eloDiff) {
    return 1 / (1 + Math.pow(10, -eloDiff / 400));
}
/**
 * @description The margin-of-victory multiplier that scales an Elo update. Grows with the log of
 * the margin so blowouts count more but not proportionally, and shrinks as the winner's pre-game
 * edge grows so a strong favourite gains little from beating a weak opponent badly. This second
 * term is the autocorrelation correction; without it ratings drift upward without bound.
 * @param margin - Absolute scoring margin, already capped by the caller.
 * @param winnerEloEdge - Winner's pre-game Elo minus loser's, home advantage included.
 * @returns Multiplier applied to the K-factor.
 */
function movMultiplier(margin, winnerEloEdge) {
    return Math.log(Math.abs(margin) + 1) * (2.2 / (winnerEloEdge * 0.001 + 2.2));
}
/**
 * @description Run Elo over a chronological list of finished games. Teams are discovered from the
 * games themselves, each starting at `BASE_ELO`, so a caller never has to seed a roster of teams.
 * Games are sorted by date defensively — an out-of-order tape would otherwise silently produce a
 * different rating than the same games in sequence.
 * @param games - Finished games. Unfinished or malformed rows should be filtered out first.
 * @param league - League whose constants apply.
 * @param seed - Optional starting ratings, e.g. last season's carried over.
 * @returns Final rating per team, keyed by abbreviation.
 */
function computeElo(games, league, seed) {
    const c = exports.LEAGUE_CONSTANTS[league];
    const table = {};
    // Materialise the seed FIRST. Teams are otherwise discovered from the games themselves, which
    // means a seeded call with an empty tape — exactly the Week 1 case, where last season's carry-over
    // is the only signal that exists — would return an empty table and silently discard every rating
    // it was handed. The symptom is not an error: it is a whole league sitting at 1500 and a line
    // built from nothing but home-field advantage.
    for (const [team, elo] of Object.entries(seed || {}))
        table[team] = { team, elo, games: 0 };
    const get = (team) => {
        if (!table[team])
            table[team] = { team, elo: seed?.[team] ?? exports.BASE_ELO, games: 0 };
        return table[team];
    };
    const ordered = [...games].sort((a, b) => a.date.localeCompare(b.date));
    for (const g of ordered) {
        const home = get(g.homeTeam);
        const away = get(g.awayTeam);
        const hfa = g.neutralSite ? 0 : c.homeAdvantageElo;
        const diff = home.elo + hfa - away.elo;
        const expected = eloExpectation(diff);
        const margin = g.homeScore - g.awayScore;
        const actual = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
        const capped = Math.min(Math.abs(margin), c.marginCap);
        // The winner's edge; on a draw there is no winner so the damping term is taken as neutral.
        const winnerEdge = margin > 0 ? diff : margin < 0 ? -diff : 0;
        const shift = c.kFactor * movMultiplier(capped, winnerEdge) * (actual - expected);
        home.elo += shift;
        away.elo -= shift;
        home.games += 1;
        away.games += 1;
    }
    return table;
}
/**
 * @description Regress a set of ratings toward the mean for a new season. Roster and staff turnover
 * makes last season's rating a claim about a team that no longer exists; this is what makes a Week
 * 1 number honest rather than stale.
 * @param ratings - End-of-season ratings.
 * @param league - League whose regression fraction applies.
 * @returns New starting Elo per team.
 */
function carryOverElo(ratings, league) {
    const r = exports.LEAGUE_CONSTANTS[league].seasonRegression;
    const out = {};
    for (const [team, rating] of Object.entries(ratings)) {
        out[team] = rating.elo + (exports.BASE_ELO - rating.elo) * r;
    }
    return out;
}
/**
 * @description Opponent-adjusted power ratings by iterating a Simple Rating System to a fixed
 * point: rating = average capped margin + average opponent rating. Twenty passes is far past
 * convergence for a season-sized schedule; the loop exits early once no rating moves.
 *
 * Home advantage is removed from each result before it is averaged, so a team that played nine
 * home games is not credited with the points its venue gave it.
 * @param games - Finished games.
 * @param league - League whose constants apply.
 * @returns Power rating per team, keyed by abbreviation.
 */
function computePowerRatings(games, league) {
    const c = exports.LEAGUE_CONSTANTS[league];
    const margins = {};
    const opponents = {};
    const cap = (m) => Math.max(-c.marginCap, Math.min(c.marginCap, m));
    for (const g of games) {
        const hfa = g.neutralSite ? 0 : c.homeAdvantagePoints;
        const homeMargin = cap(g.homeScore - g.awayScore - hfa);
        (margins[g.homeTeam] ||= []).push(homeMargin);
        (margins[g.awayTeam] ||= []).push(-homeMargin);
        (opponents[g.homeTeam] ||= []).push(g.awayTeam);
        (opponents[g.awayTeam] ||= []).push(g.homeTeam);
    }
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const ratings = {};
    const raw = {};
    for (const team of Object.keys(margins)) {
        raw[team] = mean(margins[team]);
        ratings[team] = raw[team];
    }
    for (let pass = 0; pass < 20; pass += 1) {
        let moved = 0;
        const next = {};
        for (const team of Object.keys(ratings)) {
            const sos = mean((opponents[team] || []).map((o) => ratings[o] ?? 0));
            next[team] = raw[team] + sos;
            moved = Math.max(moved, Math.abs(next[team] - ratings[team]));
        }
        Object.assign(ratings, next);
        if (moved < 1e-6)
            break;
    }
    const out = {};
    for (const team of Object.keys(ratings)) {
        out[team] = { team, rating: ratings[team], rawMargin: raw[team], games: margins[team].length };
    }
    return out;
}
/**
 * @description Convert an Elo gap into an expected point margin, which is how a rating becomes a
 * line that can be compared to a spread.
 * @param eloDiff - Home Elo plus home advantage, minus away Elo.
 * @param league - League whose points-per-Elo conversion applies.
 * @returns Expected home margin in points.
 */
function eloToMargin(eloDiff, league) {
    return eloDiff / exports.LEAGUE_CONSTANTS[league].eloPerPoint;
}
//# sourceMappingURL=sports-ratings.js.map