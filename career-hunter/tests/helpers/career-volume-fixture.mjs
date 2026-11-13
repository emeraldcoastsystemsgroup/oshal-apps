/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Measure shipped Career handlers on fictional owner relationships and a disposable job corpus; record exact SQL plans.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRouter,loadCompiledModules} from './career-route-harness.mjs';
const require=createRequire(import.meta.url),Database=require('../../../scripts/toolchain/node_modules/better-sqlite3');
/** The fictional corpus and stored relationship volume used by every route measurement. */
export const VOLUME={jobs:60000,relationships:60000,aiMatches:8000,saved:500,preparing:1000,applications:1000};
const schema=name=>readFileSync(new URL('../../engine/jobhunter/db.py',import.meta.url),'utf8').match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1];
function seed(paths){
 mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
 const db=new Database(paths.userDb);db.exec(`ATTACH DATABASE '${paths.corpusDb}' AS corpus`);db.exec(schema('CORPUS_SCHEMA'));db.exec(schema('USER_SCHEMA'));
 db.exec("BEGIN; INSERT INTO corpus.companies(id,name) VALUES(1,'Invented employer')");
 const post=db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,location,remote,active,target_role,url,posted_date,first_seen_at) VALUES(?,1,?,'Platform engineer',?,'Fully remote',1,1,1,'https://fixture.invalid/job',?,?)`);
 const signal=db.prepare(`INSERT INTO user_signals(posting_id,fit_score,ai_fit_score,status,promoted_at,generated_at,applied_at) VALUES(?,75,?,?,?,?,?)`);
 for(let id=1;id<=VOLUME.jobs;id++){
  const date='2026-11-'+String(1+id%12).padStart(2,'0'),stamp=date+'T12:00:00Z';
  post.run(id,'fiction-'+id,'Fictional cloud skills. '.repeat(100),date,stamp);
  const status=id<=1000?'generated':id<=2000?'applied':id<=2500?'dismissed':'new';
  signal.run(id,id<=VOLUME.aiMatches?80+id%20:null,status,status==='generated'?stamp:null,status==='generated'?stamp:null,status==='applied'?stamp:null);
 }
 db.exec('COMMIT');db.close();
 const board=require('../../lib/career-board-state');for(let id=1;id<=VOLUME.saved;id++)board.updateBoardState(paths.userDir,id,{favorite:true,workflowEnteredAt:'2026-11-12T12:00:00Z'});
}
/** Build an isolated owner, real SQLite stores and compiled handlers with external-work tripwires. */
export function volumeFixture(){
 const root=mkdtempSync(join(tmpdir(),'career-volume-')),previous=process.env.JOBHUNTER_STORE_ROOT,plans=[],writes=[],starts=[];
 process.env.JOBHUNTER_STORE_ROOT=root;
 function Observed(file,options){
  const db=new Database(file,options),original=db.prepare.bind(db);
  db.prepare=sql=>{const stmt=original(sql);for(const method of ['all','get','run']){const fn=stmt[method].bind(stmt);stmt[method]=(...args)=>{
   if(/^(?:SELECT|WITH)\b/.test(sql.trim()))plans.push({sql,plan:original('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail)});
   if(/^(?:UPDATE|INSERT|DELETE)\b/.test(sql.trim()))writes.push(sql);
   return fn(...args);
  };}return stmt;};return db;
 }
 const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':Observed,'./career-engine-dispatch':{runCareerCliAsync:async(...args)=>{starts.push(args);return {started:true};}},'./career-engine-runner':{nativeRunInProgress:async()=>false}});
 const sub='fictional-volume-person',paths=modules.store.userPaths(sub);seed(paths);
 const router=createRouter(),ctx={pool:{query:async sql=>{assert.match(sql,/SELECT remote_only/,'only matching preference is doubled');return {rows:[{remote_only:true}]};}}};
 modules.board.registerCareerBoardRoutes(router,ctx);
 async function call(method,url,body){
  const u=new URL(url,'http://fixture.invalid'),entry=router.find(method,u.pathname);assert.ok(entry,url);
  return new Promise((resolve,reject)=>{let status=200;const res={status(n){status=n;return res;},setHeader(){},json(json){resolve({status,json});return res;}};
   Promise.resolve(entry.handler({method,oidc:{user:{sub}},params:entry.params,query:Object.fromEntries(u.searchParams),body,headers:{}},res)).catch(reject);
  });
 }
 return {root,paths,call,plans,writes,starts,close(){if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;rmSync(root,{recursive:true,force:true});}};
}
/** Time the Home SQLite read group, stage lists and explicit relationship writers. */
export async function measurements(f){
 const result=[];
 for(const [label,method,url,body]of [
  ['Home','GET',['/jobs/stats','/jobs/stats','/jobs?status=tracked&page=1&per=50','/jobs?status=saved&page=1&per=6','/jobs/progress','/jobs/updates']],['New matches','GET','/jobs?matches=1&sort=posted&per=25&lane=all'],
  ['Saved','GET','/jobs?status=saved&sort=ai&per=25'],['Getting ready','GET','/jobs?status=queue&sort=generated&per=25&current=1'],
  ['Applications','GET','/jobs?status=tracked&sort=applied&per=25'],['Save','POST','/jobs/8100/status',{favorite:true}],
  ['Remove','POST','/jobs/8100/status',{status:'dismissed',favorite:false}],['Prepare','POST','/jobs/8101/status',{status:'promoted',favorite:true}],
 ]){
  f.plans.length=0;f.writes.length=0;const at=performance.now(),outputs=await Promise.all((Array.isArray(url)?url:[url]).map(path=>f.call(method,path,body))),ms=performance.now()-at;
  for(const out of outputs)assert.equal(out.status,200,label+': '+JSON.stringify(out.json));result.push({label,ms,rows:outputs[0].json.jobs?.length,plans:[...f.plans],writes:[...f.writes]});
 }
 return result;
}
