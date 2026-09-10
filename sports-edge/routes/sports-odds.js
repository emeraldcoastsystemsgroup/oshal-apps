"use strict";
/**
 * Sports odds math — the conversions between a betting market's language and a probability.
 *
 * Every number this package produces eventually has to be compared against a price, and a price at
 * a sportsbook is quoted in American odds with the vig baked in. A -150 favorite does NOT imply a
 * 60% chance; it implies 60% BEFORE you remove the book's margin, and the book's margin is exactly
 * the reason a naive "our model says 58%, the book says 60%, no bet" comparison is wrong in the
 * other direction too. This module is the only place that arithmetic lives.
 *
 * WHAT THE MARKET ACTUALLY SAYS. A two-way market's raw implied probabilities sum to more than 1
 * (the overround). `devigTwoWay` removes it proportionally, which is the standard and the most
 * conservative of the common methods — it does not assume favourite-longshot bias the way the
 * power or Shin methods do, so it never manufactures edge on the longshot side out of a modelling
 * choice. The de-vigged pair is the market's honest forecast, and it is the ONLY thing our model
 * is allowed to be scored against.
 *
 * WHY A COVER PROBABILITY IS NOT A WIN PROBABILITY. Straight-up and against-the-spread are
 * different bets with different distributions. We model a game's margin as normal around our
 * projected margin; P(win) is the mass above 0 and P(cover) is the mass above the spread. The
 * standard deviations are league constants (NFL ~13.4, NBA ~11.5 points) measured from decades of
 * final margins — they are the single biggest lever in this file and they are named, not buried.
 *
 * KELLY IS QUARTER-KELLY, ALWAYS. Full Kelly is the growth-optimal stake only if your probability
 * is exactly right. Ours is an estimate from a model that has not yet proven it beats the closing
 * line, so the fraction is quartered and then capped. See `kellyFraction`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — American-odds conversions, proportional two-way de-vig, normal margin model for straight-up and against-the-spread probabilities, quarter-Kelly staking, and closing-line value in probability points.
 *
 * @module sports-odds
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_STAKE_FRACTION = exports.KELLY_MULTIPLIER = exports.MARGIN_SIGMA = void 0;
exports.impliedProbability = impliedProbability;
exports.decimalOdds = decimalOdds;
exports.devigTwoWay = devigTwoWay;
exports.normalCdf = normalCdf;
exports.winProbabilityFromMargin = winProbabilityFromMargin;
exports.coverProbability = coverProbability;
exports.kellyFraction = kellyFraction;
exports.expectedValue = expectedValue;
exports.closingLineValue = closingLineValue;
/**
 * Standard deviation of a game's final margin around its true expectation, in points.
 *
 * These are the league-level dispersion constants every margin→probability conversion in this
 * package depends on. NFL final margins scatter roughly 13.4 points around the spread; NBA roughly
 * 11.5; college football roughly 16.5, which is much wider because the talent gap between two FBS
 * programmes can be enormous in a way no professional league permits. That single number is why a
 * ten-point college edge is worth less win probability than a ten-point NFL edge.
 *
 * They are deliberately module constants rather than tunable knobs — a knob here would let a losing
 * model be "fixed" by widening its own uncertainty instead of by being right.
 */
exports.MARGIN_SIGMA = { nfl: 13.4, nba: 11.5, ncaaf: 16.5 };
/** Kelly is quartered before it is capped — see the module note on why. */
exports.KELLY_MULTIPLIER = 0.25;
/** Hard ceiling on any single stake, as a fraction of bankroll, after the Kelly quartering. */
exports.MAX_STAKE_FRACTION = 0.02;
/**
 * @description Convert American odds to the probability they imply, vig included. This is the raw
 * quote, NOT a forecast — two sides of the same market will sum above 1. Feed the pair to
 * `devigTwoWay` before comparing anything to a model.
 * @param american - American odds, e.g. -150 or +130. Zero is not a valid quote.
 * @returns Implied probability in (0, 1).
 */
function impliedProbability(american) {
    if (!Number.isFinite(american) || american === 0)
        return NaN;
    return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}
/**
 * @description Convert American odds to decimal payout per unit staked (stake returned included),
 * which is the form `kellyFraction` needs.
 * @param american - American odds, e.g. -150 or +130.
 * @returns Decimal odds, e.g. 1.667 or 2.30.
 */
function decimalOdds(american) {
    if (!Number.isFinite(american) || american === 0)
        return NaN;
    return american < 0 ? 1 + 100 / -american : 1 + american / 100;
}
/**
 * @description Remove a two-way market's vig proportionally, yielding the market's honest forecast.
 * Proportional (a.k.a. multiplicative) de-vig divides each raw probability by their sum. It is
 * chosen over the power and Shin methods because it makes no assumption about favourite-longshot
 * bias — an assumption that would otherwise show up as model "edge" on every underdog.
 * @param homeAmerican - American odds on the home/first side.
 * @param awayAmerican - American odds on the away/second side.
 * @returns The de-vigged pair plus the overround that was removed, or NaNs if either quote is
 * unusable.
 */
