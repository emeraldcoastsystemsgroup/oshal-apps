/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The calibration table's arithmetic as the retired study computed it (scripts/oshal-kalshi-calibration.ts and prediction-markets/services/calibration.ts of the retired platform), for the package to rebuild its own table. Guard: tests/kalshi-calibration-build.test.js.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The pooled '*' buckets add prices in the order the samples were given, as the retired study did; grouping by category first could move an average's last digit. Checked: 200 random tables identical to the retired buildCalibrationTable, key order and digits.
 */
'use strict';

const BUCKET_EDGES = [0, 0.03, 0.06, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.94, 0.97, 1.0000001];
const HORIZONS = [24, 6, 1];

/**
 * @description Choose the price to use for a market at a specific horizon.
 * @param close - The close price, or null.
 * @param bid   - The yes bid price at close, or null.
 * @param ask   - The yes ask price at close, or null.
 * @returns The chosen price in [0, 1], or null if no usable price.
 */
function pickPrice(close, bid, ask) {
  if (close !== null && close > 0.005 && close < 0.995) return close;
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask < 1) {
    const mid = (bid + ask) / 2;
    if (mid > 0.005 && mid < 0.995) return mid;
  }
  return null;
}

/**
 * @description Return the bucket index for a price, or -1 if outside all buckets.
 * @param p - A price in dollars.
 * @returns The bucket index (0–15), or -1.
 */
function bucketIndex(p) {
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    if (p >= BUCKET_EDGES[i] && p < BUCKET_EDGES[i + 1]) return i;
  }
  return -1;
}

/**
 * @description Aggregate an array of samples into 16 bucket summaries.
 * @param samples - Array of { price, settledYes } objects.
 * @returns An array of 16 bucket objects { lo, hi, n, avgPrice, yesRate }.
 */
function aggregate(samples) {
  const buckets = BUCKET_EDGES.slice(0, -1).map((lo, i) => ({
    lo, hi: BUCKET_EDGES[i + 1], n: 0, sumPrice: 0, yesCount: 0,
  }));

  for (const s of samples) {
    const idx = bucketIndex(s.price);
    if (idx < 0) continue;
    const b = buckets[idx];
    b.n += 1;
    b.sumPrice += s.price;
    if (s.settledYes) b.yesCount += 1;
  }

  return buckets.map((b) => ({
    lo: b.lo, hi: b.hi, n: b.n,
    avgPrice: b.n === 0 ? 0 : b.sumPrice / b.n,
    yesRate: b.n === 0 ? 0 : b.yesCount / b.n,
  }));
}

/**
 * @description Extract price samples from one settled market across all horizons.
 * @param market  - The market object with closeTime, openTime, ticker, result.
 * @param category - The category string for this market.
 * @param candles  - Array of { endPeriodTs, close, yesBidClose, yesAskClose }.
 * @returns Array of sample objects { ticker, category, horizonHours, price, settledYes }.
 */
function samplesOf(market, category, candles) {
  if (!market.closeTime || !market.openTime) return [];
  if (candles.length === 0) return [];

  const closeTimeMs = market.closeTime instanceof Date ? market.closeTime.getTime() : Date.parse(market.closeTime);
  const openTimeMs = market.openTime instanceof Date ? market.openTime.getTime() : Date.parse(market.openTime);
  const closeS = Math.floor(closeTimeMs / 1000);
  const openS = Math.floor(openTimeMs / 1000);

  const out = [];
  for (const h of HORIZONS) {
    const targetTs = closeS - h * 3600;
    if (targetTs < openS + 1800) continue;

    let best = null;
    for (const c of candles) {
      if (c.endPeriodTs <= targetTs) {
        if (best === null || c.endPeriodTs > best.endPeriodTs) best = c;
      }
    }
    if (!best) continue;

    const price = pickPrice(best.close, best.yesBidClose, best.yesAskClose);
    if (price === null) continue;

    out.push({
      ticker: market.ticker, category, horizonHours: h, price,
      settledYes: market.result === 'yes',
    });
  }
  return out;
}

/**
 * @description Filter markets to those that are usable for calibration.
 * @param markets - Array of market objects.
 * @returns Array of market objects that pass all usable rules.
 */
function usableSettled(markets) {
  return markets.filter((m) => {
    if (m.isMultivariate) return false;
    if (m.result !== 'yes' && m.result !== 'no') return false;
    if (!m.closeTime || !m.openTime) return false;
    if (!m.volume || m.volume <= 0) return false;
    return true;
  });
}

/**
 * @description Build the calibration table object from pre-extracted samples.
 * @param samples - Array of { ticker, category, horizonHours, price, settledYes }.
 * @param now     - A Date for generatedAt, or current time if omitted.
 * @returns The calibration table object.
 */
function buildCalibrationTable(samples, now) {
  const generatedAt = (now || new Date()).toISOString();
  const sampleCounts = {};
  for (const s of samples) {
    sampleCounts[s.category] = (sampleCounts[s.category] || 0) + 1;
  }

  // Each horizon keeps its samples in the order given: the pooled '*' set adds prices in that order, as the retired
  // study did, so an average matches it to the last digit.
  const horizonSamples = {};
  const horizonAll = {};
  for (const s of samples) {
    const key = String(s.horizonHours);
    if (!horizonSamples[key]) { horizonSamples[key] = {}; horizonAll[key] = []; }
    if (!horizonSamples[key][s.category]) horizonSamples[key][s.category] = [];
    horizonSamples[key][s.category].push(s);
    horizonAll[key].push(s);
  }

  const horizons = {};
  for (const hKey of Object.keys(horizonSamples)) {
    const cats = horizonSamples[hKey];
    const hEntry = {};
    hEntry['*'] = aggregate(horizonAll[hKey]);
    for (const cKey of Object.keys(cats)) {
      hEntry[cKey] = aggregate(cats[cKey]);
    }
    horizons[hKey] = hEntry;
  }

  return { generatedAt, sampleCounts, horizons };
}

module.exports = {
  BUCKET_EDGES, HORIZONS, pickPrice, bucketIndex, aggregate,
  samplesOf, usableSettled, buildCalibrationTable,
};
