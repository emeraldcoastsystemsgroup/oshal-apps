/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise native writer-busy feedback on actual Career pages with synthetic same-origin responses, preserved inputs and explicit retries; no live jobs, runs or submissions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain every busy/refusal control under Save-only behavior, with separate explicit fit-refusal checks and unchanged acknowledged favorites.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen,playwright,PHONE,DESKTOP} from './helpers/ux-page.mjs';
const BUSY='career_run_in_progress',NOTICE='Career is working on your account.';
const RUN='12345678-1234-4234-8234-123456789012';let browser;
const entries=[['home','home'],['board','board-native'],['search','search-ui'],['resume-studio','resume-studio']]
 .map(([view,file])=>({id:'tool-career-'+view,label:view,toolUi:{iframeUrl:'/api/career-hunter/'+file,visibilityToolName:'career-'+view}}));
function state(patch={}){
 return {error:BUSY,status:409,accepted:false,writes:[],job:{id:17,title:'Synthetic fixture role',company:'Fixture company',location:'Remote',
  status:'new',active:1,favorite:false,ai_fit_score:83,application:{needsGeneration:true,draft:{revision:1,guidance:'',experienceIds:[],experienceRevision:'fixture-bank'}}},...patch};
}
function reads(url,s){
 const p=url.pathname;
 if(p==='/api/ui/profile')return {profile:{ribbon:{items:entries}}};
 if(p==='/api/auth/user')return {authenticated:true,tenant:'fixture',principal_id:'fixture',displayName:'Fixture Seeker'};
 if(p.endsWith('/resume/state'))return {hasResume:true,roles:2,indexing:false,scored:2};
 if(p.endsWith('/jobs/stats'))return {saved:0,matches:1,queued:0,tracked:0,byStatus:[]};
 if(p.endsWith('/jobs')||p.endsWith('/browse'))return {jobs:s.jobs||[s.job],total:s.jobs?.length||1,page:1,per:25,exhausted:true};
 if(p.endsWith('/jobs/17'))return {job:s.job};
 if(p.endsWith('/experience-bank'))return {entries:[],revision:'fixture-bank'};
 if(p.endsWith('/search-memory'))return {stored:true,last:null,saved:[]};
 if(p.endsWith('/applications')||p.endsWith('/submission-queue'))return {applications:[],items:[]};
 return {};
}
function answers(s){return ({method,url,body})=>{
 if(method==='GET')return {json:reads(url,s)};
 s.writes.push({path:url.pathname,body});
 if(url.pathname.includes('/search-memory'))return {json:{stored:true}};
 if(!s.accepted&&!(s.preparationOnly&&url.pathname.endsWith('/status')))
  return {status:s.status,json:{error:s.error,code:s.code,runId:RUN}};
 if(body?.draft){s.job.application.draft={...body.draft,revision:body.draft.revision+1};return {json:{application:s.job.application}};}
 if(body?.favorite)s.job.favorite=true;
 return {json:{ok:true,requestId:'synthetic-fit-receipt'}};
};}
async function screen(kind,s,size=PHONE){
 const path='/api/career-hunter/'+(kind==='search'?'search-ui':'board-native');
 const file=kind==='search'?'career-search.html':kind==='application'?'career-application.html':'career-job-lists.html';
 const query=kind==='application'?'?view=queue&application=17':['matches','cards'].includes(kind)?'?view=matches':'';
 const f=await openScreen(browser,file,answers(s),size,query,path);f.page.setDefaultTimeout(2200);f.errors=[];f.page.on('pageerror',e=>f.errors.push(e.message));if(kind==='matches'){await f.page.getByRole('button',{name:'Filters',exact:true}).click();await f.page.getByRole('tab',{name:'List',exact:true}).click();await f.page.getByRole('button',{name:'Done',exact:true}).click();}return f;
}
const changes=s=>s.writes.filter(w=>!w.path.includes('/search-memory'));
async function noAutomatic(f,s,n){await f.page.waitForTimeout(750);assert.equal(changes(s).length,n,'no queued or automatic mutation retry');assert.deepEqual(f.errors,[]);assert.equal(f.calls.some(c=>c.method==='DIALOG'),false);}
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
for(const kind of ['search','matches']){
 test(kind+': refused Save stays available, explains busy and retries only on another press',async()=>{
  const s=state(),f=await screen(kind,s);try{
   await f.page.getByText(s.job.title,{exact:true}).first().waitFor();await f.page.getByRole('button',{name:'Save',exact:true}).first().click();
   const notice=f.page.locator(kind==='search'?'#searchStatus':'#actionState');await notice.getByText(NOTICE,{exact:false}).waitFor({timeout:1200});
   assert.doesNotMatch(await notice.innerText(),/career_run_in_progress/);assert.equal(await f.page.getByText(s.job.title,{exact:true}).count()>0,true);
   const retry=f.page.getByRole('button',{name:kind==='search'?'Try saving again':'Save',exact:true}).first();assert.equal(await retry.isEnabled(),true);
   await noAutomatic(f,s,1);s.accepted=true;await retry.click();await f.page.getByRole('button',{name:'Saved',exact:true}).first().waitFor();
   assert.deepEqual(changes(s).map(w=>w.path),['/api/career-hunter/jobs/17/status','/api/career-hunter/jobs/17/status']);
  }finally{await f.context.close();}
 });
 test(kind+': a separate explicit fit refusal cannot undo an acknowledged Save',async()=>{
  const s=state({preparationOnly:true}),f=await screen(kind,s);try{
   await f.page.getByRole('button',{name:'Save',exact:true}).first().click();await f.page.getByRole('button',{name:'Saved',exact:true}).first().waitFor();
   assert.equal(changes(s).length,1);
   const text=await f.page.evaluate(async()=>{try{await CareerJobActions.prepare(17,false);return 'unexpected';}catch(error){return error.message;}});
   assert.match(text,new RegExp(NOTICE));assert.doesNotMatch(text,/career_run_in_progress/);assert.equal(s.job.favorite,true);
   assert.equal(await f.page.getByRole('button',{name:'Saved',exact:true}).first().count(),1);await noAutomatic(f,s,2);
  }finally{await f.context.close();}
 });
}
for(const size of [PHONE,DESKTOP])test(size===PHONE?'phone: busy draft keeps input and manual retry saves it':'desktop: busy draft keeps input and manual retry saves it',async()=>{
 const s=state(),f=await screen('application',s,size);try{
  const field=f.page.locator('#guidance');await field.waitFor();await field.fill('Synthetic unsaved guidance');
  await f.page.locator('#message').getByText(NOTICE,{exact:false}).waitFor({timeout:2000});
  assert.equal(await field.inputValue(),'Synthetic unsaved guidance');assert.equal(await f.page.getByRole('button',{name:'Reload saved draft',exact:true}).count(),0);
  assert.match(await f.page.locator('#draftState').innerText(),/not saved/i);await noAutomatic(f,s,1);
  s.accepted=true;await f.page.getByRole('button',{name:'Retry saving draft',exact:true}).click();
  await f.page.locator('#message').getByText('Draft saved to your account.',{exact:true}).waitFor({timeout:1200});
  assert.equal(await field.inputValue(),'Synthetic unsaved guidance');assert.equal(changes(s).length,2);
  assert.equal(changes(s)[1].body.draft.guidance,'Synthetic unsaved guidance');assert.equal(changes(s)[1].body.draft.revision,1);
  assert.equal(await f.page.locator('#draftState').innerText(),'Draft saved to your account');
 }finally{await f.context.close();}
});
test('a real draft revision conflict retains its explicit reload path without writing again',async()=>{
 const s=state({error:'This draft changed in another tab.',code:'draft_conflict'}),f=await screen('application',s);try{
  const field=f.page.locator('#guidance');await field.waitFor();await field.fill('Unsaved conflicting text');
  await f.page.getByRole('button',{name:'Reload saved draft',exact:true}).waitFor();assert.equal(await field.inputValue(),'Unsaved conflicting text');
  assert.doesNotMatch(await f.page.locator('#message').innerText(),/Career is working/);await noAutomatic(f,s,1);
  s.job.application.draft={...s.job.application.draft,guidance:'Saved in another tab',revision:2};
  await f.page.getByRole('button',{name:'Reload saved draft',exact:true}).click();await f.page.waitForFunction(()=>document.getElementById('guidance')?.value==='Saved in another tab');
  assert.equal(changes(s).length,1);
 }finally{await f.context.close();}
});
test('unknown draft failure keeps its message and retry behavior',async()=>{
 const s=state({error:'Synthetic storage refusal',status:503}),f=await screen('application',s);try{
  const field=f.page.locator('#guidance');await field.waitFor();await field.fill('Retained after unknown failure');
  await f.page.getByRole('button',{name:'Retry saving draft',exact:true}).waitFor();assert.match(await f.page.locator('#message').innerText(),/Synthetic storage refusal/);
  assert.equal(await field.inputValue(),'Retained after unknown failure');await noAutomatic(f,s,1);
 }finally{await f.context.close();}
});
for(const [status,error,busy] of [[409,BUSY,true],[503,BUSY,false],[409,'draft_conflict',false],[409,'Synthetic refusal',false]]){
 test('submission request preserves exact classification '+status+' '+error,async()=>{
  const s=state({status,error}),f=await screen('application',s);try{
   const result=await f.page.evaluate(async()=>{try{await CareerSubmit.request('/submission-queue',{postingId:17});return {unexpected:true};}
    catch(e){return {message:e.message,code:e.code,status:e.status};}});
   if(busy){assert.match(result.message,new RegExp(NOTICE));assert.doesNotMatch(result.message,/career_run_in_progress/);assert.equal(result.code,BUSY);assert.equal(result.status,409);}
   else assert.equal(result.message,error);
   await noAutomatic(f,s,1);
  }finally{await f.context.close();}
 });
}
test('a non409 busy-looking Save error remains an ordinary error',async()=>{
 const s=state({status:503}),f=await screen('search',s);try{
  await f.page.getByRole('button',{name:'Save',exact:true}).first().click();await f.page.locator('#searchStatus').getByText(BUSY,{exact:true}).waitFor();await noAutomatic(f,s,1);
 }finally{await f.context.close();}
});

