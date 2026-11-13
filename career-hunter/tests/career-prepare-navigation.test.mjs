/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Freeze the recovered actual shell transport offline and add shipped writer + application workspace proof, with no native session or network mode.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real nested Career preparation clicks, bounded unknown-write recovery and admitted-parent navigation; a native companion supplies the actual shell listener and installed owner APIs.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {playwright,tools as packageTools,PHONE,DESKTOP,ORIGIN} from './helpers/ux-page.mjs';
const tools=process.env.CAREER_PREPARE_TEST_TOOLS||packageTools;
const actualShell=readFileSync(new URL('./helpers/career-shell-handoffs.fixture.js',import.meta.url),'utf8');
import {writerFixture,closeWriters} from './helpers/career-prepare-writer.mjs';
let browser;
before(async()=>{browser=await playwright().chromium.launch({headless:true});});
after(async()=>{await browser?.close();closeWriters();});
const record=(status='new')=>({id:1,title:'Office manager',company:'Example employer',location:'Austin',status,favorite:true,active:1,ai_fit_score:80,description:'A synthetic role.'});
const profile={planAdmission:'granted',tiles:[{toolName:'career-board',iframeUrl:'/api/career-hunter/board-native'}]};
// Frozen complete shell listener from the queued recovery checkpoint; no native server is contacted.
function parentHtml(){
 return `<meta name="viewport" content="width=device-width,initial-scale=1"><div data-view="tool-career-board"></div><iframe id="frame" src="/api/career-hunter/board-native?view=saved" style="width:100%;height:850px"></iframe><script>
 let activeAppName='career-hunter';const frame=document.getElementById('frame');
 const getAuthHeaders=()=>({}),localAppUrl=value=>value;
 function navigateAppTile(url){window.__navigations=(window.__navigations||[]).concat(url);frame.src=url;}
 ${actualShell}
 bindShellHandoffs(frame);
 </script>`;
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function state(options={}){return {job:record(options.status),writes:[],requests:[],reads:0,profiles:0,hold:null,readHold:null,refuse:false,readRefuse:false,...options};}
async function fixtureReply(route,url,req,s){
 const p=url.pathname;
 if(p==='/api/ui/profile'){s.profiles++;if(s.profileHold)await s.profileHold.promise;return {status:s.profileRefuse?403:200,json:s.profileRefuse?{error:'access withdrawn'}:profile};}
 if(p==='/api/career-hunter/jobs/1/status'){
  if(s.writer){const body=req.postDataJSON();s.writes.push(body);const out=await s.writer.call('POST',body);s.job=(await s.writer.call('GET')).json.job;return out;}
  s.writes.push(req.postDataJSON());if(s.hold)await s.hold.promise;
  if(s.refuse)return {status:s.refuseStatus||409,json:{ok:false,error:s.refuseError||'career_run_in_progress'}};
  if(s.commit!==false)s.job={...s.job,...req.postDataJSON()};return {json:{ok:true}};
 }
 if(p==='/api/career-hunter/jobs/1'){if(s.writer)return s.writer.call('GET');s.reads++;if(s.readHold)await s.readHold.promise;return {status:s.readRefuse?403:200,json:s.readRefuse?{error:'access withdrawn'}:{job:s.job}};}
 if(p==='/api/career-hunter/jobs')return {json:{jobs:[s.job],exhausted:true,exclusions:[]}};
 if(p==='/api/career-hunter/resume/state')return {json:{hasResume:true,indexing:false,roles:1}};
 if(p==='/api/career-hunter/jobs/stats')return {json:{saved:1,queued:0,tracked:0,byStatus:[]}};
 if(p==='/api/career-hunter/experience-bank')return {json:{entries:[],revision:'synthetic-bank'}};
 if(p==='/api/career-hunter/applications')return {json:{applications:[]}};
 if(p==='/api/auth/user')return {json:{authenticated:false}};
 return {json:{}};
}
async function open(s=state(),size=PHONE){
 const origin=ORIGIN;
 const context=await browser.newContext(size);
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin)throw Error('Unexpected external request: '+url.origin);
  if(req.method()!=='GET')s.requests.push({path:url.pathname,body:req.postDataJSON()});
  if(url.pathname==='/prepare-outer')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><iframe id="cockpit" src="/prepare-parent" style="width:100%;height:900px"></iframe>'});
  if(url.pathname==='/prepare-parent')return route.fulfill({contentType:'text/html',body:parentHtml()});
  if(url.pathname==='/api/career-hunter/board-native')return route.fulfill({contentType:'text/html',body:s.workspace&&url.searchParams.has('application')?readFileSync(join(tools,'career-application.html')):url.searchParams.has('application')?'<h1>Application tailoring workspace</h1><button>Generate résumé &amp; cover letter</button>':readFileSync(join(tools,'career-job-lists.html'))});
  const asset=url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if(asset&&existsSync(join(tools,asset[1])))return route.fulfill({contentType:asset[1].endsWith('.css')?'text/css':'application/javascript',body:readFileSync(join(tools,asset[1]))});
  if(/^\/(shared|cockpit|ui)\//.test(url.pathname))return route.fulfill({contentType:'application/javascript',body:''});
  const out=await fixtureReply(route,url,req,s);
  await route.fulfill({status:out.status||200,contentType:'application/json',body:JSON.stringify(out.json)}).catch(()=>{});
 });
 const page=await context.newPage();page.setDefaultTimeout(2500);await page.goto(origin+'/prepare-outer');
 const parent=page.frameLocator('#cockpit'),frame=parent.frameLocator('#frame');
 await frame.locator('.job-row[data-job-id="1"]').waitFor();
 return {context,page,parent,frame,button:frame.locator('[data-open="1"]')};
}
async function close(f,s){s?.hold?.resolve();s?.readHold?.resolve();s?.profileHold?.resolve();await f.context.close();}
 for(const [name,size] of [['phone',PHONE],['desktop',DESKTOP]]){
  test(`${name}: Open application names a prepared job and crosses the nested parent without a writer`,async()=>{
   const s=state({status:'promoted'}),f=await open(s,size);try{
    assert.equal(await f.button.textContent(),'Open application');await f.button.click();
    await f.frame.getByRole('heading',{name:'Application tailoring workspace'}).waitFor();assert.equal(s.writes.length,0);assert.ok(s.profiles>0);
   }finally{await close(f,s);}
  });
  test(`${name}: Prepare makes one explicit supported write then opens tailoring, never generates documents`,async()=>{
   const s=state(),f=await open(s,size);try{
    await f.button.click();await f.frame.getByRole('heading',{name:'Application tailoring workspace'}).waitFor();
    assert.deepEqual(s.writes,[{status:'promoted',favorite:true}]);assert.equal(s.job.status,'promoted');
   }finally{await close(f,s);}
  });
 }
 test('held promotion visibly explains the workspace and keeps duplicate presses from writing',async()=>{
  const s=state({hold:deferred()}),f=await open(s);try{
   await f.button.click();await f.frame.locator('#actionState').getByText(/opening preparation/i).waitFor();
   assert.match(await f.frame.locator('#actionState').textContent(),/generate.*documents|generate.*résumé/i);
   assert.equal(await f.button.isDisabled(),true);
   await f.frame.locator('#openBoardFilters').click();await f.frame.locator('#sort').selectOption('recent');await f.frame.locator('#boardSheetDone').click();await f.frame.locator('.job-row').waitFor();
   assert.equal(await f.button.isDisabled(),true);
   await f.button.evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(s.writes.length,1);
  }finally{await close(f,s);}
 });
 test('known writer refusal restores the same control and never sends navigation',async()=>{
  const s=state({refuse:true}),f=await open(s);try{
   await f.button.click();await f.frame.locator('#actionState').getByText(/working on your account/i).waitFor();
   assert.equal(await f.button.isEnabled(),true);assert.equal(s.profiles,0);assert.equal(s.writes.length,1);
  }finally{await close(f,s);}
 });
 test('refused native parent leaves Open application usable without repeating acknowledged promotion',async()=>{
  const s=state({profileRefuse:true}),f=await open(s);try{
   await f.page.clock.install();await f.button.click();await f.frame.locator('#actionState').getByText('Opening application…',{exact:true}).waitFor();await f.page.clock.fastForward(11000);
   await f.frame.locator('#actionState').getByText(/did not open/i).waitFor();
   assert.equal(await f.button.isEnabled(),true);assert.equal(await f.button.textContent(),'Open application');
   await f.button.click();assert.equal(s.writes.length,1);assert.ok(s.profiles>=1);
  }finally{await close(f,s);}
 });
 test('unknown promotion is checked read-only before another manual write, then opens an acknowledged saved state',async()=>{
  const s=state({hold:deferred()}),f=await open(s);try{
   await f.page.clock.install();await f.button.click();await f.page.clock.fastForward(16000);
   await f.frame.locator('#actionState').getByText(/could not confirm/i).waitFor();assert.equal(await f.button.textContent(),'Check preparation');
   s.job={...s.job,status:'promoted'};await f.button.click();await f.frame.getByRole('heading',{name:'Application tailoring workspace'}).waitFor();
   assert.equal(s.writes.length,1);assert.equal(s.reads,1);
  }finally{await close(f,s);}
 });
 test('read-only reconciliation that finds new state asks for a separate manual retry and makes no second write',async()=>{
  const s=state({hold:deferred(),commit:false}),f=await open(s);try{
   await f.page.clock.install();await f.button.click();await f.page.clock.fastForward(16000);
   await f.frame.locator('#actionState').getByText(/could not confirm/i).waitFor();await f.button.click();
   await f.frame.locator('#actionState').getByText(/not recorded/i).waitFor();assert.equal(s.writes.length,1);assert.equal(s.reads,1);assert.equal(await f.button.textContent(),'Prepare application');
   assert.equal(s.profiles,0);s.hold.resolve();s.hold=null;await f.button.click();await f.frame.getByRole('heading',{name:'Application tailoring workspace'}).waitFor();assert.equal(s.writes.length,2);
  }finally{await close(f,s);}
 });
 test('refused reconciliation cannot retry an unknown write or navigate',async()=>{
  const s=state({hold:deferred(),readRefuse:true}),f=await open(s);try{
   await f.page.clock.install();await f.button.click();await f.page.clock.fastForward(16000);
   await f.frame.locator('#actionState').getByText(/could not confirm/i).waitFor();await f.button.click();
   await f.frame.locator('#actionState').getByText(/could not check/i).waitFor();assert.equal(s.writes.length,1);assert.equal(s.profiles,0);assert.equal(await f.button.textContent(),'Check preparation');
  }finally{await close(f,s);}
 });


