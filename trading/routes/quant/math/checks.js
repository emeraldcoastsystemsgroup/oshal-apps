/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Input checks shared by the quant's math core: a number the math cannot use is refused with the reason in words (status 400, code quant_input), never coerced, so a tool never answers from a silently repaired input.
 */
'use strict';

/**
 * @description An input the math cannot use: a refusal a route answers as 400 with the reason in words.
 * @param {string} message - What is wrong, in plain words.
 * @returns {RangeError} The error to throw (status 400, code quant_input).
 */
function fail(message) {
  return Object.assign(new RangeError(message), { status: 400, code: 'quant_input' });
}

/**
 * @description A finite number, or a refusal naming the input.
 * @param {*} x - Candidate.
 * @param {string} name - Input name for the message.
 * @returns {number} The number.
 */
function finite(x, name) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw fail(`${name} must be a finite number.`);
  return x;
}

/**
 * @description A number above zero.
 * @param {*} x - Candidate.
 * @param {string} name - Input name.
 * @returns {number} The number.
 */
function positive(x, name) {
  if (!(finite(x, name) > 0)) throw fail(`${name} must be above zero.`);
  return x;
}

/**
 * @description A number at or above zero.
 * @param {*} x - Candidate.
 * @param {string} name - Input name.
 * @returns {number} The number.
 */
function nonNegative(x, name) {
  if (!(finite(x, name) >= 0)) throw fail(`${name} must be zero or more.`);
  return x;
}

/**
 * @description A probability strictly between 0 and 1.
 * @param {*} p - Candidate.
 * @param {string} name - Input name.
 * @returns {number} The probability.
 */
function probability(p, name) {
  if (!(finite(p, name) > 0 && p < 1)) throw fail(`${name} must be between 0 and 1 (exclusive).`);
  return p;
}

/**
 * @description A whole number inside a range.
 * @param {*} n - Candidate.
 * @param {string} name - Input name.
 * @param {number} lo - Smallest allowed.
 * @param {number} hi - Largest allowed.
 * @returns {number} The whole number.
 */
function integer(n, name, lo, hi) {
  if (!Number.isInteger(n) || n < lo || n > hi) throw fail(`${name} must be a whole number from ${lo} to ${hi}.`);
  return n;
}

/**
 * @description An array of finite numbers with at least a minimum length.
 * @param {*} values - Candidate array.
 * @param {string} name - Input name.
 * @param {number} [min] - Least length.
 * @returns {number[]} The array.
 */
function numbers(values, name, min = 1) {
  if (!Array.isArray(values) || values.length < min) throw fail(`${name} needs at least ${min} numbers.`);
  for (const v of values) if (typeof v !== 'number' || !Number.isFinite(v)) throw fail(`${name} must hold finite numbers only.`);
  return values;
}

/**
 * @description Two series of equal length (paired observations).
 * @param {number[]} a - First series.
 * @param {number[]} b - Second series.
 * @param {string} names - Both names for the message.
 * @param {number} [min] - Least length.
 * @returns {void}
 */
function paired(a, b, names, min = 2) {
  numbers(a, names, min);
  numbers(b, names, min);
  if (a.length !== b.length) throw fail(`${names} must be the same length.`);
}

module.exports = { fail, finite, positive, nonNegative, probability, integer, numbers, paired };
