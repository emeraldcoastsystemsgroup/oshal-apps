/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.1: the bill-rate source is the U.S. Treasury (home.treasury.gov), and a made-up Treasury bill-rate CSV in its published layout.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The context also carries a memory store for the reference cache, a made-up option chain priced by Black-Scholes on a known smile, and a fetch double that answers only the two reference sources with made-up files (anything else is refused, so a test can never reach the network).
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Made-up markets for the quant lab's tests: seeded daily candles shaped like the kernel's Schwab bars (open, high, low, close, volume), the World archive's day rows, a Level 1 quote, and a route context whose intents answer from them and count every read. Nothing here is anyone's real price.
 */
'use strict';
const zlib = require('node:zlib');
const { randomSource } = require('../../routes/quant/math/random');
const { blackScholes } = require('../../routes/quant/math/options');
const { memoryPool } = require('./native-quant-doubles');

/** The instant the tests run at: after the close on a Monday, so the last finished session is that Monday. */
const NOW = Date.parse('2026-11-16T23:00:00Z');

/**
 * @description Weekday session stamps (05:00 UTC, as the kernel normalizes Schwab's daily candles) ending on a date.
 * @param {number} n - Sessions.
 * @param {string} [end] - Last session date.
 * @returns {number[]} Epoch milliseconds, oldest first.
 */
function sessions(n, end = '2026-11-16') {
  const out = [];
  for (let at = Date.parse(`${end}T05:00:00Z`); out.length < n; at -= 86400000) {
    const d = new Date(at);
    if (d.getUTCDay() > 0 && d.getUTCDay() < 6) out.unshift(at);
  }
  return out;
}

/**
 * @description Seeded daily candles: a random walk in log price with the given drift and volatility, highs and lows around it.
 * @param {{seed:number, n:number, drift?:number, vol?:number, start?:number, volume?:number}} o - Shape.
 * @returns {Array<{t:number, o:number, h:number, l:number, c:number, v:number}>} Candles (t in epoch seconds).
 */
function candles({ seed, n, drift = 0.0003, vol = 0.015, start = 100, volume = 1e6 }) {
  const rng = randomSource(seed);
  let c = start;
  return sessions(n).map((at) => {
    const o = c;
    c *= Math.exp(drift + vol * rng.normal());
    return { t: at / 1000, o, h: Math.max(o, c) * (1 + 0.004 * rng.uniform()), l: Math.min(o, c) * (1 - 0.004 * rng.uniform()), c, v: volume };
  });
}

/**
 * @description A stable seed per ticker, so each made-up name has its own path.
 * @param {string} symbol - Ticker.
 * @returns {number} Seed.
 */
function seedOf(symbol) {
  return [...symbol].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
}

/**
 * @description A route context for the lab: Schwab connected or not, the archive's coverage, and a record of each read.
 * @param {{schwab:boolean, archiveDays?:number, archiveMissing?:string[], barsDelayMs?:number, custom?:Object<string, Array<object>>}} o - Shape.
 * @returns {{ctx:object, reads:Array<object>}} The context and its read log.
 */
function labContext({ schwab, archiveDays = 25, archiveMissing = [], barsDelayMs = 0, custom = {}, optionChains = true, chain = null, references = {} }) {
  const reads = [], fetched = [];
  const bars = (symbol, n) => custom[symbol] || candles({ seed: seedOf(symbol), n });
  const intent = async (name, input) => {
    reads.push({ name, input });
    if (name === 'trading.config') return { configured: schwab, ...(optionChains ? { optionChains: true } : {}) };
    if (name === 'trading.chains') return chain || { symbol: input.symbol, available: false, expirations: [], contracts: 0, source: 'schwab' };
    if (name === 'trading.bars') {
      if (barsDelayMs) await new Promise((resolve) => setTimeout(resolve, barsDelayMs));
      return { symbol: input.symbol, source: 'schwab', timeframe: '1Day', bars: bars(input.symbol, Math.min(2600, Math.round((input.historyDays * 252) / 365))) };
    }
    if (name === 'trading.quotes') return { source: 'schwab', quotes: input.symbols.map((symbol) => ({ symbol, bidPrice: 99.98, askPrice: 100.02, bidSize: 300, askSize: 100, delayed: false })) };
    if (name === 'prices.series') {
      const series = Object.fromEntries(input.symbols.filter((s) => !archiveMissing.includes(s)).map((s) => [s, bars(s, archiveDays).map((b) => ({ bucket: new Date(b.t * 1000).toISOString().slice(0, 10), at: new Date(b.t * 1000 + 72000000).toISOString(), price: b.c, volume: b.v }))]));
      return { interval: 'day', days: input.days, series };
    }
    throw new Error(`the lab must not ask for ${name}`);
  };
  const fetch = async (url) => {
    fetched.push(String(url));
    const host = new URL(url).hostname, body = host === 'mba.tuck.dartmouth.edu' ? references.ff : host === 'home.treasury.gov' ? references.bills : undefined;
    if (body === undefined) throw new Error(`refused in tests: ${host}`);
    if (body === null) return { ok: false, status: 503 };
    return { ok: true, status: 200, arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(body)), text: async () => String(body) };
  };
  return { ctx: { pool: memoryPool(), intent }, reads, fetched, fetch };
}

