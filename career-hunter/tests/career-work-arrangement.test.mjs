/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Execute actual board and public browse filters/projections over every legacy workplace fixture instead of trusting raw remote flags.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execute shared legacy workplace fixtures against native board SQL and real Python feed/scoring helpers without network or applicant data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { fullyRemoteSql, jobSearchScopeSql } = require('../routes/career-search-scope.js');
const { fetchBoardPage } = require('../routes/career-board-feed.js');
const { fetchBrowsePage } = require('../routes/career-browse-feed.js');
const fixtures = JSON.parse(readFileSync(new URL('./career-work-arrangement-fixtures.json', import.meta.url), 'utf8'));
const scope = { version:1, near:'Destin, FL', lat:30.4044, lon:-86.4714, radiusMiles:70, includeRemote:true };

test('board SQL blocks legacy contradictions and occupational flags without losing independent remote evidence', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE p(id INTEGER, title TEXT, location TEXT, remote INTEGER, city TEXT, lat REAL, lon REAL)');
    const insert = db.prepare('INSERT INTO p VALUES(?,?,?,?,?,?,?)');
    fixtures.forEach((value, id) => insert.run(id, value.title, value.location, value.remote, 'seattle',47.6062,-122.3321));
    const ids = sql => db.prepare(`SELECT id FROM p WHERE ${sql} ORDER BY id`).all().map(row => row.id);
    const expected = fixtures.flatMap((value, id) => value.expected ? [id] : []);
    assert.deepEqual(ids(fullyRemoteSql()), expected);
    assert.deepEqual(ids(jobSearchScopeSql(scope)), expected);
    assert.throws(() => fullyRemoteSql('p); DROP TABLE p;--'));
    const before = db.prepare('SELECT id,title,location,remote FROM p ORDER BY id').all();
    db.exec("UPDATE p SET city='destin',lat=30.4044,lon=-86.4714");
    assert.equal(ids(jobSearchScopeSql(scope)).length, fixtures.length, 'local hybrid and on-site work remains eligible');
    assert.deepEqual(ids(jobSearchScopeSql({...scope, includeRemote:false})), fixtures.flatMap((value,id)=>value.expected ? [] : [id]));
    assert.deepEqual(db.prepare('SELECT id,title,location,remote FROM p ORDER BY id').all(), before, 'retrieval must not rewrite evidence');
  } finally { db.close(); }
});

test('real source mappings and Python SQLite selection preserve evidence and exclude false positives', () => {
  const result = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-work-arrangement-contract.py', import.meta.url))],
    {encoding:'utf8', timeout:20000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stderr, /Ran 8 tests/);
});

test('actual matched and public pages filter and label legacy remote evidence consistently without rewriting it',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("ATTACH DATABASE ':memory:' AS corpus");
    const source=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8');
    for(const name of ['CORPUS_SCHEMA','USER_SCHEMA'])db.exec(source.match(new RegExp(name+'\\s*=\\s*"""([^]*?)"""'))[1]);
    db.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Fixture employer')");
    const posting=db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,location,remote,active,target_role,first_seen_at,city,lat,lon)
      VALUES(?,1,?,?,?,?,1,1,datetime('now'),'seattle',47.6062,-122.3321)`);
    const signal=db.prepare('INSERT INTO user_signals(posting_id,ai_fit_score) VALUES(?,80)');
    fixtures.forEach((row,index)=>{posting.run(index+1,'fixture-'+index,row.title,row.location,row.remote);signal.run(index+1);});
    const raw=db.prepare('SELECT remote FROM corpus.postings_corpus ORDER BY id').all();
    db.exec('PRAGMA query_only=ON');
    const sorted=rows=>rows.map(r=>r.id).sort((a,b)=>a-b);
    for(const fetch of [query=>fetchBoardPage(db,{sort:'ai',per:'200',lane:'all',...query}),query=>fetchBrowsePage(db,{sort:'recent',per:'200',...query})]){
      for(const remote of ['0','1']){
        const expected=fixtures.flatMap((r,i)=>r.expected===Number(remote)?[i+1]:[]);
        const jobs=fetch({remote}).jobs;assert.deepEqual(sorted(jobs),expected);
        assert.ok(jobs.every(r=>r.remote===Number(remote)));
      }
      const any=fetch({}).jobs;
      for(const job of any)assert.equal(job.remote,fixtures[job.id-1].expected);
      assert.deepEqual(sorted(fetch({remote:'1',q:'Developer'}).jobs),fixtures.flatMap((r,i)=>r.expected&&/developer/i.test(r.title)?[i+1]:[]));
    }
    assert.deepEqual(db.prepare('SELECT remote FROM corpus.postings_corpus ORDER BY id').all(),raw);
  }finally{db.close();}
});
