/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.1 (Lane VER15 on the test server, 2026-11-15: with 0 characters pasted Generate résumé & cover letter, or Retry generation, was off but drawn in the same colour as when on, background rgb(15, 95, 115), and a tap did nothing). The shipped application page and frame in Chromium at 412x915 with touch, over a made-up person's fixture at the page's real address. With nothing pasted the button is disabled and aria-disabled, and its computed fill, ink and border are the page's disabled look, not the on button's; the line under the box says why; a tap sends nothing; at 199 characters it is still off; at 200 it is on, aria-disabled is gone and it is drawn as the on button again. The same holds for Retry generation on a job the nightly pass did not mark whose last preparation stopped for missing details (job_details_unavailable, or job_context_unavailable with no description), whose notice says to paste the description in Prepare application, step 1 · Tailor; a marked job that stopped for another reason keeps that reason's words. CAREER_PASTE_DISABLED_SHOTS names a folder for phone screenshots of the off and on button.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {openScreen,playwright,PHONE} from './helpers/ux-page.mjs';

let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

const SHOTS=process.env.CAREER_PASTE_DISABLED_SHOTS||'';
const entry=(name,label,path)=>({id:'tool-career-'+name,label,toolUi:{iframeUrl:'/api/career-hunter/'+path,visibilityToolName:'career-'+name}});
const PROFILE={ribbon:{items:[entry('home','Home','home'),entry('search','Find jobs','search-ui'),entry('board','My jobs','board-native'),entry('resume-studio','My résumé','resume-studio')]}};
const MARK={kind:'needs-details',score:null,assessedAt:'2026-11-15T07:30:00.000Z',model:null,inputRecorded:false,currentness:'not-applicable',keyword:40};
const KEYWORD={kind:'keyword',score:40,assessedAt:null,model:null,inputRecorded:false,currentness:'not-applicable'};
const NEEDED='Career could not read this job’s details, so it cannot check your fit or write a résumé for it yet. Open the job’s posting, copy the job description, paste it in Prepare application, step 1 · Tailor, and generate your résumé and cover letter there.';
const job=patch=>({id:7,title:'Principal Invented Designer',company:'Invented Analog',location:'Austin, TX',status:'new',favorite:true,active:1,posted_date:'2026-11-14',
  url:'https://jobs.invented-analog.example/careers/7',ai_fit_score:null,fit_score:40,has_resume:false,has_cover:false,
  application:{needsGeneration:true,draft:{revision:0,guidance:'',experienceIds:[]}},...patch});
const marked=()=>job({fit_assessment:MARK,board:{favorite:true},details_needed:NEEDED});
const stopped=error=>job({fit_assessment:KEYWORD,board:{favorite:true,phase:'failed',error,requestId:'r-1',completedAt:'2026-11-15T02:35:00.000Z'},
  application:{needsGeneration:true,failed:true,draft:{revision:0,guidance:'',experienceIds:[]}},details_needed:NEEDED});
/* Exactly 200 made-up characters: the fewest the page accepts as a description. */
const TWO_HUNDRED=('Invented role. Design invented converters and review invented layouts with two invented teams each week. ').repeat(2).slice(0,200);

function fixture(value){
  const state={job:value,writes:[]};
  state.api=({method,url,body})=>{
    const p=url.pathname;
    if(p==='/api/ui/profile')return {json:{profile:PROFILE}};
    if(p==='/api/auth/user')return {json:{authenticated:true,sub:'olive'}};
    if(p==='/api/career-hunter/jobs/7/generate'&&method==='POST'){state.writes.push({path:p,body});return {status:202,json:{ok:true,status:'generating',requestId:body.requestId}};}
    if(p==='/api/career-hunter/jobs/7'&&method==='GET')return {json:{job:state.job}};
    if(p==='/api/career-hunter/jobs/7/status'&&method==='POST'){state.writes.push({path:p,body});return {json:{ok:true,application:state.job.application}};}
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
async function tailor(state){
  const t=await openScreen(browser,'career-application.html',state.api,PHONE,'?view=queue&application=7','/api/career-hunter/board-native');
  const errors=[];t.page.on('pageerror',error=>errors.push(error.message));
  await t.page.locator('.cf-bottombar:not([hidden])').waitFor();
  await t.page.getByRole('heading',{name:'What should this application emphasize?'}).waitFor();
  return {...t,errors};
}
/** How the browser draws a control: its fill, ink, border, cursor and opacity. */
const look=locator=>locator.evaluate(node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,color:s.color,border:s.borderTopColor,cursor:s.cursor,opacity:s.opacity};});
const accent=page=>page.evaluate(()=>{const probe=document.createElement('span');probe.style.color='var(--accent)';document.body.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value;});
const shot=async(page,locator,name)=>{if(!SHOTS)return;mkdirSync(SHOTS,{recursive:true});await locator.evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:SHOTS+'/'+name+'.png',fullPage:false});};

