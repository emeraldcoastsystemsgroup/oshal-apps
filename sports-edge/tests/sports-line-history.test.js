/**
 * Guards for line capture — the part of this package whose data cannot be recovered if it is wrong.
 *
 * Three failures matter here, and none of them look like a crash:
 *   1. A LINE MOVE IS MISSED. If `sameLine` is too loose, a real move extends the standing row and
 *      the movement history silently loses a step that can never be re-observed.
 *   2. A FAKE MOVE IS RECORDED. If it is too strict — treating a missing number as different from
 *      another missing number — a flaky read writes a phantom move and the history becomes noise.
 *   3. AN OBSERVATION IS CALLED AN OPENER. The earliest row is the first quote WE saw. Labelling a
 *      four-hours-before-kickoff pickup as an opening line corrupts every closing-line-value number
 *      computed on top of it, permanently and invisibly.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — quote normalisation and equality incl. the null-vs-null and NaN cases, the refusal to store a priceless quote, movement summarisation, opener confidence rather than an asserted opening line, and spread-based closing-line value.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OPENER_EARLY_HOURS, describeMove, hasPrice, normaliseQuote, sameLine, spreadClv, summariseMovement,
} = require('../routes/sports-line-history.js');

const Q = { book: 'DraftKings', homeSpread: -3.5, homeSpreadOdds: -110, awaySpreadOdds: -110, homeMoneyline: -180, awayMoneyline: 150, total: 44.5 };

test('normalisation keeps the compared numbers and drops everything else', () => {
  const n = normaliseQuote(Q);
  assert.equal(n.homeSpread, -3.5);
  assert.equal(n.homeMoneyline, -180);
  assert.equal(n.book, undefined, 'the book is not part of the line itself');
  assert.equal(n.total, undefined, 'the total is stored but is not what defines a spread move');
});

test('an absent number and a NaN normalise the SAME — otherwise a flaky read is a phantom move', () => {
  assert.equal(normaliseQuote({}).homeSpread, null);
  assert.equal(normaliseQuote({ homeSpread: NaN }).homeSpread, null);
  assert.equal(normaliseQuote(undefined).homeSpread, null);
  assert.equal(sameLine({}, { homeSpread: NaN }), true, 'two ways of saying "no price" are the same line');
});

test('the same line is the same line', () => {
  assert.equal(sameLine(Q, { ...Q }), true);
  assert.equal(sameLine(Q, { ...Q, book: 'Other', total: 99 }), true, 'book and total do not define the move');
});

test('A REAL MOVE IS DETECTED — a missed move is a step lost forever', () => {
  assert.equal(sameLine(Q, { ...Q, homeSpread: -4 }), false, 'half a point is a move');
  assert.equal(sameLine(Q, { ...Q, homeMoneyline: -185 }), false, 'a price move is a move');
  assert.equal(sameLine(Q, { ...Q, homeSpreadOdds: -115 }), false, 'juice is part of the line');
});

test('a quote with NO price is never stored — that would fabricate an opener', () => {
  assert.equal(hasPrice(Q), true);
  assert.equal(hasPrice({ book: 'DraftKings' }), false, 'a book that has not posted is ABSENT, not zero');
  assert.equal(hasPrice({ book: 'X', total: 44.5 }), false, 'a total alone is not a side to bet');
  assert.equal(hasPrice({ homeMoneyline: -180 }), true, 'a moneyline alone is a real market');
  assert.equal(hasPrice(null), false);
});

/** Builds a stored observation. */
function obs(spread, ml, firstSeen) {
  return {
    eventId: 'E1', book: 'DraftKings', homeSpread: spread, homeSpreadOdds: -110, awaySpreadOdds: -110,
    homeMoneyline: ml, awayMoneyline: null, total: null,
    firstSeen, lastSeen: firstSeen, observations: 1,
  };
}

test('a move reads in the direction the market moved', () => {
  // -3.5 -> -4.5 is the market moving TOWARD the home side.
  const m = describeMove(obs(-3.5, -180, '2026-09-01T00:00Z'), obs(-4.5, -200, '2026-09-02T00:00Z'));
  assert.ok(m);
  assert.equal(m.spreadDelta, 1, 'positive = toward home');
  assert.equal(m.moneylineDelta, -20);
  assert.match(m.what, /spread -3.5 to -4.5/);
});

test('no change produces no move, so a movement list needs no filtering', () => {
  assert.equal(describeMove(obs(-3.5, -180, 'a'), obs(-3.5, -180, 'b')), null);
});

test('the movement summary orders by time and totals the net move', () => {
  const rows = [
    obs(-4.5, -200, '2026-09-03T00:00Z'),
    obs(-3.5, -180, '2026-09-01T00:00Z'),
    obs(-4, -190, '2026-09-02T00:00Z'),
  ];
  const s = summariseMovement(rows, '2026-09-06T00:00Z');
  assert.equal(s.firstSeen.homeSpread, -3.5, 'earliest first, whatever order they arrive in');
  assert.equal(s.latest.homeSpread, -4.5);
  assert.equal(s.moves.length, 2);
  assert.equal(s.netSpreadMove, 1, '-3.5 to -4.5 is a full point toward home');
});

