/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive saved-job preparation settings, review and automatic readiness through the shipped owner writer with disposable people/jobs and external-work tripwires.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';
import {playwright,PHONE,DESKTOP} from './helpers/ux-page.mjs';
const require=createRequire(import.meta.url),Database=require('../../scripts/toolchain/node_modules/better-sqlite3');
const root=mkdtempSync(join(tmpdir(),'career-workflow-')),previous=process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT=root;
const starts=[];let refusal=false;
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'}, {
 'better-sqlite3':Database,
 './career-engine-dispatch':{runCareerCliAsync:async(...args)=>{starts.push(args);return {started:!refusal,err:'Synthetic engine unavailable'};}},
 './career-engine-runner':{nativeRunInProgress:async()=>false},
});
const router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{query(){throw Error('No external database, kernel, employer or submission service allowed');}}});
const board=require('../lib/career-board-state'),drafts=require('../lib/career-application-draft');
let serial=0;
function fixture(){
 const sub='workflow-fiction-'+(++serial),paths=modules.store.userPaths(sub);assert.ok(paths.userDir.startsWith(root+'/'),'every fictional owner stays inside this test’s disposable root');
 mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
 const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8'),corpus=new Database(paths.corpusDb);
 corpus.exec(engine.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1].replaceAll('corpus.',''));
 corpus.exec("INSERT OR IGNORE INTO companies(id,name)VALUES(1,'Invented employer'); INSERT OR IGNORE INTO postings_corpus(id,company_id,ats_job_id,title,url,active)VALUES(1,1,'fiction-1','Office assistant','https://employer.example.test/opening/1',1)");corpus.exec("UPDATE postings_corpus SET active=1,url='https://employer.example.test/opening/1' WHERE id=1");corpus.close();
 const db=new Database(paths.userDb);db.exec(engine.match(/USER_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);db.exec("INSERT INTO user_signals(posting_id,status)VALUES(1,'new')");db.close();
 return {sub,paths,call:(method,path,body,owner=sub)=>call(method,path,body,owner),job:()=>call('GET','/jobs/1',undefined,sub),signal:()=>{const d=new Database(paths.userDb);try{return d.prepare('SELECT * FROM user_signals WHERE posting_id=1').get();}finally{d.close();}}};
}
function call(method,path,body,sub){
 const parsed=new URL(path,'http://fixture.test');const found=router.find(method,parsed.pathname);if(!found)return Promise.resolve({status:404,json:{error:'route missing'}});
 return new Promise((resolve,reject)=>{const out={status:200};const res={status(n){out.status=n;return res;},setHeader(){},json(json){resolve({...out,json});return res;}};
 Promise.resolve(found.handler({method,oidc:{user:sub?{sub}:null},params:found.params,body,query:Object.fromEntries(parsed.searchParams),headers:{}},res)).catch(reject);});
}
const settings=(f,mode='review',enabled=true)=>f.call('POST','/application-workflow',{enabled,mode});
const save=f=>f.call('POST','/jobs/1/status',{favorite:true});
function complete(f){
 const saved=board.readBoardState(f.paths.userDir).jobs[1];assert.ok(saved.workflow,'real writer queued the job');
 const resume=join(f.paths.userDir,'resume.pdf'),cover=join(f.paths.userDir,'cover.pdf');writeFileSync(resume,'%PDF-1.4 fictional resume');writeFileSync(cover,'%PDF-1.4 fictional cover');
 const d=new Database(f.paths.userDb);d.prepare("UPDATE user_signals SET status='generated',resume_path=?,cover_path=? WHERE posting_id=1").run(resume,cover);d.close();
 board.updateBoardState(f.paths.userDir,1,{requestId:saved.generationDraft.requestId,phase:'ready',completedAt:new Date().toISOString(),error:null});
}
after(async()=>{await browser?.close();if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;rmSync(root,{recursive:true,force:true});});
test('workflow settings default OFF/review and a save starts no preparation (control)',async()=>{
 const f=fixture(),n=starts.length;const s=await f.call('GET','/application-workflow');assert.equal(s.status,200);assert.deepEqual(s.json,{enabled:false,mode:'review'});
 await save(f);assert.equal(f.signal().status,'new');assert.equal(starts.length,n);
});
test('explicit settings survive fresh reads for only the authenticated owner and reject forged input',async()=>{
 const a=fixture(),b=fixture();assert.equal((await settings(a,'automatic')).status,200);
 assert.deepEqual((await a.call('GET','/application-workflow')).json,{enabled:true,mode:'automatic'});
 assert.deepEqual((await b.call('GET','/application-workflow')).json,{enabled:false,mode:'review'});
 for(const body of [{enabled:'true',mode:'automatic'},{enabled:true,mode:'submit'},{enabled:true,mode:'review',userSub:b.sub},{enabled:true,mode:'review',autoSubmit:true}])assert.equal((await a.call('POST','/application-workflow',body)).status,400);
 assert.equal((await a.call('POST','/application-workflow',{enabled:true,mode:'automatic'},null)).status,401);
 assert.equal((await a.call('GET','/application-workflow',null,null)).status,401);
});
test('opting in prepares already saved jobs through the writer, preserving tailoring and another owner',async()=>{
 const a=fixture(),b=fixture();await save(a);await save(b);
 const current=(await a.job()).json.job.application;await a.call('POST','/jobs/1/status',{draft:{...current.draft,guidance:'Use only recorded office work.'}});
 const n=starts.length,s=await settings(a);assert.equal(s.status,200);assert.equal(s.json.queued,1);assert.equal(a.signal().status,'promoted');assert.equal(b.signal().status,'new');
 const job=(await a.job()).json.job;assert.equal(job.application.draft.guidance,'Use only recorded office work.');assert.equal(job.board.workflow.mode,'review');assert.ok(job.board.workflowEnteredAt);
 assert.equal(starts.length,n+1);assert.equal(starts.at(-1)[1],a.sub);assert.deepEqual(starts.at(-1)[2],['prepare-saved']);
});
test('automatic saved jobs queue once, disabling stops future work, and removed/applied jobs stay untouched',async()=>{
 const a=fixture();await settings(a,'automatic');const n=starts.length;await save(a);await save(a);assert.equal(starts.length,n+1);assert.equal(a.signal().status,'promoted');
 await settings(a,'review',false);const b=fixture();await settings(b,'review',false);await save(b);assert.equal(b.signal().status,'new');
 const c=fixture();await save(c);await c.call('POST','/jobs/1/status',{favorite:false});await settings(c,'automatic');assert.equal(c.signal().status,'new');
 const d=fixture(),sql=new Database(d.paths.userDb);sql.exec("UPDATE user_signals SET status='applied'");sql.close();await save(d);await settings(d,'automatic');assert.equal(d.signal().status,'applied');
});
test('review mode holds exact current documents until an explicit review writer acknowledges them',async()=>{
 const f=fixture();await settings(f);await save(f);complete(f);let j=(await f.job()).json.job;
 assert.equal(j.application.workflow.state,'review');assert.equal(j.application.workflow.ready,false);assert.ok(j.application.workflow.proof);
 const result=await f.call('POST','/jobs/1/status',{applicationReview:{proof:j.application.workflow.proof}});assert.equal(result.status,200);
 j=(await f.job()).json.job;assert.equal(j.application.workflow.state,'ready');assert.equal(f.signal().status,'generated');assert.equal(f.signal().applied_at,null);
});
test('automatic mode ends at ready with employer link and creates no submission intent',async()=>{
 const f=fixture();await settings(f,'automatic');await save(f);complete(f);const j=(await f.job()).json.job;
 assert.equal(j.application.workflow.state,'ready');assert.equal(j.application.workflow.ready,true);assert.equal(j.application.intent,null);assert.equal(j.url,'https://employer.example.test/opening/1');assert.equal(f.signal().status,'generated');assert.equal(f.signal().applied_at,null);
});
test('stale review or changed document bytes cannot retain readiness or approve another packet',async()=>{
 const f=fixture();await settings(f);await save(f);complete(f);const old=(await f.job()).json.job.application.workflow.proof;
 writeFileSync(join(f.paths.userDir,'resume.pdf'),'%PDF-1.4 changed fictional bytes');assert.equal((await f.call('POST','/jobs/1/status',{applicationReview:{proof:old}})).status,409);
 let j=(await f.job()).json.job;await f.call('POST','/jobs/1/status',{applicationReview:{proof:j.application.workflow.proof}});
 writeFileSync(join(f.paths.userDir,'cover.pdf'),'%PDF-1.4 changed cover');j=(await f.job()).json.job;assert.equal(j.application.workflow.state,'review');assert.equal(j.application.workflow.ready,false);
 const fresh=j.application.workflow.proof;assert.equal((await f.call('POST','/jobs/1/status',{draft:{revision:j.application.draft.revision,guidance:'Changed priorities.',experienceIds:j.application.draft.experienceIds,experienceRevision:j.application.draft.experienceRevision}})).status,200);
 assert.equal((await f.call('POST','/jobs/1/status',{applicationReview:{proof:fresh}})).status,409);
});
test('dispatch refusal retains Getting ready with a reason and never retries on save or read',async()=>{
 const f=fixture();await settings(f,'automatic');const n=starts.length;refusal=true;try{await save(f);}finally{refusal=false;}
 let j=(await f.job()).json.job;assert.equal(j.status,'promoted');assert.equal(j.application.workflow.state,'stuck');assert.match(j.application.workflow.reason,/could not start/i);
 await save(f);await f.job();assert.equal(starts.length,n+1);
});
test('failed and interrupted preparation remain unready with reasons; unavailable posting cannot be ready',async()=>{
 const f=fixture();await settings(f,'automatic');await save(f);board.updateBoardState(f.paths.userDir,1,{phase:'failed',error:'resume_required',completedAt:new Date().toISOString()});
 let j=(await f.job()).json.job;assert.equal(j.application.workflow.state,'stuck');assert.match(j.application.workflow.reason,/résumé/i);
 board.updateBoardState(f.paths.userDir,1,{phase:'generating',completedAt:null,error:null});j=(await f.job()).json.job;assert.equal(j.application.workflow.ready,false);assert.match(j.application.workflow.reason,/interrupted|refresh|progress/i);
 complete(f);const sql=new Database(f.paths.corpusDb);sql.exec('UPDATE postings_corpus SET active=0 WHERE id=1');sql.close();j=(await f.job()).json.job;assert.equal(j.application.workflow.state,'stuck');assert.match(j.application.workflow.reason,/posting/i);
});

