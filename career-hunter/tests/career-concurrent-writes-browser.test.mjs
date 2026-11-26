/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-CONCURRENT (Roger, 2026-11-25: "when im batch running resumes and trying to look for jobs i cant post them .. hit save... ect.."): while a résumé is being written, Save on Find jobs and the notes on a job's page land by themselves once it finishes, in Chromium at 1440x900 and 412x915. The shipped pages run against the COMPILED Career routes and the real Python engine for a made-up person (tests/helpers/career-concurrent-fixture.mjs); the engine's model calls are held so the résumé is being written for as long as the test says. The one thing stood in is the native kernel's rule for that time (crates/host-process/src/host/career.rs career_busy, guarded by the kernel's package_background_runs suite): every other change of the person's is answered 409 career_run_in_progress before Career runs it. Red before the change: the press said "Career is working on your account. Try saving again when it finishes." and nothing was saved. Green: the page says it is waiting, the change reaches Career only after the résumé is written, it is in the person's store, and the page says Saved.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {playwright,tools,ORIGIN,PHONE,DESKTOP} from './helpers/ux-page.mjs';
import {concurrentHarness,JOBS} from './helpers/career-concurrent-fixture.mjs';

const API='/api/career-hunter';
const WAITING=/^Saving — waiting for the résumé being written now\./;
let browser,h;
before(async()=>{browser=await playwright().chromium.launch({headless:true});h=await concurrentHarness();});
after(async()=>{await browser?.close();await h?.stop();});

const entries=[['home','home'],['board','board-native'],['search','search-ui']]
 .map(([view,file])=>({id:'tool-career-'+view,label:view,toolUi:{iframeUrl:'/api/career-hunter/'+file,visibilityToolName:'career-'+view}}));
/** The jobs Find jobs lists: the made-up corpus, none saved yet. */
const listed=(saved=false)=>JOBS.slice(1).map(([id,company,title])=>({id,company,title,location:'Springfield, IL',status:'new',active:1,favorite:saved,ai_fit_score:80,
 url:'https://example.invalid/jobs/'+id,description:'A real description.',...(saved?{board:{favorite:true,savedAt:'2026-11-25T15:00:00Z'}}:{})}));

/**
 * @description One shipped Career page for a made-up person. Its changes and job reads go to the real routes, through the
 * kernel's rule while a run holds the person's files; the list it shows and the platform files are stood in.
 * @returns {Promise<{page:object,context:object,seen:object[]}>} seen: every change that reached the routes or was refused.
 */
