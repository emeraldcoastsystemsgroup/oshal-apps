/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper book on the Accounts landing. On the native kernel the book store lists no books (the paper book lives in the package's own trading_paper_* tables), so GET /accounts and GET /summary answered an empty roster and $0 and the landing said "No accounts yet - connect a Schwab login" while the person's paper book held $100,000. These helpers give the roster its paper book and the summary its row and positions: the recorded equity, cash, day change against the last recorded session and the held names valued at their last recorded price. A person who has not started the paper book gets a row saying so, never invented balances. A host without the kernel price intents, a connected rail or a stored paper book keeps the existing answers exactly.
 *
 * @module paper/landing
 */
'use strict';

const store = require('./store');
const { nativeHost, accountOf, positionsOf, dayOf } = require('./screen');

/** The paper book's name on the landing (the same words the page uses for the paper book). */
const PAPER_LABEL = 'Paper (reference book)';
/** What the landing says for a paper book the person has not started yet. */
const NOT_OPENED = 'Not started yet. Open this account and press Start paper autopilot to begin with paper cash; no broker is needed.';

/**
 * @description Whether the roster already carries a stored paper book (the platform host does).
 * @param {Array<object>} books - Listed books.
 * @returns {boolean} True when a book with ref 'paper' is listed.
 */
function hasPaperBook(books) {
  return (books || []).some((b) => b && b.ref === 'paper');
}

/**
 * @description The person's native paper book for the landing, or null when the existing answers stand.
 * @param {object} ctx - Route context.
 * @param {string} sub - Caller subject.
 * @param {Array<object>} books - The books the store listed.
 * @param {boolean} railConnected - Whether the paper book's broker rail is connected.
 * @returns {Promise<object|null>} {opened, armed, state, series, error}.
 */
async function paperLanding(ctx, sub, books, railConnected) {
  if (railConnected || !sub || !nativeHost(ctx) || hasPaperBook(books)) return null;
  try {
    const account = await store.loadAccount(ctx.pool, sub);
    if (!account) return { opened: false, armed: false, state: null, series: [], error: null };
    const [config, positions, series] = await Promise.all([store.loadConfig(ctx.pool, sub), store.loadPositions(ctx.pool, sub),
      store.equitySeries(ctx.pool, sub)]);
    return { opened: true, armed: Boolean(config && config.armed), state: { config, account, positions }, series, error: null };
  } catch (err) {
    const detail = String((err && err.message) || err || 'unknown failure').replace(/\s+/g, ' ').slice(0, 200);
    return { opened: false, armed: false, state: null, series: [], error: `The paper book could not be read: ${detail}` };
  }
}

/**
 * @description The roster entry GET /accounts lists for the native paper book. It has no stored book id: the
 * surface matches it on ref, and the per-book strategy and arming controls do not apply to it.
 * @param {object} landing - paperLanding's answer.
 * @returns {object} The books[] entry.
 */
function rosterBook(landing) {
  return { bookId: null, ref: 'paper', kind: 'paper', enabled: true, learn: false, label: PAPER_LABEL, accountMasked: null,
    strategy: null, capitalCapUsd: null, connectionMissing: false, accountType: null, settlementPolicy: null,
    armAckRequired: false, armAckAt: null, armAckBy: null, nativePaper: { opened: landing.opened, armed: landing.armed } };
}

/**
 * @description The GET /summary row and positions for the native paper book.
 * @param {object} landing - paperLanding's answer.
 * @param {Date} now - Instant (the day change compares against the last session recorded before today).
 * @returns {{row: object, positions: Array<object>}} The row (balances, a not-started note or the read's error) and the held names.
 */
function summaryOf(landing, now) {
  const base = { bookId: null, ref: 'paper', kind: 'paper', enabled: true, nativePaper: { opened: landing.opened, armed: landing.armed } };
  if (landing.error) return { row: { ...base, error: landing.error }, positions: [] };
  if (!landing.opened) return { row: { ...base, notOpened: true, message: NOT_OPENED }, positions: [] };
  const account = accountOf(landing.state);
  const day = dayOf(landing.series, account.equity, now);
  return {
    row: { ...base, source: 'native-paper', equity: account.equity, cash: account.cash, buyingPower: account.buyingPower,
      dayChange: day ? day.dayPL : null, dayChangePct: day ? day.dayPLPct : null },
    positions: positionsOf(landing.state),
  };
}

module.exports = { paperLanding, rosterBook, summaryOf, hasPaperBook, PAPER_LABEL, NOT_OPENED };
