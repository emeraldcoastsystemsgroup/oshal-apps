/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Cross the shipped settings/save writer, dispatcher, launcher and Python batch over disposable SQLite; a missing fictional résumé becomes a retained failure without model, employer or submission work.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createRouter,loadCompiledModules,isolateRunnerEnv} from './helpers/career-route-harness.mjs';
const require=createRequire(import.meta.url),Database=require('../../scripts/toolchain/node_modules/better-sqlite3');
test('real saved-job writer launches the packaged background batch and retains missing-résumé failure, never a submission',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workflow-background-')),restore=isolateRunnerEnv(root);
 const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js',runner:'routes/career-engine-runner.js'},{'better-sqlite3':Database});
 const sub='fictional-background-owner',paths=modules.store.userPaths(sub);mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
 const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8'),corpus=new Database(paths.corpusDb);
 corpus.exec(engine.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1].replaceAll('corpus.',''));
 corpus.exec("INSERT INTO companies(id,name)VALUES(1,'Invented workplace');INSERT INTO postings_corpus(id,company_id,ats_job_id,title,url,active)VALUES(1,1,'fiction','Office assistant','https://employer.example.test/1',1)");corpus.close();
 const db=new Database(paths.userDb);db.exec(engine.match(/USER_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);db.exec("INSERT INTO user_signals(posting_id,status)VALUES(1,'new')");db.close();
 const router=createRouter(),queries=[];modules.board.registerCareerBoardRoutes(router,{pool:{async query(sql){const text=typeof sql==='string'?sql:sql.text;queries.push(text);assert.match(text,/SELECT provider, access_token FROM oshal_connections/);return {rows:[]};}}});
 const call=(path,body)=>new Promise((resolve,reject)=>{const route=router.find('POST',path);if(!route)return resolve({status:404});let status=200;const res={setHeader(){},status(n){status=n;return res;},json(json){resolve({status,json});return res;}};Promise.resolve(route.handler({method:'POST',params:route.params,body,query:{},headers:{},oidc:{user:{sub}}},res)).catch(reject);});
 try{
  assert.equal((await call('/application-workflow',{enabled:true,mode:'automatic'})).status,200);
  const saved=await call('/jobs/1/status',{favorite:true});assert.equal(saved.status,200);assert.equal(saved.json.preparation.started,true);
  let state;const end=Date.now()+15000;
  do{try{state=JSON.parse(readFileSync(join(paths.userDir,'job-board-state.json'),'utf8')).jobs[1];}catch{}if(state?.completedAt)break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);
  assert.equal(state?.phase,'failed');assert.equal(state.error,'resume_required');assert.equal(state.workflow.mode,'automatic');assert.ok(queries.length>0);
  const reopened=new Database(paths.userDb);try{const row=reopened.prepare('SELECT status,applied_at,application_task_id FROM user_signals WHERE posting_id=1').get();assert.equal(row.status,'promoted');assert.equal(row.applied_at,null);assert.equal(row.application_task_id,null);}finally{reopened.close();}
  assert.equal(require('../lib/career-submission-queue').read(paths.userDir).items&&Object.keys(require('../lib/career-submission-queue').read(paths.userDir).items).length,0);
 }finally{const end=Date.now()+15000;let lease;do{lease=modules.runner.tryAcquireRun(sub,'user-store');if(lease.status==='ok'){modules.runner.releaseRun(lease);break;}await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);restore();if(lease.status==='ok')rmSync(root,{recursive:true,force:true});assert.equal(lease.status,'ok','fixture engine released its owner lease');}
});
