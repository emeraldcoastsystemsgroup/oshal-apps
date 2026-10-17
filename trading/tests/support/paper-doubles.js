/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: test doubles for the native paper engine. An in-memory SQL double that implements exactly the statements routes/paper/store.js declares (any other text is refused, so a new statement cannot slip past the tests) over ONE shared set of tables for every person, with BEGIN/COMMIT/ROLLBACK snapshots; and a recording kernel-intent double that answers prices.latest / prices.series from a synthetic market and refuses every other intent name. No database, kernel, broker or network is reached.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Implement ACCOUNT_BUMP (arm and disarm move the account version), and read the day-bucket window up to the kernel's own 365-day cap instead of 200, so a test sees what the real price view can serve.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | DECISION_GET and ORDER_FOR_DECISION for the manual paper orders.
 */
'use strict';

const { SQL } = require('../../routes/paper/store');

const TABLES = ['config', 'account', 'positions', 'orders', 'decisions', 'ticks', 'equity'];
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * @description Build the shared in-memory store and a pool over it.
 * @returns {{pool:object, db:object, log:Array<{text:string, values:Array}>}} The pool, its tables and every statement run.
 */
function createSqlDouble() {
  const db = Object.fromEntries(TABLES.map((t) => [t, []]));
  const log = [];
  const handlers = statementHandlers(db);
  const run = (text, values = []) => {
    log.push({ text, values });
    const handler = handlers.get(text);
    if (!handler) throw new Error(`SQL double refuses an undeclared statement: ${String(text).slice(0, 80)}`);
    return handler(values);
  };
  const pool = {
    async query(text, values) { return run(text, values); },
    async connect() {
      let snapshot = null;
      return {
        async query(text, values) {
          if (text === 'BEGIN') { snapshot = clone(db); log.push({ text, values: [] }); return { rows: [], rowCount: 0 }; }
          if (text === 'COMMIT') { snapshot = null; log.push({ text, values: [] }); return { rows: [], rowCount: 0 }; }
          if (text === 'ROLLBACK') {
            if (snapshot) for (const t of TABLES) db[t] = snapshot[t];
            snapshot = null; log.push({ text, values: [] }); return { rows: [], rowCount: 0 };
          }
          return run(text, values);
        },
        release() {},
      };
    },
  };
  return { pool, db, log };
}

/**
 * @description One handler per declared statement over the shared tables.
 * @param {object} db - Tables.
 * @returns {Map<string, Function>} Statement text → (values) => {rows,rowCount}.
 */
