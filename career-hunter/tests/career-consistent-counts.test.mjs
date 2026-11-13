/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep Home, New matches and Review truthful about the same synthetic personal match, saved and application states while preserving dated score activity.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen,playwright,PHONE,DESKTOP} from './helpers/ux-page.mjs';
let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const items=[['home','Home','home'],['search','Find jobs','search-ui'],['board','My jobs','board-native'],['review','Career Review','review']].map(([name,label,path])=>({id:'tool-career-'+name,label,toolUi:{iframeUrl:'/api/career-hunter/'+path,visibilityToolName:'career-'+name}}));
const profile={ribbon:{items}},metric=(id,value,label=id)=>({id,value:String(value),label});
function fixture(options={}){
  const state={stats:{matches:0,saved:7,tracked:0,applied:0,interviewing:0,queued:0,byStatus:[{status:'new',n:7}]},...options};
  state.jobs=Array.from({length:7},(_,i)=>({id:i+1,title:'Saved fixture '+(i+1),company:'Fixture employer',location:'Austin, TX',status:'new',favorite:true,active:1}));
  state.api=({method,url})=>{
    const p=url.pathname;
    if(method==='POST')throw Error('Read-only fixture refused a write.');
    if(p==='/cockpit/js/app-handoff.js')return {text:'export function receiveHandoff(){}'};
    if(p==='/cockpit/js/app-workflows.js')return {text:'export async function mountConnectedActions(){}'};
    if(p==='/api/ui/profile')return {json:{profile}};
    if(p==='/api/auth/user')return {json:{authenticated:false}};
    if(p==='/api/career-hunter/jobs/stats')return state.stats===null?{status:503,json:{error:'Synthetic stats unavailable'}}:{json:state.stats};
    if(p==='/api/career-hunter/jobs')return {json:{jobs:url.searchParams.get('status')==='saved'?state.jobs:url.searchParams.get('matches')==='1'?[]:url.searchParams.get('status')==='tracked'?[]:state.jobs,exhausted:true,exclusions:[]}};
    if(p==='/api/career-hunter/applications')return {json:{applications:[]}};
    if(p==='/api/career-hunter/resume/state')return {json:{hasResume:true}};
    if(p==='/api/career-hunter/jobs/updates')return {json:{status:'connected',events:[]}};
    if(p==='/api/career-hunter/home-summary')return {json:{metrics:[metric('scored-24h',state.scored??0,'Scores updated / 24h'),metric('approval-review',0)],items:[{text:'No saved work yet. Open the app to begin.'}]}};
    return {json:{}};
  };
  return state;
}

for(const [name,size] of [['phone',PHONE],['computer',DESKTOP]]){
  test(`${name}: seven saved unscored jobs remain Saved, while Home and New matches agree on zero actionable matches`,{timeout:12000},async()=>{
    const state=fixture({scored:99}),home=await openScreen(browser,'career-home.html',state.api,size,'','/api/career-hunter/home');
    try{
      await home.page.locator('#todayPanel[aria-busy="false"]').waitFor();
      assert.equal(await home.page.locator('.stage[data-stage="matches"] b').innerText(),'0','dated score activity is not a match count');
      assert.equal(await home.page.locator('.stage[data-stage="saved"] b').innerText(),'7');
      assert.equal(await home.page.locator('#today [data-step="matches"]').count(),0);
    }finally{await home.context.close();}
    const matches=await openScreen(browser,'career-job-lists.html',state.api,size,'?view=matches&page=1','/api/career-hunter/board-native');
    try{
      await matches.page.getByRole('heading',{name:'No matches yet',exact:true}).waitFor({timeout:3000});
      assert.equal(await matches.page.locator('.job-row,.match-card').count(),0);
      const calls=matches.calls.filter(c=>c.method==='GET'&&c.path.startsWith('/api/career-hunter/jobs?'));
      assert.equal(new URLSearchParams(calls[0].path.split('?')[1]).get('matches'),'1');
    }finally{await matches.context.close();}
    const saved=await openScreen(browser,'career-job-lists.html',state.api,size,'?view=saved&page=1','/api/career-hunter/board-native');
    try{await saved.page.locator('.job-row').first().waitFor();assert.equal(await saved.page.locator('.job-row').count(),7);}
    finally{await saved.context.close();}
  });
}

for(const [name,size] of [['phone',PHONE],['computer',DESKTOP]]){
  test(`${name}: Review recognizes saved jobs even when every dated score metric is zero`,{timeout:12000},async()=>{
    const state=fixture(),t=await openScreen(browser,'review.html',state.api,size,'','/api/career-hunter/review');
    try{
      const saved=t.page.locator('a.metric').filter({hasText:/Saved jobs/});await saved.waitFor({timeout:3000});
      assert.equal(await saved.locator('strong').innerText(),'7');
      assert.equal(await t.page.getByRole('heading',{name:'No career activity yet'}).isVisible(),false);
      assert.equal(await saved.getAttribute('href'),'/api/career-hunter/board-native?view=saved');
    }finally{await t.context.close();}
  });
}

test('Review keeps the actionable match count separate from dated scoring activity',{timeout:12000},async()=>{
  const state=fixture({scored:99,stats:{matches:2,saved:7,tracked:3,queued:1,byStatus:[]}}),t=await openScreen(browser,'review.html',state.api,DESKTOP,'','/api/career-hunter/review');
  try{
    await t.page.getByRole('link',{name:/2\s*New matches/}).waitFor({timeout:3000});
    assert.equal(await t.page.locator('a.metric').filter({hasText:/99\s*Scores updated/}).count(),0,'dated activity does not link to a different match set');
    assert.match(await t.page.locator('#metrics').innerText(),/99/);assert.match(await t.page.locator('#metrics').innerText(),/3[\s\S]*Applications/);
  }finally{await t.context.close();}
});

test('unavailable saved/pipeline counts cannot be declared an empty career',{timeout:12000},async()=>{
  const state=fixture({stats:null}),t=await openScreen(browser,'review.html',state.api,PHONE,'','/api/career-hunter/review');
  try{
    await t.page.getByText('Saved jobs and applications could not be checked.',{exact:true}).waitFor({timeout:3000});
    assert.equal(await t.page.getByRole('heading',{name:'No career activity yet'}).isVisible(),false);
  }finally{await t.context.close();}
});

test('New matches requests the explicit actionable view and shows its honest empty state',{timeout:12000},async()=>{
  const state=fixture(),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE,'?view=matches&page=1','/api/career-hunter/board-native');
  try{
    await t.page.getByRole('heading',{name:'No matches yet',exact:true}).waitFor({timeout:3000});
    const call=t.calls.find(c=>c.method==='GET'&&c.path.startsWith('/api/career-hunter/jobs?'));
    assert.equal(new URLSearchParams(call.path.split('?')[1]).get('matches'),'1');
    assert.equal(await t.page.locator('.job-row,.match-card').count(),0);
  }finally{await t.context.close();}
});

test('all seven actual saved jobs stay visible in Saved before or after match reconciliation',{timeout:12000},async()=>{
  const state=fixture(),t=await openScreen(browser,'career-job-lists.html',state.api,PHONE,'?view=saved&page=1','/api/career-hunter/board-native');
  try{await t.page.locator('.job-row').first().waitFor();assert.equal(await t.page.locator('.job-row').count(),7);}
  finally{await t.context.close();}
});