test('default phone Cards retain a job after native busy rejection so Save can be retried',async()=>{
 const s=state(),f=await screen('cards',s);try{
  await f.page.getByText(s.job.title,{exact:true}).first().waitFor();await f.page.getByRole('button',{name:'Save',exact:true}).click();
  await f.page.locator('#actionState').getByText(NOTICE,{exact:false}).waitFor({timeout:1200});
  await f.page.getByText(s.job.title,{exact:true}).first().waitFor({timeout:1200});
  assert.equal(await f.page.getByRole('button',{name:'Save',exact:true}).isEnabled(),true);await noAutomatic(f,s,1);
  s.accepted=true;await f.page.getByRole('button',{name:'Save',exact:true}).click();
  await f.page.waitForFunction(()=>document.getElementById('actionState')?.textContent.includes('Saved'));
  assert.equal(await f.page.locator('[data-deck-id="17"]').count(),0);assert.equal(s.job.favorite,true);assert.equal(changes(s).length,2);
 }finally{await f.context.close();}
});

test('an unrelated409 with a reserved code still uses the ordinary conflict path',async()=>{
 const s=state({error:'Synthetic unrelated conflict',code:BUSY}),f=await screen('application',s);try{
  const field=f.page.locator('#guidance');await field.waitFor();await field.fill('Retained unrelated conflict');
  await f.page.getByRole('button',{name:'Reload saved draft',exact:true}).waitFor({timeout:1200});
  assert.match(await f.page.locator('#message').innerText(),/Synthetic unrelated conflict/);
  assert.equal(await field.inputValue(),'Retained unrelated conflict');await noAutomatic(f,s,1);
 }finally{await f.context.close();}
});