function statementHandlers(db) {
  const ok = (rows, rowCount = rows.length) => ({ rows: clone(rows), rowCount });
  const mine = (t, sub) => db[t].filter((r) => r.user_sub === sub);
  return new Map([
    [SQL.CONFIG_GET, ([sub]) => ok(mine('config', sub))],
    [SQL.CONFIG_ARM, ([sub, posture, cash, shares, notional, orders, age, universe, at]) => {
      const row = { user_sub: sub, armed: true, posture, starting_cash: cash, max_shares: shares, max_notional: notional, max_orders_per_tick: orders,
        max_quote_age_minutes: age, universe, armed_at: at, disarmed_at: null, updated_at: at };
      const i = db.config.findIndex((r) => r.user_sub === sub);
      if (i >= 0) db.config[i] = { ...db.config[i], ...row, disarmed_at: db.config[i].disarmed_at }; else db.config.push(row);
      return ok([], 1);
    }],
    [SQL.CONFIG_DISARM, ([sub, at]) => {
      const rows = mine('config', sub); for (const r of db.config) if (r.user_sub === sub) Object.assign(r, { armed: false, disarmed_at: at, updated_at: at });
      return ok([], rows.length);
    }],
    [SQL.ACCOUNT_GET, ([sub]) => ok(mine('account', sub))],
    [SQL.ACCOUNT_OPEN, ([sub, cash, at]) => {
      if (mine('account', sub).length) return ok([], 0);
      db.account.push({ user_sub: sub, cash, equity: cash, high_water: cash, realized_pl: 0, starting_cash: cash, version: 0, last_tick_window: null, created_at: at, updated_at: at });
      return ok([], 1);
    }],
    [SQL.ACCOUNT_BUMP, ([sub, at]) => {
      const rows = mine('account', sub); for (const r of db.account) if (r.user_sub === sub) Object.assign(r, { version: r.version + 1, updated_at: at });
      return ok([], rows.length);
    }],
    [SQL.ACCOUNT_WRITE, ([sub, cash, equity, high, realized, version, window, at, prior]) => {
      const row = db.account.find((r) => r.user_sub === sub && r.version === prior);
      if (!row) return ok([], 0);
      Object.assign(row, { cash, equity, high_water: high, realized_pl: realized, version, last_tick_window: window, updated_at: at });
      return ok([], 1);
    }],
    [SQL.POSITIONS_LIST, ([sub]) => ok(mine('positions', sub).sort((a, b) => (a.symbol < b.symbol ? -1 : 1)))],
    [SQL.POSITION_UPSERT, ([sub, symbol, qty, avg, last, lastAt, peak, opened, at]) => {
      const row = db.positions.find((r) => r.user_sub === sub && r.symbol === symbol);
      if (row) Object.assign(row, { qty, avg_cost: avg, last_price: last, last_price_at: lastAt, peak_price: peak, updated_at: at });
      else db.positions.push({ user_sub: sub, symbol, qty, avg_cost: avg, last_price: last, last_price_at: lastAt, peak_price: peak, opened_at: opened, updated_at: at });
      return ok([], 1);
    }],
    [SQL.POSITION_DELETE, ([sub, symbol]) => {
      const before = db.positions.length; db.positions = db.positions.filter((r) => !(r.user_sub === sub && r.symbol === symbol));
      return ok([], before - db.positions.length);
    }],
    [SQL.TICK_CLAIM, ([sub, window, trigger, runId, outcome, count, equity, summary, at]) => {
      if (db.ticks.some((r) => r.user_sub === sub && r.tick_window === window)) return ok([], 0);
      db.ticks.push({ user_sub: sub, tick_window: window, trigger_kind: trigger, run_id: runId, outcome, order_count: count, equity, summary, created_at: at });
      return ok([{ tick_window: window }]);
    }],
    [SQL.TICKS_RECENT, ([sub]) => ok(mine('ticks', sub).sort((a, b) => (a.tick_window < b.tick_window ? 1 : -1)).slice(0, 20))],
    [SQL.ORDER_INSERT, ([orderId, sub, window, decisionId, symbol, side, qty, price, notional, reason, realized, quoteAt, at]) => {
      if (db.orders.some((r) => r.order_id === orderId || (r.user_sub === sub && r.tick_window === window && r.symbol === symbol && r.side === side))) {
        throw new Error('duplicate key value violates unique constraint');
      }
      db.orders.push({ order_id: orderId, user_sub: sub, tick_window: window, decision_id: decisionId, symbol, side, qty, fill_price: price, notional,
        reason, realized_pl: realized, status: 'filled', quote_at: quoteAt, created_at: at });
      return ok([], 1);
    }],
    [SQL.ORDERS_LIST, ([sub]) => ok(mine('orders', sub).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 200))],
    [SQL.DECISION_INSERT, ([decisionId, sub, window, symbol, action, reason, score, confidence, regime, rationale, perTf, at]) => {
      db.decisions.push({ decision_id: decisionId, user_sub: sub, tick_window: window, symbol, action, reason, score, confidence, regime, rationale, per_timeframe: perTf, created_at: at });
      return ok([], 1);
    }],
    [SQL.DECISIONS_LIST, ([sub]) => ok(mine('decisions', sub).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 200))],
    [SQL.DECISION_GET, ([sub, id]) => ok(mine('decisions', sub).filter((r) => r.decision_id === id))],
    [SQL.ORDER_FOR_DECISION, ([sub, id]) => ok(mine('orders', sub).filter((r) => r.decision_id === id))],
    [SQL.EQUITY_UPSERT, ([sub, date, equity, cash, at]) => {
      const row = db.equity.find((r) => r.user_sub === sub && r.session_date === date);
      if (row) Object.assign(row, { equity, cash, recorded_at: at }); else db.equity.push({ user_sub: sub, session_date: date, equity, cash, recorded_at: at });
      return ok([], 1);
    }],
    [SQL.EQUITY_SERIES, ([sub]) => ok(mine('equity', sub).sort((a, b) => (a.session_date < b.session_date ? -1 : 1)))],
  ]);
}

