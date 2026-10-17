/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native Futures study's settings. The only source is the person's Schwab connection ('schwab'); file and Kibot sources answer futures_source_unavailable_native. Roots are the engine's known roots, the chart timeframe is 1Hour (the entry rules trade 09:30-15:45 exchange time, so daily bars never enter), the higher timeframe 1Day or 1Week, and the window and walk-forward split must yield a complete out-of-sample period within 512 estimated backtests - the platform's study envelope.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Forward research calls settings: off by default; horizon, outcome tolerance, source age (72 h default so a Monday call can read Friday's close) and replay history bounded.
 *
 * @module futures/config
 */
'use strict';

const { DEFAULT_OPTIMIZER_STAGES, getFuturesRoot } = require('./engine');

const DAY_MS = 86400000;
const MAX_BACKTESTS = 512;

/** A refusal the route answers in words. */
function refusal(status, code, message) { return Object.assign(new Error(message), { status, code }); }

function int(value, fallback, min, max, name) {
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw refusal(400, 'futures_config_invalid', `${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** The previous completed New York day's last second, as the engine's wall-clock ISO stamp. */
function latestCompletedDay(now) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))) parts[p.type] = p.value;
  return new Date(Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`) - 1000).toISOString();
}

function grids(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw refusal(400, 'futures_config_invalid', 'Stage grids must be an object of stage name to parameter lists.');
  const names = new Set(DEFAULT_OPTIMIZER_STAGES.map((s) => s.name)), out = {};
  for (const [stage, grid] of Object.entries(raw)) {
    if (!names.has(stage) || !grid || typeof grid !== 'object') throw refusal(400, 'futures_config_invalid', `Unknown optimizer stage '${stage}'.`);
    out[stage] = {};
    for (const [key, values] of Object.entries(grid)) {
      if (!Array.isArray(values) || !values.length || values.length > 12) throw refusal(400, 'futures_config_invalid', `${stage}.${key} needs 1-12 values.`);
      out[stage][key] = values;
    }
  }
  return out;
}

/**
 * @description Normalize the Futures panel's settings for the native Schwab study.
 * @param {object} raw - The panel's form (futuresForm()).
 * @param {number} [now] - Clock (epoch ms).
 * @returns {object} The bounded study configuration.
 */
function normalizeNativeFuturesConfig(raw, now = Date.now()) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const source = input.source == null || input.source === '' ? 'schwab' : String(input.source);
  if (source !== 'schwab') throw refusal(409, 'futures_source_unavailable_native', 'On this installation the Futures study reads your Schwab connection; Kibot files, the Kibot API and the old captured-bar store are not available.');
  const roots = [...new Set((Array.isArray(input.roots) && input.roots.length ? input.roots : ['ES', 'CL']).map((r) => String(r).trim().toUpperCase()).filter(Boolean))];
  if (!roots.length || roots.length > 4) throw refusal(400, 'futures_config_invalid', 'Name 1 to 4 futures roots.');
  for (const root of roots) if (!getFuturesRoot(root)) throw refusal(400, 'futures_config_invalid', `Unknown futures root '${root}'.`);
  const timeframe = String(input.timeframe || '1Hour');
  if (timeframe !== '1Hour') throw refusal(400, 'futures_config_invalid', 'The chart timeframe is 1Hour: the entry rules trade 09:30-15:45 exchange time, so daily bars never enter.');
  const ltfTimeframe = String(input.ltfTimeframe || '1Day');
  if (!['1Day', '1Week'].includes(ltfTimeframe)) throw refusal(400, 'futures_config_invalid', 'The higher timeframe is 1Day or 1Week.');
  const split = { inSampleMonths: int(input.split && input.split.inSampleMonths, 3, 1, 24, 'In-sample months'),
    oosMonths: int(input.split && input.split.oosMonths, 1, 1, 12, 'Out-of-sample months'),
    stepMonths: int(input.split && input.split.stepMonths, 1, 1, 12, 'Step months') };
  if (split.stepMonths < split.oosMonths) throw refusal(400, 'futures_config_invalid', 'Step months must not be shorter than out-of-sample months.');
  const startRaw = input.start ? Date.parse(input.start) : now - 270 * DAY_MS;
  if (!Number.isFinite(startRaw) || startRaw < now - 390 * DAY_MS) throw refusal(400, 'futures_config_invalid', 'Start must be a date within the last 390 days (your Schwab history).');
  const start = new Date(startRaw).toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const end = latestCompletedDay(now);
  const stageGrids = grids(input.stageGrids);
  const months = (Date.parse(end) - Date.parse(start)) / (30.44 * DAY_MS);
  const windows = Math.max(0, Math.floor((months - split.inSampleMonths - split.oosMonths) / split.stepMonths) + 1);
  if (!windows) throw refusal(400, 'futures_config_invalid', 'The window has no complete out-of-sample period: move Start earlier or shorten the split.');
  const per = DEFAULT_OPTIMIZER_STAGES.reduce((n, s) => n + Object.values(stageGrids[s.name] || s.grid).reduce((m, v) => m * v.length, 1), 1);
  if (roots.length * windows * per > MAX_BACKTESTS) throw refusal(400, 'futures_config_invalid', `This study is too large: about ${roots.length * windows * per} backtests (at most ${MAX_BACKTESTS}).`);
  const quality = { minOosTradesPerWindow: int(input.quality && input.quality.minOosTradesPerWindow, 3, 0, 1000, 'Minimum OOS trades per window') };
  const p = input.predictions && typeof input.predictions === 'object' ? input.predictions : {};
  // Forward calls read the live contract over Schwab; the platform's file-archive contract map and clock zone do not apply.
  const predictions = { enabled: p.enabled === true, horizonHours: int(p.horizonHours, 24, 1, 168, 'Forward horizon hours'),
    gradingToleranceHours: int(p.gradingToleranceHours, 24, 1, 168, 'Outcome tolerance hours'), maxSourceAgeHours: int(p.maxSourceAgeHours, 72, 1, 168, 'Maximum source age hours'),
    historyBars: int(p.historyBars, 512, 64, 4096, 'Replay history bars') };
  return { roots, timeframe, ltfTimeframe, source, adjust: input.adjust === 'panama' ? 'panama' : 'none', start, end, endMode: 'latest', split, stageGrids, quality, predictions };
}

module.exports = { normalizeNativeFuturesConfig, refusal };
