/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: a native-kernel-shaped host for the SHIPPED trading route files, shared by the landing route test and its browser test. The platform imports those files name are stood in exactly as the kernel bridge answers them with no broker and no market-data connector (crates/host-process/bridge compat_shims.js and trading_market.js): an empty book store and account roster, an unresolved book ('default'), broker and market-data rails whose configured() is false and whose reads reject with TradingError 503, a refused symbol search and asset directory. The pool sends the paper engine's declared statements to the in-memory paper SQL double and answers every other statement with no rows (the legacy tables are not declared natively), except the watchlist rows a test seeds. The kernel's prices.latest and prices.series are answered from a synthetic World archive that keeps the kernel's shapes: distinct `at` per point, day and hour buckets on New York wall time, and `missing` for an untracked ticker.
 */
'use strict';

const path = require('node:path');
const Module = require('node:module');
const { SQL } = require('../../routes/paper/store');

const NO_MD = 'No market-data source is connected on this installation: oshal has no Alpaca connector, and the native runtime does not read quotes, bars, fundamentals or news through the Schwab connection.';
const NO_BROKER = 'No broker rail is connected on this installation: oshal has no Alpaca connector, and the native runtime does not read accounts, positions or orders through the Schwab connection.';
const PAPER_STATEMENTS = new Set(Object.values(SQL));
const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } };

/** The routes' error class as the bridge serves it (httpStatus, code, message). */
class TradingError extends Error {
  constructor(httpStatus, code, message) { super(message); this.httpStatus = httpStatus; this.code = code; }
}

/**
 * @description A rail shaped like the bridge's notConnectedRail, or a connected one when a test asks for it.
 * @param {string} reason - The not-connected sentence.
 * @param {boolean} connected - Whether configured() answers true.
 * @returns {object} The rail.
 */
function rail(reason, connected) {
  const refuse = () => Promise.reject(new TradingError(503, 'market_data_not_connected', reason));
  return { kind: connected ? 'alpaca' : 'none', configured: () => connected, notConnectedReason: reason, latestTrade: refuse, latestPrice: refuse,
    dailyCloses: refuse, getAccount: connected ? async () => ({ equity: 1, cash: 1, buyingPower: 1 }) : refuse,
    getPositions: connected ? async () => [] : refuse, listOrders: refuse };
}

/**
 * @description The platform modules the shipped routes import, answered as the native bridge answers them.
 * @param {{universe:string[], paperRail?:boolean, express?:object}} opts - The default universe, whether the paper rail is connected, and express.
 * @returns {Object<string, object>} Request → module.
 */
function standIns(opts) {
  const refuse = () => Promise.reject(new TradingError(503, 'market_data_not_connected', NO_MD));
  return {
    '@/shared/logger': { createChildLogger: () => silent },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => undefined },
    '@/app/routes/trading-routes-helpers': { callerSub: (req) => req.oshalCallerSub || null, resolveBook: async () => 'default',
      resolveMode: () => 'paper', guardrails: () => ({}), servePage: () => () => undefined, TradingError },
    '@/features/trading': { getBrokerReader: () => rail(NO_BROKER, Boolean(opts.paperRail)), getMarketData: () => rail(NO_MD, false),
      marketDataConfigured: () => false, liveTradingEnabled: () => false, barsBatchOhlcv: refuse, searchSymbols: refuse, assetDirectory: refuse,
      fundamentalsSummary: refuse, recentNews: refuse, DEFAULT_UNIVERSE: opts.universe },
    '@/app/trading-books-store': { ensureLegacyBooks: async () => undefined, listBooks: async () => [], loadBook: async () => null,
      multiAccountEnabled: () => false, requiresArmAcknowledgement: () => false },
    '@/app/trading-accounts-store': { listAccounts: async () => [] },
    '@/features/world-data': { createWorldIntelligenceService: () => null },
    '@/app/trading-schema': { ensureTradingSchema: async () => undefined },
    ...(opts.express ? { express: opts.express } : {}),
  };
}

/**
 * @description Require the shipped route files with the platform imports stood in, and register them.
 * @param {Object<string, object>} modules - standIns(...).
 * @param {(load:(file:string) => object) => *} register - Registers the routes; load(file) requires routes/<file>.
 * @returns {*} What register returns.
 */
