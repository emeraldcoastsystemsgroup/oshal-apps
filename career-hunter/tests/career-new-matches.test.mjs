/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compare actionable personal match pages and counts over actual disposable SQLite, preserving saved jobs and application history separately.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const feed=require('../routes/career-board-feed.js');
const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8');
const scope={version:1,near:'Destin, FL',lat:30.4044,lon:-86.4714,radiusMiles:70,includeRemote:true};
const favorites=[1,2,3,4,5,6,7],exclusions=[{kind:'title',value:'excluded role'}];
let db;
function seed(){
  db.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Fixture employer')");
  const posting=db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,location,active,target_role,remote,city,lat,lon,posted_date,first_seen_at)
    VALUES(?,1,?,?,?, ?,?,?,?, ?,?, date('now'),datetime('now'))`);
  const signal=db.prepare('INSERT INTO user_signals(posting_id,ai_fit_score,status) VALUES(?,?,?)');
  for(let id=1;id<=19;id++){
    const far=[14,15].includes(id),remote=[9,15,19].includes(id),title=id===16?'Excluded role':'Fixture role '+id;
    posting.run(id,'fixture-'+id,title,id===15?'Hybrid - Los Angeles, CA':remote?'Fully remote':'Destin, FL',id===13?0:1,id===17?0:1,remote?1:0,far?'Los Angeles':'Destin',id===19?null:far?34.0522:30.4044,id===19?null:far?-118.2437:-86.4714);
    const score=id<=7?null:({8:87,9:0,18:88,19:86}[id]??90),status={10:'dismissed',11:'applied',12:'promoted',18:null}[id];
    signal.run(id,score,status===undefined?'new':status);
  }
}
before(()=>{
  const Adapter=process.env.CAREER_NATIVE_SQLITE_BRIDGE?require(process.env.CAREER_NATIVE_SQLITE_BRIDGE).BetterSqlite3:null;
  db=Adapter?new Adapter(':memory:'):new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  for(const name of ['CORPUS_SCHEMA','USER_SCHEMA'])db.exec(engine.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1]);
  seed();
});
after(()=>db?.close());
const page=(query={})=>feed.fetchBoardPage(db,{matches:'1',sort:'ai',per:'100',...query},scope,undefined,exclusions,favorites);
const ids=jobs=>jobs.map(job=>job.id);

test('New matches excludes seven saved unscored jobs and every worked, removed, inactive, out-of-area or excluded role',()=>{
  assert.deepEqual(ids(page().jobs),[18,8,19,9]);
  assert.equal(page().scoredOnly,true);
  assert.deepEqual(ids(page({include_unscored:'1'}).jobs),[18,8,19,9],'New matches never becomes the unscored corpus');
});

test('saved openings and application history remain available in their own pipeline views',()=>{
  const saved=feed.fetchBoardPage(db,{status:'saved',sort:'ai',per:'100'},scope,favorites,exclusions,favorites);
  assert.deepEqual(ids(saved.jobs).sort((a,b)=>a-b),favorites);
  const applied=feed.fetchBoardPage(db,{status:'tracked',sort:'ai',per:'100'},scope,undefined,exclusions,favorites);
  assert.deepEqual(ids(applied.jobs),[11]);
});

test('match count and pagination share exactly the same eligibility filters, including zero scores and remote preference',()=>{
  assert.equal(typeof feed.countNewMatches,'function');
  assert.equal(feed.countNewMatches(db,{},scope,favorites,exclusions),4);
  assert.deepEqual([...ids(page({per:'2',page:'1'}).jobs),...ids(page({per:'2',page:'2'}).jobs)],[18,8,19,9]);
  assert.deepEqual(ids(page({remote:'1'}).jobs),[19,9]);
  assert.equal(feed.countNewMatches(db,{remote:'1'},scope,favorites,exclusions),2);
  assert.deepEqual(ids(page({min_score:'80'}).jobs),[18,8,19]);
  assert.equal(feed.countNewMatches(db,{min_score:'80'},scope,favorites,exclusions),3);
});

test('the exact match count uses private scored signals and primary-key corpus lookups',()=>{
  assert.equal(typeof feed.countNewMatches,'function');let plan=[];
  const observed={prepare(sql){const statement=db.prepare(sql);return {all:(...args)=>statement.all(...args),get(...args){plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail);return statement.get(...args);}};}};
  assert.equal(feed.countNewMatches(observed,{},scope,favorites,exclusions),4);
  assert.ok(plan.some(line=>/^SEARCH p USING INTEGER PRIMARY KEY/.test(line)),plan.join('\n'));
  assert.ok(plan.every(line=>!/^SCAN p\b/.test(line)),plan.join('\n'));
});

test('full-text word searches keep the exact match count aligned with the page',()=>{
  db.exec("UPDATE corpus.postings_corpus SET title=CASE id WHEN 8 THEN 'Lead platform engineer' WHEN 18 THEN 'Engineer for platform services' WHEN 9 THEN 'Platform engineer' ELSE title END");
  assert.deepEqual(ids(page({q:'platform engineer'}).jobs),[18,8,9]);
  assert.equal(feed.countNewMatches(db,{q:'platform engineer'},scope,favorites,exclusions),3);
});
