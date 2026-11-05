/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Candles carry volume, and the memory table speaks the desk's one-column-key statements.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Synthetic Quant desk market: deterministic daily closes per symbol as Schwab candles, an in-memory stand-in for the desk's own table for the browser fixture, and a seeded generator so a test run never depends on real prices.
 */
'use strict';

/**
 * @description A small seeded random generator, so a synthetic market is the same on every run.
 * @param {number} seed - Seed.
 * @returns {() => number} Values in [0, 1).
 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * @description Weekday session dates ending at a date, oldest first.
 * @param {string} end - Last session (YYYY-MM-DD).
 * @param {number} count - How many sessions.
 * @returns {string[]} Dates.
 */
function weekdays(end, count) {
  const out = [];
  for (let at = Date.parse(end + 'T00:00:00Z'); out.length < count; at -= 86400000) {
    const d = new Date(at);
    if (d.getUTCDay() > 0 && d.getUTCDay() < 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * @description Daily candles from a daily-return function, stamped the way the kernel normalizes Schwab's.
 * @param {string[]} dates - Sessions.
 * @param {(i:number) => number} dailyReturn - Return for each session.
 * @param {number} [start] - First close.
 * @param {number} [volume] - Shares a day: a million by default, well above the desk's trading floor at these prices.
 * @returns {Array<{t:number,c:number,v:number}>} Candles.
 */
function candles(dates, dailyReturn, start = 100, volume = 1000000) {
  let close = start;
  return dates.map((date, i) => { close *= 1 + dailyReturn(i); return { t: Date.parse(date + 'T05:00:00Z') / 1000, c: Math.round(close * 10000) / 10000, v: volume }; });
}

/**
 * @description An in-memory stand-in for the desk's own table, for the browser fixture only. The pipeline test uses real PostgreSQL.
 * @returns {{query:Function, rows:Map}} A pool double.
 */
function memoryPool() {
  const rows = new Map(),portfolioRows=new Map();
  const keep = (id, group, payload) => rows.set(id, { group, payload });
  return {
    rows,portfolioRows,
    async query(sql, args) {
      if(sql.startsWith('SELECT')&&sql.includes('oshal_trading_portfolio_records'))return {rows:[...portfolioRows.values()].filter(r=>r.user_sub===args[0]&&r.kind===args[1])};
      if (sql.includes('oshal_trading_watchlist')) return { rows: [{ symbol: 'WATCH' }] };
      if (sql.includes('trading_quant_records')) return { rows: [], rowCount: 0 };
      const table = sql.includes('trading_quant_prices') ? 'p:' : 's:';
      if (sql.startsWith('SELECT payload') && sql.includes('WHERE id=')) { const hit = rows.get(table + args[0]); return { rows: hit ? [{ payload: hit.payload }] : [] }; }
      if (sql.startsWith('SELECT payload')) return { rows: [...rows.entries()].filter(([k, v]) => k.startsWith(table) && v.group === args[0]).map(([, v]) => ({ payload: v.payload })) };
      if (sql.startsWith('UPDATE')) { const hit = rows.get(table + args[2]); if (!hit) return { rows: [], rowCount: 0 }; hit.payload = args[0]; return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('INSERT')) { keep(table + args[0], args[2], args[3]); return { rows: [], rowCount: 1 }; }
      throw new Error(`Unimplemented fixture SQL: ${sql}`);
    },
  };
}

module.exports = { seeded, weekdays, candles, memoryPool };