function loadShipped(modules, register) {
  const original = Module._load;
  const standIn = (request) => new Proxy(modules[request] || {}, {
    get: (target, key) => (key in target ? target[key] : key === '__esModule' ? true : () => undefined),
  });
  Module._load = function load(request, ...rest) {
    if (request === 'express' && modules.express) return modules.express;
    return request.startsWith('@/') ? standIn(request) : original.call(this, request, ...rest);
  };
  try {
    const dir = path.join(__dirname, '..', '..', 'routes');
    for (const key of Object.keys(require.cache)) if (key.startsWith(dir)) delete require.cache[key];
    return register((file) => require(path.join(dir, file)));
  } finally {
    Module._load = original;
  }
}

/**
 * @description A pool shaped like the native package pool: paper statements reach the paper SQL double, the watchlist reads
 * answer the seeded rows, and every other statement (undeclared legacy tables) answers no rows.
 * @param {object} sql - The paper SQL double (paper-doubles.js createSqlDouble).
 * @param {Object<string, string[]>} [watchlists] - Subject → watchlist symbols.
 * @returns {object} The pool.
 */
function nativeLandingPool(sql, watchlists = {}) {
  const query = (text, values = []) => {
    if (PAPER_STATEMENTS.has(text)) return sql.pool.query(text, values);
    if (/FROM oshal_trading_watchlist WHERE user_sub=\$1/.test(String(text))) {
      const rows = (watchlists[values[0]] || []).map((symbol) => ({ symbol, note: null, added_at: '2026-10-01T00:00:00Z' }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  return { query, connect: () => sql.pool.connect() };
}

/**
 * @description The New York wall-clock date and hour of an instant (the kernel's bucket zone).
 * @param {number} ms - Epoch milliseconds.
 * @returns {{date:string, hour:string}} YYYY-MM-DD and HH.
 */
function nyParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: p.hour };
}

/**
 * @description A World archive double with the kernel's answer shapes: one stored price every 30 minutes per ticker,
 * each ticker moving by a fixed fraction per point, ending at its latest price.
 * @param {Object<string, {price:number, step:number}>} market - Ticker → latest price and per-point step.
 * @param {Date} now - The archive clock.
 * @returns {{intent:Function, calls:Array<object>}} The intent call and every request it answered.
 */
function worldArchive(market, now) {
  const calls = [];
  const STEP_MS = 30 * 60000; const POINTS = 2000;
  const pointsOf = (sym) => Array.from({ length: POINTS }, (_, i) => {
    const back = POINTS - 1 - i; const at = now.getTime() - back * STEP_MS - 60000;
    return { at, price: Math.round(market[sym].price / (1 + market[sym].step) ** back * 10000) / 10000, volume: 1000 + i };
  });
  const bucketed = (points, unit) => {
    const out = new Map();
    for (const p of points) {
      const { date, hour } = nyParts(p.at);
      out.set(unit === 'day' ? `${date}T00:00` : `${date}T${hour}:00`, { at: new Date(p.at).toISOString(), price: p.price, volume: p.volume });
    }
    return [...out.entries()].map(([bucket, row]) => ({ bucket, ...row }));
  };
  const intent = async (name, input) => {
    calls.push({ name, input: JSON.parse(JSON.stringify(input)) });
    const symbols = input.symbols || [input.symbol];
    const known = symbols.filter((s) => market[s]);
    if (name === 'prices.latest') {
      return { prices: known.map((s) => { const p = pointsOf(s).pop(); return { symbol: s, at: new Date(p.at).toISOString(), price: p.price, volume: p.volume }; }),
        missing: symbols.filter((s) => !market[s]), source: 'world_prices', readAt: now.toISOString() };
    }
    if (name !== 'prices.series') throw new Error(`World archive double refuses ${name}`);
    const series = Object.fromEntries(symbols.map((s) => [s, []]));
    for (const s of known) {
      const since = now.getTime() - (input.days || 30) * 86400000;
      const recent = pointsOf(s).filter((p) => p.at >= since);
      series[s] = input.interval === 'raw' ? recent.slice(-(input.limit || 200)).map((p) => ({ at: new Date(p.at).toISOString(), price: p.price }))
        : bucketed(recent, input.interval || 'day');
    }
    return { interval: input.interval || 'day', days: input.days, zone: 'America/New_York', series, missing: symbols.filter((s) => !series[s].length),
      source: 'world_prices', readAt: now.toISOString() };
  };
  return { intent, calls };
}

module.exports = { standIns, loadShipped, nativeLandingPool, worldArchive, TradingError, NO_MD, NO_BROKER };