async function open(sub,size,file,path,query=''){
 const seen=[],context=await browser.newContext({...size,locale:'en-US',timezoneId:'UTC'});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method(),json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin!==ORIGIN)return route.abort();
  if(p===path)return route.fulfill({status:200,contentType:'text/html',body:readFileSync(join(tools,file))});
  const asset=p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if(asset)return existsSync(join(tools,asset[1]))?route.fulfill({status:200,contentType:asset[1].endsWith('.css')?'text/css':'application/javascript',body:readFileSync(join(tools,asset[1]))}):route.fulfill({status:404,body:''});
  if(/^\/(shared|cockpit|ui)\//.test(p))return route.fulfill({status:200,contentType:p.endsWith('.css')?'text/css':'application/javascript',body:''});
  if(p==='/api/ui/profile')return json({profile:{ribbon:{items:entries}}});
  if(p==='/api/auth/user')return json({authenticated:true,sub,tenant:'tenant-1',principal_id:sub,displayName:'Sample Candidate'});
  if(p==='/api/guest/session')return json({guest:false});
  const change=method!=='GET'&&p.startsWith(API+'/')&&!p.endsWith('/search-memory');
  if(change){
   const run=h.holds(sub);
   seen.push({method,path:p,body:JSON.parse(req.postData()||'null'),at:Date.now(),refused:!!run});
   // The native kernel, while a background run of the person's holds their Career files: refused before Career runs it.
   if(run)return json({error:'career_run_in_progress',runId:run.requestId},409);
  }
  if(change||/^\/api\/career-hunter\/jobs\/\d+$/.test(p)||p===`${API}/experience-bank`){
   const answer=await h.call(sub,method,p+url.search,method==='GET'?undefined:JSON.parse(req.postData()||'{}'));
   return route.fulfill({status:answer.status,contentType:answer.type,body:answer.bytes});
  }
  if(p===`${API}/browse`)return json({jobs:listed(),total:listed().length,page:1,per:25,exhausted:true});
  if(p===`${API}/jobs`)return json({jobs:listed(true),exhausted:true,exclusions:[],home:{known:true,label:'Springfield, IL',radiusMiles:50,line:'',settingsUrl:`${API}/settings`}});
  if(p===`${API}/jobs/stats`)return json({saved:0,matches:listed().length,queued:0,tracked:0,byStatus:[]});
  if(p===`${API}/resume/state`)return json({hasResume:true,roles:1,indexing:false,scored:1});
  if(p===`${API}/apply-runs`)return json({runs:[]});
  if(p.endsWith('/search-memory'))return json({stored:true,last:null,saved:[]});
  return json({});
 });
 const page=await context.newPage();
 page.errors=[];page.on('pageerror',error=>page.errors.push(error.message));
 await page.goto(ORIGIN+path+query,{waitUntil:'load'});
 return {page,context,seen};
}
const press=(size,target)=>(size===PHONE?target.tap():target.click());
const fits=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
const pending=page=>page.locator('.career-pending-writes');
/** Wait for `done` in real time (the engine runs in real time). */
async function until(done,most=120){for(let i=0;i<most;i+=1){if(await done())return true;await new Promise(resolve=>setTimeout(resolve,250));}return done();}

for(const [label,size] of [['computer',DESKTOP],['phone',PHONE]]){
 test(`${label}: Save on Find jobs while a résumé is being written waits, then lands by itself`,{timeout:180000},async()=>{
  const sub=`concurrent-save-${label}`;h.person(sub);
  h.rail.hold();
  const started=await h.generate(sub,401);
  assert.equal(started.status,202,'the résumé for 401 is being written');
  assert.ok(await until(()=>h.rail.calls>0&&h.rail.waiting.length>0),'the engine is in a model call');
  const {page,context,seen}=await open(sub,size,'career-search.html',`${API}/search-ui`);
  try{
   const save=page.locator('[data-save-job="402"]');
   await save.waitFor();
   await press(size,save);
   const said=()=>page.locator('#searchStatus').innerText().catch(()=>'');
   await until(async()=>(await pending(page).count())>0||/\S/.test(await said()),40);
   assert.equal(await said(),'','no "try again" for the person to act on');
   await pending(page).getByText(WAITING).waitFor({timeout:8000});
   assert.ok(await fits(page),'the waiting line fits the screen');
   assert.equal(await save.innerText(),'Saving…','the press is still saving, not refused');
   assert.ok(seen.some(change=>change.path===`${API}/jobs/402/status`&&change.refused),'the kernel refused it while the résumé is written');
   assert.notEqual(h.board(sub)['402']?.favorite,true,'nothing is written while the run holds the files');
   await page.waitForTimeout(6000);
   assert.ok(seen.filter(change=>change.path===`${API}/jobs/402/status`).every(change=>change.refused),'it is tried again and refused while the run holds the files');
   h.rail.release();
   assert.ok(await until(()=>!h.holds(sub)),'the résumé is written');
   await page.getByRole('button',{name:'Saved',exact:true}).waitFor({timeout:20000});
   await pending(page).getByText('Saved.',{exact:true}).waitFor({timeout:5000});
   assert.equal(h.board(sub)['402']?.favorite,true,'the Save is in the person’s store');
   assert.equal(h.board(sub)['401']?.phase,'ready','the résumé that was being written is kept as written');
   const landed=seen.filter(change=>change.path===`${API}/jobs/402/status`&&!change.refused);
   assert.equal(landed.length,1,'it reached Career once, after the run');
   assert.deepEqual(landed[0].body,{favorite:true});
   assert.deepEqual(page.errors,[]);
   assert.ok(await fits(page));
  }finally{h.rail.release();await until(()=>!h.holds(sub));await context.close();}
 });
}

