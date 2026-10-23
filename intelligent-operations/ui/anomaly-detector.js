/**
 * CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A persistence parameter (consecutive anomalous samples before a candidate fires) so calibration can trade lead time for fewer isolated spikes.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Deterministic statistical anomaly detectors shared by the server tick and the offline NAB evaluation: a rolling robust z-score (median/MAD) and a seasonal time-of-day profile. Each sample is scored before it updates the baseline; cold, ready and stale readiness are explicit; state is bounded so it can be persisted per resource and metric.
 */
(function (root) {
  'use strict';
  const DETECTORS = { 'robust-zscore': { version: '1' }, 'seasonal-profile': { version: '1' } };
  const DEFAULTS = { detector: 'robust-zscore', threshold: 6, persistence: 1, warmupSamples: 60, windowSamples: 288, bucketSeconds: 1800, bucketSamples: 14, resolveSamples: 3, staleSeconds: 3600 };
  const LIMITS = { threshold: [2, 50], persistence: [1, 20], warmupSamples: [10, 2000], windowSamples: [24, 2000], bucketSeconds: [300, 86400], bucketSamples: [3, 64], resolveSamples: [1, 50], staleSeconds: [60, 604800] };
  function configuration(input) {
    const config = { ...DEFAULTS };
    for (const [key, value] of Object.entries(input || {})) {
      if (key === 'detector') { if (!DETECTORS[value]) throw Error('Unknown detector.'); config.detector = value; continue; }
      if (!(key in LIMITS)) throw Error('Unsupported detector parameter: ' + key);
      if (!Number.isSafeInteger(value) && !(key === 'threshold' && Number.isFinite(value))) throw Error('Detector parameter must be numeric: ' + key);
      if (value < LIMITS[key][0] || value > LIMITS[key][1]) throw Error(key + ' must be between ' + LIMITS[key][0] + ' and ' + LIMITS[key][1] + '.');
      config[key] = value;
    }
    return config;
  }
  const sorted = values => values.slice().sort((a, b) => a - b);
  function median(values) { const s = sorted(values), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
  /** @description Median and scaled median absolute deviation; a flat series yields MAD 0 and the caller uses a floor so a single changed sample is a strong, finite score. */
  function robust(values) { const m = median(values); const mad = median(values.map(v => Math.abs(v - m))); return { median: m, mad, scale: 1.4826 * mad }; }
  function floor(values, stats) { const spread = values.length ? Math.max(Math.abs(stats.median), 1) : 1; return stats.scale > 0 ? stats.scale : spread * 1e-3; }
  function createState(config) { return { detector: config.detector, version: DETECTORS[config.detector].version, samples: 0, lastObservedAt: null, anomalousRun: 0, normalRun: 0, firing: false, late: 0, window: [], buckets: {} }; }
  function bucketOf(config, observedAt) { const seconds = Math.floor(Date.parse(observedAt) / 1000); const day = ((seconds % 86400) + 86400) % 86400; return String(Math.floor(day / config.bucketSeconds)); }
  function baseline(config, state, observedAt) {
    if (config.detector === 'robust-zscore') { const values = state.window; return { values, ready: values.length >= config.warmupSamples }; }
    const values = state.buckets[bucketOf(config, observedAt)] || [];
    const warmBuckets = Object.values(state.buckets).filter(b => b.length >= 3).length, needed = Math.ceil(86400 / config.bucketSeconds);
    return { values, ready: values.length >= 3 && warmBuckets >= needed && state.samples >= config.warmupSamples };
  }
  function learn(config, state, observedAt, value) {
    if (config.detector === 'robust-zscore') { state.window.push(value); if (state.window.length > config.windowSamples) state.window.shift(); return; }
    const key = bucketOf(config, observedAt), bucket = state.buckets[key] || (state.buckets[key] = []);
    bucket.push(value); if (bucket.length > config.bucketSamples) bucket.shift();
  }
  /**
   * @description Score one sample against the baseline learned from earlier samples only, then learn from it. Returns the decision the server turns into a candidate; `emit` is 'firing' on the first anomalous sample of a run and 'resolved' after resolveSamples normal samples following a run.
   * @param config Frozen detector configuration. @param state Persisted per resource/metric state. @param point {observedAt, value}. @param now Receipt clock (ms) for staleness.
   */
  function observe(config, state, point, now) {
    const value = Number(point.value), observedAt = point.observedAt;
    if (!Number.isFinite(value) || Number.isNaN(Date.parse(observedAt))) return { readiness: 'invalid', score: null, emit: null };
    if (state.lastObservedAt && Date.parse(observedAt) < Date.parse(state.lastObservedAt)) { state.late++; return { readiness: 'late', score: null, emit: null }; }
    const stale = state.lastObservedAt && (Date.parse(observedAt) - Date.parse(state.lastObservedAt)) / 1000 > config.staleSeconds;
    const base = baseline(config, state, observedAt), stats = base.values.length ? robust(base.values) : { median: null, mad: null, scale: 0 };
    let readiness = base.ready ? 'ready' : 'cold', score = null, anomalous = false, emit = null, confidence = 0;
    if (stale) { readiness = 'stale'; if (config.detector === 'robust-zscore') state.window = []; state.firing = false; state.anomalousRun = 0; state.normalRun = 0; }
    else if (base.ready) {
      score = Math.abs(value - stats.median) / floor(base.values, stats);
      anomalous = score >= config.threshold;
      confidence = Math.min(1, base.values.length / (2 * config.warmupSamples)) * Math.min(1, score / (2 * config.threshold));
      if (anomalous) { state.anomalousRun++; state.normalRun = 0; if (!state.firing && state.anomalousRun >= config.persistence) { state.firing = true; emit = 'firing'; } }
      else { state.normalRun++; state.anomalousRun = 0; if (state.firing && state.normalRun >= config.resolveSamples) { state.firing = false; emit = 'resolved'; } }
    }
    if (!anomalous) learn(config, state, observedAt, value);
    state.samples++; state.lastObservedAt = observedAt;
    return { readiness, score, anomalous, emit, confidence, baseline: { median: stats.median, mad: stats.mad, samples: base.values.length }, window: config.detector === 'robust-zscore' ? { samples: config.windowSamples } : { bucketSeconds: config.bucketSeconds, bucket: bucketOf(config, observedAt) } };
  }
  const api = { DETECTORS, DEFAULTS, LIMITS, configuration, createState, observe, robust, median };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.OperationsAnomalyDetector = api;
})(typeof window === 'object' ? window : globalThis);
