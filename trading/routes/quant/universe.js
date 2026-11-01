/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger asked for a wider pool to assess: more industries and niches, every stock Congress holds, crypto, mid caps, mining and metals. The pool is now the largest listed companies from the SEC's own list, every name a member of Congress has disclosed trading, hand-kept themes, the person's holdings and watchlist. Disclosures show trades rather than holdings, and nothing here can price a coin, so crypto means listed stocks and funds; the screen says both. Each outside read may fail on its own.
 */
'use strict';
const store = require('./store');
const { FUNDS } = require('./rank');
const { themeTickers } = require('./themes');
const { CONGRESS_SEED } = require('./congress-seed');
const { DEFAULT_UNIVERSE } = require('../paper/universe');
const { readCongressCandidates } = require('../trading-congress-candidates');
const { EDGAR_UA } = require('../trading-edgar-filings');

/** The SEC's list of companies, with exchange, ordered roughly largest first. */
const LISTED_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
/** How many of the largest listed companies join the pool: enough to reach well into small companies. */
const LISTED_SIZE = 3000;
/** A ceiling that still fits one night of bounded passes. */
const MAX_POOL = 4500;
const DUST_USD = 100;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const EXCHANGES = Object.freeze(new Set(['Nasdaq', 'NYSE', 'CBOE']));
/** A common share or a share class. Preferred shares and other suffixes are left out. */
const COMMON_SHARE = /^[A-Z]{1,5}$|^[A-Z]{1,4}-[A-C]$/;
/** Nasdaq's fifth letter for warrants, rights and units. */
const NOT_A_SHARE = /^[A-Z]{4}[WRU]$/;
/** Shell companies and closed-end funds in the SEC's list. */
const NOT_A_BUSINESS = /\b(acquisition|acquisitions|blank check|spac|merger corp|fund|funds)\b/i;
/** Five letters ending in X is the convention for a mutual fund, which has one price a day and no market to speak of. */
const MUTUAL_FUND = /^[A-Z]{4}X$/;

/**
 * @description The SEC's list of companies.
 * @returns {Promise<object>} {fields, data}.
 */
