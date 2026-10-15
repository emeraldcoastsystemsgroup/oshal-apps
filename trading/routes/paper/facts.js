/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper book's figures for the trading bots' specialist facts. On the native kernel the person's paper book lives in the package's own trading_paper_* tables, not in the legacy book store the facts reader lists, so the analyst was told "paper.present false" and answered that the person had no paper book while it held $100,000. The paper slot now carries that book: present, today's and the prior session's recorded equity from its daily snapshots (null when none was recorded, never a guess), and today's realized result from its own filled sells.
 *
 * @module paper/facts
 */
'use strict';

const store = require('./store');
const { etParts } = require('./market');
const { nativeHost, realizedOf } = require('./screen');

const round2 = (n) => Math.round(n * 100) / 100;
const dayKey = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);

/**
 * @description The person's native paper book as one specialist-facts slot, or null when there is none.
 * @param {object} ctx - Route context (the native host has ctx.intent and ctx.pool).
 * @param {string} sub - The ticket owner.
 * @param {Date} now - The clock.
 * @returns {Promise<object|null>} The slot's numbers in the book-facts shape.
 */
async function nativePaperFacts(ctx, sub, now) {
  if (!nativeHost(ctx) || !sub) return null;
  const account = await store.loadAccount(ctx.pool, sub);
  if (!account) return null;
  const today = etParts(now).date;
  const series = await store.equitySeries(ctx.pool, sub);
  const todays = series.filter((r) => dayKey(r.date) === today).pop();
  const prior = series.filter((r) => dayKey(r.date) < today).pop();
  const realized = realizedOf(await store.listOrders(ctx.pool, sub), now).today;
  return {
    present: true,
    equityToday: todays ? round2(todays.equity) : null,
    equityPriorClose: prior ? round2(prior.equity) : null,
    equityRecordedToday: Boolean(todays),
    realizedNet: realized.net, realizedTrades: realized.trades, realizedWins: realized.wins, realizedLosses: realized.losses,
  };
}

module.exports = { nativePaperFacts };
