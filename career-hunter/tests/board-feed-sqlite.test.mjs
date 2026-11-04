/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual ranked board SQL against engine schemas and guard bounded candidate-first corpus lookups.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify posted-date filters drive from the corpus date index.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include recently indexed undated postings in the seven-day board window.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Preserve privately scored explicit-title matches outside the shared technology classification.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Require both date range indexes and primary-key lookups when saved geography competes with the recent-window plan; preserve exact filters and pagination without duplicate dated rows.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Require matched title/description FTS lookups before original-owner score access and retain status, remote, rank and pagination constraints.
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
    (id, company_id, ats_job_id, title, active, target_role, remote, state, salary_max, salary_currency, salary_period, posted_date, first_seen_at)
    VALUES (?, 1, ?, 'Platform engineer', ?, ?, ?, ?, 150000, 'USD', 'year',
      CASE WHEN ? IN (4, 5) THEN date('now') ELSE NULL END,
      CASE WHEN ? = 6 THEN datetime('now') ELSE datetime('now', '-15 days') END)`);
  const signal = db.prepare(`INSERT INTO user_signals
    (posting_id, ai_fit_score, fit_score, status, application_source, application_task_id)
    VALUES (?, ?, 75, ?, 'worker-reported', ?)`);
  for (let id = 1; id <= 26001; id++) {
    posting.run(id, `job-${id}`, id === 1 ? 0 : 1, id === 2 ? 0 : 1,
      id % 2, id >= 26000 ? 'WY' : 'CA', id, id);
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

test('the matched board can include an owner-scored role outside the shared technology lane', () => {
  const generic = fetchBoardPage(db, { sort: 'ai', per: '10' });
  assert.ok(!generic.jobs.some(job => job.id === 2));
  const explicit = fetchBoardPage(db, { sort: 'ai', per: '10', lane: 'all' });
  assert.ok(explicit.jobs.some(job => job.id === 2));
  assert.ok(!explicit.jobs.some(job => job.id === 1), 'inactive jobs stay excluded');
});

/** Explain and execute the compiled feed's exact statements with their real parameters. */
function observedPage(query, scope) {
  const plans = [];
  const observed = {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all(...args) {
          plans.push({
            bounded: /ORDER BY s\.[\w]+ DESC[^)]* LIMIT \d+\)/.test(sql),
            detail: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row => row.detail),
          });
          return statement.all(...args);
        },
        get: (...args) => statement.get(...args),
      };
    },
  };
  return { page: fetchBoardPage(observed, query, scope), plans };
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
  assert.match(filtered.plans[0].detail.join('\n'),/postings_fts VIRTUAL TABLE INDEX/);
  assert.deepEqual(filtered.page.jobs.map(row => row.id), Array.from({ length: 150 }, (_, i) => (i + 1) * 10));
  const capped = fetchBoardPage(db, { sort: 'ai', per: '9999' });
  assert.equal(capped.per, 300);
  assert.equal(capped.jobs.length, 300);
});

test('matched keywords find description-only terms through FTS and retain exact private filters and pages', () => {
  db.exec('BEGIN');
  try {
    db.exec("UPDATE corpus.postings_corpus SET description='Teaching Python curriculum' WHERE id IN(4,5,26001)");
    const query={q:'curriculum',lane:'all',per:'1',sort:'ai'};
    const first=observedPage(query);
    assert.deepEqual(first.page.jobs.map(r=>r.id),[4]);
    assert.equal(first.page.pooled,false);
    const detail=first.plans[0].detail.join('\n');
    assert.match(detail,/postings_fts VIRTUAL TABLE INDEX/);
    assert.match(detail,/SEARCH s USING INTEGER PRIMARY KEY/);
    assert.doesNotMatch(detail,/SCAN s\b|SEARCH p USING INDEX idx_corpus/);
    assert.deepEqual(observedPage({...query,page:'2'}).page.jobs.map(r=>r.id),[5]);
    assert.deepEqual(observedPage({...query,page:'3'}).page.jobs,[],'unscored postings are excluded');
    assert.deepEqual(observedPage({...query,status:'applied'}).page.jobs.map(r=>r.id),[5]);
    assert.deepEqual(observedPage({...query,remote:'1'}).page.jobs.map(r=>r.id),[5]);
    assert.deepEqual(observedPage({...query,q:'platform curriculum'}).page.jobs.map(r=>r.id),[4]);
    assert.deepEqual(observedPage({...query,q:'no such keyword'}).page.jobs,[]);
  } finally { db.exec('ROLLBACK'); }
});

test('company-only keywords find private matches without scanning user signals', () => {
  const {page, plans} = observedPage({q:'Fixture company',lane:'all',per:'2',sort:'ai'});
  assert.deepEqual(page.jobs.map(r=>r.id),[2,4]);
  const detail=plans[0].detail.join('\n');
  assert.match(detail,/SEARCH s USING INTEGER PRIMARY KEY/);
  assert.doesNotMatch(detail,/SCAN s\b/);
});

test('seven-day windows include recent undated posts while using corpus date indexes', () => {
  const { page, plans } = observedPage({ sort: 'ai', per: '150', days: '7' });
  assert.equal(plans.length, 1);
  assert.match(plans[0].detail.join('\n'), /(?:idx_corpus_posted|idx_corpus_lane_seen)/);
  assert.deepEqual(page.jobs.map(row => row.id), [4, 5, 6]);
  assert.equal(page.exhausted, true);
  assert.equal(page.scoredOnly, true);

  const noRecentRows = observedPage({ sort: 'ai', per: '150', days: '7', state: 'FL' });
  assert.deepEqual(noRecentRows.page.jobs, []);
  assert.match(noRecentRows.plans[0].detail.join('\n'), /(?:idx_corpus_posted|idx_corpus_lane_seen)/);
});

test('saved geography cannot replace the recent date ranges with an active-corpus scan', () => {
  db.exec('BEGIN');
  try {
    const cols = new Set(db.prepare('PRAGMA corpus.table_info(postings_corpus)').all().map(r => r.name));
    for (const [name, type] of [['city','TEXT'],['lat','REAL'],['lon','REAL']]) {
      if (!cols.has(name)) db.exec(`ALTER TABLE corpus.postings_corpus ADD COLUMN ${name} ${type}`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS corpus.idx_corpus_geo ON postings_corpus(active,lat,lon,city);
      UPDATE corpus.postings_corpus SET city='destin',lat=30.4044,lon=-86.4714 WHERE id=4;
      UPDATE corpus.postings_corpus SET first_seen_at=datetime('now') WHERE id=5;`);
    const scope = {version:1,near:'Destin, FL',lat:30.4044,lon:-86.4714,radiusMiles:70,includeRemote:true};
    const query = {sort:'ai',days:'7',lane:'all',per:'1'};
    const first = observedPage(query, scope);
    const detail = first.plans[0].detail.join('\n');
    assert.match(detail, /idx_corpus_posted \(posted_date>\?\)/);
    assert.match(detail, /idx_corpus_seen \(first_seen_at>\?\)/);
    assert.match(detail, /SEARCH p USING INTEGER PRIMARY KEY/);
    assert.doesNotMatch(detail, /SEARCH p USING INDEX idx_corpus_geo/);
    assert.deepEqual(first.page.jobs.map(r=>r.id), [4]);
    assert.deepEqual(observedPage({...query,page:'2'},scope).page.jobs.map(r=>r.id), [5]);
    assert.deepEqual(observedPage({...query,page:'3'},scope).page.jobs, []);
    assert.deepEqual(observedPage({...query,status:'applied'},scope).page.jobs.map(r=>r.id), [5]);
  } finally { db.exec('ROLLBACK'); }
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