/** Hold a résumé for 401 in a model call, as the batch does, and open the page. */
async function writing(sub){
 h.person(sub);h.rail.hold();
 const started=await h.generate(sub,401);
 assert.equal(started.status,202,'the résumé for 401 is being written');
 assert.ok(await until(()=>h.rail.calls>0&&h.rail.waiting.length>0),'the engine is in a model call');
}
/** Let the résumé finish and wait until Career's run of it has ended. */
async function finish(sub){h.rail.release();assert.ok(await until(()=>!h.holds(sub)),'the résumé is written');assert.equal(h.board(sub)['401']?.phase,'ready');}

for(const [label,size] of [['computer',DESKTOP],['phone',PHONE]]){
 test(`${label}: notes typed on a job's page while a résumé is being written save by themselves once it is written`,{timeout:180000},async()=>{
  const sub=`concurrent-notes-${label}`;await writing(sub);
  const {page,context,seen}=await open(sub,size,'career-application.html',`${API}/board-native`,'?view=queue&application=403');
  try{
   const field=page.locator('#guidance');await field.waitFor();
   await field.fill('Lead with running the front office and the books.');
   await pending(page).getByText(WAITING).waitFor({timeout:8000});
   assert.equal(await page.locator('#draftState').innerText(),'Saving draft…','the draft is still saving, not refused');
   assert.equal(await page.locator('#message').innerText(),'','no "try again" for the person to act on');
   assert.equal(await field.inputValue(),'Lead with running the front office and the books.');
   assert.ok(await fits(page));
   await page.waitForTimeout(3000);
   assert.ok(seen.filter(change=>change.path===`${API}/jobs/403/status`).every(change=>change.refused),'nothing reaches Career while the run holds the files');
   await finish(sub);
   await page.locator('#draftState').getByText('Draft saved to your account',{exact:true}).waitFor({timeout:20000});
   await pending(page).getByText('Saved.',{exact:true}).waitFor({timeout:5000});
   const landed=seen.filter(change=>change.path===`${API}/jobs/403/status`&&!change.refused);
   assert.equal(landed.length,1,'one draft write after the run');
   assert.equal(landed[0].body.draft.guidance,'Lead with running the front office and the books.');
   const kept=JSON.parse((await h.call(sub,'GET',`${API}/jobs/403`)).bytes.toString('utf8')).job.application.draft;
   assert.equal(kept.guidance,'Lead with running the front office and the books.','the notes are in the person’s store');
   assert.deepEqual(page.errors,[]);
  }finally{h.rail.release();await until(()=>!h.holds(sub));await context.close();}
 });
 test(`${label}: Remove on My jobs while a résumé is being written lands by itself once it is written`,{timeout:180000},async()=>{
  const sub=`concurrent-remove-${label}`;await writing(sub);
  const {page,context,seen}=await open(sub,size,'career-job-lists.html',`${API}/board-native`,'?view=saved');
  try{
   const remove=page.locator('[data-remove-pick="404"]');await remove.waitFor();
   await press(size,remove);
   await pending(page).getByText(WAITING).waitFor({timeout:8000});
   assert.ok(await fits(page));
   assert.doesNotMatch(await page.locator('#actionState').innerText(),/Try|working on your account/,'no "try again" for the person to act on');
   await finish(sub);
   await pending(page).getByText('Saved.',{exact:true}).waitFor({timeout:20000});
   const landed=seen.filter(change=>change.path===`${API}/jobs/404/status`&&!change.refused);
   assert.equal(landed.length,1,'one status write after the run');
   assert.deepEqual(landed[0].body,{status:'dismissed',favorite:false});
   assert.equal(h.rows(sub).find(row=>row.posting_id===404)?.status,'dismissed','the job is removed in the person’s store');
   assert.equal(await page.locator('[data-remove-pick="404"]').count(),0,'the job stays off the list');
   assert.deepEqual(page.errors,[]);
  }finally{h.rail.release();await until(()=>!h.holds(sub));await context.close();}
 });
}