function twoCards(patch={}){
 const s=state(patch);s.jobs=[s.job,{...s.job,id:18,title:'Second synthetic role',favorite:false}];return s;
}
test('phone Cards preserve an acknowledged favorite after a separate explicit scoring refusal',async()=>{
 const s=twoCards({preparationOnly:true}),f=await screen('cards',s);try{
  await f.page.getByRole('button',{name:'Save',exact:true}).click();
  await f.page.waitForFunction(()=>document.getElementById('actionState')?.textContent.includes('Saved'));
  const text=await f.page.evaluate(async()=>{try{await CareerJobActions.prepare(17,false);return 'unexpected';}catch(error){return error.message;}});
  assert.match(text,new RegExp(NOTICE));
  assert.equal(await f.page.locator('[data-deck-id="17"]').count(),0);assert.equal(s.job.favorite,true);
  assert.equal(await f.page.locator('[data-deck-id="18"]').count(),1);await noAutomatic(f,s,2);
 }finally{await f.context.close();}
});
for(const patch of [{status:503,error:'Synthetic uncertain refusal'},{error:'Synthetic other conflict',code:BUSY}]){
 test('phone Cards do not reinterpret an unknown result as a proven busy refusal '+patch.error,async()=>{
  const s=twoCards(patch),f=await screen('cards',s);try{
   await f.page.getByRole('button',{name:'Save',exact:true}).click();await f.page.locator('#actionState').getByText(patch.error,{exact:true}).waitFor();
   assert.equal(await f.page.locator('[data-deck-id="17"]').count(),0);await noAutomatic(f,s,1);
  }finally{await f.context.close();}
 });
}
test('a busy card removes only its own optimistic history entry; earlier Undo still works',async()=>{
 const s=twoCards({accepted:true}),f=await screen('cards',s);try{
  await f.page.getByRole('button',{name:'Save',exact:true}).click();await f.page.waitForFunction(()=>!document.querySelector('[data-deck-id="17"]'));
  await f.page.waitForFunction(()=>document.getElementById('actionState')?.textContent.includes('Saved'));
  s.accepted=false;await f.page.getByRole('button',{name:'Save',exact:true}).click();await f.page.locator('#actionState').getByText(NOTICE,{exact:false}).waitFor();
  assert.equal(await f.page.locator('[data-deck-id="18"]').count(),1);await noAutomatic(f,s,2);
  s.accepted=true;await f.page.getByRole('button',{name:'Undo',exact:true}).click();await f.page.locator('[data-deck-id="17"]').waitFor();
  assert.equal(changes(s).length,3);assert.deepEqual(changes(s).at(-1),{path:'/api/career-hunter/jobs/17/status',body:{favorite:false}});
 }finally{await f.context.close();}
});