// Actual SQLite continuation, including score ties and the old pool boundary.
test('pages beyond 400 and 4000 are complete, stable and signal-driven, including exhaustion',()=>{
  const ids=[];for(let page=1;page<=10;page++)ids.push(...fetchBoardPage(db,{sort:'ai',per:'50',page:String(page)}).jobs.map(r=>r.id));
  assert.equal(ids.length,500);assert.equal(new Set(ids).size,500);assert.deepEqual(ids,Array.from({length:500},(_,i)=>i+4));
  const deep=observedPage({sort:'ai',per:'50',page:'81'});assert.equal(deep.page.jobs[0].id,4004);
  const empty=observedPage({sort:'ai',per:'50',page:'600'});assert.equal(empty.page.exhausted,true);
  empty.plans.forEach(assertCandidateLookups);
});
test('corpus sorts rank the full scored set rather than stopping at a top-score pool',()=>{
  db.exec('BEGIN');try{db.exec("UPDATE corpus.postings_corpus SET salary_max=9999999 WHERE id=26000");
    assert.equal(fetchBoardPage(db,{sort:'salary',per:'1'}).jobs[0].id,26000);
  }finally{db.exec('ROLLBACK');}
});

test('starred jobs precede all ranked pages, including unscored saves outside age and matching-area defaults',()=>{
 db.exec('BEGIN');try{
  db.exec("UPDATE user_signals SET status='new' WHERE posting_id=26000;INSERT INTO user_signals(posting_id,status)VALUES(26001,'new')");
  const query={sort:'ai',per:'2',days:'7',lane:'all'},favoriteIds=[26000,26001],first=fetchBoardPage(db,query,null,undefined,[],favoriteIds);
  assert.deepEqual(first.jobs.map(j=>j.id),[26000,26001]);assert.equal(first.starredCount,2);assert.equal(first.exhausted,false);
  const second=fetchBoardPage(db,{...query,page:'2'},null,undefined,[],favoriteIds);assert.deepEqual(second.jobs.map(j=>j.id),[4,5]);
  const third=fetchBoardPage(db,{...query,page:'3'},null,undefined,[],favoriteIds);assert.deepEqual(third.jobs.map(j=>j.id),[6]);assert.equal(third.exhausted,true);
  assert.deepEqual(fetchBoardPage(db,{...query,page:'4'},null,undefined,[],favoriteIds).jobs,[]);
  const hidden=[{kind:'company',value:'fixture company'}];assert.deepEqual(fetchBoardPage(db,query,null,undefined,hidden,favoriteIds).jobs,[]);
 }finally{db.exec('ROLLBACK');}
});
