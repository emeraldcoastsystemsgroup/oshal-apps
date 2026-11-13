/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove Career-only native account setup in the actual Settings screen with isolated OAuth and caller metadata fixtures.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const card=page=>page.locator('#careerAccounts');
const AT='2026-11-11T18:00:00.000Z';
function saved(status='connected'){return {connector:'gmail',account:'primary',liveness:status,status,renewable:status==='renewable',shared:false,expiresAt:null};}
function state(options={}){return {rows:[],social:false,status:200,mail:{status:'not-checked',lastSuccessAt:null,lastCheckedAt:null},...options};}
function api(s){return ({url})=>{
  if(url.pathname==='/connectors')return {status:s.status,json:s.malformed?{}:{connectors:[{id:'gmail',display_name:'Gmail',auth:{kind:s.gmailAuth||'o_auth'}},{id:'facebook',auth:{kind:'o_auth'}},{id:'schwab',auth:{kind:'o_auth'}}],connections:s.rows}};
  if(url.pathname==='/api/career-hunter/jobs/updates')return {json:s.mail};
  if(url.pathname==='/api/career-hunter/companies-admin')return {status:s.admin?200:403,json:{}};
  if(url.pathname==='/api/ui/profile')return s.refusedProfile?{status:403,json:{}}:{json:{profile:{ribbon:{items:[
    {id:'tool-career-hunter--career-settings',label:'Settings',toolUi:{iframeUrl:'/api/career-hunter/settings'}},
    ...(s.social?[{id:'tool-social--social-workspace',label:'Workspace',toolUi:{iframeUrl:'/api/social/workspace'}}]:[])]}}}};
  if(url.pathname==='/api/auth/user')return {json:{authenticated:true,displayName:'Fixture Person'}};
  if(url.pathname==='/api/career-hunter/title-profile/state')return {json:{titleTerms:[],remoteOnly:false}};
  if(url.pathname==='/api/v1/agent/schedules')return {json:{schedules:[]}};
  return {json:{}};
};}
async function open(s,size=DESKTOP,query='#accounts'){
  const h=await openScreen(browser,'career-settings.html',api(s),size,query,'/api/career-hunter/settings');
  assert.equal(await card(h.page).count(),1,'actual Settings includes a Career Accounts section');
  await card(h.page).waitFor();
  await h.page.waitForFunction(()=>document.querySelector('#careerAccountsState').dataset.loaded==='true');
  return h;
}
async function announce(page,ok=true){await page.evaluate(ok=>{const c=new BroadcastChannel('oshal-connections');c.postMessage({type:'connect-outcome',connector:'gmail',ok,text:ok?'Gmail is connected.':'Canceled by person.'});c.close();},ok);}
const noActions=calls=>assert.equal(calls.some(c=>['POST','DELETE','PATCH'].includes(c.method)),false,'opening and callback do not check mail, activate schedules or write credentials');

for(const [size,label] of [[PHONE,'phone'],[DESKTOP,'desktop']])test(`${label}: Career Accounts shows only Gmail, dated mailbox evidence and44px controls`,async()=>{
  const s=state({rows:[saved(),{connector:'facebook',account:'personal',status:'connected'},{connector:'outlook',account:'work',status:'connected'}],mail:{status:'ok',lastSuccessAt:AT,lastCheckedAt:AT,mailbox:'fixture@example.invalid',expectedMailbox:'fixture@example.invalid'}});
  const {page,context,calls}=await open(s,size);
  try{
    const text=await card(page).innerText();
    assert.match(text,/Saved Gmail authorization/);
    assert.match(text,/Last successful mailbox check/);
    assert.match(text,/2026|11\/11/);
    assert.doesNotMatch(text,/personal|Outlook|Facebook|Schwab|Mail read ready/);
    assert.match(text,/LinkedIn.*signed.in.*browser/s);
    assert.equal(await card(page).getByRole('button',{name:/Disconnect|Choose mailbox/}).count(),0);
    const targets=await card(page).locator('button:visible,a:visible').evaluateAll(es=>es.map(e=>({name:e.textContent,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,min:getComputedStyle(e).minHeight,display:getComputedStyle(e).display})));
    assert.ok(targets.length&&targets.every(e=>e.w>=44&&e.h>=44),JSON.stringify(targets));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    noActions(calls);
    await page.getByRole('button',{name:'‹ Settings'}).click();
    await page.getByRole('list',{name:'Settings sections'}).waitFor();
  }finally{await context.close();}
});

