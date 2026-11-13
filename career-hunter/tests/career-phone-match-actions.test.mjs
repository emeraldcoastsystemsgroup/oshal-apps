/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real phone match-action hit targets above the frame bar, unobscured status, accessible filters/view controls and nearby navigation over synthetic local fixtures.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Await the visible post-resize control placement rather than racing the browser's asynchronous matchMedia event.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen,playwright,PHONE} from './helpers/ux-page.mjs';
let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const entry=(name,label,path)=>({id:'tool-career-'+name,label,toolUi:{iframeUrl:'/api/career-hunter/'+path,visibilityToolName:'career-'+name}});
const PROFILE={ribbon:{items:[entry('home','Home','home'),entry('search','Find jobs','search-ui'),entry('board','My jobs','board-native'),entry('resume-studio','My résumé','resume-studio'),entry('strengthen','Improve my résumé','strengthen-ui')]}};
const sizes=[[412,915],[412,743],[390,844]];

function fixture(){
  const state={writes:[],jobs:Array.from({length:6},(_,i)=>({id:101+i,title:'Fixture role '+(i+1),company:'Fixture employer '+(i+1),location:'Austin, TX',status:'new',favorite:false,active:1,ai_fit_score:83,ai_fit_rationale:'Synthetic fit explanation. '.repeat(20)}))};
  state.api=({method,url,body})=>{
    const p=url.pathname;
    if(method==='POST'){state.writes.push({path:p,body});return {json:{ok:true}};}
    if(p==='/api/ui/profile')return {json:{profile:PROFILE}};
    if(p==='/api/auth/user')return {json:{authenticated:false}};
    if(p==='/api/career-hunter/jobs')return {json:{jobs:state.jobs,exhausted:true,exclusions:[]}};
    if(p==='/api/career-hunter/jobs/stats')return {json:{saved:0,byStatus:[]}};
    if(p==='/api/career-hunter/applications')return {json:{applications:[]}};
    if(p==='/api/career-hunter/resume/state')return {json:{hasResume:true}};
    if(p==='/api/career-hunter/strengthen')return {json:{themes:[],total:0}};
    return {json:{}};
  };
  return state;
}
const phone=(width,height)=>({...PHONE,viewport:{width,height}});
async function matches(state,size){
  const t=await openScreen(browser,'career-job-lists.html',state.api,size,'?view=matches','/api/career-hunter/board-native');
  await t.page.locator('.cf-bottombar:not([hidden])').waitFor();await t.page.locator('.match-card.lead').waitFor();return t;
}

for(const [width,height] of sizes){
  test(`${width}x${height}: Save and Pass start above the bar and status never covers them`,{timeout:12000},async()=>{
    const state=fixture(),t=await matches(state,phone(width,height));
    try {
      const bar=await t.page.locator('.cf-bottombar').boundingBox();
      for(const name of ['undo','pass','save','more']){
        const button=t.page.locator('[data-deck-act="'+name+'"]'),box=await button.boundingBox();
        assert.ok(box.height>=44&&box.width>=44,name+' has a 44 px target');
        assert.ok(box.y>=0&&box.y+box.height<=bar.y-8,name+' starts above the bottom bar');
        const hit=await button.evaluate(el=>{const b=el.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('[data-deck-act]')?.dataset.deckAct;});
        assert.equal(hit,name,name+' receives the tap at its centre');
      }
      assert.match(await t.page.locator('.match-deck').innerText(),/Swipe right to save or left to pass/);
      const save=await t.page.locator('[data-deck-act="save"]').boundingBox();
      await t.page.touchscreen.tap(save.x+save.width/2,save.y+save.height/2);
      await t.page.locator('#actionState').getByText(/Saved:/).waitFor();
      const status=await t.page.locator('#actionState').boundingBox(),actions=await t.page.locator('.match-deck-actions').boundingBox();
      assert.ok(status.y>=0&&status.y+status.height<=actions.y-4,'the visible status is above the buttons');
      const pass=await t.page.locator('[data-deck-act="pass"]').boundingBox();
      await t.page.touchscreen.tap(pass.x+pass.width/2,pass.y+pass.height/2);
      await t.page.waitForFunction(()=>document.getElementById('actionState').textContent.startsWith('Removed:'));
      assert.deepEqual(state.writes.filter(x=>x.path.endsWith('/status')),[{path:'/api/career-hunter/jobs/101/status',body:{favorite:true}},{path:'/api/career-hunter/jobs/102/status',body:{status:'dismissed'}}]);
      assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
    }finally{await t.context.close();}
  });
}

test('phone match search and view controls live in Filters and return on a computer',{timeout:12000},async()=>{
  const state=fixture(),t=await matches(state,phone(412,743));
  try{
    for(const id of ['keywordSearch','searchModes'])assert.equal(await t.page.locator('#'+id).isVisible(),false,id+' is out of the card workspace');
    await t.page.getByRole('button',{name:'Filters',exact:true}).click();const sheet=t.page.getByRole('dialog',{name:'Filters'});
    for(const id of ['keywordSearch','searchModes','matchesLayoutSwitch'])assert.equal(await sheet.locator('#'+id).isVisible(),true,id+' is in the sheet');
    await sheet.getByRole('tab',{name:'List',exact:true}).click();
    await sheet.getByRole('searchbox').fill('Fixture');await sheet.getByRole('button',{name:'Search',exact:true}).click();
    await sheet.getByRole('button',{name:'Done',exact:true}).click();await t.page.locator('.job-row').first().waitFor();
    assert.ok(t.calls.some(c=>c.method==='GET'&&c.path.startsWith('/api/career-hunter/jobs?')&&new URLSearchParams(c.path.split('?')[1]).get('q')==='Fixture'));
    await t.page.setViewportSize({width:1440,height:900});
    await t.page.locator('#keywordSearch').waitFor({state:'visible'});await t.page.locator('#searchModes').waitFor({state:'visible'});
    assert.equal(await t.page.locator('#keywordSearch').evaluate(el=>Boolean(el.closest('dialog'))),false);
  }finally{await t.context.close();}
});

test('all My jobs stage tabs remain visible at 360 px without sideways scrolling',{timeout:12000},async()=>{
  const state=fixture(),t=await matches(state,phone(360,800));
  try{
    const tabs=t.page.locator('#careerStages [role="tab"]');assert.equal(await tabs.count(),4);
    for(const tab of await tabs.all()){const b=await tab.boundingBox();assert.ok(b.height>=44);assert.ok(b.x>=0&&b.x+b.width<=360,await tab.innerText());}
    assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  }finally{await t.context.close();}
});

test('phone section links have 44 px targets',{timeout:12000},async()=>{
  const state=fixture(),t=await openScreen(browser,'career-strengthen.html',state.api,phone(390,844),'','/api/career-hunter/strengthen-ui');
  try{
    const tabs=t.page.locator('.cf-subnav:not([hidden]) a');await tabs.first().waitFor();assert.ok(await tabs.count()>=2);
    for(const tab of await tabs.all()){const b=await tab.boundingBox();assert.ok(b.height>=44,await tab.innerText()+' is '+b.height+'px');}
  }finally{await t.context.close();}
});
