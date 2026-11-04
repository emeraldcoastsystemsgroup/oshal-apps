/** Real board interactions retain cards, expanded details and scrolling during delayed reads/writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,startFixture} from './career-theme-fixture.mjs';
const jobs=Array.from({length:50},(_,i)=>({id:i+1,title:'Fixture engineer '+(i+1),company:'Owned employer',status:'promoted',ai_fit_score:85,
  location:'Remote',remote:true,job_type:'fte',description:'Owned fixture description.',url:'https://employer.invalid/'+(i+1)}));
const gate=()=>{let release;const promise=new Promise(done=>{release=done;});return {promise,release};};
async function open(t){
  const fixture=await startFixture({respond:req=>{
    if(req.path.endsWith('/resume/state'))return {body:{hasResume:true,scored:50}};
    if(req.path.endsWith('/jobs/stats'))return {body:{byStatus:[],saved:0}};
    if(/\/jobs\/\d+$/.test(req.path))return {body:{job:jobs.find(j=>j.id===Number(req.path.split('/').at(-1)))}};
  }});
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1280,height:900}});
  const state={feedReads:0,writes:0,holdRead:null,pages:null,queries:[],exclusions:[],holdWrite:null,fail:false,newJobs:null,oldRead:null,pages:null,queries:[],exclusions:[]};
  t.after(async()=>{state.holdRead?.release();state.holdWrite?.release();state.oldRead?.release();await context.close();await browser.close();await fixture.close();});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==fixture.origin)return route.abort();
    if(process.env.CAREER_BOARD_BASELINE&&url.pathname.endsWith('/board-native'))return route.fulfill({contentType:'text/html',body:execFileSync('git',['show','HEAD:career-hunter/tools/career-board.html'],{encoding:'utf8'})});
    if(url.pathname==='/api/career-hunter/jobs'){
      state.feedReads++;state.queries.push(url.searchParams.get('page'));const held=state.holdRead,rows=state.pages?state.pages.slice((Number(url.searchParams.get('page'))-1)*Number(url.searchParams.get('per')),Number(url.searchParams.get('page'))*Number(url.searchParams.get('per'))):state.newJobs||jobs;
      if(held)await held.promise;
      try{return await route.fulfill({status:state.fail?503:200,contentType:'application/json',body:JSON.stringify(state.fail?{error:'Owned temporary failure'}:{jobs:rows,per:Number(url.searchParams.get('per')),exclusions:state.exclusions,exhausted:state.pages?Number(url.searchParams.get('page'))*Number(url.searchParams.get('per'))>=state.pages.length:true})});}
      catch(error){if(!req.failure())throw error;return;}
    }
    if(/\/jobs\/\d+\/status$/.test(url.pathname)){
      state.writes++;if(req.postDataJSON().feedback){const input=req.postDataJSON().feedback;state.feedback=input;if(input.remove)state.exclusions=[];else state.exclusions=[{id:'fixture-rule',postingId:Number(url.pathname.split('/').at(-2)),kind:input.kind,value:input.value?.toLowerCase()||'owned employer',label:input.value||'Owned employer'}];return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,exclusions:state.exclusions})});}if(state.holdWrite)await state.holdWrite.promise;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,favorite:req.postDataJSON().favorite})});
    }
    return route.continue();
  });
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.origin+'/api/career-hunter/board-native');
  await page.locator('#list .card[data-job-id="50"]').waitFor();
  await page.locator('#list').evaluate(list=>{window.emptyPaints=0;new MutationObserver(()=>{if(!list.querySelector('.card'))window.emptyPaints++;}).observe(list,{childList:true});});
  return {page,state,errors};
}
async function position(page,id=20){return page.locator('.card[data-job-id="'+id+'"]').evaluate(el=>({top:el.getBoundingClientRect().top,retained:el.__retained===true,detail:el.querySelector('.detail').hidden}));}

test('starring a scrolled job updates that card without refetching the board or losing details',async t=>{
  const {page,state,errors}=await open(t),row=page.locator('.card[data-job-id="20"]');
  await row.getByRole('button',{name:'Prepare application',exact:true}).click();await row.locator('.detail h3').waitFor();
  await row.evaluate(el=>{el.__retained=true;el.scrollIntoView({block:'center'});});
  const before=await position(page),reads=state.feedReads;state.holdWrite=gate();
  const star=row.getByRole('button',{name:'☆ Star job',exact:true});await star.click();
  assert.equal(await star.isDisabled(),true);assert.equal(await page.locator('#list .card').count(),50);
  state.holdWrite.release();await row.getByRole('button',{name:'★ Starred',exact:true}).waitFor();
  const after=await position(page);assert.equal(after.retained,true);assert.equal(after.detail,false);
  assert.ok(Math.abs(before.top-after.top)<3,JSON.stringify({before,after}));
  assert.equal(state.feedReads,reads);assert.equal(state.writes,1);assert.equal(await page.evaluate(()=>window.emptyPaints),0);assert.deepEqual(errors,[]);
});

test('a pending or failed filter keeps results and scroll; retry reuses unchanged cards',async t=>{
  const {page,state,errors}=await open(t);state.holdRead=gate();
  await page.locator('#min_score').selectOption('70');
  const row=page.locator('.card[data-job-id="20"]');await row.evaluate(el=>{el.__retained=true;el.scrollIntoView({block:'center'});});
  const before=await position(page);assert.equal(await page.locator('#list .card').count(),50);assert.equal(await page.locator('#list').getAttribute('aria-busy'),'true');
  state.fail=true;state.holdRead.release();await page.locator('#retryJobs').waitFor();
  assert.equal(await page.locator('#list .card').count(),50);assert.equal((await position(page)).retained,true);
  assert.ok(Math.abs(before.top-(await position(page)).top)<3);assert.match(await page.locator('#boardRequestStatus').innerText(),/Previous results/);
  state.holdRead=null;state.fail=false;await page.locator('#retryJobs').click();await page.locator('#list[aria-busy="false"]').waitFor();
  assert.equal((await position(page)).retained,true);assert.equal(await page.evaluate(()=>window.emptyPaints),0);assert.deepEqual(errors,[]);
});

test('superseded filter responses cannot replace the latest visible result',async t=>{
  const {page,state,errors}=await open(t);const old=gate();state.holdRead=old;state.oldRead=old;
  await page.locator('#min_score').selectOption('70');
  state.holdRead=null;state.newJobs=[{...jobs[0],id:99,title:'Latest filtered role'}];
  await page.locator('#min_score').selectOption('80');await page.getByText('Latest filtered role',{exact:true}).waitFor();
  old.release();await page.locator('#list[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('#list .card').count(),1);assert.equal(await page.locator('.card[data-job-id="99"]').count(),1);assert.deepEqual(errors,[]);
});

test('Load more crosses 400 results without removing existing cards; Next and Previous return to page top',async t=>{
  const {page,state,errors}=await open(t);state.pages=Array.from({length:475},(_,i)=>({...jobs[0],id:i+1,title:'Dynamic role '+(i+1),url:'https://employer.invalid/'+(i+1)}));
  await page.locator('#days').selectOption('');await page.locator('#boardMore').waitFor();
  await page.locator('.card[data-job-id="20"]').evaluate(el=>el.__retained=true);
  for(let i=1;i<=8;i++){await page.locator('#boardMore').click();await page.locator('.card[data-job-id="'+((i+1)*50)+'"]').waitFor();}
  assert.equal(await page.locator('#list .card').count(),450);assert.equal((await position(page)).retained,true);
  assert.match(await page.locator('#boardPager').innerText(),/Results 1–450/);
  await page.locator('#boardNext').click();await page.locator('.card[data-job-id="475"]').waitFor();
  assert.equal(await page.evaluate(()=>window.scrollY),0);assert.equal(await page.locator('#list .card').count(),25);
  await page.locator('#boardPrev').click();await page.locator('.card[data-job-id="450"]').waitFor();assert.equal(await page.evaluate(()=>window.scrollY),0);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.emptyPaints),0);
});
test('Not interested records a title phrase, removes matching visible cards and supports Undo through saved preferences',async t=>{
  const {page,state,errors}=await open(t);
  await page.locator('.card[data-job-id="20"] [data-job-feedback]').click();
  await page.getByLabel('Why?',{exact:false}).selectOption('title');
  await page.locator('#jobFeedbackDialog input[name=value]').fill('Fixture engineer');
  await page.getByRole('button',{name:'Hide matching jobs',exact:true}).click();
  await page.locator('#jobFeedbackDialog').waitFor({state:'hidden'});assert.deepEqual(state.feedback,{kind:'title',value:'Fixture engineer'});
  assert.equal(await page.locator('#list .card').count(),0);
  await page.locator('#careerExclusions summary').click();await page.locator('#careerExclusions').getByRole('button',{name:'Remove',exact:true}).click();
  await page.locator('.card[data-job-id="50"]').waitFor();assert.deepEqual(state.feedback,{remove:'fixture-rule'});assert.deepEqual(errors,[]);
});

test('repeated employer URLs collapse while distinct requisition IDs remain separate',async t=>{
  const {page,state,errors}=await open(t);state.newJobs=[{...jobs[0],id:1,url:'https://employer.invalid/jobs/one?utm_source=board'}, {...jobs[0],id:2,url:'https://employer.invalid/jobs/one?utm_source=feed'}, {...jobs[0],id:3,url:'https://employer.invalid/jobs/one?jobId=2'}];
  await page.locator('#min_score').selectOption('70');await page.locator('#list[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('#list .card').count(),2);assert.equal(await page.locator('.card[data-job-id="3"]').count(),1);assert.deepEqual(errors,[]);
});
