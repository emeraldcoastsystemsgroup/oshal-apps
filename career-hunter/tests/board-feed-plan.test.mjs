/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Regression guards for the operator-reported 50s job board. Every assertion here is on the statements the planner ACTUALLY issues (captured through a recording db double), not on substrings of a string it happened to build — each of these shapes was measured as a multi-second regression on the live 1.45M-posting store, so a guard that can pass while the query changes underneath is worth nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Against the COMPILED module — that is what the api loads.
const feed = require('../routes/career-board-feed.js');

/**
 * A better-sqlite3 double that records every statement prepared and replays canned result sets.
 * `rows` is a queue: one entry per prepare() whose statement is executed with .all().
 */
function recordingDb(rows = []) {
  const sql = [];
  const queue = [...rows];
  return {
    sql,
    prepare(text) {
      sql.push(text);
      return {
        all: () => (queue.length ? queue.shift() : []),
        get: () => ({ n: 0 }),
      };
    },
  };
}

const card = (id) => ({ id, title: 't', ai_fit_score: 90 });
const page = (n) => Array.from({ length: n }, (_, i) => card(i + 1));

/** The scored-candidate CTE — the statement the board's speed depends on. */
const poolSql = (db) => db.sql.find((s) => s.includes('WITH cand AS'));
/** The unscored backfill — the statement that must NOT run by default. */
const tailSql = (db) => db.sql.find((s) => s.includes('s.ai_fit_score IS NULL'));

test('the lane predicate is sargable, so idx_corpus_lane can serve it', () => {
  const { corpWhere } = feed.splitBoardFilters({});
  assert.ok(corpWhere.includes('p.target_role = 1'));
  // COALESCE(p.target_role,0) = 1 is equivalent but unindexable — it is what made the board
  // fall back to a 157K-row scan. It must never come back.
  assert.ok(!corpWhere.includes('COALESCE(p.target_role'));
});

test('min_score is pushed into the candidate pool as an index range bound', () => {
  const { scoredWhere, scoredArgs, corpWhere } = feed.splitBoardFilters({ min_score: '90' });
  assert.ok(scoredWhere.includes('s.ai_fit_score >= ?'));
  assert.deepEqual(scoredArgs, [90]);
  // Not COALESCE(...) — that form cannot seek on idx_user_scored (measured 108ms -> 0ms).
  assert.ok(!scoredWhere.includes('COALESCE(s.ai_fit_score'));
  // And it must not leak into the corpus half, where it would be applied after the join.
  assert.ok(!corpWhere.includes('ai_fit_score'));
});

test('signal-side and corpus-side predicates land on their own halves', () => {
  const p = feed.splitBoardFilters({ status: 'applied', remote: '1', min_pay: '150000' });
  assert.ok(p.scoredWhere.includes('s.status = ?'));
  assert.ok(p.corpWhere.includes('p.remote = ?') && p.corpWhere.includes('salary_max'));
  assert.ok(!p.scoredWhere.includes('p.remote'));
  assert.ok(!p.corpWhere.includes('s.status'));
});

test('the default feed hides dismissed jobs; the Dismissed tab still lists them', () => {
  // The rule that made dismissed cards un-clearable when it regressed (ac34b79).
  const dflt = feed.splitBoardFilters({});
  assert.ok(dflt.scoredWhere.includes("COALESCE(s.status,'') <> 'dismissed'"));
  assert.ok(dflt.tailWhere.includes("COALESCE(s.status,'') <> 'dismissed'"));
  const tab = feed.splitBoardFilters({ status: 'dismissed' });
  assert.ok(tab.scoredWhere.includes('s.status = ?'));
  assert.ok(!tab.scoredWhere.includes("<> 'dismissed'"));
});

