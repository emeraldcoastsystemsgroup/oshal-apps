/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper engine's decision rules, ported from the legacy multi-timeframe.ts and portfolio.ts (reference only). The multi-timeframe fold keeps its weights, regime gate and action band; the risk postures keep their dials; stop-loss / take-profit, the trailing stop (volatility-scaled giveback), the per-name cap trim, the short-timeframe breakdown, relative-strength rotation and conviction sizing keep their rules. Two deliberate differences, both stated here: the timeframes come from the kernel's World price view (raw points, hour and day buckets, and week / quarter resampled from days), and a timeframe too short for any algorithm to vote (under 15 bars) is reported missing instead of counted as a neutral vote. Entry sizing additionally honours the person's own guardrails (max shares and max notional per order). Pure: no I/O, no clock, no randomness.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes. The regime is null (reported missing, never 0) when no higher timeframe has enough history, and a buy or a technical sell then holds: before, regime 0 passed both gates, so the short timeframes alone traded at full conviction. The 3Month timeframe is dropped: the kernel serves at most 365 days of day buckets, which resample to at most 5 quarters, never the 15 bars an algorithm needs, so it was a weight that could never vote. The remaining four keep the legacy weight ratios (renormalized to sum to 1.0) and the regime runs on 1Week, the remaining legacy regime timeframe.
 *
 * @module paper/decide
 */
'use strict';

const { scoreSymbol, ensemble, round } = require('./algorithms');
const { sectorOf } = require('./universe');

/**
 * Per-timeframe weight (sums to 1.0): longer trends carry more of the combined conviction. These are the
 * legacy 0.10 / 0.15 / 0.30 / 0.25 ratios without the legacy 3Month view: the kernel's day read is capped
 * at 365 days, which resamples to at most 5 quarters, so a quarterly view could never reach MIN_BARS.
 */
const TF_WEIGHTS = Object.freeze([
  { tf: '5Min', weight: 0.125 }, { tf: '1Hour', weight: 0.1875 }, { tf: '1Day', weight: 0.375 }, { tf: '1Week', weight: 0.3125 },
]);
/** The regime timeframe: a technical buy or sell needs it, and it must not lean against the trade. */
const HIGHER_TFS = Object.freeze(['1Week']);
const SHORT_TFS = Object.freeze(['5Min', '1Hour']);
const ACTION_THRESHOLD = 0.2;
const REGIME_TOLERANCE = 0.05;
const SHORT_BREAKDOWN_SCORE = 0.34;
/** Fewest bars a timeframe needs before any algorithm can vote on it (RSI-14 needs 15). */
const MIN_BARS = 15;

/** The four postures (percent of equity for caps; percent moves of the position for stops). */
const RISK_POLICIES = Object.freeze({
  conservative: { posture: 'conservative', maxPerNamePct: 3, maxSectorPct: 12, maxDeployedPct: 30, maxPositions: 12, stopLossPct: 5, takeProfitPct: 12, dailyLossHaltPct: 2, trailArmPct: 6, trailGivebackPct: 3, maxDrawdownPct: 8 },
  balanced: { posture: 'balanced', maxPerNamePct: 5, maxSectorPct: 22, maxDeployedPct: 60, maxPositions: 16, stopLossPct: 9, takeProfitPct: 20, dailyLossHaltPct: 4, trailArmPct: 8, trailGivebackPct: 4, maxDrawdownPct: 12 },
  aggressive: { posture: 'aggressive', maxPerNamePct: 10, maxSectorPct: 40, maxDeployedPct: 95, maxPositions: 12, stopLossPct: 15, takeProfitPct: 35, dailyLossHaltPct: 7, trailArmPct: 12, trailGivebackPct: 7, maxDrawdownPct: 25 },
  active: { posture: 'active', maxPerNamePct: 3, maxSectorPct: 25, maxDeployedPct: 85, maxPositions: 32, stopLossPct: 5, takeProfitPct: 8, dailyLossHaltPct: 3, trailArmPct: 5, trailGivebackPct: 3, maxDrawdownPct: 10 },
});

/** Baseline daily volatility (percent) the trailing giveback and per-name cap scale against. */
const BASELINE_VOL_PCT = 2;
const ROTATION_HOT = 0.30;
const ROTATION_COLD = 0.15;
const ROTATION_MARGIN = 0.25;

/**
 * @description The risk policy for a posture name; an unknown posture is the balanced default.
 * @param {string} posture - conservative | balanced | aggressive | active.
 * @returns {object} The policy dials.
 */