/** Off at 0 and 199 characters (disabled, aria-disabled, drawn off, a tap sends nothing), on at exactly 200. */
async function offUntilPasted(t,state,name,shots){
  const page=t.page,generate=page.getByRole('button',{name});
  assert.equal(await generate.isDisabled(),true,'off before anything is pasted');
  assert.equal(await generate.getAttribute('aria-disabled'),'true','a screen reader says it is unavailable');
  assert.equal(await page.locator('#pasteCount').innerText(),'0 of at least 200 characters. Generate résumé & cover letter is off until the job description is pasted.');
  const off=await look(generate),on=await accent(page);
  assert.notEqual(off.background,on,'not filled with the on colour: '+JSON.stringify({off,on}));
  assert.equal(off.cursor,'default');assert.equal(off.opacity,'1','drawn opaque, as the design standard asks');
  if(shots)await shot(page,generate,shots[0]);
  await generate.tap({force:true});await page.waitForTimeout(200);
  assert.equal(state.writes.filter(write=>write.path.endsWith('/generate')).length,0,'a tap on the off button sends nothing');
  const area=page.getByLabel('Paste the job description from the posting');
  await area.fill(TWO_HUNDRED.slice(0,199));
  assert.equal(await generate.isDisabled(),true,'199 characters is not a description');assert.equal(await generate.getAttribute('aria-disabled'),'true');
  assert.deepEqual(await look(generate),off,'still drawn off');
  await area.fill(TWO_HUNDRED);
  assert.equal(Array.from(TWO_HUNDRED.trim()).length,200);
  assert.equal(await generate.isDisabled(),false,'on at 200 characters');assert.equal(await generate.getAttribute('aria-disabled'),null);
  assert.equal(await page.locator('#pasteCount').innerText(),'200 characters pasted. Career uses this as the job description.');
  const ready=await look(generate);
  assert.equal(ready.background,on,'filled with the on colour again: '+JSON.stringify(ready));
  for(const key of ['background','color','border'])assert.notEqual(ready[key],off[key],key+' differs between off and on');
  if(shots)await shot(page,generate,shots[1]);
  assert.deepEqual(t.errors,[]);
}

test('phone, a marked job: Generate résumé & cover letter is drawn off until 200 characters are pasted',{timeout:30000},async()=>{
  const state=fixture(marked()),t=await tailor(state);
  try{await offUntilPasted(t,state,'Generate résumé & cover letter',['disabled-generate-0-characters-412x915','enabled-generate-200-characters-412x915']);}
  finally{await t.context.close();}
});

for(const error of ['job_details_unavailable','job_context_unavailable']){
  test(`phone, a job the nightly pass did not mark that stopped with ${error}: the paste words, and Retry generation drawn off`,{timeout:30000},async()=>{
    const state=fixture(stopped(error)),t=await tailor(state);
    try{
      const notice=await t.page.locator('.notice.error').innerText();
      assert.equal(notice,'Preparation needs attention: '+NEEDED+' Your saved notes, selections and previous documents are retained.');
      assert.equal(await t.page.locator('#pasteBox').getByRole('heading').innerText(),'Job details needed');
      await offUntilPasted(t,state,'Retry generation',error==='job_details_unavailable'?['disabled-retry-0-characters-412x915','enabled-retry-200-characters-412x915']:null);
    }finally{await t.context.close();}
  });
}

test('phone, a marked job whose preparation stopped for another reason keeps that reason’s words, and Generate stays drawn off',{timeout:30000},async()=>{
  const state=fixture(job({...stopped('renderer_unavailable'),fit_assessment:MARK})),t=await tailor(state);
  try{
    const notice=await t.page.locator('.notice.error').innerText();
    assert.match(notice,/^Preparation needs attention: This server cannot make PDF documents right now\./,notice);
    const retry=t.page.getByRole('button',{name:'Retry generation'});
    assert.equal(await retry.isDisabled(),true);assert.equal(await retry.getAttribute('aria-disabled'),'true');
    assert.notEqual((await look(retry)).background,await accent(t.page));
    assert.deepEqual(t.errors,[]);
  }finally{await t.context.close();}
});
