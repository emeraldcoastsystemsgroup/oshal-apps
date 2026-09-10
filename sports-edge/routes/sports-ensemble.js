"use strict";
/**
 * The ensemble — every model votes, the shadows only watch, and the market gets the last word.
 *
 * This is the sports twin of the trading engine's ALGORITHMS / SHADOW_ALGORITHMS split
 * (@/features/trading algorithms.ts, ADR-096). A model in `STRENGTH_MODELS` contributes to the
 * line we publish. A model in `SHADOW_MODELS` is computed and recorded on every game and
 * contributes NOTHING, so its record accumulates in the open where it can be compared before
 * anyone is tempted to promote it. Promotion is an operator decision backed by graded rows, never
 * a code change made because a model looked good in a backtest.
 *
 * TWO KINDS OF MODEL, COMBINED TWO DIFFERENT WAYS. This distinction is the one methodological
 * point in the file and getting it wrong quietly corrupts every number downstream:
 *
 *   - STRENGTH models (Elo, power ratings, unit matchup) are competing ESTIMATES OF THE SAME
 *     QUANTITY — how much better one team is. They are combined by weighted AVERAGE. Averaging is
 *     right because they are three views of one thing; adding them would triple-count team quality
 *     and produce lines twenty points off.
 *   - CONTEXT adjustments (availability, rest and travel) are SEPARATE EFFECTS that the strength
 *     models cannot see, because they describe this specific game rather than the team's season.
 *     They are ADDED. Averaging them in would dilute a starting quarterback's absence into
 *     nothing.
 *
 * WHY THE MARKET IS IN HERE AT ALL. `SHADOW_MODELS` includes a blend of our line with the market's
 * and the ESPN matchup predictor. Both exist to answer the only question that matters early on:
 * does this package add anything to a number anyone can get for free? If the blend beats us, the
 * honest conclusion is that our contribution is noise and the blend should be promoted. That
 * comparison is built in from the first game rather than discovered later.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — weighted strength ensemble plus additive context adjustments, non-voting shadow models incl. a market blend and the ESPN predictor baseline, and the straight-up / against-the-spread edge evaluation against a de-vigged market. A strength model with no data ABSTAINS and its weight is redistributed: found live in NFL Week 1, where power and units had no games, returned zero, and averaged a real Elo signal most of the way to nothing — a confident-looking preview that was pure home-field advantage.
 *
 * @module sports-ensemble
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRENGTH_WEIGHTS = void 0;
exports.buildLine = buildLine;
exports.evaluateEdges = evaluateEdges;
const sports_odds_1 = require("./sports-odds");
const sports_ratings_1 = require("./sports-ratings");
const sports_adjustments_1 = require("./sports-adjustments");
/** Relative weights of the strength models. They are normalised, so these are ratios not shares. */
exports.STRENGTH_WEIGHTS = { elo: 0.45, power: 0.35, units: 0.20 };
/**
 * @description Build our line for a game: average the strength models, add the context
 * adjustments, and convert the result to a win probability. Every contribution is returned
 * separately so the card can show WHY the number is what it is, which is what makes a bad pick
 * diagnosable after the fact.
 * @param g - Everything known about the scheduled game.
 * @returns The projected margin, the win probability, and each model's contribution.
 */
