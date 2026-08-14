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

test('the default is the WHOLE corpus, because a job search is a search of the database', () => {
  // The regression this pins: defaulting to `target_role = 1` filtered a general search
  // down to the roles this deployment tracks for resume matching. Searching "nurse"
  // against 1.6M postings returned ONE row, which reads as a broken search.
  const all = titles(browse.fetchBrowsePage(db, {}));
  assert.ok(all.includes('Platform Intern'),
    `the default view hid an out-of-lane posting: ${all.join(', ')}`);
  assert.ok(!all.includes('Platform Engineer (closed)'), 'inactive postings are never browsable');
  // ...and the tracked lane is still reachable for callers that want it.
  const lane = titles(browse.fetchBrowsePage(db, { lane: 'target' }));
  assert.ok(!lane.includes('Platform Intern'), 'lane=target must still narrow to the tracked lane');
  assert.ok(lane.includes('Staff Platform Engineer'));
});

test('the default order is newest first, off first_seen_at', () => {
  assert.deepEqual(titles(browse.fetchBrowsePage(db, {})), [
    'Platform Intern', 'Staff Platform Engineer', 'Senior SRE', 'Data Analyst', 'Office Manager',
  ]);
});

test('the simple search box matches TITLES, not description text', () => {
  const page = browse.fetchBrowsePage(db, { q: 'platform' });
  assert.deepEqual(titles(page).sort(), ['Platform Intern', 'Staff Platform Engineer']);
  // Office Manager's DESCRIPTION says "platform engineering". The simple box must not
  // reach it -- that is what the advanced description field is for, below.
  assert.ok(!titles(page).includes('Office Manager'));
  assert.equal(page.fullText, true, 'the fixture corpus carries FTS, so it should be used');
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
  // The feed probes sqlite_master to decide whether this corpus carries the full-text
  // index; that probe is not the page. Everything else must still be ONE statement.
  const pages = seen.filter((text) => !/sqlite_master/.test(text));
  assert.equal(pages.length, 1, `a browse page must be one statement, got: ${seen.join(String.fromCharCode(10))}`);
  return pages[0];
}

/** The single page statement a FULL-TEXT search issues, captured off the real db. */
function capturedFullTextSql(query) {
  const seen = [];
  const spy = {
    prepare(text) {
      seen.push(text);
      return db.prepare(text);
    },
  };
  browse.fetchBrowsePage(spy, query);
  const pages = seen.filter((text) => !/sqlite_master/.test(text));
  assert.equal(pages.length, 1, 'a full-text page must be one statement');
  return pages[0];
}

/** Every EXPLAIN QUERY PLAN line for a statement, as an array. */
function planOf(sql, args) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail);
}

test('the TITLE arm is covered, and never falls onto a row-reading index', () => {
  const [titleArm] = browse.searchCandidateSql(false).parts;
  const plan = planOf(titleArm, ['%platform%']);
  assert.ok(plan.some((line) => line.includes('COVERING INDEX idx_corpus_browse')),
    `the title search stopped being covered — it now reads posting rows:
${plan.join(String.fromCharCode(10))}`);
  // The subtle regression, and the reason `ORDER BY cid + 0` exists: a bare ORDER BY on
  // the rowid lets SQLite satisfy the ordering by walking idx_corpus_active, which does
  // NOT carry the title, so every entry costs a row read to test the LIKE. It looks
  // indexed in the plan and reads the entire table.
  assert.ok(!plan.some((line) => /USING INDEX idx_corpus_active\b/.test(line)),
    `the title arm fell onto a non-covering index — every entry now costs a row read:
${plan.join(String.fromCharCode(10))}`);
});

test('the EMPLOYER arm drives from companies, not from every active posting', () => {
  const employerArm = browse.searchCandidateSql(false).parts[1];
  const plan = planOf(employerArm, ['%northwind%']);
  const drivesCompanies = plan.findIndex((line) => /SCAN c\b/.test(line));
  const postingsByCompany = plan.findIndex(
    (line) => /SEARCH p USING (COVERING )?INDEX idx_corpus_company/.test(line));
  assert.ok(drivesCompanies >= 0 && postingsByCompany > drivesCompanies,
    `the employer search no longer drives from the small table — CROSS JOIN lost?
${plan.join(String.fromCharCode(10))}`);
});