function riskPolicy(posture) {
  return RISK_POLICIES[String(posture || '').toLowerCase()] || RISK_POLICIES.balanced;
}

/**
 * @description Fold one symbol's per-timeframe closes into a risk-aware call.
 * @param {string} symbol - Ticker.
 * @param {Object<string, number[]>} closesByTf - Timeframe → closes (oldest first).
 * @param {number|null} price - The latest quote price (null when the name has none).
 * @param {object} [params] - Strategy parameter overrides.
 * @returns {{symbol:string,price:number|null,action:'buy'|'sell'|'hold',score:number,confidence:number,regime:number|null,perTimeframe:Array<object>,rationale:string}} The decision (regime null when no regime timeframe has enough history, and the action is then hold).
 */
function decideSymbol(symbol, closesByTf, price, params) {
  const views = [];
  for (const { tf, weight } of TF_WEIGHTS) {
    const closes = (closesByTf && closesByTf[tf]) || [];
    if (closes.length < MIN_BARS) continue;
    const ens = ensemble(scoreSymbol(symbol, closes, params), params && params.ensembleThreshold);
    views.push({ timeframe: tf, weight, action: ens.action, score: ens.score, confidence: ens.confidence, bars: closes.length });
  }
  const totalW = views.reduce((s, v) => s + v.weight, 0) || 1;
  const score = round(views.reduce((s, v) => s + v.weight * v.score, 0) / totalW);
  const confidence = round(views.reduce((s, v) => s + v.weight * v.confidence, 0) / totalW);
  const higher = views.filter((v) => HIGHER_TFS.includes(v.timeframe));
  // No regime view is "regime unknown", never a neutral 0 that passes both gates.
  const regime = higher.length ? round(higher.reduce((s, v) => s + v.score, 0) / higher.length) : null;
  let action = 'hold';
  if (regime != null && score > ACTION_THRESHOLD && regime >= -REGIME_TOLERANCE) action = 'buy';
  else if (regime != null && score < -ACTION_THRESHOLD && regime <= REGIME_TOLERANCE) action = 'sell';
  const missing = TF_WEIGHTS.length - views.length;
  const rationale = `MTF score ${score.toFixed(2)} (regime ${regime == null ? 'missing' : regime.toFixed(2)}, conf ${confidence.toFixed(2)}) → ${action}. `
    + views.map((v) => `${v.timeframe}:${v.action}(${v.score.toFixed(2)})`).join(', ')
    + (missing ? ` [${missing} timeframe(s) without enough history]` : '')
    + (regime == null ? ` [no ${HIGHER_TFS.join('/')} regime yet: holds until it has ${MIN_BARS} bars]` : '');
  return { symbol, price: price > 0 ? price : null, action, score, confidence, regime, perTimeframe: views, rationale };
}

/**
 * @description True when BOTH short timeframes are decisively bearish: the fast, news-driven breakdown
 * the regime-weighted score is too slow to flag.
 * @param {object} d - A decision from decideSymbol.
 * @param {number} [threshold] - Minimum bearish |score| on each short timeframe.
 * @returns {boolean} Whether a protective breakdown exit is warranted.
 */
function isShortTermBreakdown(d, threshold = SHORT_BREAKDOWN_SCORE) {
  const fast = (d && d.perTimeframe ? d.perTimeframe : []).filter((v) => SHORT_TFS.includes(v.timeframe));
  if (fast.length < SHORT_TFS.length) return false;
  return fast.every((v) => v.action === 'sell' && v.score <= -threshold);
}

/**
 * @description Unrealized percent of a position against its own average cost.
 * @param {{qty:number,avgCost:number,unrealizedPl:number}} p - Position.
 * @returns {number} Percent (0 when there is no cost).
 */
function pnlPctOf(p) {
  const cost = p.avgCost * p.qty;
  return cost > 0 ? (p.unrealizedPl / cost) * 100 : 0;
}

/**
 * @description Hard stop / take-profit exits across priced open longs.
 * @param {Array<object>} positions - Marked positions ({symbol, qty, avgCost, currentPrice, unrealizedPl, priced}).
 * @param {object} policy - Risk policy.
 * @returns {Array<{symbol:string,qty:number,reason:string,pnlPct:number}>} Exits.
 */
