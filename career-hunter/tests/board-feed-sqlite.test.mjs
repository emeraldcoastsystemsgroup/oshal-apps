/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual ranked board SQL against engine schemas and guard bounded candidate-first corpus lookups.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { fetchBoardPage } = require('../routes/career-board-feed.js');
const engine = readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
let db;

/** Use the engine's actual user/corpus columns and indexes, without a deployment database. */
function schema(name) {
  const match = engine.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`));
  assert.ok(match, `engine schema ${name} must exist`);
  return match[1];
}

/** Distinct scores make ranking/pagination assertions independent of equal-score tie order. */
function seed() {
  db.exec('BEGIN');
  db.exec("INSERT INTO corpus.companies(id, name) VALUES (1, 'Fixture company')");
  const posting = db.prepare(`INSERT INTO corpus.postings_corpus
    (id, company_id, ats_job_id, title, active, target_role, remote, state, salary_max)
    VALUES (?, 1, ?, 'Platform engineer', ?, ?, ?, ?, 150000)`);
  const signal = db.prepare(`INSERT INTO user_signals
    (posting_id, ai_fit_score, fit_score, status, application_source, application_task_id)
    VALUES (?, ?, 75, ?, 'worker-reported', ?)`);
  for (let id = 1; id <= 26001; id++) {
    posting.run(id, `job-${id}`, id === 1 ? 0 : 1, id === 2 ? 0 : 1,
      id % 2, id >= 26000 ? 'WY' : 'CA');
    if (id <= 26000) signal.run(id, 100 - id / 1000,
      id === 3 ? 'dismissed' : id % 5 === 0 ? 'applied' : 'new', `task-${id}`);
  }
  db.exec('COMMIT');
}

before(() => {
  db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(schema('CORPUS_SCHEMA'));
  db.exec(schema('USER_SCHEMA'));
  seed();
});
after(() => db?.close());

/** Explain and execute the compiled feed's exact statements with their real parameters. */
function observedPage(query) {
  const plans = [];
  const observed = {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all(...args) {
          plans.push({
            bounded: /ORDER BY s\.[\w]+ DESC LIMIT \d+\)/.test(sql),
            detail: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row => row.detail),
          });
          return statement.all(...args);
        },
        get: (...args) => statement.get(...args),
      };
    },
  };
  return { page: fetchBoardPage(observed, query), plans };
}

/** A bounded pool must fetch corpus/company rows by identity, never drive from corpus lanes. */
function assertCandidateLookups(plan) {
  const details = plan.detail.join('\n');
  const candidate = plan.detail.findIndex(line => /^SCAN s\b/.test(line));
  const posting = plan.detail.findIndex(line => /^SEARCH p USING INTEGER PRIMARY KEY/.test(line));
  const company = plan.detail.findIndex(line => /^SEARCH c USING INTEGER PRIMARY KEY/.test(line));
  assert.ok(candidate >= 0 && posting > candidate && company > posting,
    `bounded board plan must drive from candidates into primary-key lookups:\n${details}`);
  assert.doesNotMatch(details, /(?:SCAN p\b|SEARCH p USING INDEX|AUTOMATIC.*INDEX)/);
}

test('the exact foreground sort=ai&per=150 uses bounded primary-key corpus lookups', () => {
  const { page, plans } = observedPage({ sort: 'ai', per: '150' });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].bounded, true);
  assertCandidateLookups(plans[0]);
  assert.equal(page.poolSize, 4000);
  assert.equal(page.per, 150);
  assert.equal(page.scoredOnly, true);
  assert.equal(page.exhausted, false);
  assert.deepEqual(page.jobs.map(row => row.id), Array.from({ length: 150 }, (_, i) => i + 4));
  assert.equal(page.jobs[0].application_source, 'worker-reported');
  assert.equal(page.jobs[0].application_task_id, 'task-4');
});

test('candidate-driven lookups retain filters, ranking, page offsets and return caps', () => {
  const { page, plans } = observedPage({ sort: 'ai', per: '150', page: '2' });
  assertCandidateLookups(plans[0]);
  assert.deepEqual(page.jobs.map(row => row.id), Array.from({ length: 150 }, (_, i) => i + 154));
  const filtered = observedPage({ sort: 'ai', per: '150', remote: '0', status: 'applied',
    min_score: '70', min_pay: '80000', state: 'ca', q: 'platform' });
  assertCandidateLookups(filtered.plans[0]);
  assert.deepEqual(filtered.page.jobs.map(row => row.id), Array.from({ length: 150 }, (_, i) => (i + 1) * 10));
  const capped = fetchBoardPage(db, { sort: 'ai', per: '9999' });
  assert.equal(capped.per, 300);
  assert.equal(capped.jobs.length, 300);
});

test('narrow filters still escalate through both pools to exhaustive and optional unscored rows', () => {
  const { page, plans } = observedPage({ sort: 'ai', per: '150', state: 'wy' });
  assert.deepEqual(plans.map(plan => plan.bounded), [true, true, false]);
  plans.filter(plan => plan.bounded).forEach(assertCandidateLookups);
  assert.equal(page.poolSize, null);
  assert.equal(page.exhausted, true);
  assert.deepEqual(page.jobs.map(row => row.id), [26000]);
  const withUnscored = fetchBoardPage(db, { sort: 'ai', per: '150', state: 'wy', include_unscored: '1' });
  assert.equal(withUnscored.scoredOnly, false);
  assert.deepEqual(withUnscored.jobs.map(row => row.id), [26000, 26001]);
});
