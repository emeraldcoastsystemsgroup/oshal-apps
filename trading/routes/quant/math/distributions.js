/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Probability distributions for the quant's math core: the normal (bell curve) density, cumulative probability to double precision (Hart 1968, as published by West 2005) and its inverse (Acklam with a Halley step), Student's t, the chi-square and the gamma and beta functions behind them. Fixed published algorithms; nothing is fitted.
 */
'use strict';
const { finite, positive, probability } = require('./checks');

const SQRT2PI = 2.5066282746310002;
const TINY = 1e-300;
const EPS = 3e-16;
const LANCZOS = Object.freeze([0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]);
const ACKLAM_A = Object.freeze([-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]);
const ACKLAM_B = Object.freeze([-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]);
const ACKLAM_C = Object.freeze([-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]);
const ACKLAM_D = Object.freeze([7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]);

/**
 * @description Evaluate a polynomial with coefficients from the highest power down (Horner's rule).
 * @param {number[]} coefficients - Highest power first.
 * @param {number} x - Point.
 * @returns {number} The value.
 */
function horner(coefficients, x) {
  return coefficients.reduce((acc, c) => acc * x + c, 0);
}

/**
 * @description The standard normal density (the height of the bell curve) at x.
 * @param {number} x - Point.
 * @returns {number} The density.
 */
function normalPdf(x) {
  return Math.exp(-0.5 * finite(x, 'x') * x) / SQRT2PI;
}

/**
 * @description The standard normal cumulative probability P(Z <= x), double precision (Hart 1968; West 2005).
 * @param {number} x - Point.
 * @returns {number} The probability.
 */
function normalCdf(x) {
  const z = Math.abs(finite(x, 'x'));
  let tail = 0;
  if (z <= 37) {
    const e = Math.exp(-z * z / 2);
    if (z < 7.07106781186547) {
      const num = horner([3.52624965998911e-2, 0.700383064443688, 6.37396220353165, 33.912866078383, 112.079291497871, 221.213596169931, 220.206867912376], z);
      const den = horner([8.83883476483184e-2, 1.75566716318264, 16.064177579207, 86.7807322029461, 296.564248779674, 637.333633378831, 793.826512519948, 440.413735824752], z);
      tail = e * num / den;
    } else {
      let b = z + 0.65;
      for (const k of [4, 3, 2, 1]) b = z + k / b;
      tail = e / b / SQRT2PI;
    }
  }
  return x > 0 ? 1 - tail : tail;
}

/**
 * @description The standard normal quantile: the x with P(Z <= x) = p (Acklam's rational approximation and one Halley step).
 * @param {number} p - Probability strictly between 0 and 1.
 * @returns {number} The quantile.
 */
function normalInv(p) {
  probability(p, 'p');
  let x;
  if (p < 0.02425 || p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)));
    x = horner(ACKLAM_C, q) / (horner(ACKLAM_D, q) * q + 1);
    if (p > 0.5) x = -x;
  } else {
    const q = p - 0.5, r = q * q;
    x = horner(ACKLAM_A, r) * q / (horner(ACKLAM_B, r) * r + 1);
  }
  const e = normalCdf(x) - p, u = e * SQRT2PI * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

/**
 * @description The natural log of the gamma function (Lanczos, g = 7).
 * @param {number} x - Positive argument.
 * @returns {number} ln Gamma(x).
 */
function logGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const y = x - 1, t = y + 7.5;
  let a = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i += 1) a += LANCZOS[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * @description The continued fraction of the incomplete beta function (modified Lentz).
 * @param {number} a - Shape a.
 * @param {number} b - Shape b.
 * @param {number} x - Point in (0, 1).
 * @returns {number} The fraction's value.
 */
function betaFraction(a, b, x) {
  const clamp = (v) => (Math.abs(v) < TINY ? TINY : v);
  let c = 1, d = 1 / clamp(1 - (a + b) * x / (a + 1)), h = d;
  for (let m = 1; m <= 400; m += 1) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2));
    d = 1 / clamp(1 + aa * d); c = clamp(1 + aa / c); h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2));
    d = 1 / clamp(1 + aa * d); c = clamp(1 + aa / c);
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < EPS) break;
  }
  return h;
}