function exitsToRun(positions, policy) {
  const exits = [];
  for (const p of positions) {
    if (!(p.qty > 0) || !p.priced || !(p.avgCost > 0)) continue;
    const pnlPct = pnlPctOf(p);
    if (pnlPct <= -policy.stopLossPct) exits.push({ symbol: p.symbol, qty: p.qty, reason: 'stop_loss', pnlPct });
    else if (pnlPct >= policy.takeProfitPct) exits.push({ symbol: p.symbol, qty: p.qty, reason: 'take_profit', pnlPct });
  }
  return exits;
}

/**
 * @description Roll each open long's high-water price forward (closed names drop out).
 * @param {Array<object>} positions - Marked positions.
 * @param {Object<string, number>} peaks - Stored peak per symbol.
 * @returns {Object<string, number>} The updated peaks.
 */
function nextPeaks(positions, peaks) {
  const out = {};
  for (const p of positions) {
    if (!(p.qty > 0)) continue;
    const prior = Number(peaks && peaks[p.symbol]) || p.avgCost;
    out[p.symbol] = Math.max(prior, p.currentPrice || p.avgCost, p.avgCost);
  }
  return out;
}

/**
 * @description Trailing-stop exits: a winner arms past trailArmPct and exits on a volatility-scaled giveback from its peak.
 * @param {Array<object>} positions - Marked positions.
 * @param {Object<string, number>} peaks - Rolled-forward peaks.
 * @param {object} policy - Risk policy.
 * @param {Object<string, number>} [volPcts] - Symbol → daily volatility percent.
 * @returns {Array<object>} Exits.
 */
function trailingExits(positions, peaks, policy, volPcts = {}) {
  const exits = [];
  for (const p of positions) {
    if (!(p.qty > 0) || !p.priced || !(p.avgCost > 0) || !(p.currentPrice > 0)) continue;
    const peak = Number(peaks[p.symbol]) || p.avgCost;
    const gainPct = ((p.currentPrice - p.avgCost) / p.avgCost) * 100;
    const givebackPct = peak > 0 ? ((peak - p.currentPrice) / peak) * 100 : 0;
    const vol = Number(volPcts[p.symbol]);
    const volMult = vol > 0 ? Math.max(0.5, Math.min(3, vol / BASELINE_VOL_PCT)) : 1;
    if (gainPct >= policy.trailArmPct && givebackPct >= policy.trailGivebackPct * volMult) {
      exits.push({ symbol: p.symbol, qty: p.qty, reason: 'trailing_stop', pnlPct: gainPct });
    }
  }
  return exits;
}

/**
 * @description Cap-breach trims: sell a name that grew past the per-name cap back down to it (never flatten).
 * @param {Array<object>} positions - Marked positions.
 * @param {number} equity - Book equity (the cap base).
 * @param {object} policy - Risk policy.
 * @returns {Array<object>} Partial exits.
 */
function rebalanceTrims(positions, equity, policy) {
  if (!(equity > 0)) return [];
  const cap = (policy.maxPerNamePct / 100) * equity;
  const trims = [];
  for (const p of positions) {
    if (!(p.qty > 0) || !p.priced || !(p.currentPrice > 0)) continue;
    const mktVal = p.qty * p.currentPrice;
    if (mktVal <= cap) continue;
    const qty = Math.min(Math.floor((mktVal - cap) / p.currentPrice), p.qty - 1);
    if (qty >= 1) trims.push({ symbol: p.symbol, qty, reason: 'cap_trim', pnlPct: pnlPctOf(p) });
  }
  return trims;
}

/**
 * @description Relative-strength rotation: bench a cold holding when a much hotter unheld buy waits on the bench.
 * @param {Array<object>} positions - Marked positions.
 * @param {Map<string, {score:number, action:string}>} strength - Scan strength per symbol.
 * @param {object} policy - Risk policy (bounds swaps per tick).
 * @returns {Array<object>} Rotation exits, coldest first.
 */
function rotationBenches(positions, strength, policy) {
  const held = positions.filter((p) => p.qty > 0);
  if (!held.length) return [];
  const heldSyms = new Set(held.map((p) => p.symbol));
  const candidates = [...strength.entries()].filter(([sym, s]) => s.action === 'buy' && !heldSyms.has(sym)).map(([, s]) => s.score).sort((a, b) => b - a);
  const bestAvail = candidates.length ? candidates[0] : -Infinity;
  if (bestAvail < ROTATION_HOT) return [];
  const cold = held.filter((p) => p.priced)
    .map((p) => ({ p, score: strength.has(p.symbol) ? strength.get(p.symbol).score : -Infinity }))
    .filter((x) => x.score < ROTATION_COLD && bestAvail - x.score >= ROTATION_MARGIN)
    .sort((a, b) => a.score - b.score);
  const n = Math.min(cold.length, candidates.length, Math.max(1, Math.floor(policy.maxPositions / 4)));
  return cold.slice(0, n).map((x) => ({ symbol: x.p.symbol, qty: x.p.qty, reason: 'rotation', pnlPct: pnlPctOf(x.p) }));
}

