"use strict";
/**
 * Line history — the capture layer, and the one part of this package with a clock on it.
 *
 * WHY THIS EXISTS AT ALL. There is no historical odds endpoint. ESPN serves the line as it is RIGHT
 * NOW and nothing else; a number that moved an hour ago is simply gone. So the opening line for a
 * game — the single most valuable price in the whole dataset, because it is the one the market has
 * had the least time to sharpen — can only ever be obtained by having been watching when it posted.
 * Every day this poller does not run is a slate of openers that can never be recovered, bought, or
 * backfilled. That is why it ships before the models that would use it.
 *
 * WHAT IT HONESTLY CLAIMS. The first row for a game is `firstSeen`, NOT "the opening line". Those
 * are the same thing only if we happened to be polling before the book posted, and this module has
 * no way to know that. `openerConfidence` reports how long before kickoff the first observation
 * landed so a caller can judge it, rather than a column called `opening_line` quietly asserting
 * something unproven. A number labelled as an opener that is really a Tuesday-afternoon observation
 * would corrupt every closing-line-value measurement built on top of it.
 *
 * STORAGE IS CHANGE-ONLY. Polling hourly and writing every observation would store 24 identical
 * rows a day per game per book. Instead a row is written only when the quote actually DIFFERS from
 * the last one seen, carrying `first_seen`/`last_seen`/`observations`. That keeps the full movement
 * history at a fraction of the rows and makes "the line moved" a real event rather than something a
 * reader has to infer by diffing adjacent samples.
 *
 * ⚠ WHAT THE CHEAP CAPTURE ACTUALLY GETS. Measured live 2026-09-08: the scoreboard carries the
 * SPREAD and the TOTAL for essentially the whole slate (47 of 48 NFL games) but leaves the
 * MONEYLINE null — moneylines only appear on the per-game summary endpoint, which costs one call
 * per game instead of one per league. So the poller captures spread and total for the entire board
 * every pass, and moneyline movement is NOT captured. For football that is the right trade: the
 * spread is the market. Anything measuring moneyline closing-line value must say it has no data
 * rather than reading the stored nulls as prices.
 *
 * These are pure functions over quotes — no I/O, no clock of their own — so the comparison and
 * movement rules can be tested without a database or a network.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — quote normalisation and equality, change-only capture semantics, movement summary over an observation series, and honest opener labelling with a confidence window rather than an asserted opening line.
 *
 * @module sports-line-history
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENER_EARLY_HOURS = void 0;
exports.normaliseQuote = normaliseQuote;
exports.sameLine = sameLine;
exports.hasPrice = hasPrice;
exports.describeMove = describeMove;
exports.summariseMovement = summariseMovement;
exports.spreadClv = spreadClv;
/** The comparable numbers in a quote. Two quotes are "the same line" iff all of these match. */
const COMPARED = [
    'homeSpread', 'homeSpreadOdds', 'awaySpreadOdds', 'homeMoneyline', 'awayMoneyline',
];
/**
 * @description Normalise a quote to the fields this module compares and stores, coercing anything
 * unusable to null. A missing number and a NaN must land in the same place, or a flaky read would
 * register as a line move.
 * @param quote - A quote as parsed from the scoreboard or summary.
 * @returns The comparable subset, with absent values as null.
 */
