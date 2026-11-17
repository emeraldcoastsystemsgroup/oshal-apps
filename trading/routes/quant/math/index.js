/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant's deterministic math core in one place: every module under routes/quant/math, so a tool handler requires one path. Research arithmetic only: nothing here reads data, writes a record or reaches an account or an order.
 */
'use strict';

module.exports = {
  checks: require('./checks'),
  linalg: require('./linalg'),
  distributions: require('./distributions'),
  stats: require('./stats'),
  random: require('./random'),
  optimize: require('./optimize'),
  regression: require('./regression'),
  timeseries: require('./timeseries'),
  volatility: require('./volatility'),
  options: require('./options'),
  portfolio: require('./portfolio'),
  risk: require('./risk'),
  simulation: require('./simulation'),
  overfitting: require('./overfitting'),
  microstructure: require('./microstructure'),
  kalman: require('./kalman'),
  factorModels: require('./factor-models'),
};
