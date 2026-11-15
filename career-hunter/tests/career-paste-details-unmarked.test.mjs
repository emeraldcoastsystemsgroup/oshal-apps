/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.1 (Lane VER15 on the test server, 2026-11-15: asked to draft a résumé for a job the nightly pass had not marked, the Concierge said "The draft stopped … the job details are unavailable" and pointed to Getting ready, never to the paste box). The compiled POST /jobs/:id/generate and GET /jobs/:id over a disposable invented person, with the real engine preparation (career-paste-details-unmarked-engine.py) behind the start: an unmarked job with no description still gets its one employer read and stops with job_details_unavailable, and the job read the Concierge and Jarvis read after career_draft then carries details_needed, the same words as the marked job's refusal and the application page: "… paste it in Prepare application, step 1 · Tailor, and generate your résumé and cover letter there."; a retry still starts the engine. A saved copy that cannot be verified (job_context_unavailable) on a job with no description reads the same, and so does the saved-job preparation receipt. A job with its own listing text, and a stop for another reason, carry no such words. The career_job description and the Concierge's perspective name details_needed and say to tell the person those words.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';

const require=createRequire(import.meta.url),Database=require('../../scripts/toolchain/node_modules/better-sqlite3');
const yaml=require('../../scripts/toolchain/node_modules/js-yaml');
const SUB='paste-unmarked-olive';
const root=mkdtempSync(join(tmpdir(),'career-paste-unmarked-')),previous=process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT=root;
const starts=[],engineRuns=[];
let paths;
/** The route's engine start runs the real preparation for that job, as the runner would, and records it. */
async function startEngine(pool,sub,args,env){
  starts.push({sub,args,env});
  const run=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-paste-details-unmarked-engine.py',import.meta.url))],
    {input:JSON.stringify({dataDir:paths.userDir,userDb:paths.userDb,corpusDb:paths.corpusDb,sub,postingId:env.CH_JOB,requestId:env.CH_REQUEST_ID}),encoding:'utf8',timeout:60000});
  assert.equal(run.status,0,run.stderr+run.stdout);
  engineRuns.push(JSON.parse(run.stdout.trim().split('\n').pop()));
  return {started:true};
}
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{
  'better-sqlite3':Database,
  './career-engine-dispatch':{runCareerCliAsync:startEngine},
  './career-engine-runner':{nativeRunInProgress:async()=>false},
});
const router=createRouter();
modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[{remote_only:false}]};}}});
after(()=>{if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;rmSync(root,{recursive:true,force:true});});

const MARK='{"needsDetails":1,"at":"2026-11-15T07:30:00+00:00"}';
const WORDS=/^Career could not read this job’s details, so it cannot check your fit or write a résumé for it yet\. Open the job’s posting, copy the job description, paste it in Prepare application, step 1 · Tailor, and generate your résumé and cover letter there\.$/;
const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8'),schema=name=>engine.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1];
paths=modules.store.userPaths(SUB);
mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
{const corpus=new Database(paths.corpusDb);corpus.exec(schema('CORPUS_SCHEMA').replaceAll('corpus.',''));
 corpus.exec("INSERT INTO companies(id,name,ats_type,ats_token)VALUES(1,'Invented Analog','eightfold','invented.eightfold.ai|x')");
 corpus.exec(`INSERT INTO postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role,posted_date)VALUES
  (5,1,'a-5','Marked Lead','https://invented.example/jobs/5',NULL,1,1,date('now')),
  (6,1,'a-6','Listed Designer','https://invented.example/jobs/6','${'Invented listing text. '.repeat(60)}',1,1,date('now')),
  (7,1,'a-7','Principal Invented Designer','https://invented.example/jobs/7',NULL,1,1,date('now')),
  (8,1,'a-8','Invented Converter Engineer','https://invented.example/jobs/8',NULL,1,1,date('now')),
  (9,1,'a-9','Invented Test Engineer','https://invented.example/jobs/9',NULL,1,1,date('now'))`);corpus.close();}
{const db=new Database(paths.userDb);db.exec(schema('USER_SCHEMA'));require('../lib/career-signal-migrations').migrate(db);
 db.prepare("INSERT INTO user_signals(posting_id,fit_score,status,ai_model)VALUES(5,40,'new',?)").run(MARK);
 for(const id of [6,7,8,9])db.prepare("INSERT INTO user_signals(posting_id,fit_score,status)VALUES(?,40,'new')").run(id);db.close();}
const board=require('../lib/career-board-state');

function call(method,path,body,sub=SUB){
  const parsed=new URL(path,'http://fixture.test'),found=router.find(method,parsed.pathname);assert.ok(found,path);
  return new Promise((resolve,reject)=>{const out={status:200};const res={status(n){out.status=n;return res;},setHeader(){},json(json){resolve({...out,json});return res;}};
    Promise.resolve(found.handler({method,oidc:{user:sub?{sub}:null},params:found.params,body,query:Object.fromEntries(parsed.searchParams),headers:{}},res)).catch(reject);});
}