/**
 * @description A synthetic close series growing (or shrinking) by a fixed step per bar.
 * @param {number} last - The final close.
 * @param {number} step - Fractional change per bar (0.005 = +0.5%).
 * @param {number} n - Bars.
 * @returns {number[]} Closes, oldest first, ending at `last`.
 */
function trend(last, step, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(Math.round(last / (1 + step) ** i * 10000) / 10000);
  return out;
}

/**
 * @description A recording kernel-intent double over a synthetic market.
 * @param {Object<string, {price:number, step:number, at?:string}>} market - Symbol → latest price, per-bar trend and quote instant.
 * @param {{now:Date, fail?:boolean}} opts - The quote clock; fail makes every price read throw.
 * @returns {{intent:Function, calls:Array<{name:string, input:object}>, market:object}} The double.
 */
function createIntentDouble(market, opts) {
  const calls = [];
  const quoteAt = (sym) => market[sym].at || new Date(opts.now.getTime() - 2 * 60000).toISOString();
  const intent = async (name, input) => {
    calls.push({ name, input: clone(input) });
    if (name !== 'prices.latest' && name !== 'prices.series') throw new Error(`intent double refuses ${name}`);
    if (opts.fail) throw new Error('World archive is not configured');
    const symbols = input.symbols || [input.symbol];
    const known = symbols.filter((s) => market[s]);
    const missing = symbols.filter((s) => !market[s]);
    if (name === 'prices.latest') {
      return { prices: known.map((s) => ({ symbol: s, at: quoteAt(s), price: market[s].price, volume: 1000 })), missing, source: 'world_prices', readAt: opts.now.toISOString() };
    }
    const series = {};
    for (const s of symbols) series[s] = [];
    for (const s of known) {
      const m = market[s];
      if (input.interval === 'raw') {
        series[s] = trend(m.price, m.fastStep ?? m.step / 10, Math.min(input.limit || 200, 100))
          .map((price, i, all) => ({ at: new Date(opts.now.getTime() - (all.length - 1 - i) * 300000 - 120000).toISOString(), price }));
      } else if (input.interval === 'hour') {
        series[s] = trend(m.price, m.hourStep ?? m.step / 3, 70)
          .map((price, i, all) => ({ bucket: new Date(opts.now.getTime() - (all.length - 1 - i) * 3600000).toISOString().slice(0, 13) + ':00', at: opts.now.toISOString(), price, volume: 1 }));
      } else {
        const n = Math.min(input.days || 30, 365);
        series[s] = trend(m.dayPrice ?? m.price, m.step, n)
          .map((price, i, all) => ({ bucket: new Date(opts.now.getTime() - (all.length - 1 - i) * 86400000).toISOString().slice(0, 10) + 'T00:00', at: opts.now.toISOString(), price, volume: 1 }));
      }
    }
    return { interval: input.interval || 'day', days: input.days, zone: 'America/New_York', series, missing: symbols.filter((s) => !series[s].length), source: 'world_prices', readAt: opts.now.toISOString() };
  };
  return { intent, calls, market };
}

module.exports = { createSqlDouble, createIntentDouble, trend };
