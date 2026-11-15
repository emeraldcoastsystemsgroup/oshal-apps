/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.66.1: the refusal's words end with what to do after pasting, "… step 1 · Tailor, and generate your résumé and cover letter there."
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "make the user get the position details and paste them before generating the resume"): the compiled POST /jobs/:id/generate, which the application page, the Concierge and Jarvis's career_draft all call, over a disposable invented person. A job the nightly pass marked "details needed" with no description is refused before the engine starts, for Generate and for Check my fit, in words that say to paste it in Prepare application, step 1 · Tailor; a paste shorter than 200 or longer than 20,000 characters is refused; a valid paste starts preparation with the text as CH_JOB_DESCRIPTION; a job with its own listing text, and the same job once its description is saved, start as before. GET /jobs/:id and New matches name the job details-needed.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';

const require=createRequire(import.meta.url),Database=require('../../scripts/toolchain/node_modules/better-sqlite3');
const root=mkdtempSync(join(tmpdir(),'career-paste-route-')),previous=process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT=root;
const starts=[];
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{
  'better-sqlite3':Database,
  './career-engine-dispatch':{runCareerCliAsync:async(...args)=>{starts.push(args);return {started:true};}},
  './career-engine-runner':{nativeRunInProgress:async()=>false},
});
const router=createRouter();
modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[{remote_only:false}]};}}});
after(()=>{if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;rmSync(root,{recursive:true,force:true});});

const MARK='{"needsDetails":1,"at":"2026-11-15T07:30:00+00:00"}';
const PASTED='Invented warehouse lead. Duties: run the invented dock, train three invented colleagues, keep invented records. '.repeat(3);
const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8'),schema=name=>engine.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1];
const paths=modules.store.userPaths('paste-route-olive');
mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
{const corpus=new Database(paths.corpusDb);corpus.exec(schema('CORPUS_SCHEMA').replaceAll('corpus.',''));
 corpus.exec("INSERT INTO companies(id,name)VALUES(1,'Invented Freight')");
 corpus.exec(`INSERT INTO postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role,posted_date)VALUES
  (5,1,'f-5','Warehouse Lead','https://invented.example/jobs/5',NULL,1,1,date('now')),
  (6,1,'f-6','Dock Supervisor','https://invented.example/jobs/6','${'Invented listing text. '.repeat(60)}',1,1,date('now'))`);corpus.close();}
{const db=new Database(paths.userDb);db.exec(schema('USER_SCHEMA'));require('../lib/career-signal-migrations').migrate(db);
 db.prepare("INSERT INTO user_signals(posting_id,fit_score,status,ai_model)VALUES(5,40,'new',?)").run(MARK);
 db.prepare("INSERT INTO user_signals(posting_id,fit_score,status,ai_fit_score)VALUES(6,50,'new',72)").run();db.close();}

function call(method,path,body,sub='paste-route-olive'){
  const parsed=new URL(path,'http://fixture.test'),found=router.find(method,parsed.pathname);assert.ok(found,path);
  return new Promise((resolve,reject)=>{const out={status:200};const res={status(n){out.status=n;return res;},setHeader(){},json(json){resolve({...out,json});return res;}};
    Promise.resolve(found.handler({method,oidc:{user:sub?{sub}:null},params:found.params,body,query:Object.fromEntries(parsed.searchParams),headers:{}},res)).catch(reject);});
}

test('the job reads as details needed on its page and in New matches',async()=>{
  const job=(await call('GET','/jobs/5')).json.job;
  assert.equal(job.fit_assessment.kind,'needs-details');assert.equal(job.ai_fit_score,null);assert.ok(!job.description);
  const matches=(await call('GET','/jobs?matches=1&sort=posted&per=50')).json.jobs;
  assert.deepEqual(matches.map(row=>row.id).sort(),[5,6],'the details-needed job is listed beside the scored one');
});