test('an unmarked job Career cannot read: the engine tries the employer page once, then the job read says where to paste',async()=>{
  const before=(await call('GET','/jobs/7')).json.job;
  assert.equal(before.fit_assessment.kind,'keyword','not marked by the nightly pass');assert.equal(before.details_needed,undefined,'nothing to say before Career has tried');
  const started=await call('POST','/jobs/7/generate',{documents:true,requestId:'unmarked-first-1'});
  assert.equal(started.status,202,JSON.stringify(started.json));assert.equal(starts.length,1,'an unmarked job still starts the engine');
  const [run]=engineRuns;
  assert.equal(run.result.error,'job_details_unavailable',JSON.stringify(run));
  assert.equal(run.employerReads,1,'the engine tried the employer page once, as before');assert.equal(run.modelCalls,0);
  const job=(await call('GET','/jobs/7')).json.job;
  assert.equal(job.board.phase,'failed');assert.equal(job.board.error,'job_details_unavailable');
  assert.match(job.details_needed,WORDS,'what career_job answers the Concierge and Jarvis');
  assert.equal(job.application.failed,true);assert.equal(job.application.needsGeneration,true,'the application opens on step 1 · Tailor');
  const marked=await call('POST','/jobs/5/generate',{documents:true,requestId:'marked-refused-1'});
  assert.equal(marked.status,409);assert.equal(marked.json.error,job.details_needed,'the same words as a marked job’s refusal');
  assert.equal((await call('GET','/jobs/5')).json.job.details_needed,job.details_needed,'and as a marked job’s read');
});

test('a retry still starts the engine: when Career tries the employer page is unchanged',async()=>{
  const again=await call('POST','/jobs/7/generate',{documents:true,requestId:'unmarked-again-1'});
  assert.equal(again.status,202,JSON.stringify(again.json));assert.equal(starts.length,2);
  assert.equal(engineRuns[1].employerReads,1);assert.equal(engineRuns[1].result.error,'job_details_unavailable');
  assert.match((await call('GET','/jobs/7')).json.job.details_needed,WORDS);
});

test('a saved copy that cannot be verified, on a job with no description, reads the same',async()=>{
  mkdirSync(join(paths.userDir,'job-context'),{recursive:true,mode:0o700});
  writeFileSync(join(paths.userDir,'job-context','8.json'),JSON.stringify({version:1,description:'Invented copy',descriptionSha256:'0'.repeat(64)}),{mode:0o600});
  assert.equal((await call('POST','/jobs/8/generate',{documents:true,requestId:'unverified-copy-1'})).status,202);
  assert.equal(engineRuns.at(-1).result.error,'job_context_unavailable',JSON.stringify(engineRuns.at(-1)));
  const job=(await call('GET','/jobs/8')).json.job;
  assert.equal(job.board.error,'job_context_unavailable');assert.match(job.details_needed,WORDS);
});

test('the saved-job preparation receipt says the same words',async()=>{
  const saved=board.readBoardState(paths.userDir).jobs[7];
  board.updateBoardState(paths.userDir,7,{workflow:{batchId:'invented-batch',mode:'review'},workflowEnteredAt:saved.requestedAt});
  const job=(await call('GET','/jobs/7')).json.job;
  assert.equal(job.application.workflow.state,'stuck');assert.match(job.application.workflow.reason,WORDS);
});

test('a job with its own listing text, or a stop for another reason, carries no paste words',async()=>{
  board.updateBoardState(paths.userDir,6,{phase:'failed',error:'job_context_unavailable',completedAt:new Date().toISOString()});
  board.updateBoardState(paths.userDir,9,{phase:'failed',error:'score_unavailable',completedAt:new Date().toISOString()});
  for(const id of [6,9]){const job=(await call('GET','/jobs/'+id)).json.job;assert.equal(job.board.phase,'failed');assert.equal(job.details_needed,undefined,String(id));}
});

test('what the Concierge and Jarvis read: career_job names details_needed and the Concierge is told to say those words',()=>{
  const manifest=yaml.load(readFileSync(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
  assert.equal(manifest.chatBot,'career-concierge','Jarvis hands Career requests to the Concierge');
  const tool=manifest.tools.find(entry=>entry.name==='career_job');
  assert.match(tool.description,/details_needed holds the words to tell them/,'the kernel shows the model description and schema only');
  const persona=yaml.load(readFileSync(new URL('../personas/career-concierge.yaml',import.meta.url),'utf8')).perspective.replace(/\s+/g,' ');
  assert.match(persona,/could not read the job's details carries the words to say \(the refusal, or the job's details_needed\): tell the person, in those words, to open Prepare application, step 1 · Tailor, paste the job description from the posting and generate there\./);
});