test('saved authorization status never asserts mailbox-read access and labels are safe text',async()=>{
  for(const status of ['connected','renewable','expired','revoked']){
    const row=saved(status);row.account='<img src=x onerror="window.__accountXss=1">';row.shared=true;
    const {page,context,calls}=await open(state({rows:[row]}));
    try{
      const text=await card(page).innerText();
      assert.match(text,/Mailbox access has not been checked/);
      assert.match(text,/<img src=x/);
      assert.match(text,/Shared authorization/);
      assert.equal(await card(page).locator('img').count(),0);
      assert.equal(await page.evaluate(()=>window.__accountXss),undefined);
      assert.match(text,status==='renewable'?/Renews when used/:status==='expired'?/Sign in again/:status==='revoked'?/Revoked/:/Saved Gmail authorization/);
      noActions(calls);
    }finally{await context.close();}
  }
});

test('generic Google grant is not proof of Gmail-read access; metadata failure remains unknown',async()=>{
  for(const s of [state({rows:[{connector:'google',account:'primary',status:'connected'}]}),state({status:403}),state({status:503}),state({malformed:true})]){
    const {page,context}=await open(s);
    try{
      assert.doesNotMatch(await card(page).innerText(),/Mail read ready|Gmail is connected/);
      assert.match(await card(page).innerText(),s.status===200&&!s.malformed?/No saved Gmail authorization/:/Saved authorization is unavailable/);
      assert.equal(await card(page).getByRole('button',{name:'Connect Gmail',exact:true}).isEnabled(),s.status===200&&!s.malformed);
    }finally{await context.close();}
  }
});

test('OAuth uses explicit native popup and persisted readback, never a broadcast or query badge',async()=>{
  const s=state();const {page,context,calls}=await open(s,DESKTOP,'?connected=gmail#accounts');
  try{
    await page.evaluate(()=>{window.__opened=[];window.open=(...args)=>{window.__opened.push(args);return null;};});
    await card(page).getByRole('button',{name:'Connect Gmail',exact:true}).click();
    const opened=await page.evaluate(()=>window.__opened);
    assert.equal(opened.length,1);assert.equal(opened[0][1],'_blank');assert.equal(opened[0][2],'noopener');
    const url=new URL(opened[0][0],'http://career.fixture.test');
    assert.equal(url.origin,'http://career.fixture.test');assert.equal(url.pathname,'/api/connect/gmail/start');
    assert.equal(url.searchParams.get('return'),'/utilities?connected=gmail&window=connect');
    assert.match(await card(page).innerText(),/Waiting for Gmail/);
    await announce(page);
    await page.waitForFunction(()=>document.querySelector('#careerAccountsState').textContent.includes('No saved Gmail'));
    assert.doesNotMatch(await card(page).innerText(),/Gmail is connected/);
    s.rows=[saved()];await announce(page);
    await card(page).getByRole('button',{name:'Refresh account status'}).click();
    await page.waitForFunction(()=>document.querySelector('#careerAccountsState').textContent.includes('Saved Gmail authorization'));
    assert.match(await card(page).innerText(),/Mailbox access has not been checked/);
    noActions(calls);
    const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
    assert.doesNotMatch(storage,/access_token|refresh_token|client_secret/);
  }finally{await context.close();}
});

