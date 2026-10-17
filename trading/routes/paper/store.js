/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: every statement the native paper book runs, declared once as a constant over the tables of migrations/002-native-paper.sql, with the reads and the one transactional tick write built on them. Every statement filters or stamps user_sub with the caller's own subject, so person B can never read or write person A's book. A tick commits all of its fills, decisions, positions, account and equity snapshot together, after claiming its five-minute window (ON CONFLICT DO NOTHING RETURNING) and checking the account version the plan was computed from; a window already claimed, or a book that moved under the plan, rolls the whole tick back.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fix: arming and disarming now bump the account version in the same transaction as the configuration change (ACCOUNT_BUMP). Before, a disarm (or a re-arm with tighter guardrails) that landed while a tick was in flight left the version alone, so the tick's optimistic check passed and it still traded on the old configuration; now that tick rolls back as book_changed.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Manual paper orders: DECISION_GET and ORDER_FOR_DECISION, recordManualDecision, loadDecision, orderForDecision and writeManualFill (one transaction: version-checked account, order, position, equity snapshot). Buy a stock on the native paper book had no native path.
 *
 * @module paper/store
 */
'use strict';

const CONFIG_COLUMNS = 'user_sub, armed, posture, starting_cash, max_shares, max_notional, max_orders_per_tick, max_quote_age_minutes, universe, armed_at, disarmed_at, updated_at';