test('THE EARLIEST ROW IS NOT CALLED AN OPENING LINE — it is labelled by confidence', () => {
  // Five days of lead: plausibly at or near the book's opener.
  const early = summariseMovement([obs(-3.5, -180, '2026-09-01T00:00Z')], '2026-09-06T00:00Z');
  assert.equal(early.openerConfidence, 'observed-early');
  assert.ok(early.openerLeadHours >= OPENER_EARLY_HOURS);

  // Four hours of lead: the number had days to move before we ever looked.
  const late = summariseMovement([obs(-3.5, -180, '2026-09-05T20:00Z')], '2026-09-06T00:00Z');
  assert.equal(late.openerConfidence, 'late-pickup');
  assert.equal(late.openerLeadHours, 4);
});

test('with no kickoff there is no confidence claim at all', () => {
  const s = summariseMovement([obs(-3.5, -180, '2026-09-01T00:00Z')], null);
  assert.equal(s.openerConfidence, 'unknown');
  assert.equal(s.openerLeadHours, null);
});

test('an empty history summarises to nothing rather than throwing', () => {
  const s = summariseMovement([], '2026-09-06T00:00Z');
  assert.equal(s.firstSeen, null);
  assert.equal(s.latest, null);
  assert.deepEqual(s.moves, []);
  assert.equal(s.netSpreadMove, null);
});

test('spread CLV is favourable when the market moves TOWARD the side we took', () => {
  // Took home -3.5, it closed -4.5: the market came to us.
  assert.equal(spreadClv('home', -3.5, -4.5), 1);
  // Same move, but we were on the away side: it moved against us.
  assert.equal(spreadClv('away', -3.5, -4.5), -1);
  // Took home -4.5, closed -3.5: we laid more than the close.
  assert.equal(spreadClv('home', -4.5, -3.5), -1);
  assert.equal(spreadClv('home', -3.5, -3.5), 0, 'no move, no value');
});

// ---- capture SQL contract ---------------------------------------------------
// These cross the boundary the bug actually lived at: WHAT SQL THE WRITER ISSUES. A pure-function
// test could not have caught it, because the arithmetic was always right — the predicate was not.
const { captureQuote } = require('../routes/sports-line-store.js');

/** A pool stub that records every query and answers the standing-quote SELECT with `standing`. */
function fakePool(standing) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/^SELECT \* FROM sports_line_history/i.test(String(sql).trim())) {
        return { rows: standing ? [standing] : [] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const GAME = { league: 'nfl', eventId: 'E1', gameDate: '2026-09-14T17:00Z', homeTeam: 'SEA', awayTeam: 'NE' };
/** A stored row as Postgres returns it — note the MICROSECOND timestamp that caused the bug. */
const STORED = {
  id: 4242, event_id: 'E1', book: 'DraftKings',
  home_spread: '-3.5', home_spread_odds: -110, away_spread_odds: -110,
  home_moneyline: null, away_moneyline: null, total: '44.5',
  first_seen: '2026-09-09 05:01:59.133599+00', last_seen: '2026-09-09 05:01:59.133599+00',
  observations: 1,
};
const SAME = { book: 'DraftKings', homeSpread: -3.5, homeSpreadOdds: -110, awaySpreadOdds: -110, total: 44.5 };

test('AN UNCHANGED LINE UPDATES BY ROW ID, NEVER BY TIMESTAMP', async () => {
  // Postgres keeps microseconds (…133599); a JS Date round-trip keeps milliseconds (…133Z). A
  // `WHERE first_seen = $3` predicate therefore matched NOTHING: no duplicate rows appeared, so it
  // looked correct, while observations froze at 1 and last_seen never advanced. Found on the box.
  const pool = fakePool(STORED);
  assert.equal(await captureQuote(pool, GAME, SAME), 'unchanged');
  const update = pool.queries.find((q) => /^UPDATE/i.test(q.sql));
  assert.ok(update, 'an unchanged line must still extend the standing row');
  assert.match(update.sql, /WHERE id = \$1/, 'must target the primary key');
  assert.equal(update.params[0], 4242, 'and pass the real row id');
  assert.equal(/first_seen\s*=/.test(update.sql), false, 'never match on a round-tripped timestamp');
});

test('a moved line INSERTS instead of updating', async () => {
  const pool = fakePool(STORED);
  assert.equal(await captureQuote(pool, GAME, { ...SAME, homeSpread: -4 }), 'moved');
  assert.ok(pool.queries.some((q) => /^INSERT/i.test(q.sql)), 'a move is a new row');
  assert.equal(pool.queries.some((q) => /^UPDATE/i.test(q.sql)), false, 'and must not extend the old one');
});

test('the first sighting of a game inserts and reports first-capture', async () => {
  const pool = fakePool(null);
  assert.equal(await captureQuote(pool, GAME, SAME), 'first-capture');
  assert.ok(pool.queries.some((q) => /^INSERT/i.test(q.sql)));
});

test('a priceless quote touches the database at ALL — not even a SELECT', async () => {
  const pool = fakePool(STORED);
  assert.equal(await captureQuote(pool, GAME, { book: 'DraftKings' }), 'no-price');
  assert.equal(pool.queries.length, 0, 'no price means nothing to compare and nothing to store');
});