function devigTwoWay(homeAmerican, awayAmerican) {
    const rawHome = impliedProbability(homeAmerican);
    const rawAway = impliedProbability(awayAmerican);
    const sum = rawHome + rawAway;
    if (!Number.isFinite(sum) || sum <= 0)
        return { home: NaN, away: NaN, overround: NaN };
    return { home: rawHome / sum, away: rawAway / sum, overround: sum };
}
/**
 * @description Standard normal cumulative distribution, via the Abramowitz & Stegun 7.1.26
 * approximation of erf. Accurate to ~1.5e-7, which is four orders of magnitude finer than any
 * probability this package acts on.
 * @param z - Standard score.
 * @returns P(Z <= z).
 */
function normalCdf(z) {
    if (!Number.isFinite(z))
        return NaN;
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const erf = 1 - poly * Math.exp(-x * x);
    return 0.5 * (1 + sign * erf);
}
/**
 * @description Probability the home side wins outright, given a projected margin. The margin is
 * modelled as normal around the projection with the league's `MARGIN_SIGMA`; a tie (margin exactly
 * zero) is measure-zero under a continuous model and is not special-cased, which is correct for
 * the NBA and a negligible ~0.4% overstatement in the NFL.
 * @param projectedMargin - Projected home points minus away points. Positive favours home.
 * @param league - League whose margin dispersion applies.
 * @returns P(home wins) in (0, 1).
 */
function winProbabilityFromMargin(projectedMargin, league) {
    const sigma = exports.MARGIN_SIGMA[league];
    if (!Number.isFinite(projectedMargin) || !sigma)
        return NaN;
    return normalCdf(projectedMargin / sigma);
}
/**
 * @description Probability the home side covers a spread. Spreads are quoted from the home side's
 * perspective the way books quote them: -3.5 means home is laying 3.5, so home covers when its
 * margin exceeds 3.5. A half-point spread cannot push; an integer spread can, and the push mass
 * sits in neither side's probability here — treat an integer-spread edge as slightly optimistic.
 * @param projectedMargin - Projected home points minus away points.
 * @param homeSpread - The home side's spread, e.g. -3.5 when home is favoured by 3.5.
 * @param league - League whose margin dispersion applies.
 * @returns P(home covers) in (0, 1).
 */
function coverProbability(projectedMargin, homeSpread, league) {
    const sigma = exports.MARGIN_SIGMA[league];
    if (!Number.isFinite(projectedMargin) || !Number.isFinite(homeSpread) || !sigma)
        return NaN;
    return normalCdf((projectedMargin + homeSpread) / sigma);
}
/**
 * @description Quarter-Kelly stake as a fraction of bankroll, capped at `MAX_STAKE_FRACTION`.
 * Returns zero whenever the bet has no positive expectation, so a caller can size every candidate
 * unconditionally and let the arithmetic refuse the bad ones.
 * @param probability - Our probability the bet wins.
 * @param american - The American odds actually available.
 * @returns Fraction of bankroll to stake, in [0, MAX_STAKE_FRACTION].
 */
function kellyFraction(probability, american) {
    const dec = decimalOdds(american);
    if (!Number.isFinite(probability) || !Number.isFinite(dec) || dec <= 1)
        return 0;
    const b = dec - 1;
    const full = (probability * b - (1 - probability)) / b;
    if (!(full > 0))
        return 0;
    return Math.min(full * exports.KELLY_MULTIPLIER, exports.MAX_STAKE_FRACTION);
}
/**
 * @description Expected value per unit staked, at the offered price. Negative means the price is
 * worse than our probability, which is the normal case and why most games produce no bet.
 * @param probability - Our probability the bet wins.
 * @param american - The American odds actually available.
 * @returns Expected profit per 1 unit staked.
 */
function expectedValue(probability, american) {
    const dec = decimalOdds(american);
    if (!Number.isFinite(probability) || !Number.isFinite(dec))
        return NaN;
    return probability * (dec - 1) - (1 - probability);
}
/**
 * @description Closing-line value in probability points: how much better the price we took was
 * than the price the market settled on. CLV is the only fast, low-variance read on whether a sports
 * model has edge — win/loss records need hundreds of bets to say anything, whereas consistently
 * beating the close is the market itself confirming the pick was mispriced. A model that beats the
 * close and still loses money was unlucky; one that loses to the close and still makes money was
 * lucky, and this package treats it as unproven either way.
 * @param takenAmerican - The odds we recorded at pick time.
 * @param closingAmerican - The odds the same side closed at.
 * @param opposingClosingAmerican - The other side's closing odds, used to de-vig the close.
 * @returns Our de-vigged closing probability minus the de-vigged probability we bought, in
 * probability points (positive means we beat the close).
 */
function closingLineValue(takenAmerican, closingAmerican, opposingClosingAmerican) {
    const close = devigTwoWay(closingAmerican, opposingClosingAmerican);
    if (!Number.isFinite(close.home))
        return NaN;
    const takenRaw = impliedProbability(takenAmerican);
    const closeRaw = impliedProbability(closingAmerican);
    if (!Number.isFinite(takenRaw) || !Number.isFinite(closeRaw) || closeRaw <= 0)
        return NaN;
    // Scale the price we took by the same overround factor the close was de-vigged with, so the two
    // numbers are on one footing: a fair-probability comparison, not a raw-quote comparison.
    const takenFair = takenRaw * (close.home / closeRaw);
    return close.home - takenFair;
}
//# sourceMappingURL=sports-odds.js.map