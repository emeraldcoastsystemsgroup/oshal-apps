/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN (Roger, 2026-11-21: 200 applications by Monday; his open jobs need Generate résumé & cover letter again, one action, not 251 presses): Generate again on the shipped My jobs page (tools/career-job-lists.html) in Chromium at 1440x900 and 412x915. Every Generate again call goes to Career's real routes and engine (tests/helpers/career-regenerate-fixture.mjs) on a made-up person's real store; the job list, the person and the platform's schedules are stood in. Proved: the panel counts his open jobs with older documents; jobs selected in the List give Generate again (N) in the bar, whose one confirmation says the words and Cancel queues nothing; Select all with older documents selects exactly those jobs and Generate again (N) queues them and turns on his career-regenerate background job; the panel shows done, left and failed and the job being written, and Pause, Go on and Stop; a reload keeps the queue; nothing is wider than the screen. Red on store main 1ac6e2fd: My jobs has no Generate again panel.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {playwright,tools,ORIGIN,PHONE,DESKTOP} from './helpers/ux-page.mjs';
import {regenerateHarness} from './helpers/career-regenerate-fixture.mjs';

const API='/api/career-hunter';
const CONFIRM=n=>`Career makes new documents for ${n} jobs, one after another, in the background. Each takes about a minute. Your notes and choices for each job are kept.`;
let browser,h;
before(async()=>{browser=await playwright().chromium.launch({headless:true});h=await regenerateHarness();});
after(async()=>{await browser?.close();await h?.stop();});

/**
 * @description My jobs (Getting ready) for one made-up person: Generate again goes to the real routes, the rest is stood in.
 * @returns {Promise<{page:object,context:object,platform:{activated:object[],status:string}}>}
 */
async function open(sub,size){
 const platform={activated:[],status:'not-activated'},context=await browser.newContext({...size,locale:'en-US',timezoneId:'UTC'}),jobs=h.listJobs();
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin!==ORIGIN)return route.abort();
  if(p===`${API}/board-native`)return route.fulfill({status:200,contentType:'text/html',body:readFileSync(join(tools,'career-job-lists.html'))});
  const asset=p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if(asset&&existsSync(join(tools,asset[1])))return route.fulfill({status:200,contentType:asset[1].endsWith('.css')?'text/css':'application/javascript',body:readFileSync(join(tools,asset[1]))});
  if(p.startsWith(`${API}/regenerate`)){
   const answer=await fetch(h.origin+p+url.search,{method:req.method(),headers:{'content-type':'application/json','x-test-person':sub},body:req.postData()||undefined});
   return route.fulfill({status:answer.status,contentType:'application/json',body:Buffer.from(await answer.arrayBuffer())});
  }
  if(p==='/api/v1/agent/schedules')return json({schedules:[{id:'sched-regen',app:'career-hunter',name:'career-regenerate',status:platform.status}]});
  if(p==='/api/v1/agent/schedules/sched-regen/activate'){platform.activated.push(JSON.parse(req.postData()||'{}'));platform.status='active';return json({status:'active'});}
  if(/^\/(shared|cockpit|ui)\//.test(p))return route.fulfill({status:200,contentType:p.endsWith('.css')?'text/css':'application/javascript',body:''});
  if(p==='/api/auth/user')return json({authenticated:true,sub,tenant:'tenant-1',principal_id:sub});
  if(p==='/api/guest/session')return json({guest:false});
  if(p===`${API}/jobs`)return json({jobs,exhausted:true,exclusions:[],home:{known:true,label:'Springfield, IL',radiusMiles:50,line:'',settingsUrl:`${API}/settings`}});
  if(p===`${API}/jobs/stats`)return json({saved:jobs.length,byStatus:[]});
  if(p===`${API}/resume/state`)return json({hasResume:true,roles:1,indexing:false});
  if(p===`${API}/experience-bank`)return json({version:1,revision:'r1',entries:[]});
  if(p===`${API}/apply-batch`)return json({queue:null});
  return json({});
 });
 const page=await context.newPage();
 await page.clock.install();
 await page.goto(`${ORIGIN}${API}/board-native?view=queue`,{waitUntil:'load'});
 return {page,context,platform};
}
const press=(size,target)=>(size===PHONE?target.tap():target.click());
const fits=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
const panel=page=>page.locator('#regenerate');
/** Move the page's time on (the panel moves the queue every five seconds) until `done` answers truthy; the engine runs in real time. */
async function until(page,done,most=150){
 for(let i=0;i<most;i+=1){if(await done())return true;await page.clock.runFor(5000);await new Promise(resolve=>setTimeout(resolve,250));}
 return done();
}
const heading=page=>panel(page).locator('#regenerateTitle').innerText();
const counts=page=>panel(page).locator('#regenerateCounts').innerText();
const queueOf=sub=>fetch(h.origin+'/api/career-hunter/regenerate',{headers:{'x-test-person':sub}}).then(r=>r.json()).then(r=>r.queue);

