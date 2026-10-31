"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notEvaluableReason = notEvaluableReason;
exports.browseMarket = browseMarket;
exports.openMarkets = openMarkets;
exports.explainMarket = explainMarket;
const MAX_HOURS_TO_CLOSE = Number(process.env.KALSHI_MAX_HOURS_TO_CLOSE) > 0 ? Number(process.env.KALSHI_MAX_HOURS_TO_CLOSE) : 48;
function iso(value) {
    if (value instanceof Date)
        return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    if (typeof value === 'string' && value)
        return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    return null;
}
function hoursUntil(closeTime, nowMs) {
    if (!closeTime)
        return null;
    const at = Date.parse(closeTime);
    return Number.isFinite(at) ? (at - nowMs) / 3_600_000 : null;
}
/**
 * @description Why the evaluator skips a market, mirroring its own gates in words; null when it would judge it.
 * @param m - Normalised market. @param series - Its series metadata, when known. @param nowMs - Now.
 * @returns The reason, or null.
 */
function notEvaluableReason(m, _series, nowMs) {
    if (m.isMultivariate)
        return 'it is a parlay leg (a multivariate market), which the evaluator never prices';
    const close = iso(m.closeTime);
    if (!close)
        return 'it has no close time';
    if (!(m.yesAsk > 0) || !(m.noAsk > 0) || m.yesBid < 0)
        return 'its book is empty on one side, so there is no price to judge';
    const hours = hoursUntil(close, nowMs) ?? 0;
    if (hours <= 0.05)
        return 'it closes within minutes, too late to enter';
    if (hours > MAX_HOURS_TO_CLOSE)
        return `it closes in ${describeHours(hours)}, beyond the ${MAX_HOURS_TO_CLOSE}-hour horizon the calibration table was measured on`;
    return null;
}
/**
 * @description One browse row for a walked market: its book and the evaluator's better-side hand (or why it skipped it).
 * @param m - Normalised market. @param series - Series metadata. @param table - Calibration table.
 * @param evaluate - The framework's evaluateMarket. @param nowMs - Now.
 * @returns The row.
 */
function browseMarket(m, series, table, evaluate, nowMs = Date.now()) {
    const notEvaluable = notEvaluableReason(m, series, nowMs);
    // A series the scan did not read inside its budget is priced on the pooled evidence with the default fee model
    // (what the reader itself assumes when a series read fails), and the walkthrough says so.
    const meta = series || { ticker: m.seriesTicker, category: 'Unknown', feeType: 'quadratic', feeMultiplier: 1, frequency: '' };
    let hand = null;
    if (!notEvaluable) {
        try {
            hand = evaluate(m, meta, table, nowMs);
        }
        catch {
            hand = null;
        }
    }
    return {
        ticker: m.ticker, eventTicker: m.eventTicker, seriesTicker: m.seriesTicker, title: m.title,
        category: meta.category || 'Unknown', closeTime: iso(m.closeTime),
        yesBid: num(m.yesBid), yesAsk: num(m.yesAsk), noBid: num(m.noBid), noAsk: num(m.noAsk), lastPrice: num(m.lastPrice),
        volume: num(m.volume), openInterest: num(m.openInterest), liquidity: num(m.liquidity),
        hand, notEvaluable: hand ? null : (notEvaluable ?? 'the evaluator could not price it'),
        ...(series ? {} : { seriesUnknown: true }),
    };
}
/**
 * @description Only the markets still open now; a market that closed after the scan is no longer a bet.
 * @param markets - Browse rows from the snapshot. @param nowMs - Now.
 * @returns The open rows and how many closed since the scan.
 */
