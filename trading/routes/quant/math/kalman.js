/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Kalman filter for the quant's math core: a linear Gaussian state-space filter with one observation per step, and its everyday use in pairs trading, a hedge ratio that is allowed to drift (y = beta_t x + alpha_t + noise, with beta and alpha random walks).
 */
'use strict';
const { fail, finite, positive, numbers, paired } = require('./checks');
const { matVec, multiply, transpose, add } = require('./linalg');
const { ols } = require('./regression');
const { variance } = require('./stats');
const { goldenSection } = require('./optimize');

/**
 * @description One predict-and-update step of a Kalman filter with a scalar observation y = h'x + v.
 * @param {{x:number[], p:number[][]}} prior - State mean and covariance before predicting.
 * @param {{F:number[][], Q:number[][], h:number[], R:number, y:number}} step - Transition, state noise, design row, observation noise and value.
 * @returns {{x:number[], p:number[][], innovation:number, innovationVariance:number}} The updated state and the surprise.
 */
function kalmanStep({ x, p }, { F, Q, h, R, y }) {
  const xp = matVec(F, x), pp = add(multiply(multiply(F, p), transpose(F)), Q);
  const ph = matVec(pp, h), s = h.reduce((acc, hi, i) => acc + hi * ph[i], 0) + R;
  if (!(s > 0)) throw fail('The filter lost all uncertainty; observation noise must be above zero.');
  const innovation = y - h.reduce((acc, hi, i) => acc + hi * xp[i], 0), gain = ph.map((v) => v / s);
  return { x: xp.map((v, i) => v + gain[i] * innovation), p: pp.map((row, i) => row.map((v, j) => v - gain[i] * ph[j])), innovation, innovationVariance: s };
}

/**
 * @description The Kalman filter: track a hidden state that moves by x[t] = F x[t-1] + w (w ~ N(0, Q)) from noisy observations
 * y[t] = h[t]' x[t] + v (v ~ N(0, R)). Each step blends the prediction with the new observation in proportion to their
 * uncertainties.
 * @param {{observations:number[], design:number[][], F:number[][], Q:number[][], R:number, x0:number[], P0:number[][]}} model - Observations, one design row per observation, the model and the starting belief.
 * @returns {{states:number[][], innovations:number[], innovationVariances:number[], logLikelihood:number}} Filtered states and surprises.
 */
function kalmanFilter({ observations, design, F, Q, R, x0, P0 }) {
  numbers(observations, 'observations', 2); numbers(x0, 'x0'); positive(R, 'R');
  if (!Array.isArray(design) || design.length !== observations.length) throw fail('Give one design row per observation.');
  let belief = { x: x0, p: P0 };
  const states = [], innovations = [], innovationVariances = [];
  let logLikelihood = 0;
  observations.forEach((y, t) => {
    belief = kalmanStep(belief, { F, Q, h: design[t], R, y: finite(y, 'observation') });
    states.push(belief.x); innovations.push(belief.innovation); innovationVariances.push(belief.innovationVariance);
    logLikelihood -= 0.5 * (Math.log(2 * Math.PI * belief.innovationVariance) + belief.innovation ** 2 / belief.innovationVariance);
  });
  return { states, innovations, innovationVariances, logLikelihood };
}

/**
 * @description Run the pair's Kalman regression for one observation noise.
 * @param {number[]} y - First series.
 * @param {number[]} x - Second series.
 * @param {number} q - State noise per step.
 * @param {number} R - Observation noise.
 * @returns {object} The filter's result.
 */
function pairFilter(y, x, q, R) {
  // A diffuse start: the filter learns beta and alpha from the data instead of trusting a static fit's answer.
  return kalmanFilter({ observations: y, design: x.map((v) => [v, 1]), F: [[1, 0], [0, 1]], Q: [[q, 0], [0, q]], R, x0: [0, 0], P0: [[1e8, 0], [0, 1e8]] });
}

/**
 * @description A drifting hedge ratio for a pair (Kalman regression): y[t] = beta[t] x[t] + alpha[t] + noise, where beta and
 * alpha wander as random walks with variance delta / (1 - delta) per step. A small delta trusts the past; a large one adapts
 * fast. The observation noise is chosen by maximum likelihood unless given (a static fit's leftover variance would count
 * the ratio's own drift as noise and slow the filter down). The last innovation over its standard deviation is the spread's z-score.
 * @param {number[]} y - First price series.
 * @param {number[]} x - Second price series, same dates.
 * @param {{delta?:number, observationVariance?:number}} [options] - delta (1e-5) and, optionally, a fixed observation noise.
 * @returns {{hedgeRatios:number[], intercepts:number[], spread:number[], zScore:number, staticHedgeRatio:number, observationVariance:number}} The path and the latest z-score.
 */
function dynamicHedgeRatio(y, x, { delta = 1e-5, observationVariance = null } = {}) {
  paired(y, x, 'Both price series', 20);
  if (!(finite(delta, 'delta') > 0 && delta < 1)) throw fail('delta must be between 0 and 1.');
  const q = delta / (1 - delta), scale = variance(y);
  if (!(scale > 0)) throw fail('A price series that never moves cannot be hedged.');
  const R = observationVariance != null ? positive(observationVariance, 'observationVariance')
    : 10 ** goldenSection((lr) => -pairFilter(y, x, q, 10 ** lr).logLikelihood, Math.log10(scale) - 10, Math.log10(scale), { tolerance: 1e-3 }).x;
  const result = pairFilter(y, x, q, R), last = result.innovations.length - 1;
  return {
    hedgeRatios: result.states.map((s) => s[0]), intercepts: result.states.map((s) => s[1]), spread: result.innovations,
    zScore: result.innovations[last] / Math.sqrt(result.innovationVariances[last]), staticHedgeRatio: ols(y, [x]).coefficients[1].estimate, observationVariance: R,
  };
}

module.exports = { kalmanStep, kalmanFilter, dynamicHedgeRatio };
