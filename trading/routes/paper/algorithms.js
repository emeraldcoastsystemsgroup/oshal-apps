/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the deterministic per-series algorithms of the native paper engine, ported from the legacy engine's algorithms.ts (momentum close-vs-SMA, gravity masses and displacement, donchian breakout, RSI mean reversion gated to range-bound tape) and its confidence-weighted ensemble, with the same default strategy parameters. Pure functions of a close series: same closes in, same signal out, no model and no randomness.
 *
 * @module paper/algorithms
 */
'use strict';

/** The long-standing default parameters (an empty override reproduces the legacy engine exactly). */
const DEFAULT_STRATEGY_PARAMS = Object.freeze({
  momentumSma: 20, rsiLow: 35, rsiHigh: 65, donchianWindow: 20, ensembleThreshold: 0.15, meanrevMaxTrendGap: 0.04,
});

const MAX_SWING = 0.6;

/**
 * @description Round to a fixed number of decimals (stable decision records).
 * @param {number} n - Value.
 * @param {number} [d=4] - Decimals.
 * @returns {number} The rounded value.
 */
function round(n, d = 4) { const f = 10 ** d; return Math.round(n * f) / f; }

/**
 * @description Arithmetic mean (0 for an empty list).
 * @param {number[]} a - Values.
 * @returns {number} The mean.
 */
function avg(a) { return a.reduce((s, x) => s + x, 0) / (a.length || 1); }

/**
 * @description Simple period-over-period returns of a close series.
 * @param {number[]} c - Closes, oldest first.
 * @returns {number[]} The returns (length c.length - 1).
 */
function pctReturns(c) {
  const r = [];
  for (let i = 1; i < c.length; i += 1) r.push((c[i] - c[i - 1]) / c[i - 1]);
  return r;
}

/**
 * @description Simple moving average ending at index i, or null when the window is not full.
 * @param {number[]} c - Closes.
 * @param {number} i - Last index.
 * @param {number} p - Window.
 * @returns {number|null} The average.
 */
function sma(c, i, p) {
  if (i + 1 < p) return null;
  let s = 0;
  for (let k = i - p + 1; k <= i; k += 1) s += c[k];
  return s / p;
}

/**
 * @description Cutler RSI over n periods ending at index i, or null without enough history.
 * @param {number[]} c - Closes.
 * @param {number} i - Last index.
 * @param {number} [n=14] - Periods.
 * @returns {number|null} RSI 0..100.
 */
function rsi(c, i, n = 14) {
  if (i < n) return null;
  let up = 0; let dn = 0;
  for (let k = i - n + 1; k <= i; k += 1) { const d = c[k] - c[k - 1]; if (d > 0) up += d; else dn -= d; }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}

/**
 * @description The market-derived gravity masses of one close series (trend, volatility shock, stretch).
 * @param {string} symbol - Ticker (labels only).
 * @param {number[]} closes - Closes, oldest first.
 * @returns {Array<{source:string,mass:number,polarity:number,proximity:number,halfLifeDays:number,t0Day:number}>} Masses.
 */
function deriveMasses(symbol, closes) {
  const masses = []; const n = closes.length;
  if (n < 25) return masses;
  const last = closes[n - 1];
  const sma50 = avg(closes.slice(-50)); const trend = (last - sma50) / sma50;
  masses.push({ source: 'market/trend', label: `${symbol} trend`, mass: Math.min(1, Math.abs(trend) * 6), polarity: trend >= 0 ? 1 : -1, proximity: 1, halfLifeDays: 30, t0Day: 0 });
  const rets = pctReturns(closes); const recent = rets.slice(-21); const mu = avg(recent);
  const sd = Math.sqrt(avg(recent.map((x) => (x - mu) ** 2))) || 1e-9; const z = (rets[rets.length - 1] - mu) / sd;
  if (Math.abs(z) > 1.5) masses.push({ source: 'market/shock', label: `${symbol} vol-shock`, mass: Math.min(1, Math.abs(z) / 4), polarity: z >= 0 ? 1 : -1, proximity: 1, halfLifeDays: 5, t0Day: 0 });
  const sma20 = avg(closes.slice(-20)); const gap = (last - sma20) / sma20;
  if (Math.abs(gap) > 0.08) masses.push({ source: 'market/mean-reversion', label: `${symbol} stretched`, mass: Math.min(1, Math.abs(gap) * 3), polarity: gap > 0 ? -1 : 1, proximity: 0.6, halfLifeDays: 10, t0Day: 0 });
  return masses;
}

/**
 * @description Net fractional displacement of a mass set at day t, clamped to the maximum swing.
 * @param {Array<object>} masses - Masses from deriveMasses.
 * @param {number} [t=0] - Day offset.
 * @returns {number} Displacement in -0.6..0.6.
 */
