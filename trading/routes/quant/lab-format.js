/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | How the quant lab's answers read: numbers rounded to what is meaningful, percentages in words, a figure that could not be worked out says why instead of showing a number, and every answer states that it is research and never an instruction to trade.
 */
'use strict';

const RESEARCH_ONLY = 'Research only: a calculation from past prices, not a forecast you can count on and never an instruction to buy or sell.';

/**
 * @description Round every number in a value (deeply) to significant digits, so a tiny p-value or a GARCH omega keeps its
 * meaning and a price keeps its cents; non-finite numbers become null.
 * @param {*} value - Any JSON-like value.
 * @param {number} [digits] - Significant digits (6).
 * @returns {*} The rounded copy.
 */
function rounded(value, digits = 6) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toPrecision(digits)) : null;
  if (Array.isArray(value)) return value.map((v) => rounded(v, digits));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v, digits)]));
  return value;
}

/**
 * @description A fraction as a percentage in words, e.g. 0.1234 -> "12.34%".
 * @param {number|null} x - Fraction.
 * @param {number} [places] - Decimal places (2).
 * @returns {string} The text, or "not available".
 */
function pct(x, places = 2) {
  return x == null || !Number.isFinite(x) ? 'not available' : `${(x * 100).toFixed(places)}%`;
}

/**
 * @description Run one calculation, answering {unavailable: reason} instead of failing the whole answer when its inputs
 * cannot support it (too little history, a series that never moves).
 * @param {() => *} work - The calculation.
 * @returns {*} Its result, or {unavailable: reason}.
 */
function attempt(work) {
  try { return work(); } catch (err) { return { unavailable: String((err && err.message) || err).slice(0, 200) }; }
}

/**
 * @description Whether a calculation has enough observations, as a reason when it does not.
 * @param {number} have - Observations available.
 * @param {number} need - Observations required.
 * @param {string} what - The calculation, in words.
 * @returns {{unavailable:string}|null} The reason, or null when there are enough.
 */
function needs(have, need, what) {
  return have >= need ? null : { unavailable: `${what} needs at least ${need} daily returns; this history has ${have}.` };
}

module.exports = { RESEARCH_ONLY, rounded, pct, attempt, needs };
