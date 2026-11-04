/** Exercise the real activity page and client protocol without contacting an employer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'));
const {chromium}=deps('playwright');
const html=await readFile(new URL('../../tools/career-submissions.html',import.meta.url),'utf8');
const submit=await readFile(new URL('../../tools/career-submit.js',import.meta.url),'utf8');
const id='ab000000-0000-0000-0000-000000000001',ticket='ac000000-0000-0000-0000-000000000001',work='ad000000-0000-0000-0000-000000000001';
const bot='cb000000-0000-0000-0000-000000000004';

async function fixture(t,patch={}){
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let item={id,postingId:101,title:'Fixture engineer',company:'Fixture employer',status:'queued',
    authorizationExpiresAt:new Date(Date.now()+3600000).toISOString(),updatedAt:new Date().toISOString(),...patch};
  const writes=[];let loseStart=false,failSync=false;
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());assert.equal(url.origin,'http://career-fixture.test');
    const path=url.pathname;
    if(path==='/api/career-hunter/submissions')return route.fulfill({contentType:'text/html',body:html});
    if(path==='/api/career-hunter/static/career-submit.js')return route.fulfill({contentType:'text/javascript',body:submit});
    if(path.startsWith('/api/career-hunter/static/'))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',
      body:await readFile(new URL('../../tools/'+path.split('/').at(-1),import.meta.url),'utf8')});
    if(path.startsWith('/shared/ui/'))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',
      body:await readFile(resolve(process.env.OSHAL_CORE_ROOT,'src'+path),'utf8')});
    if(!path.startsWith('/api/career-hunter/')&&path!=='/api/apply-operator/workers')return route.fulfill({body:''});
    if(req.method()==='POST')writes.push({path,body:req.postDataJSON()});
    let result={};
    if(path==='/api/apply-operator/workers')result={available:true,workers:[{available:true,boundBots:[bot]}]};
    else if(path.endsWith('/applications'))result={applications:[]};
    else if(path.endsWith('/jobs'))result={jobs:[]};
    else if(path.endsWith('/submission-queue'))result={items:[item]};
    else if(path.endsWith('/bind')){assert.equal(item.nativeTicketId,undefined);item={...item,nativeTicketId:ticket};result={item};}
    else if(path.endsWith('/start')){
      assert.equal(item.nativeTicketId,ticket);assert.equal(item.nativeWorkId,undefined);
      item={...item,nativeWorkId:work,status:'claimed'};result={item};
      if(loseStart){loseStart=false;return route.abort();}
    }else if(path.endsWith('/sync')){
      if(failSync)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Native status temporarily unavailable.'})});
      result={item};
    }else assert.fail('Unexpected fixture route '+path);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://career-fixture.test/api/career-hunter/submissions');
  await page.getByText('Fixture engineer',{exact:true}).waitFor();
  return {page,writes,get item(){return item;},set item(value){item=value;},loseStart:()=>{loseStart=true;},failSync:value=>{failSync=value;}};
}

test('an interrupted approval resumes once; a lost start response recovers the same work',async t=>{
  const f=await fixture(t);f.loseStart();
  await f.page.getByRole('button',{name:'Resume approved submission',exact:true}).click();
  await f.page.getByText('Worker claimed this application.',{exact:true}).waitFor();
  assert.equal(f.item.nativeTicketId,ticket);assert.equal(f.item.nativeWorkId,work);
  assert.deepEqual(f.writes.filter(r=>!r.path.endsWith('/sync')).map(r=>r.path),[
    '/api/career-hunter/submission-queue/'+id+'/bind','/api/career-hunter/submission-queue/'+id+'/start']);
  assert.match(await f.page.locator('#submissionNotice').innerText(),/connection interrupted/);
  assert.equal(await f.page.getByRole('button',{name:'Resume approved submission',exact:true}).count(),0);
  assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
});

test('an unavailable native status leaves a recoverable error and never starts blindly',async t=>{
  const f=await fixture(t,{nativeTicketId:ticket});f.failSync(true);
  await f.page.getByRole('button',{name:'Resume approved submission',exact:true}).click();
  await f.page.getByText('Native status temporarily unavailable.',{exact:true}).waitFor();
  assert.ok(f.writes.every(r=>r.path.endsWith('/sync')));
  f.failSync(false);
  await f.page.getByRole('button',{name:'Resume approved submission',exact:true}).click();
  await f.page.getByText('Worker claimed this application.',{exact:true}).waitFor();
  assert.equal(f.writes.filter(r=>r.path.endsWith('/start')).length,1);
  assert.equal(f.writes.filter(r=>r.path.endsWith('/bind')).length,0);
});

test('expired and uncertain intents cannot be resumed, even through the client helper',async t=>{
  for(const patch of [{authorizationExpiresAt:'2000-01-01T00:00:00Z'},{status:'unknown'}]){
    const f=await fixture(t,patch);
    assert.equal(await f.page.getByRole('button',{name:'Resume approved submission',exact:true}).count(),0);
    const outcome=await f.page.evaluate(async id=>{try{return {item:await CareerSubmit.resumeApproved(id)};}catch(e){return {error:e.message};}},id);
    if(patch.status)assert.equal(outcome.item.status,'unknown');else assert.match(outcome.error,/approval expired/);
    assert.equal(f.writes.length,0);
  }
});