function buildLine(g) {
    const c = sports_ratings_1.LEAGUE_CONSTANTS[g.league];
    const hfa = g.neutralSite ? 0 : c.homeAdvantagePoints;
    const signals = strengthSignals(g, hfa);
    // Only models with data vote; the rest abstain and their weight is redistributed. Early in a
    // season this is usually Elo alone carrying the line, which is the honest answer.
    const voting = signals.filter((s) => s.available);
    const weighted = voting.reduce((sum, s) => sum + s.points * (exports.STRENGTH_WEIGHTS[s.model] || 0), 0);
    const weightSum = voting.reduce((sum, s) => sum + (exports.STRENGTH_WEIGHTS[s.model] || 0), 0);
    const strengthMargin = weightSum > 0 ? weighted / weightSum : hfa;
    const homeAvail = (0, sports_adjustments_1.availabilityImpact)(g.homeInjuries || [], g.league);
    const awayAvail = (0, sports_adjustments_1.availabilityImpact)(g.awayInjuries || [], g.league);
    const adjustments = [
        {
            model: 'availability',
            points: round2(homeAvail.points - awayAvail.points),
            available: true,
            basis: availabilityBasis(homeAvail, awayAvail),
        },
        {
            model: 'rest',
            points: round2((0, sports_adjustments_1.restImpact)(g.homeRest || { restDays: 7 }, g.league) - (0, sports_adjustments_1.restImpact)(g.awayRest || { restDays: 7 }, g.league)),
            available: true,
            basis: `${g.homeTeam} on ${g.homeRest?.restDays ?? 7}d rest, ${g.awayTeam} on ${g.awayRest?.restDays ?? 7}d`,
        },
    ];
    const projectedMargin = round2(strengthMargin + adjustments.reduce((s, a) => s + a.points, 0));
    const homeWinProbability = (0, sports_odds_1.winProbabilityFromMargin)(projectedMargin, g.league);
    return {
        projectedMargin,
        homeWinProbability,
        homeAdvantage: hfa,
        strengthMargin: round2(strengthMargin),
        signals,
        adjustments,
        shadow: shadowSignals(g, projectedMargin),
        availability: { home: homeAvail, away: awayAvail },
    };
}
/**
 * @description The three competing estimates of team strength, each expressed as points of home
 * margin so they can be averaged on one scale.
 * @param g - Game inputs.
 * @param hfa - Home advantage in points, already zeroed for neutral sites.
 * @returns One signal per strength model.
 */
function strengthSignals(g, hfa) {
    const c = sports_ratings_1.LEAGUE_CONSTANTS[g.league];
    const homeEloRow = g.elo[g.homeTeam];
    const awayEloRow = g.elo[g.awayTeam];
    const homeElo = homeEloRow?.elo ?? 1500;
    const awayElo = awayEloRow?.elo ?? 1500;
    const eloMargin = (0, sports_ratings_1.eloToMargin)(homeElo - awayElo + (hfa ? c.homeAdvantageElo : 0), g.league);
    const homePower = g.power[g.homeTeam];
    const awayPower = g.power[g.awayTeam];
    const homeUnits = g.units[g.homeTeam];
    const awayUnits = g.units[g.awayTeam];
    const match = (0, sports_adjustments_1.matchupEdge)(homeUnits, awayUnits);
    // A rating exists for a team only if it was seeded or it played; a POWER or UNIT rating needs
    // games, because both are averages. Absent either side, the model has nothing to say.
    const eloReady = Boolean(homeEloRow && awayEloRow);
    const powerReady = Boolean(homePower?.games && awayPower?.games);
    const unitsReady = Boolean(homeUnits?.games && awayUnits?.games);
    return [
        {
            model: 'elo',
            points: round2(eloMargin),
            available: eloReady,
            basis: eloReady
                ? `Elo ${Math.round(homeElo)} vs ${Math.round(awayElo)}${hfa ? ` +${c.homeAdvantageElo} home` : ' (neutral)'}`
                : 'no rating for one of these teams yet — abstaining',
        },
        {
            model: 'power',
            points: round2((homePower?.rating ?? 0) - (awayPower?.rating ?? 0) + hfa),
            available: powerReady,
            basis: powerReady
                ? `power ${homePower.rating.toFixed(1)} vs ${awayPower.rating.toFixed(1)}, schedule-adjusted`
                : 'no games played this season yet — abstaining rather than calling these teams even',
        },
        {
            model: 'units',
            points: round2(match.netHomeMargin + hfa),
            available: unitsReady,
            basis: unitsReady
                ? `${g.homeTeam} off ${signed(match.home.offenseVsDefense)} / def ${signed(match.home.defenseVsOffense)} vs ${g.awayTeam}`
                : 'no games played this season yet — abstaining rather than calling these teams even',
        },
    ];
}
/**
 * @description Models that are computed and recorded on every game but never affect the line. They
 * exist so their record accrues in the open; promoting one is an operator decision backed by
 * graded rows.
 * @param g - Game inputs.
 * @param ourMargin - The margin our voting ensemble produced.
 * @returns One signal per shadow model, omitting any whose inputs are unavailable.
 */
