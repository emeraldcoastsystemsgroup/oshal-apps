/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the corpus-only browse feed against a real SQLite corpus built from the engine's own schema.
 */
/**
 * Regression guards for the pre-resume BROWSE feed.
 *
 * The defect this feed exists to fix is a DATABASE-shaped one: `/jobs` drives from `user_signals`,
 * an account with no indexed resume has no such table, and the board therefore rendered nothing.
 * A mock cannot close that — a double answers whatever it is told to. So these run against a REAL
 * SQLite corpus (`node:sqlite`, no package dependencies) created from the CORPUS_SCHEMA text read
 * out of `engine/jobhunter/db.py`, with **no user database and no `user_signals` table anywhere**.
 * That is the exact state a brand-new account is in.
 *
 * Two things are proven here that a shape assertion alone could not:
 *   1. the feed returns rows in that state at all;
 *   2. the keyword search plans as a COVERING INDEX scan over `idx_corpus_browse` — the difference
 *      between reading ~65MB of title keys and dragging the corpus's inline descriptions (~1.1GB
 *      on the live store) through the page cache. Deleting the index from db.py, or reintroducing
 *      a description match, turns that assertion red.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
// Against the COMPILED module — that is what the api loads.
const browse = require('../routes/career-browse-feed.js');

const here = dirname(fileURLToPath(import.meta.url));
const enginePy = readFileSync(join(here, '..', 'engine', 'jobhunter', 'db.py'), 'utf8');

/** The engine's own corpus DDL, so a schema or index change here cannot drift from the guard. */
function corpusSchema() {
  const match = enginePy.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/);
  assert.ok(match, 'CORPUS_SCHEMA not found in engine/jobhunter/db.py');
  return match[1];
}

let workDir;
let db;

/** Insert one posting plus its company, keyed so the fixture reads like the live corpus. */
function seed(rows) {
  const company = db.prepare(
    'INSERT OR IGNORE INTO corpus.companies (id,name,industry) VALUES (?,?,?)',
  );
  const posting = db.prepare(
    `INSERT INTO corpus.postings_corpus
       (id,company_id,ats_job_id,title,description,location,url,posted_date,first_seen_at,
        state,remote,job_type,target_role,salary_min,salary_max,active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const r of rows) {
    company.run(r.companyId, r.company, r.industry ?? 'Software');
    posting.run(
      r.id, r.companyId, `ats-${r.id}`, r.title, r.description ?? '', r.location ?? 'Remote',
      r.url ?? `https://example.test/${r.id}`, r.postedDate ?? '2026-08-01',
      r.firstSeen ?? '2026-08-01T00:00:00Z', r.state ?? 'FL', r.remote ?? 0,
      r.jobType ?? 'full-time', r.targetRole ?? 1, r.salaryMin ?? null, r.salaryMax ?? null,
      r.active ?? 1,
    );
  }
}

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'career-browse-'));
  const corpusFile = join(workDir, 'corpus.db').replace(/\\/g, '/');
  // Same handle shape the route builds: empty main, corpus ATTACHed under the `corpus.` prefix.
  db = new DatabaseSync(':memory:');
  db.exec(`ATTACH DATABASE '${corpusFile}' AS corpus`);
  db.exec(corpusSchema());
  seed([
    { id: 1, companyId: 10, company: 'Northwind', title: 'Staff Platform Engineer', firstSeen: '2026-08-10T00:00:00Z', salaryMin: 190000, salaryMax: 240000, remote: 1, postedDate: '2026-08-09' },
    { id: 2, companyId: 11, company: 'Acme Robotics', title: 'Senior SRE', firstSeen: '2026-08-09T00:00:00Z', salaryMax: 210000, state: 'CA', postedDate: '2026-08-08' },
    { id: 3, companyId: 10, company: 'Northwind', title: 'Data Analyst', firstSeen: '2026-08-08T00:00:00Z', salaryMax: 120000, postedDate: '2026-06-01' },
    // The trap: "platform" appears ONLY in the description. A title-only search must not match it.
    { id: 4, companyId: 12, company: 'Contoso', title: 'Office Manager', description: 'Support our platform engineering org.', firstSeen: '2026-08-07T00:00:00Z' },
    // Out of lane, and inactive — neither may appear in a default browse.
    { id: 5, companyId: 12, company: 'Contoso', title: 'Platform Intern', targetRole: 0, firstSeen: '2026-08-11T00:00:00Z' },
    { id: 6, companyId: 11, company: 'Acme Robotics', title: 'Platform Engineer (closed)', active: 0, firstSeen: '2026-08-12T00:00:00Z' },
  ]);
});