test('a canceled OAuth attempt is said without inventing a saved connection',async()=>{
  const {page,context}=await open(state());
  try{
    await page.evaluate(()=>{window.open=()=>null;});
    await card(page).getByRole('button',{name:'Connect Gmail',exact:true}).click();
    await announce(page,false);
    await page.waitForFunction(()=>document.querySelector('#careerAccountsNotice').textContent.includes('Canceled by person'));
    assert.match(await card(page).innerText(),/No saved Gmail authorization/);
  }finally{await context.close();}
});

test('optional Social link comes only from the actual admitted profile and never implies LinkedIn OAuth',async()=>{
  for(const s of [state(),state({social:true}),state({social:true,refusedProfile:true})]){
    const {page,context}=await open(s);
    try{
      await page.waitForFunction(()=>document.querySelector('#careerSocialAccount').dataset.loaded==='true');
      assert.equal(await card(page).getByRole('link',{name:'Open optional Social workspace'}).count(),Number(s.social&&!s.refusedProfile));
      assert.doesNotMatch(await card(page).innerText(),/LinkedIn is connected|Connect LinkedIn|Connect Facebook/);
    }finally{await context.close();}
  }
});

test('opening the Settings home does not automatically read connection or mailbox metadata',async()=>{
  const {page,context,calls}=await openScreen(browser,'career-settings.html',api(state()),PHONE,'','/api/career-hunter/settings');
  try{
    assert.equal(await page.getByRole('list',{name:'Settings sections'}).getByRole('link',{name:/^Accounts/}).count(),1);
    assert.equal(calls.some(c=>c.path==='/connectors'||c.path==='/api/career-hunter/jobs/updates'),false);
    noActions(calls);
    await page.getByRole('list',{name:'Settings sections'}).getByRole('link',{name:/^Accounts/}).click();
    await page.waitForFunction(()=>document.querySelector('#careerAccountsState').dataset.loaded==='true');
    assert.equal(calls.some(c=>c.path==='/connectors'),true);
    assert.equal(calls.some(c=>c.path==='/api/career-hunter/jobs/updates'),true);
    noActions(calls);
  }finally{await context.close();}
});

test('an unavailable native OAuth declaration cannot start a ceremony',async()=>{
  const {page,context,calls}=await open(state({gmailAuth:'api_key'}));
  try{
    assert.equal(await card(page).getByRole('button',{name:'Connect Gmail',exact:true}).isEnabled(),false);
    assert.match(await card(page).innerText(),/No saved Gmail authorization/);
    noActions(calls);
  }finally{await context.close();}
});

test('stopping OAuth waiting retains saved state and closes the callback listener',async()=>{
  const {page,context,calls}=await open(state());
  try{
    await page.evaluate(()=>{window.open=()=>null;});
    await card(page).getByRole('button',{name:'Connect Gmail',exact:true}).click();
    await card(page).getByRole('button',{name:'Stop waiting',exact:true}).click();
    assert.match(await card(page).innerText(),/Stopped waiting.*not been changed/s);
    assert.equal(await card(page).getByRole('link',{name:'Open Gmail sign-in again'}).isVisible(),false);
    await announce(page);
    assert.match(await card(page).innerText(),/No saved Gmail authorization/);
    noActions(calls);
  }finally{await context.close();}
});

test('native sign-in waiting ends after ten minutes without asserting authorization',async()=>{
  const {page,context,calls}=await open(state());
  try{
    await page.clock.install();
    await page.evaluate(()=>{window.open=()=>null;});
    await card(page).getByRole('button',{name:'Connect Gmail',exact:true}).click();
    await page.clock.fastForward(600001);
    await page.waitForFunction(()=>document.querySelector('#careerAccountsNotice').textContent.includes('Stopped waiting for sign-in'));
    assert.match(await card(page).innerText(),/No saved Gmail authorization/);
    assert.equal(await card(page).getByRole('button',{name:'Stop waiting',exact:true}).isVisible(),false);
    noActions(calls);
  }finally{await context.close();}
});
