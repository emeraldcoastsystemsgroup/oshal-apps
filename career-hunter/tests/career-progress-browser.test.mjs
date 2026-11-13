/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise optional application goals on the actual Home page at phone and desktop sizes; count attainment uses saved original-owner progress, never sampled jobs or replies.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove a saved goal reads current progress, reports failed refresh distinctly and preserves a concurrent newer server goal without repeating the write.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen,playwright,PHONE,DESKTOP} from './helpers/ux-page.mjs';
let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const entries=[['home','Home','home'],['board','My jobs','board-native'],['search','Find jobs','search-ui']].map(([id,label,p])=>({id:'tool-career-'+id,label,toolUi:{iframeUrl:'/api/career-hunter/'+p,visibilityToolName:'career-'+id}}));
function fixture(options={}){
 const state={applied:64,goal:null,writes:[],refuse:false,unavailable:false,...options};
 state.api=({method,url,body})=>{
  const p=url.pathname;
  if(p==='/api/ui/profile')return {json:{profile:{ribbon:{items:entries}}}};
  if(p==='/api/auth/user')return {json:{authenticated:false}};
  if(p==='/api/career-hunter/jobs/progress')return state.unavailable?{status:503,json:{error:'Synthetic progress unavailable'}}:{json:{period:'past7days',applied:state.applied,goal:state.goal,since:'2026-11-05T20:00:00.000Z',asOf:state.asOf||'2026-11-12T20:00:00.000Z'}};
  if(p==='/api/career-hunter/jobs/goal'&&method==='POST'){state.writes.push(body);if(state.refuse)return {status:503,json:{error:'Synthetic goal storage unavailable'}};state.goal=state.concurrentGoal??body.goal;return {json:{ok:true,goal:body.goal}};}
  if(method!=='GET')throw Error('Unexpected mutation '+p);
  if(p==='/api/career-hunter/resume/state')return {json:{hasResume:true}};
  if(p==='/api/career-hunter/jobs/stats')return {json:{matches:0,saved:0,tracked:64,applied:16,interviewing:16,queued:0,byStatus:[]}};
  if(p==='/api/career-hunter/jobs')return {json:{jobs:url.searchParams.get('status')==='tracked'?Array.from({length:50},(_,i)=>({id:i+1,status:'applied',applied_at:new Date().toISOString()})):[],exhausted:true}};
  if(p==='/api/career-hunter/jobs/updates')return {json:{events:[{kind:'rejected',date:new Date().toISOString()},{kind:'acknowledged',date:new Date().toISOString()}]}};
  if(p==='/api/career-hunter/applications')return {json:{applications:[]}};
  return {json:{}};
 };
 return state;
}
for(const [label,size] of [['phone',PHONE],['computer',DESKTOP]]){
 test(`${label}: Home uses the full recorded count and offers an optional editable goal`,{timeout:15000},async()=>{
  const state=fixture(),t=await openScreen(browser,'career-home.html',state.api,size,'','/api/career-hunter/home');t.page.setDefaultTimeout(3000);
  try{
   await t.page.locator('#todayPanel[aria-busy="false"]').waitFor();assert.match(await t.page.locator('#week').innerText(),/Past 7 days:[\s\S]*64 applications recorded/);assert.doesNotMatch(await t.page.locator('#week').innerText(),/applications sent|This week/);
   assert.equal(await t.page.locator('#goalProgress').isVisible(),false);await t.page.getByText('Set a goal',{exact:true}).click();
   const field=t.page.getByLabel('Application goal for the past 7 days',{exact:true});await field.fill('80');await t.page.getByRole('button',{name:'Save goal',exact:true}).click();
   await t.page.getByText('64 of 80 applications recorded in the past 7 days.',{exact:true}).waitFor({timeout:3000});assert.deepEqual(state.writes,[{goal:80}]);
   assert.equal(await t.page.locator('#goalProgress').getAttribute('max'),'80');assert.equal(await t.page.locator('#goalProgress').getAttribute('value'),'64');
   assert.doesNotMatch(await t.page.locator('#goalProgressText').innerText(),/reached/);
   await field.fill('60');await t.page.getByRole('button',{name:'Save goal',exact:true}).click();await t.page.getByText(/You reached the goal you set/).waitFor({timeout:3000});
   await t.page.getByRole('button',{name:'Turn off goal',exact:true}).click();await t.page.getByText('Goal turned off.',{exact:true}).waitFor({timeout:3000});assert.equal(state.goal,null);assert.equal(await t.page.locator('#goalProgress').isVisible(),false);
   assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
   for(const control of [field,t.page.getByRole('button',{name:'Save goal',exact:true})])assert.ok((await control.boundingBox()).height>=44);
  }finally{await t.context.close();}
 });
}
test('a refused goal save retains the input and earlier target without announcing attainment',{timeout:12000},async()=>{
 const state=fixture({goal:80,refuse:true}),t=await openScreen(browser,'career-home.html',state.api,PHONE,'','/api/career-hunter/home');t.page.setDefaultTimeout(3000);
 try{await t.page.getByText('Edit your goal',{exact:true}).click();const field=t.page.getByLabel('Application goal for the past 7 days',{exact:true});await field.fill('60');await t.page.getByRole('button',{name:'Save goal',exact:true}).click();await t.page.getByText('Synthetic goal storage unavailable',{exact:true}).waitFor({timeout:3000});assert.equal(await field.inputValue(),'60');assert.equal(state.goal,80);assert.equal(await t.page.locator('#goalProgress').getAttribute('max'),'80');assert.doesNotMatch(await t.page.locator('#goalProgressText').innerText(),/reached/);}finally{await t.context.close();}
});
test('missing progress and automatic replies cannot invent zero progress or a completed goal',{timeout:12000},async()=>{
 const state=fixture({goal:1,unavailable:true}),t=await openScreen(browser,'career-home.html',state.api,PHONE,'','/api/career-hunter/home');t.page.setDefaultTimeout(3000);
 try{await t.page.getByText('Application progress could not be checked.',{exact:true}).waitFor({timeout:3000});assert.doesNotMatch(await t.page.locator('#week').innerText(),/0 applications/);assert.equal(await t.page.locator('#goalProgress').isVisible(),false);assert.deepEqual(state.writes,[]);}finally{await t.context.close();}
});
test('acknowledgements and rejections never complete an application goal',{timeout:12000},async()=>{
 const state=fixture({goal:1,applied:0}),t=await openScreen(browser,'career-home.html',state.api,PHONE,'','/api/career-hunter/home');t.page.setDefaultTimeout(3000);
 try{await t.page.getByText('0 of 1 applications recorded in the past 7 days.',{exact:true}).waitFor();assert.doesNotMatch(await t.page.locator('#goalProgressText').innerText(),/reached/);assert.equal(await t.page.locator('#goalProgress').getAttribute('value'),'0');assert.deepEqual(state.writes,[]);}finally{await t.context.close();}
});
test('saving a lower goal reads current progress instead of attaining it from the page-load count',{timeout:12000},async()=>{
 const state=fixture(),t=await openScreen(browser,'career-home.html',state.api,PHONE,'','/api/career-hunter/home');t.page.setDefaultTimeout(3000);
 try{
  await t.page.locator('#todayPanel[aria-busy="false"]').waitFor();await t.page.getByText('Set a goal',{exact:true}).click();state.applied=2;state.asOf='2026-11-13T20:00:00.000Z';
  await t.page.getByLabel('Application goal for the past 7 days',{exact:true}).fill('4');await t.page.getByRole('button',{name:'Save goal',exact:true}).click();
  await t.page.getByText('2 of 4 applications recorded in the past 7 days.',{exact:true}).waitFor();assert.doesNotMatch(await t.page.locator('#goalProgressText').innerText(),/reached/);
  assert.match(await t.page.locator('#week').innerText(),/2 applications recorded/);assert.doesNotMatch(await t.page.locator('#week').innerText(),/64 applications/);
  assert.equal(t.calls.filter(c=>c.method==='GET'&&c.path==='/api/career-hunter/jobs/progress').length,2);assert.deepEqual(state.writes,[{goal:4}]);
 }finally{await t.context.close();}
});
test('a persisted goal with an unavailable fresh count stays saved and retries progress without another write',{timeout:12000},async()=>{
 const state=fixture({goal:80}),t=await openScreen(browser,'career-home.html',state.api,PHONE,'','/api/career-hunter/home');t.page.setDefaultTimeout(3000);
 try{
  await t.page.getByText('Edit your goal',{exact:true}).click();const input=t.page.getByLabel('Application goal for the past 7 days',{exact:true});await input.fill('60');state.unavailable=true;
  await t.page.getByRole('button',{name:'Save goal',exact:true}).click();await t.page.getByText('Goal saved. Application progress could not be checked.',{exact:true}).waitFor();
  assert.equal(state.goal,60);assert.equal(await input.inputValue(),'60');assert.equal(await t.page.locator('#goalProgress').isVisible(),false);assert.doesNotMatch(await t.page.locator('#goalProgressText').innerText(),/reached/);
  assert.match(await t.page.locator('#week').innerText(),/Application count unavailable/);await input.fill('70');
  state.unavailable=false;state.applied=1;state.asOf='2026-11-13T20:00:00.000Z';await t.page.getByRole('button',{name:'Check progress again',exact:true}).click();
  await t.page.getByText('1 of 60 applications recorded in the past 7 days.',{exact:true}).waitFor();assert.equal(await input.inputValue(),'70','a read-only retry preserves an unsaved input draft');assert.deepEqual(state.writes,[{goal:60}]);
 }finally{await t.context.close();}
});
test('a newer saved goal from the fresh read wins over the earlier accepted write receipt',{timeout:12000},async()=>{
 const state=fixture({goal:80,concurrentGoal:90}),t=await openScreen(browser,'career-home.html',state.api,PHONE,'','/api/career-hunter/home');t.page.setDefaultTimeout(3000);
 try{
  await t.page.getByText('Edit your goal',{exact:true}).click();const input=t.page.getByLabel('Application goal for the past 7 days',{exact:true});await input.fill('60');state.applied=2;
  await t.page.getByRole('button',{name:'Save goal',exact:true}).click();await t.page.getByText('2 of 90 applications recorded in the past 7 days.',{exact:true}).waitFor();assert.equal(await input.inputValue(),'90');assert.deepEqual(state.writes,[{goal:60}]);assert.doesNotMatch(await t.page.locator('#goalProgressText').innerText(),/reached/);
 }finally{await t.context.close();}
});