test('the default view is served BY an index, never sorted after the fact', () => {
  const plan = planOf(capturedSql({}), [100, 0]);
  assert.ok(plan.some((line) => /idx_corpus_active_seen|idx_corpus_seen/.test(line)),
    `the newest-first view lost its ordering index:
${plan.join(String.fromCharCode(10))}`);
  // The 26s shape: filter on an index, then materialise the whole active set and sort it
  // to return one page. The point of idx_corpus_active_seen is that the walk IS the order.
  assert.ok(!plan.some((line) => /TEMP B-TREE FOR ORDER BY/.test(line)),
    `the default view sorts rows again instead of walking them in order:
${plan.join(String.fromCharCode(10))}`);
});

test('the browse statement never names user_signals, and never description by default', () => {
  for (const query of [{}, { q: 'engineer' }, { sort: 'salary', remote: '1' }]) {
    const sql = capturedSql(query);
    assert.ok(!/description/i.test(sql), `browse statement selected description: ${sql}`);
    assert.ok(!/user_signals/i.test(sql), `browse statement joined signals: ${sql}`);
  }
  // The full-text arm is opt-in and only appears when the caller asked for it. It is the
  // one unindexed scan in this module, so it must never arrive by accident.
  // The LIKE fallback's description arm appears only when a description was asked for.
  const deep = capturedSql({ q: 'engineer', description: 'clearance' });
  assert.match(deep, /description LIKE/);
  assert.ok(!/user_signals/i.test(deep));
});

// ── Search by employer, which is half of what "search jobs" means ────────────

test('a free-text search matches EMPLOYER names, not only job titles', () => {
  // "Acme" appears in no job title in the fixture — only as a company name. A search
  // that cannot find it is a search a user would call broken.
  const page = browse.fetchBrowsePage(db, { q: 'Acme' });
  assert.deepEqual(titles(page).sort(), ['Senior SRE']);
});

test('a title search and an employer search both still work from the one box', () => {
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { q: 'analyst' })), ['Data Analyst']);
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { q: 'northwind' })).sort(),
    ['Data Analyst', 'Staff Platform Engineer']);
});

test('the full-text index FOLLOWS the corpus — a new posting is searchable at once', () => {
  // An external-content FTS5 table does not track its content table by itself. Without
  // the sync triggers, everything ingested after the index was built is invisible to
  // search -- silently, while the index keeps answering about yesterday. The nightly
  // pull adds 10-18k postings, so the decay is immediate and permanent.
  db.prepare(
    `INSERT INTO corpus.postings_corpus
       (id, company_id, ats_job_id, title, description, first_seen_at, active, target_role)
     VALUES (900, 10, 'ats-900', 'Hydrographic Surveyor', 'Operates multibeam sonar.',
             '2026-08-12T00:00:00Z', 1, 0)`,
  ).run();
  try {
    assert.deepEqual(titles(browse.fetchBrowsePage(db, { q: 'hydrographic' })),
      ['Hydrographic Surveyor'], 'a newly ingested posting is not in the full-text index');
    assert.deepEqual(titles(browse.fetchBrowsePage(db, { description: 'multibeam' })),
      ['Hydrographic Surveyor'], 'its description is not in the full-text index');
    // ...and an edit follows too, rather than leaving the old words matchable.
    db.prepare("UPDATE corpus.postings_corpus SET title='Bathymetric Surveyor' WHERE id=900").run();
    assert.deepEqual(titles(browse.fetchBrowsePage(db, { q: 'bathymetric' })),
      ['Bathymetric Surveyor'], 'an edited title is not reindexed');
    assert.deepEqual(titles(browse.fetchBrowsePage(db, { q: 'hydrographic' })), [],
      'the old title still matches — the delete half of the update trigger is missing');
  } finally {
    db.prepare('DELETE FROM corpus.postings_corpus WHERE id=900').run();
  }
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { q: 'bathymetric' })), [],
    'a deleted posting is still searchable');
});

