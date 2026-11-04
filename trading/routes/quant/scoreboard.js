/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The quality-dip signal: at least 25% below the 52-week high yet profitable with growing revenue in the latest annual filing, deepest fall first. Its fundamentals are only known today, so it is judged by the forward record like profitable growth. Each forward signal now carries its own pick rule, used by the cohort and the screen alike, so what is graded is exactly what is shown.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A night's picks stored the whole list, thousands of names at the new size, and kept it for good. The list is now dropped once every horizon is graded.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The latest graded picks shown are those of the signal that led the list when they were made.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk's forward scoreboard: each session's top picks per signal are recorded before their outcome exists, entered at the next session's close and graded 5, 21 and 63 sessions later against SPY and the whole list. Verdicts wait for enough non-overlapping windows.
 */
'use strict';
const { PRICE_SIGNALS, round } = require('./factors');
const { meanT, verdictFor } = require('./history');

const HORIZONS = Object.freeze([5, 21, 63]);
const TOP_N = 10;
const MIN_WINDOWS = 12;

/** A latest annual SEC filing showing a real, growing business: positive net margin and growing revenue. */
const quality = (r) => Boolean(r.fund && r.fund.revenueYoYPct > 0 && r.fund.netMarginPct > 0);
/**
 * Signals with no history test: their inputs are only known today, so only the forward record can judge them.
 * Each carries its own pick rule, best first, shared by the cohort and the screen so what is graded is what is shown.
 */
const FORWARD_SIGNALS = Object.freeze([
  { id: 'quality-growth', name: 'Profitable growth', what: 'Growing revenue and positive net margin in the latest annual SEC filing, strongest first', source: 'Related: Novy-Marx, 2013',
    picks: (rows) => rows.filter(quality).sort((a, b) => (b.fund.revenueYoYPct + b.fund.netMarginPct) - (a.fund.revenueYoYPct + a.fund.netMarginPct) || a.symbol.localeCompare(b.symbol)) },
  { id: 'quality-dip', name: 'Quality dip', what: 'At least 25% below its 52-week high, yet profitable with growing revenue in its latest annual SEC filing, deepest fall first', source: 'Operator rule, fixed 2026-11-03; related: De Bondt & Thaler, 1985',
    picks: (rows) => rows.filter((r) => r.f.fromHigh <= -0.25 && quality(r)).sort((a, b) => a.f.fromHigh - b.f.fromHigh || a.symbol.localeCompare(b.symbol)) },
  { id: 'congress', name: 'Congress buying', what: 'Bought by members of Congress in the last 90 days of disclosures, most buyers first', source: 'Disputed: Ziobrowski et al., 2004; Eggers & Hainmueller, 2013',
    picks: (rows) => rows.filter((r) => r.congress && r.congress.buyers > 0).sort((a, b) => b.congress.buyers - a.congress.buyers || String(b.congress.latest).localeCompare(String(a.congress.latest)) || a.symbol.localeCompare(b.symbol)) },
]);

/**
 * @description Today's top names per signal, recorded before any outcome exists.
 * @param {string} session - The session the picks were made after.
 * @param {Array<object>} rows - Today's scored rows.
 * @returns {object} The cohort.
 */
