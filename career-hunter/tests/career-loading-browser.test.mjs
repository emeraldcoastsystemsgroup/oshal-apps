/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual Career pages with held GETs, fresh-profile boundaries and late résumé truth without live accounts or actions.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=dirname(fileURLToPath(import.meta.url)),tools=resolve(here,'../tools');
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN||resolve(here,'../../scripts/toolchain'),'package.json'));
const {chromium}=deps('playwright'),ORIGIN='http://career-loading.fixture.test';
const entries=[['home','home'],['board','board-native'],['search','search-ui'],['resume-studio','resume-studio']]
 .map(([view,file])=>({id:'tool-career-'+view,label:view,toolUi:{iframeUrl:'/api/career-hunter/'+file,visibilityToolName:'career-'+view}}));
entries.push({id:'tool-portrait-studio--portrait-studio',label:'Photo',toolUi:{iframeUrl:'/api/portrait-studio/app',visibilityToolName:'portrait-studio'}});
let browser;
const fixtureJob={id:17,title:'Synthetic fixture role',company:'Fixture company',location:'Remote',ai_fit_score:83,favorite:true};
function answer(url,state){
 const p=url.pathname;
 if(p==='/api/ui/profile')return {status:state.profile?200:403,json:state.profile?{profile:{ribbon:{items:entries}}}:{error:'refused'}};
 if(p==='/api/auth/user')return {json:{authenticated:true,tenant:'fixture',principal_id:'seeker',displayName:'Fixture Seeker'}};
 if(p.endsWith('/resume/state'))return {status:state.resumeStatus,json:state.resume};
 if(p.endsWith('/jobs/stats'))return {json:{saved:1,matches:2,total:2,tracked:0,queued:0,byStatus:[]}};
 if(p.endsWith('/jobs'))return {json:{jobs:[fixtureJob],page:1,per:25,exhausted:true}};
 if(p.endsWith('/jobs/progress'))return {json:{period:'past7days',applied:2,goal:8,asOf:'2026-11-12T23:00:00Z'}};
 if(p.endsWith('/home-summary'))return {json:{metrics:[]}};
 if(p.endsWith('/jobs/updates'))return {json:{events:[]}};
 if(p.endsWith('/applications'))return {json:{applications:[]}};
 if(p==='/api/portrait-studio/readiness')return {json:{portrait:{ready:false}}};
 return {json:{}};
}
async function screen(name,held=[],options={}){
 const state={profile:true,resumeStatus:200,resume:{hasResume:true,roles:2,scored:2},...options};
 const context=await browser.newContext({viewport:{width:412,height:915}}),calls=[],errors=[],dialogs=[],gates=new Map();
 for(const p of held){let release;const promise=new Promise(resolve=>{release=resolve;});gates.set(p,{promise,release});}
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==ORIGIN)return route.abort();
  if(url.pathname==='/cockpit/')return route.fulfill({contentType:'text/html',body:'<!doctype html><main class="cockpit-body"><iframe src="/api/career-hunter/home" style="width:100%;height:900px;border:0"></iframe></main>'});
  const asset=url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if(asset&&existsSync(join(tools,asset[1])))return route.fulfill({contentType:asset[1].endsWith('.css')?'text/css':'application/javascript',body:readFileSync(join(tools,asset[1]))});
  if(url.pathname==='/api/career-hunter/'+name.split('?')[0])return route.fulfill({contentType:'text/html',body:readFileSync(join(tools,name.startsWith('home')?'career-home.html':'career-job-lists.html'))});
  if(/^\/(shared|cockpit|ui)\//.test(url.pathname))return route.fulfill({body:'',contentType:url.pathname.endsWith('.css')?'text/css':'application/javascript'});
  calls.push({path:url.pathname+url.search,method:req.method(),at:Date.now()});
  assert.equal(req.method(),'GET','loading must never start a run or change an account');
  if(gates.has(url.pathname))await gates.get(url.pathname).promise;
  const out=answer(url,state);await route.fulfill({status:out.status||200,contentType:'application/json',body:JSON.stringify(out.json)}).catch(()=>{});
 });
 if(options.remembered)await context.addInitScript(value=>sessionStorage.setItem('career-frame-v2',JSON.stringify(value)),options.remembered);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());void d.dismiss();});
 await page.goto(ORIGIN+(options.cockpit?'/cockpit/?app=intelligent-career':'/api/career-hunter/'+name),{waitUntil:'load'});
 const release=p=>gates.get(p)?.release(),close=async()=>{for(const gate of gates.values())gate.release();await context.close();};
 return {page,state,calls,errors,dialogs,release,close};
}
const listCalls=f=>f.calls.filter(c=>c.path.startsWith('/api/career-hunter/jobs?'));
const frameReady=f=>f.page.locator('.cf-topbar[data-cf-ready]').waitFor({timeout:1500});
const resumeReady=f=>f.page.getByText('Your résumé is in',{exact:true}).waitFor({timeout:1500});
async function clear(f){try{assert.deepEqual(f.errors,[]);assert.deepEqual(f.dialogs,[]);}finally{await f.close();}}
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