test('the advanced fields search title and description independently', () => {
  // Office Manager's description says "platform engineering"; its title does not.
  const byDescription = titles(browse.fetchBrowsePage(db, { description: 'platform' }));
  assert.ok(byDescription.includes('Office Manager'),
    `description search did not reach the posting text: ${byDescription.join(', ')}`);
  const byTitle = titles(browse.fetchBrowsePage(db, { title: 'platform' }));
  assert.ok(!byTitle.includes('Office Manager'), 'a title search reached the description');
  assert.ok(byTitle.includes('Staff Platform Engineer'));
  // Both at once is an AND, which is what "contains ... and contains ..." means.
  assert.deepEqual(
    titles(browse.fetchBrowsePage(db, { title: 'office', description: 'platform' })),
    ['Office Manager']);
  assert.deepEqual(
    titles(browse.fetchBrowsePage(db, { title: 'office', description: 'nonexistent' })), []);
  assert.equal(browse.fetchBrowsePage(db, { description: 'platform' }).deep, true);
  assert.equal(browse.fetchBrowsePage(db, { q: 'platform' }).deep, false);
});

test('every search arm is bound to the same term, so no arm can be fed the wrong value', () => {
  // Three arms, three placeholders: a mismatch between the arm count and the bound
  // arguments is the bug that silently searches titles for a company name.
  const shallow = browse.searchCandidateSql(false);
  const deep = browse.searchCandidateSql(true);
  assert.equal(shallow.arms, 2);
  assert.equal(deep.arms, 3);
  assert.equal((shallow.sql.match(/\?/g) || []).length, shallow.arms);
  assert.equal((deep.sql.match(/\?/g) || []).length, deep.arms);
});

test('filters still narrow a search, rather than the search replacing them', () => {
  const page = browse.fetchBrowsePage(db, { q: 'northwind', min_pay: '200000' });
  assert.deepEqual(titles(page), ['Staff Platform Engineer']);
});

test('the tracked lane, when asked for, stays sargable so an index can serve it', () => {
  assert.ok(!browse.browseFilters({}).where.includes('target_role'),
    'a general search must not filter to the tracked lane');
  const { where } = browse.browseFilters({ lane: 'target' });
  assert.ok(where.includes('p.target_role = 1'));
  // COALESCE(p.target_role,0) = 1 is equivalent but unindexable — it is what made the
  // scored board fall back to a 157K-row scan. It must never come back.
  assert.ok(!where.includes('COALESCE(p.target_role'));
});

test('every sort the screen offers is served by an index, not by sorting the corpus', () => {
  // Each of these was measured on the live 1.6M-posting corpus; the ones without an
  // index behind them took seconds to return twenty rows. The guard is the PLAN, because
  // on a six-row fixture every one of them is instant either way.
  const indexed = { recent: /idx_corpus_active_seen|idx_corpus_seen/, salary: /idx_corpus_pay/ };
  for (const [sort, wanted] of Object.entries(indexed)) {
    const plan = planOf(capturedSql({ sort }), [100, 0]);
    assert.ok(plan.some((line) => wanted.test(line)),
      `sort=${sort} lost its index:\n${plan.join(String.fromCharCode(10))}`);
    assert.ok(!plan.some((line) => /TEMP B-TREE FOR ORDER BY/.test(line)),
      `sort=${sort} sorts the corpus instead of walking an index:\n${plan.join(String.fromCharCode(10))}`);
  }
});

test('the engine schema ships every index the feed plans against', () => {
  // The runtime ensure in career-browse-routes exists for corpora that predate an index.
  // A NEW corpus must get them from the engine's own schema, or every fresh install is
  // slow until someone happens to hit the browse route.
  for (const name of ['idx_corpus_browse', 'idx_corpus_active_seen', 'idx_corpus_pay']) {
    assert.match(enginePy, new RegExp(name), `CORPUS_SCHEMA does not create ${name}`);
    const found = db.prepare(
      "SELECT 1 AS ok FROM corpus.sqlite_master WHERE type='index' AND name=?",
    ).get(name);
    assert.ok(found?.ok, `${name} was not created by the schema this fixture ran`);
  }
});

// ── Filters must reach the candidate pool, not just the page ────────────────

