/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise title-first keyword order, stable page boundaries, eligibility and bounded fallback description reads in real synthetic SQLite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const browse=require('../routes/career-browse-feed.js');
const schema=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8').match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1];
const BASE=[
  {id:101,title:'Director Operations',at:'2026-01-01'},
  {id:102,title:'Director Strategy',at:'2026-01-02'},
  {id:103,title:'OPERATIONS DIRECTOR',at:'2026-01-02'},
  {id:201,title:'Office Manager',at:'2026-11-05'},
  {id:202,title:'Analyst',at:'2026-11-06',company:'Director Operations Staffing'},
];

function fixture(rows=BASE,fullText=true){
  const db=new DatabaseSync(':memory:');db.exec("ATTACH DATABASE ':memory:' AS corpus");db.exec(schema);
  db.exec('CREATE INDEX IF NOT EXISTS corpus.idx_corpus_geo ON postings_corpus(active,lat,lon,city)');
  const company=db.prepare('INSERT OR IGNORE INTO corpus.companies(id,name) VALUES(?,?)');
  const companies=new Map();
  const add=db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,first_seen_at,
    posted_date,active,location,state,city,lat,lon,remote,job_type,salary_min,salary_max,salary_currency,salary_period)
    VALUES(?,?,?,?,?,?,date('now'),?,?,?,?,?,?,?,?,?,?,?,?)`);
  rows.forEach((r,i)=>{const name=r.company||'Example Employer',companyId=companies.get(name)??i+1;
    companies.set(name,companyId);company.run(companyId,name);add.run(r.id,companyId,'fixture-'+r.id,r.title,
    r.description??'director operations needle',r.at||'2026-11-01',r.active??1,r.location||'Remote',r.state||'FL',
    'destin',r.lat??30.4044,r.lon??-86.4714,r.remote??1,r.type||'full-time',r.pay??200000,r.pay??200000,'USD','year');});
  const seen=[];
  const handle={prepare(sql){
    if(!fullText&&/sqlite_master/.test(sql))return {get(){return undefined;}};
    const statement=db.prepare(sql);
    return {get:(...args)=>statement.get(...args),all:(...args)=>{seen.push({sql,args});return statement.all(...args);}};
  }};
  return {db,handle,seen,close:()=>db.close()};
}
const ids=page=>page.jobs.map(job=>job.id);

for(const fullText of [true,false]){
  test(`Title tiers use first-seen time before ID and keep stable date ties; FTS=${fullText}`,()=>{
    const f=fixture([{id:1,title:'Director',at:'2026-11-01'},{id:999,title:'Director',at:'2026-01-01'},
      {id:2,title:'Director',at:'2026-11-01'}],fullText);try{
      assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{q:'director',sort:'relevant'})),[2,1,999]);
    }finally{f.close();}
  });
  test(`Most relevant puts older title matches before newer other matches across pages; FTS=${fullText}`,()=>{
    const f=fixture(BASE,fullText);try{
      const all=[];
      for(let page=1;page<=3;page++)all.push(...ids(browse.fetchBrowsePage(f.handle,{q:'director',sort:'relevant',per:'2',page:String(page)})));
      assert.deepEqual(all,[103,102,101,202,201]);
      assert.equal(new Set(all).size,all.length);
      assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{q:'director',per:'2'})),[103,102],'no choice defaults to Most relevant');
      assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{q:'director',sort:'recent',per:'2'})),[202,201],'explicit newest still wins');
    }finally{f.close();}
  });
  test(`Every primary keyword must occur in the title for its first tier; FTS=${fullText}`,()=>{
    const f=fixture(BASE,fullText);try{
      assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{q:'director operations',sort:'relevant'})),[103,101,202,201,102]);
    }finally{f.close();}
  });
  test(`All advanced, geographic, pay and exclusion filters apply before relevance pagination; FTS=${fullText}`,()=>{
    const good={title:'Director Operations',description:'director operations needle',company:'Example Employer'};
    const rows=[{...good,id:11,at:'2026-01-01'},{...good,id:12,at:'2026-01-02'},
      {...good,id:20,title:'Office Accounting'},{...good,id:21,description:'director operations elsewhere'},
      {...good,id:22,lat:34,lon:-118},{...good,id:23,pay:90000},{...good,id:24,company:'Hidden Employer'},
      {...good,id:25,state:'CA'},{...good,id:26,remote:0,location:'On-site Destin, FL'},
      {...good,id:27,type:'contract'},{...good,id:28,active:0}];
    const f=fixture(rows,fullText);try{
      const query={q:'director',title:'Operations',description:'needle',state:'FL',remote:'1',type:'full-time',days:'30',
        lat:'30.4044',lon:'-86.4714',radius_miles:'25',min_pay:'150000',max_pay:'250000',pay_period:'year',sort:'relevant',per:'1'};
      const hidden=[{kind:'company',value:'hidden employer'}];
      assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{...query,page:'1'},hidden)),[12]);
      assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{...query,page:'2'},hidden)),[11]);
      assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{...query,page:'3'},hidden)),[]);
    }finally{f.close();}
  });
}

test('Relevant without primary keywords retains the newest index walk, and FTS ranking starts at its match index',()=>{
  const f=fixture();try{
    assert.deepEqual(ids(browse.fetchBrowsePage(f.handle,{sort:'relevant'})),[202,201,103,102,101]);
    const plain=f.seen.at(-1);const plans=f.db.prepare('EXPLAIN QUERY PLAN '+plain.sql).all(...plain.args).map(row=>row.detail);
    assert.ok(plans.some(row=>/idx_corpus_active_seen|idx_corpus_seen/.test(row)),plans.join('\n'));
    assert.ok(!plans.some(row=>/TEMP B-TREE FOR ORDER BY/.test(row)),plans.join('\n'));
    browse.fetchBrowsePage(f.handle,{q:'director',sort:'relevant'});
    const ranked=f.seen.at(-1);const search=f.db.prepare('EXPLAIN QUERY PLAN '+ranked.sql).all(...ranked.args).map(row=>row.detail);
    assert.ok(search.some(row=>/VIRTUAL TABLE INDEX/.test(row)),search.join('\n'));
    assert.ok(!search.some(row=>/^SCAN p\b/.test(row)),search.join('\n'));
  }finally{f.close();}
});

test('Fallback description matching reads at most its bounded recent eligible arm',()=>{
  const f=fixture([],false);let reads=0;try{
    for(const name of ['insert','delete','update'])f.db.exec('DROP TRIGGER corpus.postings_fts_'+name);
    f.db.exec('DROP TABLE corpus.postings_fts; ALTER TABLE corpus.postings_corpus RENAME TO posting_rows');
    f.db.function('observed_description',value=>{reads++;return value;});
    const cols=f.db.prepare('PRAGMA corpus.table_info(posting_rows)').all().map(row=>row.name);
    f.db.exec('CREATE VIEW corpus.postings_corpus AS SELECT '+cols.map(name=>name==='description'?'observed_description(description) AS description':name).join(',')+' FROM posting_rows');
    f.db.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Unrelated Employer')");
    const add=f.db.prepare("INSERT INTO corpus.posting_rows(id,company_id,ats_job_id,title,description,first_seen_at,active) VALUES(?,1,?,'Unrelated role',?,'2026-01-01',1)");
    for(let id=1;id<=browse.ARM_POOL*2+1;id++)add.run(id,'bounded-'+id,id===1?'veryrarefixtureword':'unrelated text');
    const page=browse.fetchBrowsePage(f.handle,{q:'veryrarefixtureword',sort:'relevant'});
    assert.equal(page.pooled,true);
    assert.ok(reads>0,'the description arm must actually inspect its eligible sample');
    assert.deepEqual(page.jobs,[],'a match older than the bounded description sample must not imply a complete-corpus search');
    assert.ok(reads<=browse.ARM_POOL,`description reader examined ${reads} rows; budget is ${browse.ARM_POOL}`);
  }finally{f.close();}
});
