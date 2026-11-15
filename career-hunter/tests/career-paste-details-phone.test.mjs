/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "even if we can only see their title .. at least run it up with a warning and make the user get the position details and paste them before generating the resume"). The shipped pages and frame in Chromium at 412x915 with touch, over a made-up person's fixture at the pages' real addresses. New matches' phone card and My jobs' row of a job Career could not read say Details needed with the warning and Open the posting, inside the window's width. Prepare application, step 1 · Tailor of that job shows "Paste the job description from the posting" with Open the posting beside it; Generate résumé & cover letter is off, and the line under the box says why, until 200 characters are pasted; then it is on, reachable above Career's bottom bar, and its press sends the pasted text with the request. A job whose description the person pasted offers Replace the description you pasted, and a job with its own description has no box.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {openScreen,playwright,PHONE} from './helpers/ux-page.mjs';

let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

const SHOTS=process.env.CAREER_PASTE_SHOTS||'';
const entry=(name,label,path)=>({id:'tool-career-'+name,label,toolUi:{iframeUrl:'/api/career-hunter/'+path,visibilityToolName:'career-'+name}});
const PROFILE={ribbon:{items:[entry('home','Home','home'),entry('search','Find jobs','search-ui'),entry('board','My jobs','board-native'),entry('resume-studio','My résumé','resume-studio'),entry('strengthen','Improve my résumé','strengthen-ui')]}};
const MARK={kind:'needs-details',score:null,assessedAt:'2026-11-15T07:30:00.000Z',model:null,inputRecorded:false,currentness:'not-applicable',keyword:40};
const POSTING='https://jobs.invented-freight.example/careers/warehouse-lead-5';
const unread=()=>({id:5,title:'Warehouse Lead',company:'Invented Freight',location:'Reno, NV',status:'new',favorite:true,active:1,posted_date:'2026-11-14',url:POSTING,
  ai_fit_score:null,fit_score:40,fit_assessment:MARK,has_resume:false,has_cover:false,board:{favorite:true},
  application:{needsGeneration:true,draft:{revision:0,guidance:'',experienceIds:[]}}});
const PASTED='Invented warehouse lead. Duties: run the invented dock, train three invented colleagues and keep invented records on time. '.repeat(3);

function fixture(job){
  const state={job,writes:[]};
  state.api=({method,url,body})=>{
    const p=url.pathname;
    if(p==='/api/ui/profile')return {json:{profile:PROFILE}};
    if(p==='/api/auth/user')return {json:{authenticated:true,sub:'olive'}};
    if(p==='/api/career-hunter/jobs/5/generate'&&method==='POST'){state.writes.push({path:p,body});return {status:202,json:{ok:true,status:'generating',requestId:body.requestId}};}
    if(p==='/api/career-hunter/jobs/5'&&method==='GET')return {json:{job:state.job}};
    if(p==='/api/career-hunter/jobs/5/status'&&method==='POST'){state.writes.push({path:p,body});return {json:{ok:true,application:state.job.application}};}
    if(p==='/api/career-hunter/jobs')return {json:{jobs:[state.job],exhausted:true,exclusions:[]}};
    if(p==='/api/career-hunter/jobs/stats')return {json:{saved:1,matches:1,byStatus:[]}};
    if(p==='/api/career-hunter/applications')return {json:{applications:[]}};
    if(p==='/api/career-hunter/experience-bank')return {json:{version:1,revision:'r1',entries:[]}};
    if(p==='/api/career-hunter/resume/state')return {json:{hasResume:true}};
    if(p==='/api/v1/agent/schedules')return {json:{schedules:[]}};
    return {json:{}};
  };
  return state;
}
const shot=async(page,name)=>{if(!SHOTS)return;mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:SHOTS+'/'+name+'.png',fullPage:false});};
/** Where a control is and whether a tap at its middle reaches it. */
const place=(locator)=>locator.evaluate(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
  return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right),reached:Boolean(hit&&node.contains(hit)),width:innerWidth,height:innerHeight};});
const noSideways=(page)=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);

async function tailor(state){
  const t=await openScreen(browser,'career-application.html',state.api,PHONE,'?view=queue&application=5','/api/career-hunter/board-native');
  const errors=[];t.page.on('pageerror',error=>errors.push(error.message));
  await t.page.locator('.cf-bottombar:not([hidden])').waitFor();
  await t.page.getByRole('heading',{name:'What should this application emphasize?'}).waitFor();
  return {...t,errors};
}

test('phone, New matches: the card of a job Career could not read says Details needed and how to get the details',{timeout:20000},async()=>{
  const state=fixture({...unread(),favorite:false,board:{}});
  const t=await openScreen(browser,'career-job-lists.html',state.api,PHONE,'?view=matches','/api/career-hunter/board-native');
  try{
    const card=t.page.locator('.match-card.lead');await card.waitFor();
    const words=await card.innerText();
    assert.match(words,/Warehouse Lead/);assert.match(words,/Invented Freight/);assert.match(words,/Details needed/);
    assert.match(words,/Career could not read this job’s details\. Open the posting and paste its description in Prepare application to get your fit and a tailored résumé\./);
    const link=card.getByRole('link',{name:'Open the posting ↗'});assert.equal(await link.getAttribute('href'),POSTING);assert.equal(await link.getAttribute('target'),'_blank');
    const box=await place(card);assert.ok(box.left>=0&&box.right<=box.width,'the card is inside the window: '+JSON.stringify(box));
    assert.ok(await noSideways(t.page),'no sideways scroll');
    await shot(t.page,'after-new-matches-card-412x915');
  }finally{await t.context.close();}
});