test('Generate and Check my fit are refused before the engine starts, with the words to paste the description',async()=>{
  for(const documents of [true,false]){
    const refused=await call('POST','/jobs/5/generate',{documents,requestId:'refused-'+documents});
    assert.equal(refused.status,409);assert.equal(refused.json.code,'job_details_needed');
    assert.match(refused.json.error,/could not read this job’s details/);
    assert.match(refused.json.error,/paste it in Prepare application, step 1 · Tailor, and generate your résumé and cover letter there\.$/);
  }
  assert.equal(starts.length,0,'no engine start, so no read and no model call');
});

test('a paste outside 200 to 20,000 characters is refused, and nothing starts',async()=>{
  for(const text of ['x'.repeat(199),'  '+'y'.repeat(150)+'\r\n\r\n  ','z'.repeat(20001),12345]){
    const refused=await call('POST','/jobs/5/generate',{documents:true,requestId:'short-paste-1',jobDescription:text});
    assert.equal(refused.status,400,JSON.stringify(refused.json));assert.equal(refused.json.code,'pasted_details_invalid');
  }
  assert.match((await call('POST','/jobs/5/generate',{jobDescription:'x'.repeat(10)})).json.error,/at least 200 characters/);
  assert.equal(starts.length,0);
});

test('a valid paste starts preparation with the text as the job description',async()=>{
  const accepted=await call('POST','/jobs/5/generate',{documents:true,requestId:'pasted-start-1',jobDescription:'\r\n  '+PASTED+'\u0000  '});
  assert.equal(accepted.status,202,JSON.stringify(accepted.json));
  assert.equal(starts.length,1);const [,sub,args,env]=starts[0];
  assert.equal(sub,'paste-route-olive');assert.deepEqual(args,['prepare-job']);
  assert.equal(env.CH_JOB_DESCRIPTION,PASTED.trim(),'trimmed, control characters removed, otherwise as pasted');
  assert.equal(env.CH_JOB,'5');
});

test('a job with its own description, or one whose description is saved, starts as before',async()=>{
  starts.length=0;
  assert.equal((await call('POST','/jobs/6/generate',{documents:true,requestId:'listed-job-1'})).status,202);
  assert.equal(starts[0][3].CH_JOB_DESCRIPTION,undefined,'nothing pasted is sent');
  // The engine keeps a paste as the person's own copy; with it saved the job is no longer refused.
  const row=(await call('GET','/jobs/5')).json.job,crypto=require('node:crypto'),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
  const corpus=new Database(paths.corpusDb,{readonly:true}),posting=corpus.prepare('SELECT * FROM postings_corpus WHERE id=5').get();corpus.close();
  const snapshot={postingId:5,companyId:1,atsJobId:'f-5',title:'Warehouse Lead',url:'https://invented.example/jobs/5',location:'',department:'',jobType:'',
    postedAt:'',postedDate:posting.posted_date,state:'',city:'',remote:false,lat:null,lon:null,listingSha256:hash(''),
    salary_min:null,salary_max:null,salary_currency:'',salary_period:'',salary_raw:''};
  mkdirSync(join(paths.userDir,'job-context'),{recursive:true,mode:0o700});
  writeFileSync(join(paths.userDir,'job-context','5.json'),JSON.stringify({version:2,snapshot,description:PASTED.trim(),descriptionSha256:hash(PASTED.trim()),
    retrievedAt:new Date().toISOString().replace(/\.\d+Z$/,'Z'),basis:'person-pasted',sourceChars:Array.from(PASTED.trim()).length,sourceBytes:Buffer.byteLength(PASTED.trim()),truncated:false}),{mode:0o600});
  const saved=(await call('GET','/jobs/5')).json.job;
  assert.equal(saved.description,PASTED.trim(),'the job page reads the saved paste');assert.equal(saved.description_context.basis,'person-pasted');
  assert.ok(!row.description);
  assert.equal((await call('POST','/jobs/5/generate',{documents:false,requestId:'saved-paste-1'})).status,202,'with the description saved, Check my fit starts');
});