test('a narrow filter reaches INTO the search arms, not just the page after them', () => {
  // The bug: filters applied after a bounded pool search only the pool, so a term with
  // many matches plus a narrow filter returns nothing. Measured on the live corpus:
  // "nurse" + state=FL returned ZERO against a database holding plenty of both.
  const { postingWhere, postingArgs } = browse.browseFilters({ state: 'CA' });
  assert.match(postingWhere, /p\.state = \?/);
  assert.deepEqual(postingArgs, ['CA']);
  const arms = browse.searchCandidateSql(false, postingWhere).parts;
  for (const [index, sql] of arms.entries()) {
    assert.match(sql, /p\.state = \?/, `arm ${index} does not carry the filter into its pool`);
  }
});

test('the pushed-down filter and the term are bound in each arm\u2019s own order', () => {
  // The employer arm reads its term FIRST; the others read the filter first. Getting this
  // wrong does not error, it silently searches the wrong column for the wrong value.
  const page = browse.fetchBrowsePage(db, { q: 'engineer', state: 'CA' });
  assert.deepEqual(titles(page), [], 'CA has no engineer titles in the fixture');
  const sre = browse.fetchBrowsePage(db, { q: 'SRE', state: 'CA' });
  assert.deepEqual(titles(sre), ['Senior SRE'], 'the term and the filter got crossed');
  const acme = browse.fetchBrowsePage(db, { q: 'Acme', state: 'CA' });
  assert.deepEqual(titles(acme), ['Senior SRE'], 'the employer arm bound its args out of order');
  assert.deepEqual(titles(browse.fetchBrowsePage(db, { q: 'Acme', state: 'FL' })), [],
    'the employer arm ignored the pushed-down filter');
});

test('no sort is offered that no index can serve', () => {
  // Company A-Z ordered 1.6M postings by a column on the JOINED table: 29.9s for twenty
  // rows nobody wanted. Filtering by company is indexed and instant; sorting by it is not.
  assert.ok(!('company' in browse.BROWSE_SORT_MAP),
    'a company sort is back — it cannot be indexed and measured 29.9s on the live corpus');
  const screen = readFileSync(join(here, '..', 'tools', 'career-search.html'), 'utf8');
  assert.ok(!/<option value="company"/.test(screen),
    'the screen still offers a sort the feed does not implement');
});

test('the job-type menu speaks the ENGINE\u2019s vocabulary, not friendly guesses', () => {
  // The dead-filter bug: the screen offered "full-time"/"part-time"/"internship" while
  // jobtype.classify() writes "fte"/"parttime"/"intern"/"contract". Every one of the
  // 583,000 full-time postings was unreachable through a control that looked fine.
  const jobtype = readFileSync(join(here, '..', 'engine', 'jobhunter', 'jobtype.py'), 'utf8');
  const engineValues = new Set(
    [...jobtype.matchAll(/return "([a-z]+)"/g)].map((m) => m[1]),
  );
  assert.ok(engineValues.size >= 4, `could not read the engine vocabulary: ${[...engineValues]}`);

  const screen = readFileSync(join(here, '..', 'tools', 'career-search.html'), 'utf8');
  const menu = screen.match(/<select id="type"[\s\S]*?<\/select>/);
  assert.ok(menu, 'the job-type control is gone');
  const offered = [...menu[0].matchAll(/<option value="([^"]*)"/g)]
    .map((m) => m[1]).filter(Boolean);
  assert.ok(offered.length, 'the job-type menu offers no values at all');
  for (const value of offered) {
    assert.ok(engineValues.has(value),
      `the menu offers job_type="${value}", which the engine never writes `
      + `(it writes: ${[...engineValues].sort().join(', ')}) — a dead filter`);
  }
});

test('the employer half of the simple box is a UNION, never an OR beside the match', () => {
  // `OR c.name LIKE ?` next to the FTS match makes SQLite abandon the match as a driver
  // and evaluate both halves per row — measured 22.7s for "engineer" + remote against
  // 42ms for the union. The shape is the guard, because on a fixture both are instant.
  const sql = capturedFullTextSql({ q: 'engineer' });
  assert.match(sql, /p\.id IN \(/, 'the match is no longer an id-set driver');
  assert.match(sql, /UNION/, 'the employer arm stopped being a union');
  assert.ok(!/OR c\.name LIKE/.test(sql),
    `the employer arm is OR-ed beside the match again:\n${sql}`);
  // A search with no employer half must not carry the union at all.
  assert.ok(!/UNION/.test(capturedFullTextSql({ title: 'engineer' })),
    'an advanced title search still pays for the employer arm');
});
