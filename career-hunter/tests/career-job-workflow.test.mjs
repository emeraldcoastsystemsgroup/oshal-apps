/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise private stars, exact workflow feeds, shared UI actions and conservative read-only application-email matching with real SQLite.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Run actual card refresh helpers to retain typed text, update fit evidence and avoid duplicate document links after preparation.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Save only persists the favorite; explicit fit and document actions keep their existing separate payloads.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
const require=createRequire(import.meta.url),state=require('../lib/career-board-state'),mail=require('../lib/career-email-updates');
const {fetchBoardPage}=require('../routes/career-board-feed');
const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8');
function database(){const db=new DatabaseSync(':memory:');db.exec("ATTACH DATABASE ':memory:' AS corpus");for(const name of ['CORPUS_SCHEMA','USER_SCHEMA'])db.exec(engine.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1]);return db;}
function seed(db){db.exec(`INSERT INTO corpus.companies(id,name)VALUES(1,'Fixture Employer');INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role,remote,state,posted_date)VALUES(1,1,'req-100','Platform Engineer','Python',0,0,0,'CA','2025-01-01');INSERT INTO user_signals(posting_id,status,applied_at)VALUES(1,'applied','2026-10-26T00:00:00Z');`);}
test('private stars persist independently of status and refuse unsafe files',()=>{
 const a=mkdtempSync(join(tmpdir(),'career-star-')),b=mkdtempSync(join(tmpdir(),'career-star-'));
 try{state.updateBoardState(a,12,{favorite:true,savedAt:'now'});assert.deepEqual(state.favoriteIds(state.readBoardState(a)),[12]);assert.deepEqual(state.favoriteIds(state.readBoardState(b)),[]);state.updateBoardState(a,12,{phase:'ready'});assert.equal(state.decorateJob(state.readBoardState(a),{id:12,status:'generated'}).favorite,true);state.updateBoardState(a,12,{favorite:false});assert.deepEqual(state.favoriteIds(state.readBoardState(a)),[]);assert.throws(()=>state.updateBoardState(a,-1,{}));symlinkSync(join(a,'job-board-state.json'),join(b,'job-board-state.json'));assert.throws(()=>state.readBoardState(b));}finally{rmSync(a,{recursive:true});rmSync(b,{recursive:true});}
});
test('chosen workflow jobs remain visible without a score, active corpus flag, geographic match or target lane',()=>{
 const db=database();try{seed(db);db.exec("UPDATE user_signals SET status='promoted'");const scope={version:1,near:'Destin, FL',lat:30,lon:-86,radiusMiles:50,includeRemote:true};assert.equal(fetchBoardPage(db,{status:'queue'},scope).jobs[0].id,1);assert.equal(fetchBoardPage(db,{status:'saved'},scope,[1]).jobs[0].id,1);assert.deepEqual(fetchBoardPage(db,{status:'saved'},scope,[]).jobs,[]);assert.deepEqual(fetchBoardPage(db,{},scope).jobs,[]);db.exec("UPDATE user_signals SET status='rejected'");assert.equal(fetchBoardPage(db,{status:'tracked'},scope).jobs[0].status,'rejected');assert.equal(fetchBoardPage(db,{status:'queue'},scope).jobs.length,0);}finally{db.close();}
});
const jobs=[{id:1,title:'Platform Engineer',company:'Fixture Employer',status:'applied',applied_at:'2026-10-26 00:00:00'}];
function message(text,date='2026-10-26T12:00:00Z'){return {id:'m1',threadId:'t1',internalDate:String(Date.parse(date)),payload:{headers:[{name:'Subject',value:text}]}};}
test('email matching requires exact employer and title, a submitted date and an unambiguous application',()=>{
 const m=message('Fixture Employer Platform Engineer — interview invitation');assert.equal(mail.match(m,jobs).kind,'interview');assert.equal(mail.match(m,jobs).postingId,1);assert.equal(mail.match(m,[...jobs,{...jobs[0],id:2}]).needsReview,true);assert.equal(mail.match(message('Other Employer Platform Engineer — interview invitation'),jobs),null);assert.equal(mail.match(message('Fixture Employer Other Engineer — interview invitation'),jobs),null);assert.equal(mail.match(message('Fixture Employer Platform Engineer interview invitation','2026-10-01'),jobs),null);assert.equal(mail.match(message('Fixture Employer Platform Engineer weekly newsletter'),jobs),null);
 for(const [text,kind]of [['Thank you for applying','acknowledged'],['not moving forward','rejected'],['offer letter','offer']])assert.equal(mail.match(message('Fixture Employer Platform Engineer '+text),jobs).kind,kind);
});
test('monitor never sends mail; retries and page cursors retain unseen messages and update only one original-owner status',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'career-mail-')),db=database();seed(db);writeFileSync(join(dir,'career_db.json'),JSON.stringify({profile:{email:'applicant@example.test'}}));const calls=[];
 const messages={a:message('Fixture Employer Platform Engineer interview invitation'),b:message('Unrelated newsletter'),c:message('Fixture Employer Platform Engineer offer letter')};
 const fetcher=async(url,options)=>{calls.push([url,options]);let data;if(url.endsWith('profile'))data={emailAddress:'applicant@example.test'};else if(url.includes('/messages/')){const id=url.split('/messages/')[1].split('?')[0];data={...messages[id],id};}else data={messages:[{id:'a'},{id:'b'},{id:'c'}]};return {ok:true,json:async()=>data};};
 try{const first=await mail.check(dir,db,fetcher,Date.parse('2026-10-27T00:00:00Z'));assert.equal(first.pending,true);assert.equal(db.prepare('SELECT status FROM user_signals').get().status,'interview');assert.equal(mail.read(dir).pendingIds[0],'c');await mail.check(dir,db,fetcher,Date.parse('2026-10-27T00:15:00Z'));assert.equal(db.prepare('SELECT status FROM user_signals').get().status,'offer');assert.equal(mail.read(dir).events.length,2);assert.ok(calls.every(([,o])=>o.method==='GET'));assert.equal(db.prepare('SELECT count(*) AS n FROM corpus.postings_corpus').get().n,1);
 const bad=async()=>({ok:true,json:async()=>({emailAddress:'wrong@example.test'})});const result=await mail.check(dir,db,bad);assert.equal(result.status,'unavailable');assert.match(result.error,/match the submission email/);assert.equal(db.prepare('SELECT status FROM user_signals').get().status,'offer');
 }finally{db.close();rmSync(dir,{recursive:true});}
});
test('Save only persists favorite; fit and document preparation each require an explicit action',async()=>{
 const calls=[];const context={window:{},crypto:{randomUUID:()=> 'fixture-request-123'},fetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({ok:true,requestId:'fixture-request-123'})};},setTimeout,clearTimeout};vm.runInNewContext(readFileSync(new URL('../tools/career-job-actions.js',import.meta.url),'utf8'),context);
 const saved=await context.window.CareerJobActions.save(1);assert.equal(saved.saved,true);assert.equal(calls[0][1].favorite,true);assert.equal(calls.length,1,'Save starts no scoring work');
 await context.window.CareerJobActions.promote(1);assert.equal(calls[1][1].status,'promoted');assert.equal(calls.length,2,'promotion does not generate documents');
 await context.window.CareerJobActions.prepare(1,false);assert.equal(calls[2][1].documents,false);assert.equal(calls.length,3,'only the explicit fit action starts scoring');
 await context.window.CareerJobActions.prepare(1,true,{guidance:'Emphasize teaching'});assert.equal(calls[3][1].documents,true);assert.equal(calls[3][1].guidance,'Emphasize teaching');assert.ok(calls.every(([url])=>url.startsWith('/api/career-hunter/')));
});