/**
 * @description The regularized incomplete beta function I_x(a, b).
 * @param {number} x - Point in [0, 1].
 * @param {number} a - Shape a (positive).
 * @param {number} b - Shape b (positive).
 * @returns {number} The value in [0, 1].
 */
function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? front * betaFraction(a, b, x) / a : 1 - front * betaFraction(b, a, 1 - x) / b;
}

/**
 * @description The regularized gamma functions P(a, x) and Q(a, x) = 1 - P, each computed where it is accurate.
 * @param {number} a - Shape (positive).
 * @param {number} x - Point (zero or more).
 * @returns {{lower:number, upper:number}} P and Q.
 */
function gammaRegularized(a, x) {
  if (x <= 0) return { lower: 0, upper: 1 };
  const front = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    let term = 1 / a, total = term;
    for (let n = 1; n <= 1000 && Math.abs(term) > Math.abs(total) * EPS; n += 1) { term *= x / (a + n); total += term; }
    const lower = total * front;
    return { lower, upper: 1 - lower };
  }
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i <= 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < EPS) break;
  }
  const upper = front * h;
  return { lower: 1 - upper, upper };
}

/**
 * @description The chi-square cumulative probability and its upper tail (the p-value of a chi-square statistic).
 * @param {number} x - Statistic (zero or more).
 * @param {number} k - Degrees of freedom (positive).
 * @returns {{cdf:number, pValue:number}} P(X <= x) and P(X > x).
 */
function chiSquare(x, k) {
  positive(k, 'degrees of freedom');
  const g = gammaRegularized(k / 2, Math.max(0, finite(x, 'statistic')) / 2);
  return { cdf: g.lower, pValue: g.upper };
}

/**
 * @description Student's t density.
 * @param {number} t - Point.
 * @param {number} nu - Degrees of freedom (positive).
 * @returns {number} The density.
 */
function studentTPdf(t, nu) {
  positive(nu, 'degrees of freedom');
  return Math.exp(logGamma((nu + 1) / 2) - logGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - ((nu + 1) / 2) * Math.log(1 + t * t / nu));
}

/**
 * @description Student's t cumulative probability P(T <= t).
 * @param {number} t - Point.
 * @param {number} nu - Degrees of freedom (positive).
 * @returns {number} The probability.
 */
function studentTCdf(t, nu) {
  positive(nu, 'degrees of freedom');
  const tail = 0.5 * betaInc(nu / (nu + finite(t, 't') * t), nu / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/**
 * @description Student's t quantile: the t with P(T <= t) = p (bracketing then bisection to machine precision).
 * @param {number} p - Probability strictly between 0 and 1.
 * @param {number} nu - Degrees of freedom (positive).
 * @returns {number} The quantile.
 */
function studentTInv(p, nu) {
  probability(p, 'p');
  positive(nu, 'degrees of freedom');
  let lo = -1, hi = 1;
  while (studentTCdf(lo, nu) > p) lo *= 2;
  while (studentTCdf(hi, nu) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-14 * Math.max(1, Math.abs(lo)); i += 1) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, nu) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * @description The two-sided p-value of a t statistic.
 * @param {number} t - Statistic.
 * @param {number} nu - Degrees of freedom.
 * @returns {number} P(|T| >= |t|).
 */
function twoSidedT(t, nu) {
  return Math.min(1, 2 * studentTCdf(-Math.abs(t), nu));
}

module.exports = { SQRT2PI, normalPdf, normalCdf, normalInv, logGamma, betaInc, gammaRegularized, chiSquare, studentTPdf, studentTCdf, studentTInv, twoSidedT };
