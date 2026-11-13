/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise truthful unscored states and explicit per-job fit checks on synthetic saved jobs without generating documents or bulk scoring.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A failed matching receipt retains earlier fit evidence while reporting failure and offering retry.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Delayed posting responses cannot overwrite a newer completed per-job fit receipt.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen,playwright,PHONE,DESKTOP} from './helpers/ux-page.mjs';
let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

function fixture(mode='success') {
  const state={mode,writes:[],job:{id:7,title:'Fixture role',company:'Fixture employer',location:'Austin, TX',
    status:'new',favorite:true,active:1,has_resume:false,has_cover:false,
    board:{phase:'failed',error:'resume_required',requestId:'old-fixture',completedAt:'2026-11-01T12:00:00Z'}}};
  state.api=({method,url,body})=>{
    const p=url.pathname;
    if(method==='POST')state.writes.push({path:p,body});
    if(p==='/api/career-hunter/jobs/7/generate'&&method==='POST'){
      if(mode==='refused')return {status:503,json:{error:'Fixture scoring service unavailable.'}};
      if(mode==='pending'){state.requestId=body.requestId;return {status:202,json:{ok:true,status:'scoring',requestId:body.requestId}};}
      state.job={...state.job,...(mode==='success'?{ai_fit_score:83,ai_fit_rationale:'Synthetic fit result.'}:mode==='failed-with-score'?{ai_fit_score:61,ai_fit_rationale:'Earlier synthetic assessment retained.'}:{}),
        board:{requestId:body.requestId,completedAt:'2026-11-12T18:00:00Z',phase:mode==='success'?'scored':'failed',error:mode==='success'?null:'score_unavailable'}};
      return {status:202,json:{ok:true,status:'scoring',requestId:body.requestId}};
    }
    if(p==='/api/career-hunter/jobs/7')return {json:{job:state.job}};
    if(p==='/api/career-hunter/jobs')return {json:{jobs:[state.job],exhausted:true,exclusions:[]}};
    if(p==='/api/career-hunter/jobs/stats')return {json:{saved:1,byStatus:[{status:'new',n:1}]}};
    if(p==='/api/career-hunter/applications')return {json:{applications:[]}};
    if(p==='/api/career-hunter/resume/state')return {json:{hasResume:true}};
    if(p==='/api/career-hunter/readiness')return {json:{}};
    if(p==='/api/career-hunter/gaps')return {json:{gaps:[]}};
    if(p==='/api/auth/user')return {json:{authenticated:false}};
    return {json:{}};
  };
  return state;
}

for(const [label,size] of [['phone',PHONE],['computer',DESKTOP]]) {
  test(`${label}: an ended check says Not scored yet and checks only the selected job`,{timeout:12000},async()=>{
    const state=fixture(),t=await openScreen(browser,'career-job-lists.html',state.api,size);
    try {
      const row=t.page.locator('[data-job-id="7"]');await row.waitFor();
      assert.match(await row.innerText(),/Not scored yet/);
      assert.doesNotMatch(await row.innerText(),/AI assessment pending/);
      const button=row.getByRole('button',{name:'Check my fit',exact:true});
      assert.ok((await button.boundingBox()).height>=44);
      await button.click();
      await row.getByText(/AI fit 83/).waitFor();
      assert.equal(state.writes.length,1);assert.equal(state.writes[0].path,'/api/career-hunter/jobs/7/generate');
      assert.equal(state.writes[0].body.documents,false);assert.equal(typeof state.writes[0].body.requestId,'string');
      assert.ok(state.writes[0].body.requestId);assert.equal(state.job.has_resume,false);assert.equal(state.job.has_cover,false);
      assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
    } finally {await t.context.close();}
  });
}

for(const mode of ['refused','failed']) {
  test(`${mode}: a fit check never invents a score and remains retryable`,{timeout:12000},async()=>{
    const state=fixture(mode),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE);
    try {
      const row=t.page.locator('[data-job-id="7"]'),button=row.getByRole('button',{name:'Check my fit',exact:true});
      await button.click({timeout:3000});
      await t.page.locator('#actionState').getByText(mode==='refused'?'Fixture scoring service unavailable.':/could not be checked/i).waitFor();
      assert.equal(await button.isEnabled(),true);assert.match(await row.innerText(),/Not scored yet/);
      assert.doesNotMatch(await row.innerText(),/AI fit \d+/);assert.equal(state.writes.length,1);
    } finally {await t.context.close();}
  });
}

test('the posting sheet can check an unscored saved job without preparing an application',{timeout:12000},async()=>{
  const state=fixture(),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE);
  try {
    await t.page.getByRole('button',{name:'Fixture role',exact:true}).click();
    const dialog=t.page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Check my fit',exact:true}).click({timeout:3000});
    await dialog.getByText(/AI fit 83/).waitFor();
    assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.documents,false);
  } finally {await t.context.close();}
});