test('the feed drives from user_signals, never from a full corpus join', () => {
  const db = recordingDb([page(150)]);
  feed.fetchBoardPage(db, { per: '150' });
  const q = poolSql(db);
  assert.ok(q, 'expected a candidate-pool statement');
  // The pool must be a bounded, ordered walk of the signal rows...
  assert.match(q, /FROM user_signals s/);
  assert.match(q, /ORDER BY s\.ai_fit_score DESC LIMIT \d+/);
  // ...and the corpus must be reached only through that pool.
  assert.match(q, /FROM cand s\s+JOIN corpus\.postings_corpus p/);
  // The old shape — corpus first, signals LEFT JOINed on — is the 50s query.
  assert.ok(!/FROM corpus\.postings_corpus p\s+JOIN corpus\.companies c\s+LEFT JOIN/.test(q));
});

test('a full page issues exactly one query — no escalation, no backfill', () => {
  const db = recordingDb([page(150)]);
  const r = feed.fetchBoardPage(db, { per: '150' });
  assert.equal(r.jobs.length, 150);
  assert.equal(db.sql.length, 1);
  assert.equal(r.exhausted, false);
});

test('unscored postings are opt-in — the default board never issues the tail scan', () => {
  const db = recordingDb([page(12)]);            // short page, pool not saturated
  const r = feed.fetchBoardPage(db, { per: '150' });
  assert.equal(r.jobs.length, 12);
  assert.equal(r.exhausted, true);
  assert.equal(r.scoredOnly, true);
  // The tail cannot early-terminate when few rows match: 8.0s (state=WY) / 21.6s
  // (min_score=90 + remote) on the live store. It must not run unless asked for.
  assert.equal(tailSql(db), undefined);
});

test('include_unscored=1 runs the backfill, and it is never sorted', () => {
  const db = recordingDb([page(12), [card(99)]]);
  const r = feed.fetchBoardPage(db, { per: '150', include_unscored: '1' });
  assert.equal(r.scoredOnly, false);
  const t = tailSql(db);
  assert.ok(t, 'expected the unscored backfill to run');
  // Sorting it re-creates the 157K-row materialise (216ms unordered vs 18,702ms ordered).
  assert.ok(!/ORDER BY/.test(t));
  assert.match(t, /LIMIT \? OFFSET \?/);
  assert.equal(r.jobs.length, 13);
});

test('a short page does not escalate when the pool was not saturated', () => {
  // Pool rung 1 returns 12 rows; the saturation probe reports 0 candidates, so widening the
  // pool would re-run the identical query for nothing.
  const db = recordingDb([page(12)]);
  feed.fetchBoardPage(db, { per: '150' });
  const pools = db.sql.filter((s) => s.includes('WITH cand AS'));
  assert.equal(pools.length, 1, 'expected no pointless escalation');
});

test('corpus-keyed sorts report that they ranked within a pool', () => {
  const salary = feed.fetchBoardPage(recordingDb([page(150)]), { per: '150', sort: 'salary' });
  assert.equal(salary.pooled, true);
  assert.ok(salary.poolSize > 0);
  // Fit-ranked sorts are an ordered prefix of the pool, so truncation cannot change them.
  const ai = feed.fetchBoardPage(recordingDb([page(150)]), { per: '150', sort: 'ai' });
  assert.equal(ai.pooled, false);
});

test('the board card never selects the 1.1GB description column', () => {
  const db = recordingDb([page(150)]);
  feed.fetchBoardPage(db, { per: '150' });
  const q = poolSql(db);
  assert.ok(!/SELECT[\s\S]*?p\.description[\s\S]*?FROM cand/.test(q));
  // The card fields the surface renders must still be there.
  for (const col of ['p.title', 'c.name AS company', 's.ai_fit_score', 'AS land_prob', 'AS high_win']) {
    assert.ok(q.includes(col), `missing board column: ${col}`);
  }
});

test('a search term still filters on description, only inside the pool', () => {
  const db = recordingDb([page(150)]);
  feed.fetchBoardPage(db, { per: '150', q: 'platform' });
  const q = poolSql(db);
  assert.ok(q.includes('(p.title LIKE ? OR p.description LIKE ?)'));
  // The LIKE is applied after the join to a bounded candidate set, not to 1.45M rows.
  assert.match(q, /FROM cand s/);
});

test('per and page stay clamped', () => {
  const r = feed.fetchBoardPage(recordingDb([[]]), { per: '9999', page: '-3' });
  assert.equal(r.per, 300);
  assert.equal(r.page, 1);
});