/**
 * @description A one-file ZIP archive (deflated), as the French library publishes its CSV files.
 * @param {string} name - File name inside.
 * @param {string} text - File text.
 * @returns {Buffer} The archive.
 */
function zipOf(name, text) {
  const raw = Buffer.from(text, 'latin1'), data = zlib.deflateRawSync(raw), file = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(0, 42);
  const at = local.length + file.length + data.length, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([local, file, data, central, file, end]);
}

/**
 * @description A made-up daily three-factor file in the library's layout (percent), with a header and footer as published.
 * @param {Array<[string, number, number, number, number]>} rows - [YYYY-MM-DD, Mkt-RF, SMB, HML, RF] as fractions.
 * @returns {string} CSV text.
 */
function famaFrenchCsv(rows) {
  const body = rows.map(([d, m, s, h, rf]) => `${d.replace(/-/g, '')},${(m * 100).toFixed(4)},${(s * 100).toFixed(4)},${(h * 100).toFixed(4)},${(rf * 100).toFixed(4)}`);
  return ['This file was made up for a test.', '', ',Mkt-RF,SMB,HML,RF', ...body, '', 'Copyright line as in the real file'].join('\r\n');
}

/**
 * @description A made-up option chain in the kernel's trading.chains shape, priced by Black-Scholes on a known smile
 * iv(k) = level - 0.2 k + 0.5 k^2 (k = ln(strike / forward)), so a fit can be checked against the truth.
 * @param {{symbol:string, spot:number, rate:number, days:number[], level?:number}} o - Shape.
 * @returns {object} The chain.
 */
function madeUpChain({ symbol, spot, rate, days, level = 0.25 }) {
  const strikes = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2].map((m) => Math.round(spot * m));
  const expirations = days.map((d) => {
    const T = d / 365, F = spot * Math.exp(rate * T), iv = (k) => level - 0.2 * k + 0.5 * k * k;
    const row = (K, type) => { const sigma = iv(Math.log(K / F)), g = blackScholes({ S: spot, K, T, r: rate, sigma, type }); return { strike: K, bid: g.price * 0.99, ask: g.price * 1.01, mark: g.price, last: g.price, impliedVolatility: sigma, delta: g.delta, gamma: g.gamma, theta: g.theta / 365, vega: g.vega / 100, rho: null, openInterest: 100, inTheMoney: type === 'call' ? K < spot : K > spot, multiplier: 100 }; };
    return { date: new Date(Date.parse('2026-11-16T00:00:00Z') + d * 86400000).toISOString().slice(0, 10), daysToExpiration: d, calls: strikes.map((K) => row(K, 'call')), puts: strikes.map((K) => row(K, 'put')) };
  });
  return { symbol, available: true, delayed: false, underlying: { price: spot }, interestRatePercent: rate * 100, expirations, contracts: expirations.length * strikes.length * 2, source: 'schwab', readAt: '2026-11-16T23:00:00Z' };
}

/**
 * @description A made-up Treasury daily bill-rate CSV in the published layout (quoted header, MM/DD/YYYY, newest first).
 * @param {Array<[string, number]>} rows - [YYYY-MM-DD, 13-week coupon-equivalent rate as a fraction], any order.
 * @returns {string} CSV text.
 */
function treasuryCsv(rows) {
  const header = 'Date,"4 WEEKS BANK DISCOUNT","4 WEEKS COUPON EQUIVALENT","13 WEEKS BANK DISCOUNT","13 WEEKS COUPON EQUIVALENT","52 WEEKS BANK DISCOUNT","52 WEEKS COUPON EQUIVALENT"';
  const body = [...rows].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, r]) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)},3.95,4.02,4.10,${r == null ? '' : (r * 100).toFixed(2)},4.39,4.60`);
  return [header, ...body].join('\n');
}

module.exports = { NOW, sessions, candles, seedOf, labContext, zipOf, famaFrenchCsv, madeUpChain, treasuryCsv };