let browser;
async function screen(f,file,query=''){
 browser??=await playwright().chromium.launch({headless:true});const context=await browser.newContext(file.size||DESKTOP),requests=[];
 await context.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());assert.equal(url.origin,'http://workflow.fixture.test','no employer page or real service is fetched');
  const p=url.pathname;let response;
  if(p==='/screen')return route.fulfill({contentType:'text/html',body:readFileSync(new URL('../tools/'+file.name,import.meta.url),'utf8')});
  if(p.startsWith('/api/career-hunter/static/')){try{return route.fulfill({contentType:p.endsWith('.css')?'text/css':'application/javascript',body:readFileSync(new URL('../tools/'+p.split('/').at(-1),import.meta.url),'utf8')});}catch{}}
  if(p.startsWith('/shared/'))return route.fulfill({contentType:p.endsWith('.css')?'text/css':'application/javascript',body:''});
  const path=p.replace('/api/career-hunter','');let body;try{body=r.postDataJSON();}catch{}
  requests.push({method:r.method(),path,body});
  if(path==='/resume')return route.fulfill({contentType:'text/html',body:'<p>Fictional document preview</p>'});
  if(router.find(r.method(),path)){response=await f.call(r.method(),path+url.search,body);}
  else response={status:200,json:path==='/run/refresh'?{refreshMode:'installation-managed',manualRefreshAvailable:false}:path==='/resume/state'?{hasResume:true}:path==='/title-profile/state'?{titleTerms:[],searchScope:{}}:p==='/api/v1/agent/schedules'?{schedules:[]}:path==='/submission-queue'?{items:[]}:path==='/companies-admin'?{error:'forbidden'}:{}};
  await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.json)});
 });
 const page=await context.newPage();page.setDefaultTimeout(8000);await page.goto('http://workflow.fixture.test/screen'+query);return {page,context,requests};
}
for(const [device,size]of [['phone',PHONE],['desktop',DESKTOP]])test(device+': actual Settings saves explicit choices through original-owner writer without enabling submission',async()=>{
 const f=fixture(),out=await screen(f,{name:'career-settings.html',size},'#refresh');const {page,context,requests}=out;
 try{
  assert.equal(await page.locator('#workflowEnabled').count(),1);await page.locator('#workflowEnabled').waitFor();
  assert.equal(await page.locator('#workflowEnabled').isChecked(),false);await page.getByLabel('Prepare saved jobs for me').check();
  await page.getByLabel('Let Career finish preparation by itself').check();await page.getByRole('button',{name:'Save preparation choice'}).click();
  await page.waitForFunction(()=>document.getElementById('workflowState').textContent.includes('Saved'));
  assert.deepEqual((await f.call('GET','/application-workflow')).json,{enabled:true,mode:'automatic'});
  assert.ok(requests.every(r=>!r.path.startsWith('/submission-queue')||r.method==='GET'));
  assert.match(await page.locator('#applicationWorkflow').innerText(),/does not send.*employer/is);
 }finally{await context.close();}
});
test('application document review crosses the real review writer and shows ready plus employer link, never submission',async()=>{
 const f=fixture();assert.equal((await settings(f)).status,200);await save(f);complete(f);
 const {page,context,requests}=await screen(f,{name:'career-application.html'},'?application=1');
 try{
  await page.waitForFunction(()=>document.getElementById('application').getAttribute('aria-busy')==='false');
  assert.match(await page.locator('#application').innerText(),/Review the documents/,JSON.stringify(requests));
  await page.getByRole('button',{name:'Review complete · ready to submit'}).click();
  await page.waitForFunction(()=>document.getElementById('applicationState').textContent.includes('Ready to submit'));
  assert.equal((await f.job()).json.job.application.workflow.state,'ready');
  assert.equal(await page.locator('#workflowEmployer').getAttribute('href'),'https://employer.example.test/opening/1');
  assert.match(await page.locator('#workflowNotice').innerText(),/does not send.*employer/is);
  assert.ok(requests.filter(r=>r.method==='POST').every(r=>r.path==='/jobs/1/status'&&r.body.applicationReview));
 }finally{await context.close();}
});

