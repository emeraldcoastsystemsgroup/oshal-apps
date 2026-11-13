/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise original-owner match pages and exact counts through the compiled real router with disposable stores, explicit preferences and separate saved/application records.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';
class Adapter{
  constructor(file,options={}){this.db=new DatabaseSync(file,{readOnly:Boolean(options.readonly)});}
  exec(sql){this.db.exec(sql);return this;}
  prepare(sql){const s=this.db.prepare(sql);s.setAllowBareNamedParameters(true);return {get:(...a)=>s.get(...a),all:(...a)=>s.all(...a),run:(...a)=>s.run(...a)};}
  pragma(sql,options={}){const rows=this.prepare('PRAGMA '+sql).all();return options.simple?Object.values(rows[0]||{})[0]:rows;}
  close(){this.db.close();}
}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-g5-route-')),previous=process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT=root;
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':Adapter});
const router=createRouter(),remote=new Map([['matches-other',true]]);
modules.board.registerCareerBoardRoutes(router,{pool:{async query(sql,args){assert.match(sql,/SELECT remote_only FROM career_score_settings/);if(remote.get(args[0])==='unavailable')throw Error('Synthetic preference unavailable');return {rows:[{remote_only:remote.get(args[0])===true}]};}}});
after(()=>{if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;fs.rmSync(root,{recursive:true,force:true});});
const engine=fs.readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8');
const schema=name=>engine.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1];
function seed(sub,other=false){
  const p=modules.store.userPaths(sub);fs.mkdirSync(path.dirname(p.corpusDb),{recursive:true});fs.mkdirSync(p.userDir,{recursive:true});
  const corpus=new DatabaseSync(':memory:');corpus.prepare('ATTACH DATABASE ? AS corpus').run(p.corpusDb);
  if(!corpus.prepare("SELECT name FROM corpus.sqlite_master WHERE type='table' AND name='postings_corpus'").get()){
    corpus.exec(schema('CORPUS_SCHEMA'));
    corpus.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Fixture employer')");
    const insert=corpus.prepare("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,location,active,target_role,remote) VALUES(?,1,?,'Fixture role',?,1,1,?)");
    for(let id=1;id<=11;id++)insert.run(id,'fixture-'+id,id===9?'Fully remote':'Austin, TX',id===9?1:0);
  }
  corpus.close();const db=new DatabaseSync(p.userDb);db.exec(schema('USER_SCHEMA'));
  if(other)db.prepare("INSERT INTO user_signals(posting_id,ai_fit_score,status) VALUES(9,55,'new')").run();
  else{const signal=db.prepare('INSERT INTO user_signals(posting_id,ai_fit_score,status) VALUES(?,?,?)');for(let id=1;id<=11;id++)signal.run(id,id<=7?null:id===9?0:90,id===10?'applied':id===11?'promoted':'new');}
  db.close();if(!other)fs.writeFileSync(path.join(p.userDir,'job-board-state.json'),JSON.stringify({version:1,jobs:{...Object.fromEntries([1,2,3,4,5,6,7].map(id=>[id,{favorite:true}])),11:{workflowEnteredAt:'2026-11-12T12:00:00Z'}}}));
  return p;
}
const owner=seed('matches-owner'),other=seed('matches-other',true);
async function call(pathname,sub,query={}){
  const found=router.find('GET',pathname);assert.ok(found);
  return new Promise((resolve,reject)=>{const answer={code:200,body:null},res={status(code){answer.code=code;return res;},setHeader(){},json(body){answer.body=body;resolve(answer);return res;}};
    Promise.resolve(found.handler({oidc:{user:sub?{sub}:null},params:found.params,query,headers:{}},res)).catch(reject);});
}

test('the actual matches route returns only actionable scored jobs belonging to this owner',async()=>{
  const a=await call('/jobs','matches-owner',{matches:'1',sort:'ai',per:'100'});assert.equal(a.code,200);assert.deepEqual(a.body.jobs.map(j=>j.id),[8,9]);
  const b=await call('/jobs','matches-other',{matches:'1',sort:'ai',per:'100'});assert.equal(b.code,200);assert.deepEqual(b.body.jobs.map(j=>j.id),[9]);
});
test('owner counts use the same preference and do not merge saved or pipeline counts into matches',async()=>{
  const a=await call('/jobs/stats','matches-owner');assert.equal(a.code,200);assert.equal(a.body.matches,2);assert.equal(a.body.saved,7);assert.equal(a.body.queued,1);assert.equal(a.body.tracked,1);
  const b=await call('/jobs/stats','matches-other');assert.equal(b.code,200);assert.equal(b.body.matches,1);assert.equal(b.body.saved,0);assert.equal(b.body.tracked,0);
});
test('the owner still reads all seven saved records and the applied record separately; unsigned reads are refused',async()=>{
  const saved=await call('/jobs','matches-owner',{status:'saved',per:'100'});assert.equal(saved.code,200);assert.deepEqual(saved.body.jobs.map(j=>j.id).sort((a,b)=>a-b),[1,2,3,4,5,6,7]);
  const applied=await call('/jobs','matches-owner',{status:'tracked',per:'100'});assert.deepEqual(applied.body.jobs.map(j=>j.id),[10]);
  assert.equal((await call('/jobs/stats',null)).code,401);assert.equal((await call('/jobs',null,{matches:'1'})).code,401);
});
test('an unavailable matching area is an unknown match count while known saved/application counts remain true',async()=>{
  const file=path.join(owner.userDir,'job-search-scope.json');fs.writeFileSync(file,'{}');
  try{const a=await call('/jobs/stats','matches-owner');assert.equal(a.code,200);assert.equal(a.body.matches,null);assert.equal(a.body.saved,7);assert.equal(a.body.tracked,1);}
  finally{fs.unlinkSync(file);}
});

test('unreadable matching preferences stay unknown and never silently broaden the default match view',async()=>{
  remote.set('matches-owner','unavailable');
  try{
    assert.equal((await call('/jobs','matches-owner',{matches:'1',per:'100'})).code,500);
    const stats=await call('/jobs/stats','matches-owner');assert.equal(stats.code,200);assert.equal(stats.body.matches,null);assert.equal(stats.body.saved,7);
    const explicit=await call('/jobs','matches-owner',{matches:'1',remote:'0',per:'100'});assert.equal(explicit.code,200);assert.deepEqual(explicit.body.jobs.map(job=>job.id),[8]);
  }finally{remote.delete('matches-owner');}
});