function normaliseQuote(quote) {
    const out = {};
    for (const key of COMPARED) {
        const v = quote ? quote[key] : undefined;
        out[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    return out;
}
/**
 * @description Whether two quotes represent the same line. Used to decide whether a poll writes a
 * new row or just extends the current one — so this is the single definition of "the line moved".
 * @param a - One quote.
 * @param b - The other.
 * @returns True when every compared number matches, nulls included.
 */
function sameLine(a, b) {
    const na = normaliseQuote(a);
    const nb = normaliseQuote(b);
    return COMPARED.every((k) => na[k] === nb[k]);
}
/**
 * @description Whether a quote carries anything worth storing. A payload with no spread and no
 * moneyline is a book that has not posted yet, not a line of zero — storing it would manufacture a
 * fake opener at whatever moment we first looked.
 * @param quote - The quote.
 * @returns True when at least one real price is present.
 */
function hasPrice(quote) {
    const n = normaliseQuote(quote);
    return n.homeSpread !== null || n.homeMoneyline !== null || n.awayMoneyline !== null;
}
/**
 * @description Describe the step between two consecutive observations. Returns null when nothing
 * comparable changed, so a caller can build a movement list without filtering afterwards.
 * @param from - The earlier observation.
 * @param to - The later one.
 * @returns The move, or null.
 */
function describeMove(from, to) {
    const parts = [];
    let spreadDelta = null;
    let moneylineDelta = null;
    if (from.homeSpread !== null && to.homeSpread !== null && from.homeSpread !== to.homeSpread) {
        // A spread quoted from the home side: -3.5 -> -4.5 is the market moving TOWARD home, so the
        // delta is negated to read positive in that direction.
        spreadDelta = Math.round((from.homeSpread - to.homeSpread) * 100) / 100;
        parts.push(`spread ${fmt(from.homeSpread)} to ${fmt(to.homeSpread)}`);
    }
    if (from.homeMoneyline !== null && to.homeMoneyline !== null && from.homeMoneyline !== to.homeMoneyline) {
        moneylineDelta = to.homeMoneyline - from.homeMoneyline;
        parts.push(`home ML ${fmt(from.homeMoneyline)} to ${fmt(to.homeMoneyline)}`);
    }
    if (!parts.length)
        return null;
    return { at: to.firstSeen, what: parts.join(', '), spreadDelta, moneylineDelta };
}
/** Formats a signed number the way a line is written. */
function fmt(n) { return `${n > 0 ? '+' : ''}${n}`; }
/** Lead time beyond which a first observation is genuinely likely to be at or near the opener. */
exports.OPENER_EARLY_HOURS = 72;
/**
 * @description Fold a game's observation series into its movement story.
 *
 * The honesty is in `openerConfidence`. Calling the earliest row "the opening line" would be a
 * claim this module cannot support — it only knows when IT first looked. A first observation three
 * days out is plausibly the opener; one taken four hours before kickoff certainly is not, and every
 * closing-line-value number computed against it would be quietly wrong.
 * @param rows - Observations for one game and book, any order.
 * @param kickoff - ISO kickoff time, when known.
 * @returns The summary.
 */
function summariseMovement(rows, kickoff) {
    const ordered = [...rows].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
    const first = ordered[0] || null;
    const latest = ordered[ordered.length - 1] || null;
    const moves = [];
    for (let i = 1; i < ordered.length; i += 1) {
        const move = describeMove(ordered[i - 1], ordered[i]);
        if (move)
            moves.push(move);
    }
    let netSpreadMove = null;
    if (first?.homeSpread !== null && first?.homeSpread !== undefined
        && latest?.homeSpread !== null && latest?.homeSpread !== undefined) {
        netSpreadMove = Math.round((first.homeSpread - latest.homeSpread) * 100) / 100;
    }
    let openerLeadHours = null;
    let openerConfidence = 'unknown';
    const kick = kickoff ? Date.parse(kickoff) : NaN;
    if (first && Number.isFinite(kick)) {
        openerLeadHours = Math.round(((kick - Date.parse(first.firstSeen)) / 3600000) * 10) / 10;
        openerConfidence = openerLeadHours >= exports.OPENER_EARLY_HOURS ? 'observed-early' : 'late-pickup';
    }
    return { firstSeen: first, latest, moves, netSpreadMove, openerLeadHours, openerConfidence };
}
/**
 * @description Whether our recorded pick beat the way the line subsequently moved — the fast,
 * low-variance read on whether a call had edge, independent of whether the bet won.
 *
 * A pick on the home side is vindicated when the spread moves toward home after we took it (the
 * market agreeing with us, later). This is the same logic closing-line value applies to price, in
 * the units a spread bettor actually thinks in.
 * @param side - Which side was taken.
 * @param spreadAtPick - The home-side spread when the call was made.
 * @param closingSpread - The home-side spread at the close.
 * @returns Points of favourable movement; negative means the market moved against us.
 */
function spreadClv(side, spreadAtPick, closingSpread) {
    const towardHome = spreadAtPick - closingSpread;
    return Math.round((side === 'home' ? towardHome : -towardHome) * 100) / 100;
}
//# sourceMappingURL=sports-line-history.js.map