for(const [name,size] of [['phone',PHONE],['desktop',DESKTOP]]){
 test(name+': shipped writer persists Prepare for the original owner and real tailoring opens without generating or submitting',async()=>{
  const writer=writerFixture(),other=writerFixture(),s=state({writer,workspace:true}),f=await open(s,size);
  try{
   // Refuse one admitted-parent lookup so the saved acknowledgement must survive on the row.
   s.profileRefuse=true;await f.page.clock.install();await f.button.click();
   await f.frame.locator('#actionState').getByText('Opening application…',{exact:true}).waitFor();await f.page.clock.fastForward(11000);
   await f.frame.locator('#actionState').getByText(/did not open/i).waitFor({timeout:12000});
   assert.equal(await f.button.textContent(),'Open application');
   const saved=await writer.call('GET'),untouched=await other.call('GET');
   assert.equal(saved.json.job.status,'promoted');assert.equal(saved.json.job.favorite,true);
   assert.equal(untouched.json.job.status,'new');assert.equal(Boolean(untouched.json.job.favorite),false);
   s.profileRefuse=false;await f.button.click();
   await f.frame.locator('#guidance').waitFor();
   assert.deepEqual(s.writes,[{status:'promoted',favorite:true}]);
   assert.equal(Boolean((await writer.call('GET')).json.job.has_resume),false);
   assert.deepEqual(s.requests,[{path:'/api/career-hunter/jobs/1/status',body:{status:'promoted',favorite:true}}]);
   assert.equal((await writer.call('POST',{status:'promoted'},null)).status,401);
  }finally{await close(f,s);}
 });
}

test('an uncertain server error requires a read before any further preparation write',async()=>{
 const s=state({refuse:true,refuseStatus:503,refuseError:'synthetic uncertain result'}),f=await open(s);
 try{
  await f.button.click();await f.frame.locator('#actionState').getByText(/could not confirm/i).waitFor();
  assert.equal(await f.button.textContent(),'Check preparation');assert.equal(s.writes.length,1);
  s.job={...s.job,status:'promoted'};await f.button.click();await f.frame.getByRole('heading',{name:'Application tailoring workspace'}).waitFor();
  assert.equal(s.writes.length,1);assert.equal(s.reads,1);
 }finally{await close(f,s);}
});