test('an unsaved posting tells the truth without silently saving it for a fit check',{timeout:12000},async()=>{
  const state=fixture();state.job.favorite=false;
  const t=await openScreen(browser,'career-job-lists.html',state.api,DESKTOP,'?view=matches');
  try {
    const row=t.page.locator('[data-job-id="7"]');await row.waitFor();
    assert.match(await row.innerText(),/Not scored yet/);
    assert.equal(await row.getByRole('button',{name:'Check my fit',exact:true}).count(),0);
    await row.getByRole('button',{name:'Fixture role',exact:true}).click();
    const dialog=t.page.getByRole('dialog');
    await dialog.getByText('Not scored yet',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Check my fit',exact:true}).count(),0);
    assert.match(await dialog.innerText(),/Save this job to check your fit/);
    assert.deepEqual(state.writes,[]);assert.equal(state.job.favorite,false);
  } finally {await t.context.close();}
});

test('a running selected-job check is shared between its row and posting sheet',{timeout:12000},async()=>{
  const state=fixture('pending'),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE);
  try {
    const row=t.page.locator('[data-job-id="7"]');
    await row.getByRole('button',{name:'Check my fit',exact:true}).click();
    assert.equal(await row.getByRole('button',{name:'Checking my fit…',exact:true}).isDisabled(),true);
    await row.getByRole('button',{name:'Fixture role',exact:true}).click();
    const dialog=t.page.getByRole('dialog'),checking=dialog.getByRole('button',{name:'Checking my fit…',exact:true});
    await checking.waitFor();assert.equal(await checking.isDisabled(),true);
    await checking.dispatchEvent('click');assert.equal(state.writes.length,1,'a duplicate entry point cannot submit another check');
    state.job={...state.job,ai_fit_score:83,ai_fit_rationale:'Synthetic fit result.',
      board:{requestId:state.requestId,completedAt:'2026-11-12T18:00:00Z',phase:'scored',error:null}};
    await dialog.getByText(/AI fit 83/).waitFor();await row.getByText(/AI fit 83/).waitFor();
    assert.equal(state.writes.length,1);
  } finally {await t.context.close();}
});

test('a failed posting-sheet check keeps its reason and retry inside the sheet',{timeout:12000},async()=>{
  const state=fixture('failed'),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE);
  try {
    await t.page.getByRole('button',{name:'Fixture role',exact:true}).click();
    const dialog=t.page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Check my fit',exact:true}).click();
    await dialog.getByText(/Its fit could not be checked/).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Check my fit',exact:true}).isEnabled(),true);
    assert.match(await dialog.innerText(),/Not scored yet/);assert.doesNotMatch(await dialog.innerText(),/AI fit \d+/);
    assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.documents,false);
  } finally {await t.context.close();}
});

test('a failed receipt cannot claim success from an earlier fit score',{timeout:12000},async()=>{
  const state=fixture('failed-with-score'),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE);
  try {
    await t.page.getByRole('button',{name:'Fixture role',exact:true}).click();
    const dialog=t.page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Check my fit',exact:true}).click();
    await dialog.getByText(/Its fit could not be checked/).waitFor({timeout:4000});
    assert.match(await dialog.innerText(),/AI fit 61/,'earlier real evidence remains visible');
    assert.equal(await dialog.getByRole('button',{name:'Check my fit',exact:true}).isEnabled(),true);
    assert.doesNotMatch(await t.page.locator('#actionState').innerText(),/Fit checked:/);
    assert.equal(state.writes.length,1);
  } finally {await t.context.close();}
});

test('a delayed posting read cannot replace a fit that completed after it started',{timeout:12000},async()=>{
  const state=fixture('pending'),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE);
  let release;
  try{
    let entered,held=false;const waiting=new Promise(resolve=>{entered=resolve;});
    await t.page.route('**/api/career-hunter/jobs/7',async route=>{
      if(held)return route.fallback();held=true;const earlier=structuredClone(state.job);entered();
      await new Promise(resolve=>{release=async()=>{await route.fulfill({json:{job:earlier}});resolve();};});
    });
    await t.page.locator('[data-check-fit="7"]').waitFor();
    const accepted=t.page.waitForResponse(response=>response.url().endsWith('/jobs/7/generate')&&response.status()===202);
    await t.page.evaluate(()=>{document.querySelector('[data-check-fit="7"]').click();document.querySelector('[data-posting="7"]').click();});
    await waiting;await accepted;
    state.job={...state.job,ai_fit_score:83,ai_fit_rationale:'Synthetic fit result.',
      board:{requestId:state.requestId,completedAt:'2026-11-12T18:00:00Z',phase:'scored',error:null}};
    await t.page.locator('[data-job-id="7"]').getByText(/AI fit 83/).waitFor();
    await release();release=null;
    await t.page.getByRole('dialog').getByText(/AI fit 83/).waitFor({timeout:3000});
    assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.documents,false);
  }finally{if(release)await release();await t.context.close();}
});