function displacement(masses, t = 0) {
  let pull = 0; let damp = 0;
  for (const m of masses) {
    const decay = t < m.t0Day ? 0 : 0.5 ** ((t - m.t0Day) / Math.max(0.5, m.halfLifeDays));
    const c = m.polarity * m.mass * m.proximity * decay;
    if (m.antigravity) damp += Math.abs(c); else pull += c;
  }
  return Math.max(-MAX_SWING, Math.min(MAX_SWING, pull * Math.max(0, 1 - damp)));
}

/** The four voting algorithms: (closes, ctx) -> signal | null (null = no call). */
const ALGORITHMS = {
  momentum: (c, ctx) => {
    const w = ctx.params.momentumSma; const i = c.length - 1; const m = sma(c, i, w);
    if (m == null) return null;
    const g = (c[i] - m) / m;
    return { algo: 'momentum', dir: g >= 0 ? 'up' : 'down', confidence: Math.min(1, Math.abs(g) * 12), basis: `close vs SMA${w} ${(g * 100).toFixed(1)}%` };
  },
  gravity: (c, ctx) => {
    const masses = deriveMasses(ctx.symbol, c); const d = displacement(masses, 0);
    if (Math.abs(d) < 0.01) return null;
    return { algo: 'gravity', dir: d > 0 ? 'up' : 'down', confidence: Math.min(1, Math.abs(d) * 2), basis: `${masses.length} masses → ${(d * 100).toFixed(1)}%` };
  },
  donchian: (c, ctx) => {
    const w = ctx.params.donchianWindow; const i = c.length - 1;
    if (i < w) return null;
    let hi = -Infinity; let lo = Infinity;
    for (let k = i - w; k < i; k += 1) { hi = Math.max(hi, c[k]); lo = Math.min(lo, c[k]); }
    if (c[i] > hi) return { algo: 'donchian', dir: 'up', confidence: 0.7, basis: `${w}-bar breakout high` };
    if (c[i] < lo) return { algo: 'donchian', dir: 'down', confidence: 0.7, basis: `${w}-bar breakdown low` };
    return null;
  },
  meanrev: (c, ctx) => {
    const { rsiLow: lo, rsiHigh: hi, meanrevMaxTrendGap: maxGap, momentumSma: w } = ctx.params;
    const i = c.length - 1; const r = rsi(c, i, 14);
    if (r == null) return null;
    const m = sma(c, i, w);
    if (m == null) return null;
    const gap = (c[i] - m) / m;
    if (r < lo && gap >= -maxGap) return { algo: 'meanrev', dir: 'up', confidence: Math.min(1, (lo - r) / Math.max(1, lo)), basis: `RSI ${r.toFixed(0)} oversold` };
    if (r > hi && gap <= maxGap) return { algo: 'meanrev', dir: 'down', confidence: Math.min(1, (r - hi) / Math.max(1, 100 - hi)), basis: `RSI ${r.toFixed(0)} overbought` };
    return null;
  },
};

/**
 * @description Run every voting algorithm over one close series and keep the ones that fire.
 * @param {string} symbol - Ticker.
 * @param {number[]} closes - Closes, oldest first.
 * @param {object} [params] - Partial strategy parameters (defaults fill the rest).
 * @returns {Array<{algo:string,dir:'up'|'down',confidence:number,basis:string}>} The firing signals.
 */
function scoreSymbol(symbol, closes, params) {
  const ctx = { symbol, params: { ...DEFAULT_STRATEGY_PARAMS, ...(params || {}) } };
  return Object.values(ALGORITHMS).map((fn) => fn(closes, ctx)).filter(Boolean);
}

/**
 * @description Fold algorithm signals into one confidence-weighted call.
 * @param {Array<object>} signals - Firing signals.
 * @param {number} [threshold] - |score| an action must clear, else hold.
 * @returns {{action:'buy'|'sell'|'hold',confidence:number,score:number,votes:Array<object>}} The ensemble call.
 */
function ensemble(signals, threshold = DEFAULT_STRATEGY_PARAMS.ensembleThreshold) {
  if (!signals.length) return { action: 'hold', confidence: 0, score: 0, votes: [] };
  let score = 0; let w = 0;
  for (const s of signals) { score += (s.dir === 'up' ? 1 : -1) * s.confidence; w += s.confidence; }
  const norm = w ? score / w : 0;
  const action = norm > threshold ? 'buy' : norm < -threshold ? 'sell' : 'hold';
  return { action, confidence: round(Math.abs(norm)), score: round(norm), votes: signals };
}

/**
 * @description Daily volatility in percent: the standard deviation of the last 14 close-to-close returns.
 * @param {number[]} closes - Daily closes, oldest first.
 * @returns {number|null} Volatility percent, or null with fewer than 15 closes.
 */
function realizedVolPct(closes) {
  if (!Array.isArray(closes) || closes.length < 15) return null;
  const rets = pctReturns(closes.slice(-15));
  const mu = avg(rets);
  return round(Math.sqrt(avg(rets.map((x) => (x - mu) ** 2))) * 100, 4);
}

module.exports = { DEFAULT_STRATEGY_PARAMS, round, avg, sma, rsi, deriveMasses, displacement, scoreSymbol, ensemble, realizedVolPct };
