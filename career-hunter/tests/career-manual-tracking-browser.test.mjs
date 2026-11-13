/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise manual interview, offer and closed application controls on the shipped page with synthetic data at phone and desktop sizes.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen,playwright,PHONE,DESKTOP} from './helpers/ux-page.mjs';
let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

function fixture() {
  const state={job:{id:7,title:'Fixture role',company:'Fixture employer',status:'applied',applied_at:'2026-11-01T12:00:00Z',
    application_source:'manual-mark',has_resume:false,has_cover:false,board:{},application:{needsGeneration:false,draft:{revision:0,experienceIds:[]}}},writes:[],refuse:false};
  state.api=({method,url,body})=>{
    if(url.pathname==='/api/career-hunter/jobs/7')return {json:{job:state.job}};
    if(url.pathname==='/api/career-hunter/jobs/7/status'&&method==='POST'){
      state.writes.push(body);
      if(state.refuse)return {status:503,json:{error:'Fixture storage unavailable; nothing was saved.'}};
      state.job={...state.job,status:body.status,interview_at:body.interview_at,
        board:{manualTracking:{status:body.status,interviewAt:body.interview_at,recordedAt:'2026-11-12T18:00:00Z'}}};
      return {json:{ok:true,status:body.status}};
    }
    if(url.pathname==='/api/career-hunter/experience-bank')return {json:{version:1,revision:'fixture',entries:[]}};
    if(url.pathname==='/api/career-hunter/resume/state')return {json:{hasResume:true}};
    if(url.pathname==='/api/guest/session')return {json:{guest:false,active:false}};
    if(url.pathname==='/api/auth/user')return {json:{authenticated:true,sub:'fixture-person'}};
    if(url.pathname==='/api/v1/agent/schedules')return {json:{schedules:[]}};
    return {json:{}};
  };
  return state;
}

for(const [label,size] of [['phone',PHONE],['computer',DESKTOP]]) {
  test(`${label}: manually record an interview with local time, then offer and closed`, {timeout:20000}, async()=>{
    const state=fixture(),t=await openScreen(browser,'career-application.html',state.api,
      {...size,locale:'en-US',timezoneId:'America/Chicago'},'?view=status&application=7');
    try {
      await t.page.getByRole('heading',{name:'Application status',exact:true}).waitFor();
      for(const name of ['I have an interview','I got an offer','It closed'])
        assert.ok((await t.page.getByRole('button',{name,exact:true}).boundingBox()).height>=44);
      await t.page.getByRole('button',{name:'I have an interview',exact:true}).click({timeout:3000});
      await t.page.getByLabel('Interview date and time', {exact:true}).fill('2026-11-20T09:30');
      const save=t.page.getByRole('button',{name:'Save interview',exact:true});
      assert.ok((await save.boundingBox()).height>=44);
      await save.click();
      await t.page.getByText(/Interview recorded for/).waitFor();
      assert.deepEqual(state.writes,[{status:'interview',interview_at:'2026-11-20T15:30:00.000Z'}]);
      assert.match(await t.page.locator('#sentLine').innerText(),/November 20|11\/20\/2026/);
      assert.match(await t.page.locator('#sentLine').innerText(),/9:30/);
      assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
      await t.page.getByRole('button',{name:'I got an offer',exact:true}).click();
      await t.page.getByText('Offer recorded.').waitFor();
      await t.page.getByRole('button',{name:'It closed',exact:true}).click();
      await t.page.getByText('Application closed.').waitFor();
      assert.deepEqual(state.writes.slice(1),[{status:'offer'},{status:'rejected'}]);
      assert.match(await t.page.locator('#sentLine').innerText(),/You recorded/);
    } finally {await t.context.close();}
  });
}

test('a refused outcome retains the input and never announces it as saved', {timeout:15000}, async()=>{
  const state=fixture();state.refuse=true;
  const t=await openScreen(browser,'career-application.html',state.api,PHONE,'?view=status&application=7');
  try {
    await t.page.getByRole('button',{name:'I have an interview',exact:true}).click({timeout:3000});
    await t.page.getByLabel('Interview date and time',{exact:true}).fill('2026-11-20T09:30');
    await t.page.getByRole('button',{name:'Save interview',exact:true}).click();
    await t.page.getByText('Fixture storage unavailable; nothing was saved.').waitFor();
    assert.equal(state.job.status,'applied');
    assert.equal(await t.page.getByLabel('Interview date and time',{exact:true}).inputValue(),'2026-11-20T09:30');
    assert.doesNotMatch(await t.page.locator('#message').innerText(),/Interview recorded/);
  } finally {await t.context.close();}
});

test('Interviewing shows the saved date in the phone user time zone', {timeout:10000}, async()=>{
  const state=fixture(),at='2026-11-20T15:30:00.000Z';
  state.job={...state.job,status:'interview',board:{manualTracking:{status:'interview',interviewAt:at}}};
  const api=request=>{
    if(request.url.pathname==='/api/career-hunter/jobs')return {json:{jobs:[state.job],exhausted:true}};
    if(request.url.pathname==='/api/career-hunter/jobs/stats')return {json:{saved:0,byStatus:[{status:'interview',n:1}]}};
    if(request.url.pathname==='/api/career-hunter/applications')return {json:{applications:[]}};
    return state.api(request);
  };
  const t=await openScreen(browser,'career-job-lists.html',api,{...PHONE,locale:'en-US',timezoneId:'America/Chicago'},'?view=interviewing');
  try {
    const line=t.page.locator('[data-job-id="7"] .reply-line');
    await line.waitFor();
    assert.match(await line.innerText(),/Interview · 11\/20\/2026, 9:30:00 AM/);
    assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  } finally {await t.context.close();}
});
