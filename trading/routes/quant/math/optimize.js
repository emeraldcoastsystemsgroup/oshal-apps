/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Numerical optimizers for the quant's math core: Nelder-Mead simplex search (GARCH fits), golden-section search on an interval (Student-t tails) and a bracketing root finder (implied volatility). Deterministic, bounded by an iteration cap so a fit can never hold up the Trading process.
 */
'use strict';
const { fail } = require('./checks');

/**
 * @description The starting simplex: the start point and one point stepped along each axis.
 * @param {number[]} x0 - Start point.
 * @param {number} step - Step along each axis.
 * @returns {number[][]} n + 1 points.
 */
function startSimplex(x0, step) {
  return [x0.slice(), ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))];
}

/**
 * @description One Nelder-Mead move: reflect the worst point through the centroid, expand, contract or shrink.
 * @param {Array<{x:number[], f:number}>} pts - Points sorted best first.
 * @param {(x:number[]) => number} f - Objective.
 * @returns {void}
 */
function nelderMeadStep(pts, f) {
  const n = pts.length - 1, worst = pts[n];
  const centroid = pts[0].x.map((_, j) => pts.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
  const along = (k) => centroid.map((c, j) => c + k * (worst.x[j] - c));
  const evaluate = (x) => ({ x, f: f(x) });
  const reflected = evaluate(along(-1));
  if (reflected.f < pts[0].f) {
    const expanded = evaluate(along(-2));
    pts[n] = expanded.f < reflected.f ? expanded : reflected;
  } else if (reflected.f < pts[n - 1].f) {
    pts[n] = reflected;
  } else {
    const contracted = evaluate(along(reflected.f < worst.f ? -0.5 : 0.5));
    if (contracted.f < Math.min(reflected.f, worst.f)) pts[n] = contracted;
    else for (let i = 1; i <= n; i += 1) pts[i] = evaluate(pts[0].x.map((b, j) => b + 0.5 * (pts[i].x[j] - b)));
  }
}

/**
 * @description Minimize a function of several variables by the Nelder-Mead simplex method. A non-finite value counts as
 * infinitely bad, so an objective may refuse a point by returning Infinity.
 * @param {(x:number[]) => number} f - Objective.
 * @param {number[]} x0 - Start point.
 * @param {{step?:number, maxIterations?:number, tolerance?:number}} [options] - Initial step (0.5), iteration cap (2000), stop when the simplex's values agree to tolerance (1e-10).
 * @returns {{x:number[], f:number, iterations:number, converged:boolean}} The best point found.
 */
function nelderMead(f, x0, { step = 0.5, maxIterations = 2000, tolerance = 1e-10 } = {}) {
  if (!Array.isArray(x0) || !x0.length) throw fail('The optimizer needs a start point.');
  const safe = (x) => { const v = f(x); return Number.isFinite(v) ? v : Infinity; };
  const pts = startSimplex(x0, step).map((x) => ({ x, f: safe(x) }));
  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    pts.sort((a, b) => a.f - b.f);
    if (Math.abs(pts[pts.length - 1].f - pts[0].f) <= tolerance * (Math.abs(pts[0].f) + tolerance)) break;
    nelderMeadStep(pts, safe);
  }
  pts.sort((a, b) => a.f - b.f);
  return { x: pts[0].x, f: pts[0].f, iterations, converged: iterations < maxIterations };
}

/**
 * @description Minimize a function of one variable on an interval by golden-section search.
 * @param {(x:number) => number} f - Objective (unimodal on the interval).
 * @param {number} lo - Interval start.
 * @param {number} hi - Interval end.
 * @param {{tolerance?:number}} [options] - Stop width (1e-8).
 * @returns {{x:number, f:number}} The minimum found.
 */
function goldenSection(f, lo, hi, { tolerance = 1e-8 } = {}) {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < 200 && b - a > tolerance; i += 1) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  const x = (a + b) / 2;
  return { x, f: f(x) };
}

/**
 * @description A root of f on an interval where f changes sign (bisection with secant steps; always converges).
 * @param {(x:number) => number} f - Function.
 * @param {number} lo - Interval start.
 * @param {number} hi - Interval end.
 * @param {{tolerance?:number}} [options] - Stop width (1e-12).
 * @returns {number|null} The root, or null when f does not change sign on the interval.
 */
function bracketRoot(f, lo, hi, { tolerance = 1e-12 } = {}) {
  let a = lo, b = hi, fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return null;
  for (let i = 0; i < 300 && Math.abs(b - a) > tolerance * Math.max(1, Math.abs(a)); i += 1) {
    const secant = b - fb * (b - a) / (fb - fa), mid = (a + b) / 2;
    const x = secant > Math.min(a, b) && secant < Math.max(a, b) && i % 3 !== 2 ? secant : mid, fx = f(x);
    if (fx === 0) return x;
    if (fa * fx < 0) { b = x; fb = fx; } else { a = x; fa = fx; }
  }
  return (a + b) / 2;
}

module.exports = { nelderMead, goldenSection, bracketRoot };