async function listedCompanies() {
  const response = await fetch(LISTED_URL, { headers: { 'User-Agent': EDGAR_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`SEC company list unavailable (HTTP ${response.status}).`);
  return response.json();
}

/**
 * @description The SEC's list as the desk uses it: a directory of every company, and the largest listed businesses in order.
 * @param {object} table - {fields, data}.
 * @returns {{listed:string[], names:Object<string,string>, ciks:Object<string,string>}} Tickers use the form the kernel reads (BRK.B).
 */
function readDirectory(table) {
  const at = Object.fromEntries((table.fields || []).map((name, i) => [name, i]));
  const listed = [], names = {}, ciks = {};
  for (const row of table.data || []) {
    const raw = String(row[at.ticker] || '').toUpperCase(), symbol = raw.replace('-', '.');
    if (!TICKER.test(symbol) || names[symbol]) continue;
    names[symbol] = String(row[at.name] || '');
    ciks[symbol] = String(row[at.cik] || '').padStart(10, '0');
    if (EXCHANGES.has(row[at.exchange]) && COMMON_SHARE.test(raw) && !NOT_A_SHARE.test(raw) && !NOT_A_BUSINESS.test(names[symbol])) listed.push(symbol);
  }
  return { listed: listed.slice(0, LISTED_SIZE), names, ciks };
}

/**
 * @description The person's holdings by symbol, ignoring dust too small to matter.
 * @param {Function} intent - Kernel intent call.
 * @returns {Promise<Array<object>>} Holdings with their total value and accounts.
 */
async function readHoldings(intent) {
  const answer = await intent('trading.accounts', {});
  const out = new Map();
  for (const account of answer.accounts || []) {
    for (const p of account.positions || []) {
      const symbol = String(p.symbol || '').toUpperCase(), value = Number(p.marketValue) || 0;
      if (!symbol || value < DUST_USD) continue;
      const held = out.get(symbol) || { symbol, marketValue: 0, accounts: [] };
      held.marketValue = Math.round((held.marketValue + value) * 100) / 100;
      if (account.accountMasked) held.accounts.push(account.accountMasked);
      out.set(symbol, held);
    }
  }
  return [...out.values()];
}

/**
 * @description Congress purchases of the last 90 days by symbol.
 * @param {object} ctx - Route context.
 * @param {Date} now - Instant.
 * @returns {Promise<Array<object>>} Buyers and latest disclosure per symbol.
 */
async function readCongress(ctx, now) {
  const { candidates } = await readCongressCandidates(ctx, now);
  return candidates.map((c) => ({ symbol: c.symbol, buyers: c.distinctBuyers, latest: c.latestDisclosure }));
}

/**
 * @description Every name a member of Congress has disclosed trading. The feed has no paging and returns 200 rows at most, so it is read
 * per chamber and then per member and direction, and what it finds is kept: a name stays once seen.
 * @param {object} deps - {pool, intent}.
 * @param {string} sub - Owner.
 * @returns {Promise<{symbols:string[], members:string[]}>} Names and members so far.
 */
async function readCongressNames(deps, sub) {
  const known = (await store.getRecord(deps.pool, sub, 'congress-names', 'current')) || { symbols: CONGRESS_SEED, members: [] };
  const symbols = new Set(known.symbols), members = new Set(known.members);
  const read = async (input) => {
    const page = await deps.intent('feeds.congress_trades', { sinceDays: 365, limit: 200, ...input });
    for (const trade of page.trades || []) {
      const ticker = String(trade.ticker || '').toUpperCase(), member = String(trade.representative || '').trim();
      if (TICKER.test(ticker)) symbols.add(ticker);
      if (member && member.toLowerCase() !== 'unknown') members.add(member);
    }
  };
  for (const chamber of ['house', 'senate']) for (const direction of ['buy', 'sell']) await read({ chamber, direction });
  for (const representative of [...members]) for (const direction of ['buy', 'sell']) await read({ representative, direction });
  const value = { symbols: [...symbols].sort(), members: [...members].sort() };
  await store.putRecord(deps.pool, sub, 'congress-names', 'current', value);
  return value;
}

/**
 * @description The pool in reading order, so a night cut short still covers what matters most to the person.
 * @param {object} input - {holdings, watchlist, congress, congressNames, listed}.
 * @returns {string[]} Tickers, each once.
 */
function composePool({ holdings, watchlist, congress, congressNames, listed }) {
  const traded = congressNames.filter((s) => !MUTUAL_FUND.test(s));
  const wanted = ['SPY', ...holdings.map((h) => h.symbol), ...watchlist, ...congress.map((c) => c.symbol), ...themeTickers(), ...DEFAULT_UNIVERSE, ...listed, ...traded];
  return [...new Set(wanted)].filter((s) => TICKER.test(s) && (s === 'SPY' || !FUNDS.has(s))).slice(0, MAX_POOL);
}

/**
 * @description Tonight's pool and the inputs read on the way. Each outside read may fail on its own; the last good SEC list stands in for a failed one.
 * @param {object} deps - {ctx, pool, intent, listedCompanies}.
 * @param {string} sub - Owner.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} {symbols, holdings, congress, notes, pool}.
 */
async function buildUniverse(deps, sub, now) {
  const notes = [];
  const attempt = async (label, read, fallback) => { try { return await read(); } catch (err) { notes.push(`${label} unavailable: ${String(err && err.message || err).slice(0, 160)}`); return fallback; } };
  const holdings = await attempt('Holdings', () => readHoldings(deps.intent), []);
  const watchlist = await attempt('Watchlist', async () => (await deps.pool.query('SELECT symbol FROM oshal_trading_watchlist WHERE user_sub=$1', [sub])).rows.map((r) => String(r.symbol).toUpperCase()), []);
  const congress = await attempt('Congress purchases', () => readCongress(deps.ctx, now), []);
  const names = await attempt('Congress names', () => readCongressNames(deps, sub), { symbols: CONGRESS_SEED, members: [] });
  const previous = await store.getRecord(deps.pool, sub, 'directory', 'current');
  const directory = await attempt('SEC company list', async () => readDirectory(await deps.listedCompanies()), previous || { listed: [], names: {}, ciks: {} });
  await store.putRecord(deps.pool, sub, 'directory', 'current', directory);
  const symbols = composePool({ holdings, watchlist, congress, congressNames: names.symbols, listed: directory.listed });
  const inPool = new Set(symbols), count = (list) => list.filter((s) => inPool.has(s)).length;
  return { symbols, holdings, congress, notes, pool: { total: symbols.length, listed: count(directory.listed), congress: count(names.symbols), themes: count(themeTickers()), yours: count([...holdings.map((h) => h.symbol), ...watchlist]) } };
}

module.exports = { LISTED_URL, LISTED_SIZE, MAX_POOL, listedCompanies, readDirectory, composePool, readCongressNames, buildUniverse };