test('unavailable employer links and closed postings stay in Getting ready without starting a batch',async()=>{
 for(const update of ["url='javascript:alert(1)'","active=0"]){const f=fixture();await save(f);const d=new Database(f.paths.corpusDb);d.exec('UPDATE postings_corpus SET '+update+' WHERE id=1');d.close();const n=starts.length;await settings(f,'automatic');assert.equal(starts.length,n);const j=(await f.job()).json.job;assert.equal(j.status,'promoted');assert.equal(j.application.workflow.state,'stuck');assert.match(j.application.workflow.reason,/link|posting/i);}
});
test('explicit Prepare on an already automated packet preserves its completed receipt',async()=>{
 const f=fixture();await settings(f,'automatic');await save(f);complete(f);const n=starts.length;
 await f.call('POST','/jobs/1/status',{status:'promoted',favorite:true});const j=(await f.job()).json.job;
 assert.equal(j.application.workflow.state,'ready');assert.ok(j.board.completedAt);assert.equal(starts.length,n);
});
test('unsafe or unreadable preference files never start work or undo an acknowledged favorite',async()=>{
 const f=fixture();writeFileSync(join(f.paths.userDir,'application-workflow.json'),'broken fixture JSON');const n=starts.length;
 assert.equal((await f.call('GET','/application-workflow')).status,503);assert.equal((await save(f)).status,200);assert.equal(starts.length,n);assert.equal((await f.job()).json.job.favorite,true);
});

test('Getting ready shows the real writer’s stopped-job reason on the actual list',async()=>{
 const f=fixture();await settings(f,'automatic');refusal=true;try{await save(f);}finally{refusal=false;}
 const feed=await f.call('GET','/jobs?status=queue&current=1');assert.equal(feed.status,200);assert.equal(feed.json.jobs[0].preparation.state,'stuck');
 const {page,context}=await screen(f,{name:'career-job-lists.html'},'?view=queue');
 try{await page.locator('.job-row').first().waitFor();assert.match(await page.locator('.job-row').first().innerText(),/could not start/i);}
 finally{await context.close();}
});

test('promotion tool without a favorite field honors the owner’s preparation choice',async()=>{
 const f=fixture();await settings(f,'automatic');const n=starts.length;
 await f.call('POST','/jobs/1/status',{status:'promoted'});assert.equal(starts.length,n+1);assert.equal((await f.job()).json.job.board.workflow.mode,'automatic');
});