for(const held of ['/api/career-hunter/jobs/stats','/api/auth/user']){
 test('fresh admitted navigation and core Home survive held '+held,async()=>{
  const f=await screen('home',[held]);try{
   await frameReady(f);await resumeReady(f);assert.ok(f.calls.some(c=>c.path.endsWith('/resume/state')));
   assert.equal(await f.page.locator('.cf-role').first().innerText(),'Job seeker');
  }finally{await clear(f);}
 });
}
test('optional Portrait cannot hold core Home and late enrichment preserves goal draft',async()=>{
 const held='/api/portrait-studio/readiness',f=await screen('home',[held]);try{
  await f.page.locator('#todayPanel[aria-busy="false"]').waitFor({timeout:1500});await resumeReady(f);
  await f.page.getByText('Edit your goal',{exact:true}).click();const goal=f.page.getByLabel('Application goal for the past 7 days',{exact:true});
  await goal.fill('7');assert.equal(await f.page.locator('[data-step="portrait"]').count(),0);
  f.release(held);await f.page.locator('[data-step="portrait"]').waitFor({timeout:1500});assert.equal(await goal.inputValue(),'7');
 }finally{await clear(f);}
});
test('late stats update visible counts without resetting the goal input',async()=>{
 const held='/api/career-hunter/jobs/stats',f=await screen('home',[held]);try{
  await resumeReady(f);await f.page.getByText('Edit your goal',{exact:true}).click();const goal=f.page.getByLabel('Application goal for the past 7 days',{exact:true});
  await goal.fill('6');assert.equal(await f.page.locator('[data-stage="matches"] b').innerText(),'…');
  f.release(held);await f.page.waitForFunction(()=>document.querySelector('[data-stage="matches"] b')?.textContent==='2');
  assert.equal(await goal.inputValue(),'6');
 }finally{await clear(f);}
});
test('fresh denied profile removes cached administrator role and does not read borrowed apps',async()=>{
 const admin={...entries[0],view:'companies',own:true,href:'/api/career-hunter/companies-admin',label:'Companies'};
 const f=await screen('home',[],{profile:false,remembered:{app:'intelligent-career',entries:[admin],name:'Earlier person'}});try{
  await frameReady(f);await resumeReady(f);assert.equal(await f.page.locator('.cf-role').count(),0);
  assert.equal(f.calls.some(c=>c.path==='/api/portrait-studio/readiness'),false);
  assert.equal(await f.page.locator('.cf-topbar a[href="/api/career-hunter/companies-admin"]').count(),0);
 }finally{await clear(f);}
});
for(const profile of [true,false]){
 test('optional metadata never presents a cached role before fresh '+(profile?'seeker':'denied')+' profile',async()=>{
  const admin={view:'companies',own:true,href:'/api/career-hunter/companies-admin',label:'Companies'};
  const f=await screen('home',['/api/ui/profile'],{profile,remembered:{app:'intelligent-career',entries:[admin],name:'Earlier person'}});try{
   await f.page.waitForTimeout(150);assert.equal(await f.page.locator('.cf-role').count(),0,'cached administrator must never be asserted from name/count arrival');
   f.release('/api/ui/profile');await frameReady(f);
   if(profile)assert.equal(await f.page.locator('.cf-role').first().innerText(),'Job seeker');else assert.equal(await f.page.locator('.cf-role').count(),0);
  }finally{await clear(f);}
 });
}
test('fast Home paints real counts and has no loading dialog',async()=>{
 const f=await screen('home');try{
  await f.page.locator('#todayPanel[aria-busy="false"]').waitFor({timeout:1500});await resumeReady(f);
  await f.page.waitForFunction(()=>document.querySelector('[data-stage="matches"] b')?.textContent==='2');
  assert.equal(f.calls.filter(c=>c.path==='/api/career-hunter/jobs/stats').length,3,'duplicate-read overhead remains explicit');
 }finally{await clear(f);}
});
test('New matches waits at most two seconds for unknown resume status',async()=>{
 const held='/api/career-hunter/resume/state',f=await screen('board-native?view=matches',[held]);try{
  await f.page.waitForTimeout(150);assert.equal(listCalls(f).length,0,'fast status should still gate first');
  const request=await f.page.waitForRequest(r=>r.url().includes('/jobs?'),{timeout:3200});
  assert.match(request.url(),/matches=1/);assert.equal(await f.page.getByText('Add your résumé to get matches',{exact:true}).count(),0);
  await f.page.getByText(fixtureJob.title,{exact:true}).first().waitFor({timeout:1200});
 }finally{await clear(f);}
});
for(const indexing of [false,true]){
 test('late '+(indexing?'indexing':'no-resume')+' truth cancels an obsolete match feed',async()=>{
  const held='/api/career-hunter/resume/state',f=await screen('board-native?view=matches',[held,'/api/career-hunter/jobs']);try{
   await f.page.waitForRequest(r=>r.url().includes('/jobs?'),{timeout:3500});
   f.state.resume={hasResume:false,indexing};f.release(held);
   await f.page.getByRole('heading',{name:indexing?'Reading your résumé':'Add your résumé to get matches',exact:true}).waitFor({timeout:1200});
   f.release('/api/career-hunter/jobs');await f.page.waitForTimeout(100);
   assert.equal(await f.page.getByText(fixtureJob.title,{exact:true}).count(),0);
   assert.equal(await f.page.locator('#list').getAttribute('aria-busy'),'false');
  }finally{await clear(f);}
 });
}
for(const indexing of [false,true]){
 test('known '+(indexing?'indexing':'no-resume')+' state preserves the real gate',async()=>{
  const f=await screen('board-native?view=matches',[],{resume:{hasResume:false,indexing}});try{
   await f.page.getByRole('heading',{name:indexing?'Reading your résumé':'Add your résumé to get matches',exact:true}).waitFor({timeout:1200});
   assert.equal(listCalls(f).length,0);
  }finally{await clear(f);}
 });
}
test('unavailable resume status remains unknown and permits existing feed fallback',async()=>{
 const f=await screen('board-native?view=matches',[],{resumeStatus:503,resume:{error:'unavailable'}});try{
  await f.page.getByText(fixtureJob.title,{exact:true}).first().waitFor({timeout:1500});assert.equal(listCalls(f).length,1);
  assert.equal(await f.page.getByText('Add your résumé to get matches',{exact:true}).count(),0);
 }finally{await clear(f);}
});
test('Saved control still loads while resume status is held',async()=>{
 const f=await screen('board-native?view=saved',['/api/career-hunter/resume/state']);try{
  await f.page.getByText(fixtureJob.title,{exact:true}).first().waitFor({timeout:1500});assert.equal(listCalls(f).length,1);
 }finally{await clear(f);}
});
test('late optional response cannot redraw a page after pagehide',async()=>{
 const held='/api/portrait-studio/readiness',f=await screen('home',[held]);try{
  await f.page.locator('#todayPanel[aria-busy="false"]').waitFor({timeout:1500});
  await f.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));const before=await f.page.locator('#today').innerHTML();
  f.release(held);await f.page.waitForTimeout(100);assert.equal(await f.page.locator('#today').innerHTML(),before);
 }finally{await clear(f);}
});
test('held fresh profile cannot redraw a departed cockpit frame or restore its phone inset',async()=>{
 const held='/api/ui/profile',f=await screen('home',[held],{cockpit:true});try{
  const view=f.page.frames().find(frame=>frame.url().includes('/api/career-hunter/home'));
  await view.locator('.cf-topbar').waitFor();await view.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
  const response=f.page.waitForResponse(r=>new URL(r.url()).pathname===held);f.release(held);await response;await f.page.waitForTimeout(100);
  assert.equal(await view.locator('.cf-topbar[data-cf-ready]').count(),0,'late fresh-profile continuation must not draw an abandoned frame');
  assert.equal(await view.evaluate(()=>sessionStorage.getItem('career-frame-v2')),null,'late profile must not commit remembered identity');
  assert.equal(await f.page.evaluate(()=>document.documentElement.hasAttribute('data-career-inset')),false);
 }finally{await clear(f);}
});
test('held count refresh cannot restore a departed cockpit phone inset',async()=>{
 const held='/api/career-hunter/jobs/stats',f=await screen('home',[held],{cockpit:true});try{
  const view=f.page.frames().find(frame=>frame.url().includes('/api/career-hunter/home'));
  await view.locator('.cf-topbar[data-cf-ready]').waitFor();assert.equal(await f.page.evaluate(()=>document.documentElement.hasAttribute('data-career-inset')),true);
  await view.evaluate(()=>{window.__fixtureRefresh=CareerFrame.refresh();});
  await view.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
  f.release(held);await view.evaluate(()=>window.__fixtureRefresh);
  assert.equal(await f.page.evaluate(()=>document.documentElement.hasAttribute('data-career-inset')),false,'late refresh must not measure the old frame into its parent');
 }finally{await clear(f);}
});