test('a late busy card response cannot reinsert a job into a freshly filtered view',async()=>{
 const s=twoCards(),f=await screen('cards',s);let release;
 const held=new Promise(resolve=>{release=resolve;});
 try{
  await f.page.route('**/api/career-hunter/jobs/17/status',async route=>{
   s.writes.push({path:'/api/career-hunter/jobs/17/status',body:route.request().postDataJSON()});await held;
   await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:BUSY,runId:RUN})});
  });
  const called=f.page.waitForRequest(req=>req.method()==='POST'&&req.url().endsWith('/jobs/17/status'));
  await f.page.getByRole('button',{name:'Save',exact:true}).click();await called;
  s.jobs=[{...s.job,id:99,title:'Freshly filtered fixture role'}];
  await f.page.getByRole('button',{name:'Filters',exact:true}).click();await f.page.locator('#q').fill('fresh');
  await f.page.locator('#keywordSearch button[type="submit"]').click();await f.page.getByRole('button',{name:'Done',exact:true}).click();
  await f.page.locator('[data-deck-id="99"]').waitFor();release();
  await f.page.locator('#actionState').getByText(NOTICE,{exact:false}).waitFor();
  assert.equal(await f.page.locator('[data-deck-id="17"]').count(),0);assert.equal(await f.page.locator('[data-deck-id="99"]').count(),1);
  await noAutomatic(f,s,1);
 }finally{release();await f.context.close();}
});
