/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual Settings score/stop controls and narrow layout in an isolated browser with synthetic native responses; no installation or provider is contacted.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, startFixture } from './career-theme-fixture.mjs';

const RUN='12345678-1234-4234-8234-123456789012';
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

async function setup(t,{canCancel=true}={}){
  const fixture=await startFixture();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  t.after(async()=>{await context.close();await fixture.close();});
  let phase='running',stopResponse='cancelling';const posts=[];
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==fixture.origin)return route.abort();
    if(url.pathname==='/api/career-hunter/run/score'){
      assert.equal(request.method(),'POST');posts.push({path:url.pathname,body:request.postDataJSON()});
      return route.fulfill({status:202,json:{ok:true,started:true,state:'running',runId:RUN,limit:1,freshDays:7}});
    }
    if(url.pathname==='/api/career-hunter/runs'){
      const run={runId:RUN,state:phase,canCancel:canCancel&&phase==='running'};
      if(phase==='succeeded')Object.assign(run,{scored:1,skipped:0,limit:1});
      return route.fulfill({json:{source:'native',runs:[run]}});
    }
    if(url.pathname==='/api/career-hunter/_runtime/runs/'+RUN+'/cancel'){
      assert.equal(request.method(),'POST');posts.push({path:url.pathname,body:request.postDataJSON()});
      if(stopResponse==='finishing')return route.fulfill({status:409,json:{ok:false,runId:RUN,state:'finishing'}});
      return route.fulfill({status:202,json:{ok:true,runId:RUN,state:'cancelling',cancellationRequested:true}});
    }
    return route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.origin+'/fixture/settings');
  await page.frameLocator('iframe[title="Career screen"]').locator('#runScore').waitFor({state:'visible'});
  const surface=page.frames().find(frame=>frame.url()===fixture.origin+'/api/career-hunter/settings');
  assert.ok(surface,'the real Settings document is loaded in its themed parent');
  await surface.locator('#scoreLimit').fill('1');
  await surface.locator('#runScore').click();
  await surface.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('Scoring is running'));
  return {page:surface,tab:page,posts,errors,setPhase:value=>{phase=value;},setStopResponse:value=>{stopResponse=value;}};
}

test('the real narrow Settings page waits for the exact stopped receipt after a stop request',async t=>{
  const f=await setup(t);
  assert.equal(await f.page.locator('#cancelScore').isVisible(),true);
  await f.page.locator('#cancelScore').click();
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('Stop requested'));
  assert.deepEqual(f.posts,[
    {path:'/api/career-hunter/run/score',body:{limit:1}},
    {path:'/api/career-hunter/_runtime/runs/'+RUN+'/cancel',body:{}},
  ]);
  assert.doesNotMatch(await f.page.locator('#runOut').innerText(),/was cancelled/);
  f.setPhase('cancelling');
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('Stopping scoring'));
  assert.equal(await f.page.locator('#runScore').isDisabled(),true);
  f.setPhase('cancelled');
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent==='Scoring was cancelled.');
  assert.equal(await f.page.locator('#runScore').isEnabled(),true);
  assert.equal(await f.page.locator('#cancelScore').isVisible(),false);
  assert.deepEqual(f.errors,[]);
  assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),
    'the 390px Settings page must not overflow horizontally');
  if(process.env.CAREER_BROWSER_PROOF_DIR){
    await mkdir(process.env.CAREER_BROWSER_PROOF_DIR,{recursive:true});
    await f.page.locator('#runScore').scrollIntoViewIfNeeded();
    await f.tab.screenshot({path:join(process.env.CAREER_BROWSER_PROOF_DIR,'score-cancelled-narrow.png')});
  }
});

test('a final-publication response is followed to its saved score result rather than called cancelled',async t=>{
  const f=await setup(t);f.setStopResponse('finishing');
  await f.page.locator('#cancelScore').click();
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('already saving'));
  f.setPhase('finishing');
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('Scoring is saving'));
  assert.doesNotMatch(await f.page.locator('#runOut').innerText(),/cancelled/);
  f.setPhase('succeeded');
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('1 job updated'));
  assert.equal(await f.page.locator('#cancelScore').isVisible(),false);
  assert.deepEqual(f.errors,[]);
});

test('kernels without cancellation keep the stop control hidden while normal scoring remains usable',async t=>{
  const f=await setup(t,{canCancel:false});
  assert.equal(await f.page.locator('#cancelScore').isVisible(),false);
  f.setPhase('succeeded');
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('1 job updated'));
  assert.equal(await f.page.locator('#runScore').isEnabled(),true);
  assert.equal(f.posts.length,1);
  assert.deepEqual(f.errors,[]);
});

test('reloading Settings resumes the acknowledged scoring task without issuing another start',async t=>{
  const f=await setup(t);
  await f.page.goto(f.page.url());
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('Scoring is running'));
  assert.equal(f.posts.length,1,'reload polls the same run instead of starting another score pass');
  assert.equal(await f.page.locator('#scoreLimit').inputValue(),'1');
  assert.equal(await f.page.locator('#cancelScore').isVisible(),true);
  await f.page.locator('#cancelScore').click();
  f.setPhase('cancelled');
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent==='Scoring was cancelled.');
  assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('career.score-ack.v1')),null);
  assert.deepEqual(f.errors,[]);
});

test('a stale tab acknowledgement cannot select or stop a different active run',async t=>{
  const f=await setup(t);
  await f.page.evaluate(()=>sessionStorage.setItem('career.score-ack.v1',JSON.stringify({runId:'99999999-9999-4999-8999-999999999999',limit:1})));
  await f.page.goto(f.page.url());
  await f.page.waitForFunction(()=>document.querySelector('#runOut').textContent.includes('completion could not be confirmed'));
  assert.equal(await f.page.locator('#cancelScore').isVisible(),false);
  assert.equal(f.posts.length,1,'a stale acknowledgement never starts or stops any run');
  assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('career.score-ack.v1')),null);
  assert.deepEqual(f.errors,[]);
});