/**
 * @description Size a proposed buy: conviction-scaled toward the volatility-scaled per-name cap, then
 * clipped by the sector cap, the deployed cap, cash and the person's per-order guardrails.
 * @param {{symbol:string, price:number, confidence:number, volPct?:number}} entry - The candidate.
 * @param {{equity:number, cash:number}} account - Book snapshot.
 * @param {Array<object>} positions - Open positions after this tick's exits.
 * @param {object} policy - Risk policy.
 * @param {{maxShares:number, maxNotional:number}} guardrails - Per-order limits.
 * @returns {{qty:number, notional:number, blocked?:string}} Whole shares to buy, or 0 with the reason.
 */
function sizeEntry(entry, account, positions, policy, guardrails) {
  const { symbol, price, confidence, volPct } = entry;
  const equity = account.equity > 0 ? account.equity : account.cash;
  if (!(price > 0) || !(equity > 0)) return { qty: 0, notional: 0, blocked: 'no price/equity' };
  const open = positions.filter((p) => p.qty > 0);
  if (open.some((p) => p.symbol === symbol)) return { qty: 0, notional: 0, blocked: 'already holding' };
  if (open.length >= policy.maxPositions) return { qty: 0, notional: 0, blocked: `max positions (${policy.maxPositions})` };
  const openPnl = open.reduce((s, p) => s + p.unrealizedPl, 0);
  if (openPnl < -(policy.dailyLossHaltPct / 100) * equity) return { qty: 0, notional: 0, blocked: 'daily-loss halt' };
  const mv = (p) => Math.max(0, p.qty * (p.currentPrice || p.avgCost));
  const deployed = open.reduce((s, p) => s + mv(p), 0);
  const sector = sectorOf(symbol);
  const sectorDeployed = open.filter((p) => sectorOf(p.symbol) === sector).reduce((s, p) => s + mv(p), 0);
  const volScale = volPct > 0 ? Math.max(0.25, Math.min(1, BASELINE_VOL_PCT / volPct)) : 1;
  const target = (policy.maxPerNamePct / 100) * equity * volScale * Math.max(0.2, Math.min(1, confidence));
  const sectorRoom = (policy.maxSectorPct / 100) * equity - sectorDeployed;
  const totalRoom = (policy.maxDeployedPct / 100) * equity - deployed;
  const cashRoom = Math.max(0, account.cash);
  const notionalCap = Math.min(target, sectorRoom, totalRoom, cashRoom, guardrails.maxNotional);
  if (notionalCap <= price) {
    const why = sectorRoom <= price ? `sector cap (${policy.maxSectorPct}%)` : totalRoom <= price ? `deployed cap (${policy.maxDeployedPct}%)`
      : cashRoom <= price ? 'insufficient cash' : guardrails.maxNotional <= price ? `max notional ($${guardrails.maxNotional})` : 'below 1 share';
    return { qty: 0, notional: 0, blocked: why };
  }
  const qty = Math.min(Math.floor(notionalCap / price), guardrails.maxShares);
  if (qty < 1) return { qty: 0, notional: 0, blocked: `max shares (${guardrails.maxShares})` };
  return { qty, notional: round(qty * price, 2) };
}

/**
 * @description Whether the drawdown circuit breaker halts new buys (equity this far below its high-water mark).
 * @param {number} equity - Current equity.
 * @param {number} highWater - Peak equity.
 * @param {object} policy - Risk policy.
 * @returns {boolean} True when new entries must wait.
 */
function drawdownHalted(equity, highWater, policy) {
  if (!(highWater > 0)) return false;
  return (highWater - equity) / highWater >= policy.maxDrawdownPct / 100;
}

module.exports = {
  TF_WEIGHTS, HIGHER_TFS, MIN_BARS, RISK_POLICIES, riskPolicy, decideSymbol, isShortTermBreakdown, exitsToRun, nextPeaks,
  trailingExits, rebalanceTrims, rotationBenches, sizeEntry, drawdownHalted, pnlPctOf,
};
