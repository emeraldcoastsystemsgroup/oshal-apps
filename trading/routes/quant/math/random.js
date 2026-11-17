/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Seeded random numbers for the quant's simulations: the same seed gives the same paths on every run and every computer, so a Monte Carlo answer can be repeated and checked. Uniform (mulberry32), normal (Box-Muller), gamma (Marsaglia-Tsang) and Student's t draws.
 */
'use strict';
const { integer, positive } = require('./checks');

/**
 * @description A seeded uniform generator on [0, 1) (mulberry32).
 * @param {number} seed - Whole-number seed.
 * @returns {() => number} The generator.
 */
function uniformSource(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @description A gamma(shape, 1) draw by Marsaglia and Tsang (2000); shapes below 1 use the boost u^(1/shape).
 * @param {() => number} uniform - Uniform source.
 * @param {() => number} normal - Normal source.
 * @param {number} shape - Shape (positive).
 * @returns {number} The draw.
 */
function gammaDraw(uniform, normal, shape) {
  if (shape < 1) return gammaDraw(uniform, normal, shape + 1) * uniform() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(), v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = uniform();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * @description A seeded source of uniform, normal, gamma and Student's t draws, and whole numbers below n.
 * @param {number} seed - Whole number from 0 to 4294967295.
 * @returns {{uniform:() => number, normal:() => number, gamma:(shape:number) => number, studentT:(nu:number) => number, below:(n:number) => number}} The source.
 */
function randomSource(seed) {
  integer(seed, 'seed', 0, 4294967295);
  const uniform = uniformSource(seed);
  let spare = null;
  const normal = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0;
    while (u <= 0) u = uniform();
    const r = Math.sqrt(-2 * Math.log(u)), angle = 2 * Math.PI * uniform();
    spare = r * Math.sin(angle);
    return r * Math.cos(angle);
  };
  const gamma = (shape) => gammaDraw(uniform, normal, positive(shape, 'shape'));
  // A t draw is a normal over the root of an independent chi-square per degree of freedom; chi-square(nu) = 2 * gamma(nu / 2).
  const studentT = (nu) => normal() / Math.sqrt(2 * gamma(positive(nu, 'degrees of freedom') / 2) / nu);
  const below = (n) => Math.floor(uniform() * n);
  return { uniform, normal, gamma, studentT, below };
}

module.exports = { uniformSource, randomSource };
