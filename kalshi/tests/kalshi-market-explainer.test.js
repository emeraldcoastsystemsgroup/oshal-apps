/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The market explainer, pinned on its words and numbers: a browse row keeps the book and the evaluator's hand or the reason it skipped the market (parlay leg, empty book, closing within minutes, beyond the calibration horizon, unknown series); a fold says why in cents and percentages (price vs chance, fee, net edge, evidence, flags, zero stake); a playable hand says its stake and that it is paper-only under a closed gate; the question put to the quant names the ticker and the side; openMarkets drops what closed since the scan.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const compiled = path.resolve(__dirname, '../routes/kalshi-market-explainer.js');
const load = Module._load;
Module._load = function stubbed(request, ...rest) { return request.startsWith('@/') ? {} : load.call(this, request, ...rest); };
let explainer;
try { explainer = require(compiled); } finally { Module._load = load; }
const { browseMarket, explainMarket, notEvaluableReason, openMarkets } = explainer;

const NOW = Date.parse('2026-10-30T12:00:00Z');
const series = { ticker: 'KXRAIN', category: 'Weather', feeType: 'quadratic', feeMultiplier: 1, frequency: 'daily' };
const table = { generatedAt: '2026-07-13T05:39:26.578Z', horizons: {} };
function market(over = {}) {
  return { ticker: 'KXRAIN-26OCT31-AUS', eventTicker: 'KXRAIN-26OCT31', seriesTicker: 'KXRAIN', title: 'Will it rain in Austin on Oct 31?',
    status: 'open', result: '', yesBid: 0.55, yesAsk: 0.58, noBid: 0.39, noAsk: 0.42, lastPrice: 0.57, volume: 1200, liquidity: 900,
    openInterest: 300, openTime: new Date(NOW - 86400000), closeTime: new Date(NOW + 6 * 3600000), isMultivariate: false, ...over };
}
function hand(over = {}) {
  return { ticker: 'KXRAIN-26OCT31-AUS', eventTicker: 'KXRAIN-26OCT31', title: 'Will it rain in Austin on Oct 31?', category: 'Weather',
    closeTime: new Date(NOW + 6 * 3600000).toISOString(), side: 'no', price: 0.42, marketProb: 0.42, trueProb: 0.49, calibrationN: 412,
    feePerContract: 0.017, edgeNet: 0.053, evPerContract: 0.053, kellyFraction: 0.11, stakeFraction: 0.012, confidence: 0.94,
    riskFlags: ['thin-book'], strength: 'strong', spread: 0.03, liquidity: 900, volume: 1200, ...over };
}

test('a browse row keeps the book, ISO times and the evaluator hand', () => {
  const row = browseMarket(market(), series, table, () => hand(), NOW);
  assert.equal(row.closeTime, new Date(NOW + 6 * 3600000).toISOString());
  assert.equal(row.category, 'Weather');
  assert.deepEqual([row.yesAsk, row.noAsk, row.volume, row.liquidity], [0.58, 0.42, 1200, 900]);
  assert.equal(row.hand.strength, 'strong');
  assert.equal(row.notEvaluable, null);
});

test('why the evaluator skips a market is said in words, mirroring its own gates', () => {
  assert.match(notEvaluableReason(market({ isMultivariate: true }), series, NOW), /parlay leg/);
  assert.match(notEvaluableReason(market({ closeTime: null }), series, NOW), /no close time/);
  assert.match(notEvaluableReason(market({ noAsk: 0 }), series, NOW), /book is empty/);
  assert.match(notEvaluableReason(market({ closeTime: new Date(NOW + 60000) }), series, NOW), /closes within minutes/);
  assert.match(notEvaluableReason(market({ closeTime: new Date(NOW + 10 * 86400000) }), series, NOW), /beyond the 48-hour horizon/);
  assert.equal(notEvaluableReason(market(), series, NOW), null);
  // A skipped market is a row with no hand and the reason; the evaluator is never asked.
  const row = browseMarket(market({ isMultivariate: true }), series, table, () => { throw new Error('must not evaluate'); }, NOW);
  assert.equal(row.hand, null);
  assert.match(row.notEvaluable, /parlay leg/);
  const why = explainMarket(row, { nowMs: NOW });
  assert.equal(why.verdict, 'not-evaluable');
  assert.match(why.headline, /^No verdict: it is a parlay leg/);
  assert.match(why.question, /KXRAIN-26OCT31-AUS/);
});