test('phone, My jobs: the row of a job Career could not read has the warning and no Check my fit',{timeout:20000},async()=>{
  const state=fixture(unread());
  const t=await openScreen(browser,'career-job-lists.html',state.api,PHONE,'','/api/career-hunter/board-native');
  try{
    const row=t.page.locator('.job-row[data-job-id="5"]');await row.waitFor();
    const words=await row.innerText();
    assert.match(words,/Details needed/);assert.match(words,/Career could not read this job’s details/);assert.doesNotMatch(words,/Not scored yet|Check my fit/);
    assert.equal(await row.getByRole('button',{name:'Prepare application'}).isVisible(),true,'Prepare application leads to the paste box');
    const link=await place(row.getByRole('link',{name:'Open the posting ↗'}));
    assert.ok(link.bottom-link.top>=44&&link.right<=link.width,'Open the posting is a 44 px target inside the window: '+JSON.stringify(link));
    assert.ok(await noSideways(t.page));
    await shot(t.page,'after-my-jobs-row-412x915');
  }finally{await t.context.close();}
});

test('phone, Prepare application, 1 · Tailor: the paste box, Generate off until 200 characters, then reachable and sending the text',{timeout:30000},async()=>{
  const state=fixture(unread()),t=await tailor(state),page=t.page;
  try{
    const box=page.locator('#pasteBox');
    assert.equal(await box.getByRole('heading').innerText(),'Job details needed');
    assert.match(await box.innerText(),/Career could not read this job’s details\. Open the posting, copy the whole job description and paste it here\./);
    const area=page.getByLabel('Paste the job description from the posting');assert.equal(await area.isVisible(),true);
    const link=box.getByRole('link',{name:'Open the posting ↗'});assert.equal(await link.getAttribute('href'),POSTING);
    const generate=page.getByRole('button',{name:'Generate résumé & cover letter'});
    assert.equal(await generate.isDisabled(),true,'off before anything is pasted');
    assert.equal(await page.locator('#pasteCount').innerText(),'0 of at least 200 characters. Generate résumé & cover letter is off until the job description is pasted.');
    for(const part of [box,area,link,generate]){const at=await place(part);assert.ok(at.left>=0&&at.right<=at.width,'inside the width: '+JSON.stringify(at));}
    assert.ok(await noSideways(page));
    const steps=await page.locator('.steps').boundingBox(),boxAt=await box.boundingBox();
    assert.ok(boxAt.y>=steps.y+steps.height-1&&boxAt.y<915,'the box is the first thing under the steps, in the first screen');
    await shot(page,'after-tailor-empty-412x915');
    await area.tap();await area.fill('x'.repeat(150));
    assert.equal(await generate.isDisabled(),true,'150 characters is not a description');
    assert.match(await page.locator('#pasteCount').innerText(),/^150 of at least 200 characters\./);
    await area.fill(PASTED+'   ');
    assert.equal(await generate.isDisabled(),false,'on once a description is pasted');
    assert.match(await page.locator('#pasteCount').innerText(),new RegExp('^'+PASTED.trim().length+' characters pasted\\. Career uses this as the job description\\.$'));
    await generate.scrollIntoViewIfNeeded();
    const button=await place(generate),bar=await page.locator('.cf-bottombar').boundingBox();
    assert.ok(button.bottom<=bar.y+1,'Generate is above Career\'s bottom bar: '+JSON.stringify({button,bar}));
    assert.ok(button.top>=0&&button.reached,'nothing covers Generate: '+JSON.stringify(button));
    assert.ok(button.bottom-button.top>=44,'a 44 px target');
    await shot(page,'after-tailor-pasted-412x915');
    // The page redraws as it saves its draft: the pasted text stays in the box.
    await page.getByLabel('Tailoring notes').fill('Made-up note');await page.waitForTimeout(900);
    assert.equal((await area.inputValue()).trim(),PASTED.trim(),'the paste survives the draft save');
    await generate.tap();
    await page.waitForFunction(()=>document.getElementById('applicationState')?.textContent==='Generating documents');
    const sent=state.writes.filter(write=>write.path.endsWith('/generate'));
    assert.equal(sent.length,1);assert.equal(sent[0].body.documents,true);assert.equal(sent[0].body.jobDescription,PASTED.trim(),'the press sends the pasted text');
    assert.equal(state.writes.filter(write=>write.path.endsWith('/status')).some(write=>JSON.stringify(write.body).includes('invented dock')),false,'the paste is not put in the saved draft');
    assert.deepEqual(t.errors,[]);
  }finally{await t.context.close();}
});

test('phone: a pasted description can be replaced, and a job with its own description has no box',{timeout:20000},async()=>{
  const mine=fixture({...unread(),description:PASTED.trim(),description_context:{basis:'person-pasted'},fit_assessment:{kind:'ai'},ai_fit_score:71});
  let t=await tailor(mine);
  try{
    const replace=t.page.locator('details#pasteBox');assert.equal(await replace.locator('summary').innerText(),'Replace the description you pasted');
    assert.equal(await t.page.getByRole('button',{name:'Generate résumé & cover letter'}).isDisabled(),false,'today\'s flow: Generate is on');
    await replace.locator('summary').tap();
    assert.match(await replace.innerText(),/Career uses the description you pasted for this job\. Paste a new one here to replace it\./);
    assert.equal(await t.page.getByLabel('Paste the job description from the posting').isVisible(),true);
  }finally{await t.context.close();}
  const listed=fixture({...unread(),description:'Invented employer text. '.repeat(80),description_context:{basis:'employer-detail'},fit_assessment:{kind:'ai'},ai_fit_score:66});
  t=await tailor(listed);
  try{
    assert.equal(await t.page.locator('#pasteBox').count(),0,'no paste box when Career has the description');
    assert.equal(await t.page.getByRole('button',{name:'Generate résumé & cover letter'}).isDisabled(),false);
  }finally{await t.context.close();}
});