/** The complete statement set (the in-memory test double implements exactly these). */
const SQL = Object.freeze({
  CONFIG_GET: `SELECT ${CONFIG_COLUMNS} FROM trading_paper_config WHERE user_sub = $1`,
  CONFIG_ARM: `INSERT INTO trading_paper_config (${CONFIG_COLUMNS}) VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $9)
    ON CONFLICT (user_sub) DO UPDATE SET armed = true, posture = EXCLUDED.posture, starting_cash = EXCLUDED.starting_cash,
    max_shares = EXCLUDED.max_shares, max_notional = EXCLUDED.max_notional, max_orders_per_tick = EXCLUDED.max_orders_per_tick,
    max_quote_age_minutes = EXCLUDED.max_quote_age_minutes, universe = EXCLUDED.universe, armed_at = EXCLUDED.armed_at, updated_at = EXCLUDED.updated_at`,
  CONFIG_DISARM: 'UPDATE trading_paper_config SET armed = false, disarmed_at = $2, updated_at = $2 WHERE user_sub = $1',
  ACCOUNT_GET: 'SELECT user_sub, cash, equity, high_water, realized_pl, starting_cash, version, last_tick_window, created_at, updated_at FROM trading_paper_account WHERE user_sub = $1',
  ACCOUNT_OPEN: `INSERT INTO trading_paper_account (user_sub, cash, equity, high_water, realized_pl, starting_cash, version, last_tick_window, created_at, updated_at)
    VALUES ($1, $2, $2, $2, 0, $2, 0, NULL, $3, $3) ON CONFLICT (user_sub) DO NOTHING`,
  ACCOUNT_BUMP: 'UPDATE trading_paper_account SET version = version + 1, updated_at = $2 WHERE user_sub = $1',
  ACCOUNT_WRITE: `UPDATE trading_paper_account SET cash = $2, equity = $3, high_water = $4, realized_pl = $5, version = $6,
    last_tick_window = $7, updated_at = $8 WHERE user_sub = $1 AND version = $9`,
  POSITIONS_LIST: 'SELECT symbol, qty, avg_cost, last_price, last_price_at, peak_price, opened_at, updated_at FROM trading_paper_positions WHERE user_sub = $1 ORDER BY symbol',
  POSITION_UPSERT: `INSERT INTO trading_paper_positions (user_sub, symbol, qty, avg_cost, last_price, last_price_at, peak_price, opened_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (user_sub, symbol) DO UPDATE SET qty = EXCLUDED.qty, avg_cost = EXCLUDED.avg_cost,
    last_price = EXCLUDED.last_price, last_price_at = EXCLUDED.last_price_at, peak_price = EXCLUDED.peak_price, updated_at = EXCLUDED.updated_at`,
  POSITION_DELETE: 'DELETE FROM trading_paper_positions WHERE user_sub = $1 AND symbol = $2',
  TICK_CLAIM: `INSERT INTO trading_paper_ticks (user_sub, tick_window, trigger_kind, run_id, outcome, order_count, equity, summary, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (user_sub, tick_window) DO NOTHING RETURNING tick_window`,
  TICKS_RECENT: 'SELECT tick_window, trigger_kind, outcome, order_count, equity, summary, created_at FROM trading_paper_ticks WHERE user_sub = $1 ORDER BY tick_window DESC LIMIT 20',
  ORDER_INSERT: `INSERT INTO trading_paper_orders (order_id, user_sub, tick_window, decision_id, symbol, side, qty, fill_price, notional, reason, realized_pl, status, quote_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'filled', $12, $13)`,
  ORDERS_LIST: 'SELECT order_id, tick_window, decision_id, symbol, side, qty, fill_price, notional, reason, realized_pl, status, quote_at, created_at FROM trading_paper_orders WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 200',
  DECISION_INSERT: `INSERT INTO trading_paper_decisions (decision_id, user_sub, tick_window, symbol, action, reason, score, confidence, regime, rationale, per_timeframe, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
  DECISIONS_LIST: 'SELECT decision_id, tick_window, symbol, action, reason, score, confidence, regime, rationale, per_timeframe, created_at FROM trading_paper_decisions WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 200',
  EQUITY_UPSERT: `INSERT INTO trading_paper_equity_daily (user_sub, session_date, equity, cash, recorded_at) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_sub, session_date) DO UPDATE SET equity = EXCLUDED.equity, cash = EXCLUDED.cash, recorded_at = EXCLUDED.recorded_at`,
  EQUITY_SERIES: 'SELECT session_date, equity, cash, recorded_at FROM trading_paper_equity_daily WHERE user_sub = $1 ORDER BY session_date',
  DECISION_GET: 'SELECT decision_id, tick_window, symbol, action, reason, rationale, per_timeframe, created_at FROM trading_paper_decisions WHERE user_sub = $1 AND decision_id = $2',
  ORDER_FOR_DECISION: 'SELECT order_id, qty, fill_price, status FROM trading_paper_orders WHERE user_sub = $1 AND decision_id = $2',
});

const num = (v) => (v == null ? null : Number(v));

/**
 * @description The person's paper configuration, or null when they never armed.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @returns {Promise<object|null>} The configuration.
 */
async function loadConfig(pool, sub) {
  const row = (await pool.query(SQL.CONFIG_GET, [sub])).rows[0];
  if (!row) return null;
  let universe = null;
  try { universe = row.universe ? JSON.parse(row.universe) : null; } catch { universe = null; }
  return { armed: row.armed === true || row.armed === 't', posture: row.posture, startingCash: num(row.starting_cash),
    maxShares: num(row.max_shares), maxNotional: num(row.max_notional), maxOrdersPerTick: num(row.max_orders_per_tick),
    maxQuoteAgeMinutes: num(row.max_quote_age_minutes), universe: Array.isArray(universe) ? universe : null,
    armedAt: row.armed_at || null, disarmedAt: row.disarmed_at || null };
}

/**
 * @description The person's paper account, or null before the first arm.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @returns {Promise<object|null>} The account.
 */
async function loadAccount(pool, sub) {
  const row = (await pool.query(SQL.ACCOUNT_GET, [sub])).rows[0];
  if (!row) return null;
  return { cash: num(row.cash), equity: num(row.equity), highWater: num(row.high_water), realizedPl: num(row.realized_pl),
    startingCash: num(row.starting_cash), version: num(row.version), lastTickWindow: row.last_tick_window || null,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

/**
 * @description The person's open paper positions.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @returns {Promise<Array<object>>} Positions.
 */
async function loadPositions(pool, sub) {
  return (await pool.query(SQL.POSITIONS_LIST, [sub])).rows.map((r) => ({
    symbol: r.symbol, qty: num(r.qty), avgCost: num(r.avg_cost), lastPrice: num(r.last_price), lastPriceAt: r.last_price_at || null,
    peak: num(r.peak_price), openedAt: r.opened_at, updatedAt: r.updated_at,
  }));
}

/**
 * @description Run statements in one transaction on one client.
 * @param {object} pool - Package SQL pool.
 * @param {(client:object) => Promise<*>} work - The statements.
 * @returns {Promise<*>} What work returned, after COMMIT.
 */
async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @description Arm the book: save the configuration and open the account (an existing account keeps its cash).
 * The account version moves with the configuration, so a tick planned on the old configuration cannot commit.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {object} config - Normalized configuration.
 * @param {string} at - ISO instant.
 * @returns {Promise<void>}
 */
async function arm(pool, sub, config, at) {
  await inTransaction(pool, async (client) => {
    await client.query(SQL.CONFIG_ARM, [sub, config.posture, config.startingCash, config.maxShares, config.maxNotional,
      config.maxOrdersPerTick, config.maxQuoteAgeMinutes, config.universe ? JSON.stringify(config.universe) : null, at]);
    await client.query(SQL.ACCOUNT_OPEN, [sub, config.startingCash, at]);
    await client.query(SQL.ACCOUNT_BUMP, [sub, at]);
  });
}

/**
 * @description Disarm the book; positions, fills and history stay. The account version moves with it, so a
 * tick already in flight rolls back instead of trading after the disarm.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {string} at - ISO instant.
 * @returns {Promise<number>} Rows changed (0 when the person never armed).
 */
async function disarm(pool, sub, at) {
  return inTransaction(pool, async (client) => {
    const changed = (await client.query(SQL.CONFIG_DISARM, [sub, at])).rowCount || 0;
    await client.query(SQL.ACCOUNT_BUMP, [sub, at]);
    return changed;
  });
}

/**
 * @description Write one planned tick atomically.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {object} write - {window, trigger, runId, at, sessionDate, plan, account, ids, previousSymbols}.
 * @returns {Promise<{written:boolean, reason?:string}>} Whether the tick committed.
 */
async function writeTick(pool, sub, write) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = write.plan.fills.length ? 'traded' : 'no_trade';
    const claim = await client.query(SQL.TICK_CLAIM, [sub, write.window, write.trigger, write.runId, outcome, write.plan.fills.length,
      write.plan.equity, JSON.stringify(write.plan.summary), write.at]);
    if (!claim.rows.length) { await client.query('ROLLBACK'); return { written: false, reason: 'already_ticked' }; }
    const realized = write.plan.fills.reduce((s, f) => s + (f.realizedPl || 0), 0);
    const moved = await client.query(SQL.ACCOUNT_WRITE, [sub, write.plan.cash, write.plan.equity, write.plan.highWater,
      Math.round((write.account.realizedPl + realized) * 100) / 100, write.account.version + 1, write.window, write.at, write.account.version]);
    if (!moved.rowCount) { await client.query('ROLLBACK'); return { written: false, reason: 'book_changed' }; }
    await writeFills(client, sub, write);
    await writePositions(client, sub, write);
    await client.query(SQL.EQUITY_UPSERT, [sub, write.sessionDate, write.plan.equity, write.plan.cash, write.at]);
    await client.query('COMMIT');
    return { written: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @description Insert each fill and the decision behind it.
 * @param {object} client - Transaction client.
 * @param {string} sub - Caller subject.
 * @param {object} write - The tick write.
 * @returns {Promise<void>}
 */
async function writeFills(client, sub, write) {
  for (const [i, fill] of write.plan.fills.entries()) {
    const { orderId, decisionId } = write.ids[i];
    const d = fill.decision;
    await client.query(SQL.DECISION_INSERT, [decisionId, sub, write.window, fill.symbol, d.action, d.reason, d.score, d.confidence, d.regime,
      d.rationale, JSON.stringify(d.perTimeframe || []), write.at]);
    await client.query(SQL.ORDER_INSERT, [orderId, sub, write.window, decisionId, fill.symbol, fill.side, fill.qty, fill.price, fill.notional,
      fill.reason, fill.realizedPl, fill.quoteAt || null, write.at]);
  }
}

/**
 * @description Upsert every remaining position and delete the ones the tick closed.
 * @param {object} client - Transaction client.
 * @param {string} sub - Caller subject.
 * @param {object} write - The tick write.
 * @returns {Promise<void>}
 */
async function writePositions(client, sub, write) {
  const open = new Set();
  for (const p of write.plan.positions) {
    open.add(p.symbol);
    await client.query(SQL.POSITION_UPSERT, [sub, p.symbol, p.qty, p.avgCost, p.currentPrice, p.lastPriceAt || null,
      p.peak == null ? p.currentPrice : Math.max(p.peak, p.currentPrice), p.openedAt || write.at, write.at]);
  }
  for (const symbol of write.previousSymbols) if (!open.has(symbol)) await client.query(SQL.POSITION_DELETE, [sub, symbol]);
}

/**
 * @description Recent fills, newest first.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @returns {Promise<Array<object>>} Orders.
 */
async function listOrders(pool, sub) {
  return (await pool.query(SQL.ORDERS_LIST, [sub])).rows.map((r) => ({ ...r, qty: num(r.qty), fill_price: num(r.fill_price),
    notional: num(r.notional), realized_pl: num(r.realized_pl) }));
}

/**
 * @description Recent decisions, newest first.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @returns {Promise<Array<object>>} Decisions.
 */
async function listDecisions(pool, sub) {
  return (await pool.query(SQL.DECISIONS_LIST, [sub])).rows.map((r) => {
    let perTimeframe = [];
    try { perTimeframe = r.per_timeframe ? JSON.parse(r.per_timeframe) : []; } catch { perTimeframe = []; }
    return { ...r, score: num(r.score), confidence: num(r.confidence), regime: num(r.regime), per_timeframe: perTimeframe };
  });
}

/**
 * @description Recent ticks, newest first.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @returns {Promise<Array<object>>} Ticks with their parsed summary.
 */
async function listTicks(pool, sub) {
  return (await pool.query(SQL.TICKS_RECENT, [sub])).rows.map((r) => {
    let summary = null;
    try { summary = r.summary ? JSON.parse(r.summary) : null; } catch { summary = null; }
    return { ...r, order_count: num(r.order_count), equity: num(r.equity), summary };
  });
}

/**
 * @description Daily equity snapshots, oldest first.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @returns {Promise<Array<{date:string, equity:number, cash:number}>>} The series.
 */
async function equitySeries(pool, sub) {
  return (await pool.query(SQL.EQUITY_SERIES, [sub])).rows.map((r) => ({ date: r.session_date, equity: num(r.equity), cash: num(r.cash) }));
}

/**
 * @description Record the operator's manual paper decision (the order it describes is filled by writeManualFill).
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {object} d - {decisionId, symbol, side, qty, refPrice, quoteAt, rationale, at}.
 * @returns {Promise<void>}
 */
async function recordManualDecision(pool, sub, d) {
  await pool.query(SQL.DECISION_INSERT, [d.decisionId, sub, `manual:${d.decisionId}`, d.symbol, d.side, 'manual', null, null, null,
    d.rationale, JSON.stringify({ manual: true, side: d.side, qty: d.qty, refPrice: d.refPrice, quoteAt: d.quoteAt }), d.at]);
}

/**
 * @description One of the person's paper decisions, with the manual order it describes when it is one.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {string} decisionId - The decision.
 * @returns {Promise<object|null>} {decisionId, symbol, side, qty, rationale, manual} or null.
 */
async function loadDecision(pool, sub, decisionId) {
  const row = (await pool.query(SQL.DECISION_GET, [sub, decisionId])).rows[0];
  if (!row) return null;
  let detail = {};
  try { detail = row.per_timeframe ? JSON.parse(row.per_timeframe) : {}; } catch { detail = {}; }
  return { decisionId: row.decision_id, symbol: row.symbol, side: detail.side || row.action, qty: num(detail.qty),
    rationale: row.rationale, manual: detail.manual === true && row.reason === 'manual' };
}

/**
 * @description The fill already recorded for a decision, if any.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {string} decisionId - The decision.
 * @returns {Promise<object|null>} {orderId, qty, fillPrice, status} or null.
 */
async function orderForDecision(pool, sub, decisionId) {
  const row = (await pool.query(SQL.ORDER_FOR_DECISION, [sub, decisionId])).rows[0];
  return row ? { orderId: row.order_id, qty: num(row.qty), fillPrice: num(row.fill_price), status: row.status } : null;
}

/**
 * @description Write one manual fill atomically: the order, the account (version-checked; the tick window is kept),
 * the position and today's equity snapshot.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {object} w - {orderId, decisionId, fill:{symbol, side, qty, price, notional, realizedPl, quoteAt}, account, cash, equity,
 *   position:{symbol, qty, avgCost, price, lastPriceAt, peak, openedAt}|null, closed:boolean, sessionDate, at}.
 * @returns {Promise<{written:boolean, reason?:string}>} Whether the fill committed.
 */
async function writeManualFill(pool, sub, w) {
  return inTransaction(pool, async (client) => {
    const realized = Math.round((w.account.realizedPl + (w.fill.realizedPl || 0)) * 100) / 100;
    const moved = await client.query(SQL.ACCOUNT_WRITE, [sub, w.cash, w.equity, Math.max(w.account.highWater || 0, w.equity), realized,
      w.account.version + 1, w.account.lastTickWindow, w.at, w.account.version]);
    if (!moved.rowCount) throw Object.assign(new Error('book_changed'), { bookChanged: true });
    await client.query(SQL.ORDER_INSERT, [w.orderId, sub, `manual:${w.decisionId}`, w.decisionId, w.fill.symbol, w.fill.side, w.fill.qty,
      w.fill.price, w.fill.notional, 'manual', w.fill.realizedPl, w.fill.quoteAt || null, w.at]);
    if (w.closed) await client.query(SQL.POSITION_DELETE, [sub, w.fill.symbol]);
    else {
      const p = w.position;
      await client.query(SQL.POSITION_UPSERT, [sub, p.symbol, p.qty, p.avgCost, p.price, p.lastPriceAt || null,
        p.peak == null ? p.price : Math.max(p.peak, p.price), p.openedAt || w.at, w.at]);
    }
    await client.query(SQL.EQUITY_UPSERT, [sub, w.sessionDate, w.equity, w.cash, w.at]);
    return { written: true };
  }).catch((err) => { if (err && err.bookChanged) return { written: false, reason: 'book_changed' }; throw err; });
}

module.exports = { SQL, loadConfig, loadAccount, loadPositions, arm, disarm, writeTick, listOrders, listDecisions, listTicks, equitySeries,
  recordManualDecision, loadDecision, orderForDecision, writeManualFill };