function shadowSignals(g, ourMargin) {
    const out = [];
    if (Number.isFinite(g.marketHomeSpread)) {
        // A book's spread is quoted from the home side: -3.5 means home is favoured by 3.5, so the
        // market's projected home margin is the NEGATIVE of the quoted number.
        const marketMargin = -g.marketHomeSpread;
        out.push({
            model: 'market-blend',
            points: round2((ourMargin + marketMargin) / 2),
            available: true,
            basis: `half our ${signed(ourMargin)} and the market's ${signed(marketMargin)}`,
        });
        out.push({ model: 'market-only', points: round2(marketMargin), available: true, basis: 'the closing-line baseline we have to beat' });
    }
    if (Number.isFinite(g.espnHomeWinPct)) {
        out.push({
            model: 'espn-predictor',
            points: NaN,
            available: true,
            basis: `ESPN projects ${g.espnHomeWinPct.toFixed(1)}% for ${g.homeTeam} — a free number this package must beat`,
        });
    }
    return out;
}
/** Renders the availability adjustment's reason, naming the players that drive it. */
function availabilityBasis(home, away) {
    const name = (i) => (i.keyLosses.length ? i.keyLosses.slice(0, 2).map((l) => `${l.player} (${l.position}, ${l.status})`).join(', ') : 'clean report');
    return `home: ${name(home)}; away: ${name(away)}`;
}
/** Formats a point value with an explicit sign, the way a line is written. */
function signed(n) { return `${n > 0 ? '+' : ''}${n.toFixed(1)}`; }
/** Rounds to two decimals so stored and displayed points agree exactly. */
function round2(n) { return Math.round(n * 100) / 100; }
/**
 * @description Compare our line to the market's prices and return every disagreement worth a bet,
 * for both the straight-up and against-the-spread markets. Only positive-expectation candidates
 * survive, and both sides of each market are tested so a model that likes the underdog is not
 * silently ignored.
 *
 * The stake returned here is arithmetic, NOT permission. The scorecard gate decides whether a
 * strategy has earned the right to stake anything at all; until it has, these numbers are a record
 * of what we would have done.
 * @param line - Our line for the game.
 * @param quote - The book's prices.
 * @param league - League whose margin dispersion applies.
 * @param minEdge - Minimum probability-point disagreement worth reporting.
 * @returns Candidates sorted by edge, largest first.
 */
function evaluateEdges(line, quote, league, minEdge = 0.02) {
    const out = [];
    const homeP = line.homeWinProbability;
    if (Number.isFinite(quote.homeMoneyline) && Number.isFinite(quote.awayMoneyline)) {
        const fair = (0, sports_odds_1.devigTwoWay)(quote.homeMoneyline, quote.awayMoneyline);
        push(out, 'moneyline', 'home', 'moneyline', homeP, fair.home, quote.homeMoneyline, minEdge);
        push(out, 'moneyline', 'away', 'moneyline', 1 - homeP, fair.away, quote.awayMoneyline, minEdge);
    }
    if (Number.isFinite(quote.homeSpread)) {
        const spread = quote.homeSpread;
        const homeOdds = quote.homeSpreadOdds ?? -110;
        const awayOdds = quote.awaySpreadOdds ?? -110;
        const fair = (0, sports_odds_1.devigTwoWay)(homeOdds, awayOdds);
        const coverP = (0, sports_odds_1.coverProbability)(line.projectedMargin, spread, league);
        push(out, 'spread', 'home', fmtSpread(spread), coverP, fair.home, homeOdds, minEdge);
        push(out, 'spread', 'away', fmtSpread(-spread), 1 - coverP, fair.away, awayOdds, minEdge);
    }
    return out.sort((a, b) => b.edge - a.edge);
}
/** Formats a spread the way a ticket reads it. */
function fmtSpread(n) { return `${n > 0 ? '+' : ''}${n}`; }
/**
 * @description Append a candidate when the model genuinely disagrees with the de-vigged market by
 * at least `minEdge` AND the price is positive-expectation. Both conditions are required: an edge
 * that vanishes into the vig is not a bet.
 */
function push(out, market, side, label, modelP, marketP, price, minEdge) {
    if (!Number.isFinite(modelP) || !Number.isFinite(marketP) || !Number.isFinite(price))
        return;
    const edge = modelP - marketP;
    if (edge < minEdge)
        return;
    const ev = (0, sports_odds_1.expectedValue)(modelP, price);
    if (!(ev > 0))
        return;
    out.push({
        market, side, selection: label,
        modelProbability: modelP, marketProbability: marketP,
        edge: Math.round(edge * 10000) / 10000,
        price, expectedValue: Math.round(ev * 10000) / 10000,
        kelly: Math.round((0, sports_odds_1.kellyFraction)(modelP, price) * 10000) / 10000,
    });
}
//# sourceMappingURL=sports-ensemble.js.map