test('employer-detail refusals explain the next action rather than suggesting an unchanged retry',()=>{
 const context={window:{}};vm.runInNewContext(readFileSync(new URL('../tools/career-job-actions.js',import.meta.url),'utf8'),context);
 const message=context.window.CareerJobActions.message;
 assert.match(message('job_context_too_large'),/too large.*original posting/);
 assert.match(message('job_context_unavailable'),/could not be verified.*original posting/);
 assert.match(message('job_context_limit_reached'),/storage is full.*expire automatically/);
 assert.match(message('model_identity_unavailable'),/configuration could not be verified/);
 assert.match(message('model_identity_mismatch'),/model changed.*retry/);
});

test('check-now uses the original-person native schedule before reading durable mailbox status',async()=>{
 const calls=[];const context={window:{},fetch:async(url,options)=>{calls.push([url,options?.method||'GET']);let result=url==='/api/v1/agent/schedules'?{schedules:[{id:'mail-schedule',app:'career-hunter',name:'career-application-updates',status:'active'}]}:url.endsWith('/updates')?{status:'connected',mailbox:'fixture@example.test'}:{ok:true};return {ok:true,json:async()=>result};},setTimeout,clearTimeout};
 vm.runInNewContext(readFileSync(new URL('../tools/career-job-actions.js',import.meta.url),'utf8'),context);
 const result=await context.window.CareerJobActions.monitor(true);assert.equal(result.active,true);assert.equal(result.mail.status,'connected');
 assert.deepEqual(calls.map(c=>c[0]),['/api/v1/agent/schedules','/api/v1/agent/schedules/mail-schedule/activate','/api/v1/agent/schedules/mail-schedule/trigger','/api/career-hunter/jobs/updates']);assert.ok(!calls.some(([url])=>url==='/api/career-hunter/jobs/updates/check'));
});

test('mail checks avoid the half-hour matching start and resolve credentials inside the admitted route',()=>{
 const manifest=readFileSync(new URL('../oshal-app.yaml',import.meta.url),'utf8');const block=manifest.split('  - id: career-application-updates')[1].split('  - id: career-nightly-matches')[0];assert.match(block,/cron: "7,22,37,52 \* \* \* \*"/);assert.doesNotMatch(block,/uses:.*connections/);assert.match(block,/route: \/api\/career-hunter\/jobs\/updates\/check/);
});

// Actual scoring, open preparation and unsent text retention are exercised in
// browser/career-application-flow-proof.mjs against the complete shipped document.