test('a market whose series was not read is priced on the pooled evidence and says so', () => {
  let seen = null;
  const row = browseMarket(market(), null, table, (m, series) => { seen = series; return hand(); }, NOW);
  assert.equal(seen.category, 'Unknown'); assert.equal(seen.feeType, 'quadratic');
  assert.equal(row.category, 'Unknown'); assert.equal(row.seriesUnknown, true); assert.equal(row.hand.strength, 'strong');
  const why = explainMarket(row, { mayStake: true, nowMs: NOW });
  assert.equal(why.verdict, 'strong');
  assert.match(why.headline, / Category unknown, pooled evidence\.$/);
  assert.match(why.reasons.join('\n'), /Category unknown: the scan did not read this market's series inside its time budget, so the chance comes from the pooled evidence/);
  const known = browseMarket(market(), series, table, () => hand(), NOW);
  assert.equal(known.seriesUnknown, undefined);
  // Zero resting liquidity beside real volume is "not reported", never an empty book.
  const quiet = explainMarket(browseMarket(market({ liquidity: 0 }), series, table, () => hand(), NOW), { nowMs: NOW });
  assert.match(quiet.reasons.join('\n'), /1200 contracts traded · resting liquidity not reported/);
});

test('a fold is explained in cents and percentages with a zero stake', () => {
  const fold = hand({ side: 'yes', price: 0.58, trueProb: 0.54, edgeNet: -0.06, feePerContract: 0.017, stakeFraction: 0, kellyFraction: 0, strength: 'fold', riskFlags: ['wide-spread', 'low-sample'], calibrationN: 60, confidence: 0.7 });
  const why = explainMarket({ ...browseMarket(market(), series, table, () => fold, NOW) }, { mayStake: true, calibrationGeneratedAt: table.generatedAt, nowMs: NOW });
  assert.equal(why.verdict, 'fold');
  assert.equal(why.side, 'yes');
  assert.match(why.headline, /^Fold: YES at 58\.0¢ against a 54% calibrated chance is −6\.0¢ a contract after the 1\.7¢ fee, with 2 risk flags\./);
  const text = why.reasons.join('\n');
  assert.match(text, /YES costs 58\.0¢; the calibrated chance it pays is 54%/);
  assert.match(text, /beat 59\.7¢ just to break even/);
  assert.match(text, /−6\.0¢ a contract against you/);
  assert.match(text, /60 settled Kalshi markets .* \(confidence 70%\), from a calibration table generated 2026-07-13/);
  assert.match(text, /Risk flag wide-spread: the bid–ask spread/);
  assert.match(text, /Risk flag low-sample: the calibration bucket/);
  assert.match(text, /Sizing: with no net edge the Kelly stake is zero/);
  assert.equal(why.numbers.edgeNet, -0.06);
  assert.equal(why.question, 'Walk me through KXRAIN-26OCT31-AUS (Will it rain in Austin on Oct 31?): why is YES at 58.0¢ a bad bet?');
});

test('a playable hand says its stake, and paper-only under a closed strategy gate', () => {
  const row = browseMarket(market(), series, table, () => hand(), NOW);
  const open = explainMarket(row, { mayStake: true, nowMs: NOW });
  assert.equal(open.verdict, 'strong');
  assert.match(open.headline, /^Strong: NO at 42\.0¢ against a 49% calibrated chance is \+5\.3¢ a contract after fees; stake 1%\.$/);
  assert.match(open.reasons.join('\n'), /full Kelly would be 11% of bankroll; quarter-Kelly, halved once per risk flag and capped at 5%, is 1%\./);
  const gated = explainMarket(row, { mayStake: false, gateReason: 'the forward test is unproven', nowMs: NOW });
  assert.match(gated.headline, /\(paper only\)\.$/);
  assert.match(gated.reasons.join('\n'), /on paper only, because the strategy may not stake yet \(the forward test is unproven\)/);
  assert.match(open.question, /the scan calls NO at 42\.0¢ strong\. What could make it a bad bet\?$/);
});

test('openMarkets drops what closed since the scan and counts it', () => {
  const rows = [browseMarket(market(), series, table, () => hand(), NOW), browseMarket(market({ ticker: 'OLD', closeTime: new Date(NOW - 1000) }), series, table, () => hand(), NOW - 7200000)];
  const open = openMarkets(rows, NOW);
  assert.equal(open.markets.length, 1);
  assert.equal(open.closedSinceScan, 1);
  assert.deepEqual(openMarkets(undefined, NOW), { markets: [], closedSinceScan: 0 });
});