after(() => {
  try { db.close(); } catch { /* already closed */ }
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const titles = (page) => page.jobs.map((j) => j.title);

test('the corpus alone answers the board — there is no user_signals table to read', () => {
  const signals = db.prepare(
    "SELECT COUNT(*) AS n FROM corpus.sqlite_master WHERE name='user_signals'",
  ).get();
  assert.equal(signals.n, 0, 'fixture must model a brand-new account: no signals table at all');
  const page = browse.fetchBrowsePage(db, {});
  assert.ok(page.jobs.length > 0, 'a signed-in user with no resume must still see openings');
  assert.equal(page.browse, true);
});

test('the default lane hides inactive and non-target postings; lane=all shows the target lane opened up', () => {
  assert.deepEqual(titles(browse.fetchBrowsePage(db, {})).sort(), [
    'Data Analyst', 'Office Manager', 'Senior SRE', 'Staff Platform Engineer',
  ]);
  const all = titles(browse.fetchBrowsePage(db, { lane: 'all' }));
  assert.ok(all.includes('Platform Intern'), 'lane=all must reach outside the target lane');
  assert.ok(!all.includes('Platform Engineer (closed)'), 'inactive postings are never browsable');
});

test('the default order is newest first, off first_seen_at', () => {
  assert.deepEqual(titles(browse.fetchBrowsePage(db, {})), [
    'Staff Platform Engineer', 'Senior SRE', 'Data Analyst', 'Office Manager',
  ]);
});

test('the keyword search matches TITLES ONLY — a description hit is not a match', () => {
  const page = browse.fetchBrowsePage(db, { q: 'platform' });
  assert.deepEqual(titles(page), ['Staff Platform Engineer']);
  // Office Manager's description says "platform engineering". Matching it would mean the query
  // read p.description, which is the column that made the scored board take 50 seconds.
  assert.ok(!titles(page).includes('Office Manager'));
  assert.equal(page.pooled, true);
  assert.equal(page.poolSize, browse.BROWSE_POOL);
});

test('a browse with no search term reports that it ranked nothing within a pool', () => {
  const page = browse.fetchBrowsePage(db, {});
  assert.equal(page.pooled, false);
  assert.equal(page.poolSize, null);
});

test('corpus-side filters all reach the real query', () => {
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { remote: '1' })), ['Staff Platform Engineer']);
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { state: 'ca' })), ['Senior SRE']);
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { company: 'acme' })), ['Senior SRE']);
  assert.deepEqual(
    titles(browse.fetchBrowsePage(db, { min_pay: '200000' })).sort(),
    ['Senior SRE', 'Staff Platform Engineer'],
  );
  const fresh = titles(browse.fetchBrowsePage(db, { days: '3650' }));
  assert.ok(fresh.includes('Data Analyst'));
  assert.ok(!titles(browse.fetchBrowsePage(db, { days: '1' })).length);
});

test('every browse sort key is a corpus column that the real engine accepts', () => {
  for (const sort of Object.keys(browse.BROWSE_SORT_MAP)) {
    assert.doesNotThrow(
      () => browse.fetchBrowsePage(db, { sort }),
      `sort=${sort} did not execute against a real corpus`,
    );
  }
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { sort: 'salary' }))[0], 'Staff Platform Engineer');
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { sort: 'title' }))[0], 'Data Analyst');
});

test('an unknown sort falls back rather than interpolating into the statement', () => {
  const page = browse.fetchBrowsePage(db, { sort: 'ai_fit_score DESC; DROP TABLE companies' });
  assert.deepEqual(titles(page), titles(browse.fetchBrowsePage(db, { sort: 'recent' })));
});

test('no score column and no description ever reaches the payload', () => {
  const [row] = browse.fetchBrowsePage(db, {}).jobs;
  for (const leaked of ['ai_fit_score', 'fit_score', 'land_prob', 'high_win', 'status', 'description']) {
    assert.ok(!(leaked in row), `browse card must not carry ${leaked}`);
  }
  assert.ok(row.title && row.company && row.url, 'browse card still needs what it renders');
});

test('page geometry is clamped, and a deep page is refused rather than scanned', () => {
  const big = browse.fetchBrowsePage(db, { per: '5000' });
  assert.equal(big.per, browse.MAX_PER);
  const deep = browse.fetchBrowsePage(db, { per: '100', page: '999' });
  assert.equal(deep.capped, true);
  assert.equal(deep.jobs.length, 0);
  assert.equal(browse.browsePageGeometry({ per: '0' }).per, 60, 'a meaningless size falls back');
  assert.equal(browse.browsePageGeometry({ per: '-5' }).per, 1, 'a negative size can never reach LIMIT');
});

// ── The plan, not just the answer ────────────────────────────────────────────
/** Capture the exact statement the planner issues, then explain it on the real corpus. */
function capturedSql(query) {
  const seen = [];
  const recorder = {
    prepare(text) { seen.push(text); return { all: () => [], get: () => ({ n: 0 }) }; },
  };
  browse.fetchBrowsePage(recorder, query);
  assert.equal(seen.length, 1, 'a browse page must be one statement');
  return seen[0];
}

test('the keyword search plans as a COVERING INDEX scan over idx_corpus_browse', () => {
  const sql = capturedSql({ q: 'platform' });
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('%platform%', 100, 0)
    .map((r) => r.detail).join('\n');
  assert.match(plan, /COVERING INDEX idx_corpus_browse/,
    `the title search stopped being covered — it now reads posting rows:\n${plan}`);
});

test('the browse statement never names description or user_signals', () => {
  for (const query of [{}, { q: 'engineer' }, { sort: 'salary', remote: '1' }]) {
    const sql = capturedSql(query);
    assert.ok(!/description/i.test(sql), `browse statement selected description: ${sql}`);
    assert.ok(!/user_signals/i.test(sql), `browse statement joined signals: ${sql}`);
  }
});

test('the lane predicate stays sargable so idx_corpus_lane can serve it', () => {
  const { where } = browse.browseFilters({});
  assert.ok(where.includes('p.target_role = 1'));
  assert.ok(!where.includes('COALESCE(p.target_role'));
});