function openMarkets(markets, nowMs) {
    const list = Array.isArray(markets) ? markets : [];
    const open = list.filter((m) => { const at = m.closeTime ? Date.parse(m.closeTime) : NaN; return !Number.isFinite(at) || at > nowMs; });
    return { markets: open, closedSinceScan: list.length - open.length };
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function cents(x) { return `${(x * 100).toFixed(1)}¢`; }
function pct(x) { return `${(x * 100).toFixed(0)}%`; }
function signedCents(x) { return `${x >= 0 ? '+' : '−'}${cents(Math.abs(x))}`; }
function describeHours(h) {
    if (h < 1)
        return `${Math.max(1, Math.round(h * 60))} minutes`;
    if (h < 48)
        return `${h.toFixed(h < 10 ? 1 : 0)} hours`;
    return `${(h / 24).toFixed(1)} days`;
}
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
const FLAG_WORDS = {
    'wide-spread': 'the bid–ask spread is wider than 5¢, so the price you pay is far from where the market last agreed',
    'thin-book': 'the book holds under $500 of resting orders, so a real order would move the price against you',
    'low-oi': 'fewer than 50 contracts are open, so there is almost nobody to trade against',
    'low-sample': 'the calibration bucket holds fewer than 100 settled markets, so the probability estimate is thin',
    'long-dated': 'the market closes more than 72 hours out, where the calibration evidence is weakest',
};
/**
 * @description The walkthrough of one market in words, built only from the evaluator's own numbers.
 * @param m - Browse row. @param opts - The strategy gate and calibration age.
 * @returns Verdict, headline, reasons, numbers and the question for the quant.
 */
function explainMarket(m, opts = {}) {
    const nowMs = opts.nowMs ?? Date.now();
    const hours = hoursUntil(m.closeTime, nowMs);
    const closes = hours === null ? 'no close time' : hours <= 0 ? 'already closed' : `closes in ${describeHours(hours)}`;
    const resting = m.liquidity > 0 ? `$${Math.round(m.liquidity)} resting` : m.volume > 0 ? 'resting liquidity not reported' : 'nothing resting';
    const book = `YES ${cents(m.yesAsk)} / NO ${cents(m.noAsk)} · ${plural(Math.round(m.volume), 'contract')} traded · ${resting} · ${closes}`;
    const h = m.hand;
    if (!h) {
        return {
            verdict: 'not-evaluable', side: null,
            headline: `No verdict: ${m.notEvaluable || 'the evaluator could not price this market'}.`,
            reasons: [`Book: ${book}.`, 'The evaluator only judges single markets with a two-sided book inside its calibration horizon; outside that it makes no probability claim, so there is no edge to report either way.'],
            numbers: { yesAsk: m.yesAsk, noAsk: m.noAsk, volume: m.volume, liquidity: m.liquidity, openInterest: m.openInterest, hoursToClose: hours },
            question: `Walk me through ${m.ticker} (${m.title}): the evaluator gave no verdict because ${m.notEvaluable || 'it could not price it'}. Is there anything a careful bettor could still say about it?`,
        };
    }
    const side = h.side === 'no' ? 'no' : 'yes';
    const SIDE = side.toUpperCase();
    const edge = num(h.edgeNet), fee = num(h.feePerContract), price = num(h.price), prob = num(h.trueProb), conf = num(h.confidence);
    const n = Math.round(num(h.calibrationN)), flags = Array.isArray(h.riskFlags) ? h.riskFlags : [];
    const gated = opts.mayStake === false;
    const strength = (h.strength === 'monster' || h.strength === 'strong' || h.strength === 'playable') ? h.strength : 'fold';
    const verdictWord = strength === 'fold' ? 'Fold' : strength === 'playable' ? 'Playable' : strength === 'strong' ? 'Strong' : 'Monster';
    const reasons = [];
    reasons.push(`Price vs chance: ${SIDE} costs ${cents(price)}; the calibrated chance it pays is ${pct(prob)} (the market's own implied chance is ${pct(price)}).`);
    reasons.push(`Fees: Kalshi's taker fee on this price is about ${cents(fee)} a contract, so you need the chance to beat ${cents(price + fee)} just to break even.`);
    reasons.push(`Net edge: ${signedCents(edge)} a contract ${edge > 0 ? 'in your favour' : 'against you'}${edge <= 0 ? ' — the market is priced at or beyond what the history supports' : ''}.`);
    if (m.seriesUnknown)
        reasons.push('Category unknown: the scan did not read this market\'s series inside its time budget, so the chance comes from the pooled evidence across every category and the fee is the standard quadratic one; a later scan may know the category.');
    reasons.push(`Evidence: the chance comes from ${n > 0 ? plural(n, 'settled Kalshi market') + ` in this price bucket and category (confidence ${pct(conf)})` : 'no comparable settled markets, so the estimate is the price itself (confidence 0%)'}${opts.calibrationGeneratedAt ? `, from a calibration table generated ${opts.calibrationGeneratedAt.slice(0, 10)}` : ''}.`);
    reasons.push(`Book: ${book}${h.spread !== undefined ? ` · spread ${cents(num(h.spread))}` : ''}.`);
    for (const flag of flags)
        reasons.push(`Risk flag ${flag}: ${FLAG_WORDS[flag] || 'the evaluator halves the stake for it'}.`);
    const stake = num(h.stakeFraction), kelly = num(h.kellyFraction);
    if (strength === 'fold') {
        reasons.push(edge <= 0 ? 'Sizing: with no net edge the Kelly stake is zero; there is no price at which this side pays.'
            : `Sizing: the edge is real but too small or too thinly evidenced for the strength floors (1.2¢ with 35% confidence to be playable), so the stake is zero.`);
    }
    else {
        reasons.push(`Sizing: full Kelly would be ${pct(kelly)} of bankroll; quarter-Kelly, halved once per risk flag and capped at 5%, is ${pct(stake)}${gated ? ` — on paper only, because the strategy may not stake yet (${opts.gateReason || 'the forward test has not earned it'})` : ''}.`);
    }
    const caveat = m.seriesUnknown ? ' Category unknown, pooled evidence.' : '';
    const headline = (strength === 'fold'
        ? `Fold: ${SIDE} at ${cents(price)} against a ${pct(prob)} calibrated chance is ${signedCents(edge)} a contract after the ${cents(fee)} fee${flags.length ? `, with ${plural(flags.length, 'risk flag')}` : ''}.`
        : `${verdictWord}: ${SIDE} at ${cents(price)} against a ${pct(prob)} calibrated chance is ${signedCents(edge)} a contract after fees; stake ${pct(stake)}${gated ? ' (paper only)' : ''}.`) + caveat;
    return {
        verdict: strength, side, headline, reasons,
        numbers: { price, trueProb: prob, marketProb: num(h.marketProb ?? price), feePerContract: fee, edgeNet: edge, spread: h.spread === undefined ? null : num(h.spread),
            liquidity: m.liquidity, openInterest: m.openInterest, volume: m.volume, calibrationN: n, confidence: conf, hoursToClose: hours, kellyFraction: kelly, stakeFraction: stake },
        question: strength === 'fold'
            ? `Walk me through ${m.ticker} (${m.title}): why is ${SIDE} at ${cents(price)} a bad bet?`
            : `Walk me through ${m.ticker} (${m.title}): the scan calls ${SIDE} at ${cents(price)} ${strength}. What could make it a bad bet?`,
    };
}
//# sourceMappingURL=kalshi-market-explainer.js.map