function makeCohort(session, rows) {
  const picks = {};
  for (const signal of PRICE_SIGNALS) {
    picks[signal.id] = rows.map((r) => ({ s: r.symbol, v: signal.score(r.f) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v).slice(0, TOP_N).map((x) => x.s);
  }
  for (const signal of FORWARD_SIGNALS) picks[signal.id] = signal.picks(rows).slice(0, TOP_N).map((r) => r.symbol);
  return { session, picks, list: rows.map((r) => r.symbol), graded: {} };
}

/**
 * @description A symbol's return between two dates from its recent closes.
 * @param {Map<string, Map<string, number>>} closes - Close by date by symbol.
 * @param {string} symbol - Ticker.
 * @param {string} from - Entry date.
 * @param {string} to - Exit date.
 * @returns {number|null} The return, or null when either close is missing.
 */
function returnBetween(closes, symbol, from, to) {
  const series = closes.get(symbol), a = series && series.get(from), b = series && series.get(to);
  return a > 0 && b > 0 ? b / a - 1 : null;
}

/**
 * @description One signal's graded picks in one window.
 * @param {string[]} names - The picks.
 * @param {Map<string, Map<string, number>>} closes - Close by date by symbol.
 * @param {string} from - Entry date.
 * @param {string} to - Exit date.
 * @param {number} spy - SPY's return over the same window.
 * @returns {object|null} Average, how many beat SPY and each pick's result, or null when none could be graded.
 */
function gradePicks(names, closes, from, to, spy) {
  const results = names.map((s) => [s, returnBetween(closes, s, from, to)]).filter(([, r]) => r != null);
  if (!results.length) return null;
  const mean = results.reduce((sum, [, r]) => sum + r, 0) / results.length;
  return { n: results.length, mean: round(mean, 5), beat: results.filter(([, r]) => r > spy).length, picks: results.map(([s, r]) => [s, round(r, 4)]) };
}

/**
 * @description Grade any horizon of a cohort that has now matured. A grade, once recorded, never changes.
 * @param {object} cohort - The stored cohort; its graded map gains entries.
 * @param {Map<string, Map<string, number>>} closes - Close by date by symbol.
 * @param {string[]} sessions - SPY's session dates, oldest first.
 * @returns {boolean} Whether anything new was graded.
 */
function gradeCohort(cohort, closes, sessions) {
  const at = sessions.indexOf(cohort.session);
  if (at < 0) return false;
  let changed = false;
  for (const h of HORIZONS) {
    const from = sessions[at + 1], to = sessions[at + 1 + h];
    if (cohort.graded[h] || !from || !to) continue;
    const spy = returnBetween(closes, 'SPY', from, to);
    if (spy == null) continue;
    const listed = cohort.list.map((s) => returnBetween(closes, s, from, to)).filter((r) => r != null);
    const signals = {};
    for (const [id, names] of Object.entries(cohort.picks)) {
      const graded = gradePicks(names, closes, from, to, spy);
      if (graded) signals[id] = graded;
    }
    cohort.graded[h] = { from, to, spy: round(spy, 5), list: listed.length ? round(listed.reduce((s, r) => s + r, 0) / listed.length, 5) : null, signals };
    changed = true;
  }
  if (changed && HORIZONS.every((h) => cohort.graded[h])) delete cohort.list;
  return changed;
}

/**
 * @description Keep only windows that do not overlap, so one market move is never counted twice.
 * @param {Array<object>} cohorts - Cohorts, oldest first.
 * @param {number} h - Horizon.
 * @param {string} id - Signal id.
 * @returns {Array<object>} The independent graded windows.
 */
function independentWindows(cohorts, h, id) {
  const windows = [];
  let lastExit = '';
  for (const cohort of cohorts) {
    const grade = cohort.graded[h];
    if (grade && grade.signals[id] && grade.from > lastExit) {
      windows.push({ session: cohort.session, grade, signal: grade.signals[id] });
      lastExit = grade.to;
    }
  }
  return windows;
}

/**
 * @description One signal's forward record at one horizon.
 * @param {Array<object>} cohorts - Cohorts, oldest first.
 * @param {number} h - Horizon.
 * @param {string} id - Signal id.
 * @returns {object} Windows, average against SPY and the list, and its verdict.
 */
function horizonRecord(cohorts, h, id) {
  const windows = independentWindows(cohorts, h, id);
  const vsSpy = windows.map((w) => w.signal.mean - w.grade.spy);
  const vsList = windows.filter((w) => w.grade.list != null).map((w) => w.signal.mean - w.grade.list);
  const half = Math.floor(vsList.length / 2), { mean, t } = meanT(vsList);
  const picks = windows.reduce((n, w) => n + w.signal.n, 0), beat = windows.reduce((n, w) => n + w.signal.beat, 0);
  const verdict = windows.length < MIN_WINDOWS ? 'Not enough yet' : verdictFor({ months: Infinity, mean, t, firstHalf: meanT(vsList.slice(0, half)).mean, secondHalf: meanT(vsList.slice(half)).mean });
  return { h, windows: windows.length, needed: MIN_WINDOWS, verdict, vsSpy: round(meanT(vsSpy).mean, 5), vsList: round(mean, 5), t: round(t, 2), beatSpyPct: picks ? round((beat / picks) * 100, 1) : null, picks };
}

/**
 * @description The latest fully graded picks at a horizon, best and worst, across every signal.
 * @param {Array<object>} cohorts - Cohorts, oldest first.
 * @param {number} h - Horizon.
 * @returns {object|null} The window with its best and worst picks of the signal that led the list.
 */
function latestGraded(cohorts, h) {
  for (let i = cohorts.length - 1; i >= 0; i -= 1) {
    const grade = cohorts[i].graded[h], id = cohorts[i].rankBy || 'composite';
    if (grade && grade.signals[id]) {
      const sorted = [...grade.signals[id].picks].sort((a, b) => b[1] - a[1]);
      return { session: cohorts[i].session, signal: id, h, from: grade.from, to: grade.to, spy: grade.spy, best: sorted.slice(0, 3), worst: sorted.slice(-3).reverse() };
    }
  }
  return null;
}

/**
 * @description The whole forward scoreboard.
 * @param {Array<object>} cohorts - Stored cohorts in any order.
 * @param {string} at - ISO time of the run.
 * @returns {object} Records by signal and horizon, with how far along the record is.
 */
function forwardBoard(cohorts, at) {
  const sorted = [...cohorts].sort((a, b) => a.session.localeCompare(b.session));
  const signals = [...PRICE_SIGNALS, ...FORWARD_SIGNALS].map((s) => ({ id: s.id, name: s.name, what: s.what, source: s.source, horizons: HORIZONS.map((h) => horizonRecord(sorted, h, s.id)) }));
  return {
    at, cohorts: sorted.length, firstSession: sorted[0]?.session ?? null, lastSession: sorted.at(-1)?.session ?? null,
    graded: Object.fromEntries(HORIZONS.map((h) => [h, sorted.filter((c) => c.graded[h]).length])),
    latest: latestGraded(sorted, 21) || latestGraded(sorted, 5),
    signals,
  };
}

module.exports = { HORIZONS, MIN_WINDOWS, FORWARD_SIGNALS, makeCohort, returnBetween, gradeCohort, independentWindows, horizonRecord, forwardBoard };