for(const [label,size] of [['computer',DESKTOP],['phone',PHONE]]){
 test(`${label}: select jobs or Select all with older documents, confirm once, and Generate again runs, pauses, goes on and stops`,{timeout:600000},async()=>{
  const sub=`regen-page-${label}`;h.person(sub);
  const {page,context,platform}=await open(sub,size);
  try{
   await panel(page).getByText('Documents from an earlier Career').waitFor();
   assert.equal(await panel(page).locator('#regenerateOlder').innerText(),
    '3 of your open jobs have a résumé and cover letter made before this version of Career ('+(await (await fetch(h.origin+'/api/career-hunter/regenerate/older',{headers:{'x-test-person':sub}})).json()).version+'), or without the résumé for upload forms.');
   assert.ok(await fits(page),'nothing is wider than the screen');
   // Jobs he selects in the List.
   await page.locator('[data-job-id="204"] [data-select]').waitFor();
   for(const id of [201,204])await press(size,page.locator(`[data-job-id="${id}"] [data-select]`));
   await page.locator('#bulkBar').getByText('2 selected').waitFor();
   assert.deepEqual(await page.locator('#bulkBar .jt-actions button').allInnerTexts(),['Generate again (2)'],'the List offers Generate again for the jobs with documents');
   await press(size,page.locator('#bulkBar').getByRole('button',{name:'Generate again (2)'}));
   let sheet=page.getByRole('dialog',{name:'Generate again for 2 jobs?'});
   await sheet.waitFor();
   assert.equal(await sheet.locator('.rg-confirm').innerText(),CONFIRM(2));
   await press(size,sheet.getByRole('button',{name:'Cancel'}));
   await page.getByText('Nothing was generated again.').waitFor();
   assert.equal(await queueOf(sub),null,'Cancel queues nothing');
   await press(size,page.locator('#bulkBar [data-bulk="clear"]'));
   // Select all with older documents.
   await press(size,panel(page).getByRole('button',{name:'Select all with older documents'}));
   await panel(page).getByText('3 jobs with older documents are selected.').waitFor();
   await press(size,panel(page).getByRole('button',{name:'Generate again (3)'}));
   sheet=page.getByRole('dialog',{name:'Generate again for 3 jobs?'});
   await sheet.waitFor();
   assert.equal(await sheet.locator('.rg-confirm').innerText(),CONFIRM(3));
   assert.ok(await fits(page));
   await press(size,sheet.getByRole('button',{name:'Generate again (3)'}));
   await page.getByText('3 jobs are in line to be generated again.').waitFor();
   assert.deepEqual((await queueOf(sub)).entries.map(entry=>entry.postingId),[201,202,203],'exactly the jobs with older documents, best match first');
   assert.deepEqual(platform.activated,[{class:'person',configuration:{timeoutMs:60000}}],'his background job is turned on, so it goes on with the page closed');
   assert.ok(await until(page,async()=>/^Generating again: job 1 of 3$/.test(await heading(page))&&/writing its résumé and cover letter/.test(await panel(page).locator('#regenerateLine').innerText().catch(()=>''))));
   assert.match(await panel(page).locator('.hint').innerText(),/Career goes on with My jobs closed/);
   assert.deepEqual(await panel(page).locator('.ab-actions button').allInnerTexts(),['Pause','Stop']);
   assert.ok(await until(page,async()=>(await counts(page)).startsWith('1 done · 2 left · 0 failed')),'the first job is written');
   // Pause, a reload, Go on and Stop.
   await press(size,panel(page).getByRole('button',{name:'Pause'}));
   assert.ok(await until(page,async()=>(await heading(page))==='Generate again is paused'));
   await page.reload({waitUntil:'load'});
   await panel(page).getByText('Generate again is paused').waitFor();
   assert.deepEqual(await panel(page).locator('.ab-actions button').allInnerTexts(),['Go on','Stop'],'a reload keeps the queue');
   assert.ok(await until(page,async()=>!(await queueOf(sub)).current),'the job being written when he paused finishes');
   const paused=(await queueOf(sub)).counts;
   await page.clock.runFor(20000);
   assert.deepEqual((await queueOf(sub)).counts,paused,'paused: nothing else starts');
   await press(size,panel(page).getByRole('button',{name:'Go on'}));
   assert.ok(await until(page,async()=>/^Generating again/.test(await heading(page))));
   await press(size,panel(page).getByRole('button',{name:'Stop'}));
   assert.ok(await until(page,async()=>(await heading(page))==='Generate again stopped'&&!(await queueOf(sub)).current));
   const ended=await queueOf(sub);
   assert.equal(ended.counts.left,0);assert.equal(ended.counts.failed,0);
   assert.equal(ended.counts.done+ended.counts.skipped,3,'each job is done or was stopped before Career reached it');
   assert.ok(await fits(page),'nothing is wider than the screen');
   await press(size,panel(page).getByRole('button',{name:'Clear'}));
   // A job Stop reached before Career did still has older documents; once every job is done the panel has nothing to say.
   if(ended.counts.skipped)assert.ok(await until(page,async()=>(await heading(page).catch(()=>''))==='Documents from an earlier Career'&&(await panel(page).locator('#regenerateOlder').innerText()).startsWith(`${ended.counts.skipped} of your open jobs ha`)));
   else assert.ok(await until(page,async()=>panel(page).isHidden()),'with nothing older left the panel is hidden');
   assert.equal(await queueOf(sub),null,'Clear empties the queue');
  }finally{await context.close();}
 });
}
