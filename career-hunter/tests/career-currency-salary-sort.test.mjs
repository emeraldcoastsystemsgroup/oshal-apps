/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard USD-equivalent currency-aware salary sorting across open search, keyword search, legacy fallback and My jobs board while preserving verbatim pay fields and index-only walks.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pay = require('../lib/career-pay.js');
const browse = require('../routes/career-browse-feed.js');
const board = require('../routes/career-board-feed.js');
const enginePy = readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');

function schema(name) {
  const match = enginePy.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`));
  assert.ok(match, `${name} not found in engine/jobhunter/db.py`);
  return match[1];
}

function payUsdIndexSql() {
  const block = enginePy.match(/PAY_USD_INDEX_SQL\s*=\s*\(([\s\S]*?)\n\)/);
  assert.ok(block, 'PAY_USD_INDEX_SQL not found in engine/jobhunter/db.py');
  return [...block[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
}

let db;

const FIXTURE = [
  { id: 1, title: 'Principal Systems Architect', min: 190000, max: 220000, currency: 'USD', period: 'year' },
  { id: 2, title: 'Distinguished Engineer London', min: 130000, max: 150000, currency: 'GBP', period: 'year' },
  { id: 3, title: 'Senior Platform Engineer Toronto', min: 130000, max: 150000, currency: 'CAD', period: 'year' },
  { id: 4, title: 'Staff Engineer Bengaluru', min: 2000000, max: 2500000, currency: 'INR', period: 'year' },
  { id: 5, title: 'Operations Lead Unlisted Pay', min: null, max: null, currency: null, period: null },
];

const EXPECTED_ORDER = [
  'Principal Systems Architect',
  'Distinguished Engineer London',
  'Senior Platform Engineer Toronto',
  'Staff Engineer Bengaluru',
  'Operations Lead Unlisted Pay',
];

before(() => {
  db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(schema('CORPUS_SCHEMA'));
  db.exec(payUsdIndexSql());
  db.exec(schema('USER_SCHEMA'));
  db.exec("INSERT INTO corpus.companies (id, name, industry) VALUES (1, 'Global Tech', 'Software')");
  const post = db.prepare(`INSERT INTO corpus.postings_corpus
    (id, company_id, ats_job_id, title, description, location, url, posted_date, first_seen_at,
     state, remote, job_type, target_role, salary_min, salary_max, salary_currency, salary_period, active)
    VALUES (?, 1, ?, ?, 'Global engineering role', 'Remote', ?, '2026-08-10', '2026-08-10T00:00:00Z',
            'FL', 1, 'fte', 1, ?, ?, ?, ?, 1)`);
  const sig = db.prepare("INSERT INTO user_signals (posting_id, fit_score, ai_fit_score, status) VALUES (?, 80, 80, 'new')");
  for (const row of FIXTURE) {
    post.run(row.id, `fx-${row.id}`, row.title, `https://example.test/${row.id}`, row.min, row.max, row.currency, row.period);
    sig.run(row.id);
  }
});

after(() => db?.close());

function assertVerbatimCurrency(jobs) {
  const byTitle = new Map(jobs.map((job) => [job.title, job]));
  assert.equal(byTitle.get('Principal Systems Architect').salary_max, 220000);
  assert.equal(byTitle.get('Principal Systems Architect').salary_currency, 'USD');
  assert.equal(byTitle.get('Distinguished Engineer London').salary_max, 150000);
  assert.equal(byTitle.get('Distinguished Engineer London').salary_currency, 'GBP');
  assert.equal(byTitle.get('Senior Platform Engineer Toronto').salary_max, 150000);
  assert.equal(byTitle.get('Senior Platform Engineer Toronto').salary_currency, 'CAD');
  assert.equal(byTitle.get('Staff Engineer Bengaluru').salary_max, 2500000);
  assert.equal(byTitle.get('Staff Engineer Bengaluru').salary_currency, 'INR');
}

test('open browse feed sort=salary normalizes currencies to USD-equivalent and keeps unlisted pay last', () => {
  const page = browse.fetchBrowsePage(db, { sort: 'salary' });
  assert.deepEqual(page.jobs.map((j) => j.title), EXPECTED_ORDER);
  assertVerbatimCurrency(page.jobs);
});

test('browse FTS keyword search and legacy fallback sort=salary rank USD > GBP > CAD > INR > unlisted', () => {
  const fts = browse.fetchBrowsePage(db, { q: 'engineering', sort: 'salary' });
  assert.deepEqual(fts.jobs.map((j) => j.title), EXPECTED_ORDER);
  assertVerbatimCurrency(fts.jobs);

  const legacy = {
    prepare(sql) {
      if (sql.includes("type='table'") && sql.includes('sqlite_master')) return { get: () => undefined };
      return db.prepare(sql);
    },
  };
  const fallback = browse.fetchBrowsePage(legacy, { q: 'engineering', sort: 'salary' });
  assert.deepEqual(fallback.jobs.map((j) => j.title), EXPECTED_ORDER);
});

test('My jobs board sort=salary ranks USD > GBP > CAD > INR > unlisted and preserves raw currency', () => {
  const page = board.fetchBoardPage(db, { sort: 'salary', per: '50' });
  assert.deepEqual(page.jobs.map((j) => j.title), EXPECTED_ORDER);
  assertVerbatimCurrency(page.jobs);

  const kw = board.fetchBoardPage(db, { q: 'engineering', sort: 'salary', per: '50' });
  assert.deepEqual(kw.jobs.map((j) => j.title), EXPECTED_ORDER);
});

test('open browse sort=salary walks idx_corpus_pay_usd with zero temp B-tree sort', () => {
  const expectedSql = `CREATE INDEX IF NOT EXISTS corpus.${pay.SALARY_USD_INDEX} ON postings_corpus(active, ${pay.annualUsdPayExpr('')} DESC, id DESC)`;
  assert.equal(payUsdIndexSql(), expectedSql, 'db.py PAY_USD_INDEX_SQL must match lib/career-pay.js annualUsdPayExpr()');
  const seen = [];
  const spy = {
    prepare(sql) {
      seen.push(sql);
      return db.prepare(sql);
    },
  };
  browse.fetchBrowsePage(spy, { sort: 'salary' });
  const pageSql = seen.find((sql) => !/sqlite_master/.test(sql));
  assert.ok(pageSql, 'expected one page statement');
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${pageSql}`).all(60, 0).map((r) => r.detail);
  assert.ok(plan.some((line) => /idx_corpus_pay_usd/.test(line)), `expected idx_corpus_pay_usd:\n${plan.join('\n')}`);
  assert.ok(!plan.some((line) => /TEMP B-TREE FOR ORDER BY/.test(line)), `unexpected temp B-tree sort:\n${plan.join('\n')}`);
});

test('pre-index read-only corpus still walks idx_corpus_pay and ranks USD ahead of INR', () => {
  db.exec('DROP INDEX corpus.idx_corpus_pay_usd');
  try {
    const page = browse.fetchBrowsePage(db, { sort: 'salary' });
    const titles = page.jobs.map((j) => j.title);
    assert.equal(titles[0], 'Principal Systems Architect');
    assert.ok(titles.indexOf('Staff Engineer Bengaluru') > titles.indexOf('Principal Systems Architect'));
  } finally {
    db.exec(payUsdIndexSql());
  }
});
