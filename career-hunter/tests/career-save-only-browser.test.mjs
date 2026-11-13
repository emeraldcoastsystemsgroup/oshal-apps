/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise acknowledged Save-only behavior on actual Search, Cards, List and Saved pages while retaining explicit fit and document preparation; synthetic same-origin responses only.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openScreen,playwright,PHONE,DESKTOP,tools} from './helpers/ux-page.mjs';
import {join} from 'node:path';
let browser;
const entries=[['home','home'],['board','board-native'],['search','search-ui'],['resume-studio','resume-studio']]
 .map(([view,file])=>({id:'tool-career-'+view,label:view,toolUi:{iframeUrl:'/api/career-hunter/'+file,visibilityToolName:'career-'+view}}));
function fixture(){
 const first={id:17,title:'Known fit fixture role',company:'Fixture company',status:'new',location:'Remote',active:1,favorite:false,ai_fit_score:83,
  has_resume:false,has_cover:false,application:{needsGeneration:true,draft:{revision:0,guidance:'',experienceIds:[],experienceRevision:'fixture-bank'}}};
 return {writes:[],jobs:[first,{...structuredClone(first),id:18,title:'Unscored fixture role',ai_fit_score:null}],complete:false};
}
function answer(s,{method,url,body}){
 const p=url.pathname,id=Number(p.match(/\/jobs\/(\d+)/)?.[1]),job=s.jobs.find(j=>j.id===id);
 if(method==='POST'){
  s.writes.push({path:p,body});
  if(p.endsWith('/search-memory'))return {json:{stored:true}};
  if(p.endsWith('/status')){if(body.favorite!==undefined)job.favorite=body.favorite;if(body.status)job.status=body.status;return {json:{ok:true}};}
  if(p.endsWith('/generate')){s.pending={id,requestId:body.requestId};return {status:202,json:{ok:true,requestId:body.requestId,status:body.documents?'generating':'scoring'}};}
  assert.fail('Unexpected synthetic mutation '+p);
 }
 if(p==='/api/ui/profile')return {json:{profile:{ribbon:{items:entries}}}};
 if(p==='/api/auth/user')return {json:{authenticated:true,tenant:'fixture',principal_id:'fixture'}};
 if(p.endsWith('/resume/state'))return {json:{hasResume:true,indexing:false,roles:2}};
 if(p.endsWith('/jobs/stats'))return {json:{saved:s.jobs.filter(j=>j.favorite).length,matches:s.jobs.filter(j=>!j.favorite).length,byStatus:[],queued:0,tracked:0}};
 if(p.endsWith('/jobs')||p.endsWith('/browse')){
  const jobs=url.searchParams.get('status')==='saved'?s.jobs.filter(j=>j.favorite):url.searchParams.get('matches')==='1'?s.jobs.filter(j=>!j.favorite):s.jobs;
  return {json:{jobs,exhausted:true,page:1,per:25,total:jobs.length}};
 }
 if(job){if(s.complete&&s.pending?.id===id){job.ai_fit_score=91;job.board={phase:'scored',requestId:s.pending.requestId,completedAt:'2026-11-12T23:00:00Z'};}return {json:{job}};}
 if(p.endsWith('/applications'))return {json:{applications:[]}};
 if(p.endsWith('/search-memory'))return {json:{stored:true,last:null,saved:[]}};
 if(p.endsWith('/experience-bank'))return {json:{entries:[],revision:'fixture-bank'}};
 return {json:{}};
}
async function open(kind,s,size=PHONE){
 const search=kind==='search',file=search?'career-search.html':'career-job-lists.html',path='/api/career-hunter/'+(search?'search-ui':'board-native');
 const f=await openScreen(browser,file,req=>answer(s,req),size,['cards','list'].includes(kind)?'?view=matches':'',path);
 f.page.setDefaultTimeout(2200);f.errors=[];f.page.on('pageerror',e=>f.errors.push(e.message));
 if(kind==='list'){await f.page.getByRole('button',{name:'Filters',exact:true}).click();await f.page.getByRole('tab',{name:'List',exact:true}).click();await f.page.getByRole('button',{name:'Done',exact:true}).click();}
 return f;
}
const writes=s=>s.writes.filter(w=>!w.path.endsWith('/search-memory'));
async function quiet(f,s,count){
 await f.page.waitForTimeout(1200);
 assert.equal(writes(s).length,count,'Save must not launch extra work');
 assert.equal(f.calls.some(c=>c.method==='GET'&&/\/jobs\/\d+/.test(c.path)),false,'Save must not start a score poll');
 assert.equal(s.pending,undefined,'Save must not start a fit/document run');
 assert.deepEqual(f.errors,[]);
}
async function savedRead(s){
 const f=await open('saved',s);try{
  const known=f.page.locator('[data-job-id="17"]'),unknown=f.page.locator('[data-job-id="18"]');await known.waitFor();await unknown.waitFor();
  assert.match(await known.innerText(),/AI fit 83/);assert.match(await unknown.innerText(),/Not scored yet/);
  assert.equal(await unknown.getByRole('button',{name:'Check my fit',exact:true}).count(),1);
  assert.equal(s.jobs[0].ai_fit_score,83);assert.equal(s.jobs[1].ai_fit_score,null);
 }finally{await f.context.close();}
}
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
for(const size of [PHONE,DESKTOP])test((size===PHONE?'phone':'desktop')+': two Find jobs Saves are acknowledged without scoring or polling',async()=>{
 const s=fixture(),f=await open('search',s,size);try{
  for(const job of s.jobs){const card=f.page.locator('#job-'+job.id);await card.getByRole('button',{name:'Save',exact:true}).click();await card.getByRole('button',{name:'Saved',exact:true}).waitFor();}
  assert.deepEqual(writes(s).map(w=>[w.path,w.body]),s.jobs.map(j=>['/api/career-hunter/jobs/'+j.id+'/status',{favorite:true}]));
  const status=(await f.page.locator('.location-note').allInnerTexts()).join(' ');assert.doesNotMatch(status,/Scoring against|Scoring could not start/);
  await quiet(f,s,2);
 }finally{await f.context.close();}
 await savedRead(s);
});
for(const kind of ['cards','list'])test('phone New matches '+kind+': two Saves keep their acknowledged state without starting work',async()=>{
 const s=fixture(),f=await open(kind,s);try{
  for(const job of s.jobs){
   const button=kind==='cards'?f.page.getByRole('button',{name:'Save',exact:true}):f.page.locator('[data-job-id="'+job.id+'"]').getByRole('button',{name:'Save',exact:true});
   await button.click();await f.page.waitForFunction(id=>document.getElementById('actionState')?.textContent.includes(id),job.title);
  }
  assert.deepEqual(writes(s).map(w=>w.path),['/api/career-hunter/jobs/17/status','/api/career-hunter/jobs/18/status']);await quiet(f,s,2);
 }finally{await f.context.close();}
 await savedRead(s);
});
test('Saved shows truthful known/unknown fit and only an explicit fit check starts its receipt',async()=>{
 const s=fixture();s.jobs.forEach(j=>{j.favorite=true;});const f=await open('saved',s);try{
  const row=f.page.locator('[data-job-id="18"]');await row.getByText('Not scored yet',{exact:true}).waitFor();assert.equal(writes(s).length,0);
  await row.getByRole('button',{name:'Check my fit',exact:true}).click();await row.getByRole('button',{name:'Checking my fit…',exact:true}).waitFor();
  assert.equal(writes(s).length,1);assert.equal(writes(s)[0].path,'/api/career-hunter/jobs/18/generate');assert.equal(writes(s)[0].body.documents,false);
  assert.ok(s.pending.requestId);s.complete=true;await row.getByText(/AI fit 91/).waitFor();
  assert.equal(s.jobs[0].ai_fit_score,83);assert.equal(s.jobs[1].has_resume,false);assert.equal(s.jobs[1].has_cover,false);assert.equal(writes(s).length,1);
 }finally{await f.context.close();}
});
test('Prepare promotes only on its explicit press; document generation still requires its own explicit press',async()=>{
 const s=fixture();s.jobs[1].favorite=true;const f=await open('saved',s);try{
  await f.page.route('**/api/career-hunter/board-native?*application=*',route=>route.fulfill({contentType:'text/html',body:readFileSync(join(tools,'career-application.html'))}));
  await f.page.locator('[data-job-id="18"]').getByRole('button',{name:'Prepare application',exact:true}).click();
  await f.page.getByRole('heading',{name:'What should this application emphasize?',exact:true}).waitFor();
  assert.equal(writes(s).length,1);assert.equal(writes(s)[0].body.status,'promoted');assert.equal(s.pending,undefined);
  await f.page.getByRole('button',{name:'Generate résumé & cover letter',exact:true}).click();
  await f.page.getByRole('heading',{name:'Preparing your application',exact:true}).waitFor();
  assert.equal(writes(s).length,2);assert.equal(writes(s)[1].path,'/api/career-hunter/jobs/18/generate');assert.equal(writes(s)[1].body.documents,true);
  assert.equal(writes(s).some(w=>w.path.includes('/submission-queue')),false);
 }finally{await f.context.close();}
});
test('Find jobs does not announce Saved before the favorite response acknowledges it',async()=>{
 const s=fixture(),f=await open('search',s);let release;const held=new Promise(resolve=>{release=resolve;});
 try{
  await f.page.route('**/api/career-hunter/jobs/17/status',async route=>{
   s.writes.push({path:'/api/career-hunter/jobs/17/status',body:route.request().postDataJSON()});await held;s.jobs[0].favorite=true;
   await route.fulfill({contentType:'application/json',body:'{"ok":true}'});
  });
  const card=f.page.locator('#job-17');await card.getByRole('button',{name:'Save',exact:true}).click();await card.getByRole('button',{name:'Saving…',exact:true}).waitFor();
  assert.equal(await card.getByRole('button',{name:'Saved',exact:true}).count(),0);release();await card.getByRole('button',{name:'Saved',exact:true}).waitFor();await quiet(f,s,1);
 }finally{release();await f.context.close();}
});
test('an interrupted favorite response never claims Saved, starts scoring or retries itself',async()=>{
 const s=fixture(),f=await open('search',s);try{
  await f.page.route('**/api/career-hunter/jobs/17/status',async route=>{
   s.writes.push({path:'/api/career-hunter/jobs/17/status',body:route.request().postDataJSON()});await route.abort();
  });
  const card=f.page.locator('#job-17');await card.getByRole('button',{name:'Save',exact:true}).click();await card.getByRole('button',{name:'Try saving again',exact:true}).waitFor();
  assert.equal(await card.getByRole('button',{name:'Saved',exact:true}).count(),0);await quiet(f,s,1);
 }finally{await f.context.close();}
});
