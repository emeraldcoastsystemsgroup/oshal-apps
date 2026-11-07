/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (calling-assistant--calling-settings, SPLIT): eighteen setup
 *   fields came before Run a call, answers were raw JSON and Start call looked enabled with no Twilio connection. In
 *   headless Chromium over a loopback fixture: Calls opens first; with no connection it is one empty state with one
 *   primary (Connections in a new tab) and Check again that says it is still not connected; Start call is disabled with
 *   its reason while calling is off; answers are rows that write the same JSON; reports are newest first with badges and
 *   a status filter; nothing overflows at 412px. No call is placed (POST /tasks is never reached).
 * -----------------------------------------------------------------------------
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
const {defaults}=require('../routes/policy');

async function fixture({connections,enabled=false,tasks=[]}) {
  const app=express(),posts=[];app.use(express.json());
  app.use((req,_res,next)=>{if(req.method==='POST')posts.push(req.path);next();});
  app.get('/api/calling-assistant/app',(_req,res)=>res.sendFile(path.join(__dirname,'../ui/index.html')));
  app.get('/api/calling-assistant/client.js',(_req,res)=>res.sendFile(path.join(__dirname,'../ui/client.js')));
  app.get('/api/calling-assistant/config',(_req,res)=>res.json({config:{...defaults,connectionId:connections.length?connections[0].id:null},connections,providers:[{id:'local-stt',configured:true}],effectiveEnabled:enabled}));
  app.get('/api/calling-assistant/tasks',(_req,res)=>res.json({tasks}));
  app.get('/shared/*rest',(_req,res)=>res.type('text/plain').send(''));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  return {url:`http://127.0.0.1:${server.address().port}/api/calling-assistant/app`,posts,close:()=>new Promise(r=>server.close(r))};
}
async function withPage(f,viewport,fn){const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(f.url);await fn(page);assert.deepEqual(errors,[]);}finally{await browser.close();await f.close();}}

test('no Twilio connection: Calls is one empty state with one primary and a Check again that answers',async()=>{
  const f=await fixture({connections:[]});
  await withPage(f,{width:412,height:915},async(page)=>{
    await page.locator('#noTwilio').waitFor();
    assert.equal(await page.locator('#view-calls').isVisible(),true);
    assert.equal(await page.locator('#newCall').isVisible(),false,'no call form without a connection');
    assert.equal(await page.locator('#view-calls .primary:visible').count(),1);
    const link=page.locator('#noTwilio a.primary');
    assert.equal(await link.getAttribute('href'),'/utilities');assert.equal(await link.getAttribute('target'),'_blank');
    assert.equal(await page.locator('#message').textContent(),'','the setup sentence is not repeated as a banner');
    await page.click('#checkTwilio');
    await page.locator('#checkResult').filter({hasText:'Still no Twilio connection.'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  assert.deepEqual(f.posts,[]);
});

test('calling off: Start call is solid-disabled with its reason; answers are rows that write the JSON',async()=>{
  const f=await fixture({connections:[{id:'11111111-1111-4111-8111-111111111111',label:'Fixture',scope:'personal'}],enabled:false});
  await withPage(f,{width:1440,height:900},async(page)=>{
    await page.locator('#newCall').waitFor();
    assert.equal(await page.locator('#startCall').isDisabled(),true);
    assert.match(await page.locator('#startWhy').textContent(),/Calling is off/);
    assert.equal(await page.locator('#answerRows .answer-row').count(),1,'the default answer is one row');
    await page.click('#addAnswer');
    const row=page.locator('#answerRows .answer-row').nth(1);
    await row.locator('input.when').fill('press one for claims');await row.locator('select').selectOption('digits');await row.locator('input').nth(1).fill('1');
    assert.deepEqual(JSON.parse(await page.locator('#responses').inputValue()),[{prompt:'say claims',say:'claims'},{prompt:'press one for claims',digits:'1'}]);
    await row.getByRole('button',{name:'Actions for this answer'}).click();await row.getByRole('menuitem',{name:'Remove'}).click();
    assert.deepEqual(JSON.parse(await page.locator('#responses').inputValue()),[{prompt:'say claims',say:'claims'}]);
    const rowHeight=(id)=>page.locator(id).evaluate(el=>el.closest('label').getBoundingClientRect().height);
    assert.ok(await rowHeight('#approveCall')>=44,'#approveCall is a 44px row');
    await page.click('#tab-settings');
    for(const id of ['#consent','#enabled']){const box=await page.locator(id).evaluate(el=>el.closest('label').getBoundingClientRect().height);assert.ok(box>=44,id+' is a 44px row');}
  });
  assert.deepEqual(f.posts,[]);
});

test('call reports are newest first with status badges and a status filter',async()=>{
  const at=(h)=>new Date(Date.now()-h*36e5).toISOString();
  const tasks=[{id:'a',status:'completed',outcome:'carrier_completed',created_at:at(5)},{id:'b',status:'failed',outcome:'handoff_busy',created_at:at(1)},{id:'c',status:'completed',outcome:'',created_at:at(3)}];
  const f=await fixture({connections:[{id:'11111111-1111-4111-8111-111111111111',label:'Fixture',scope:'personal'}],enabled:true,tasks});
  await withPage(f,{width:1440,height:900},async(page)=>{
    await page.locator('#tasks .task').first().waitFor();
    assert.deepEqual(await page.locator('#tasks .badge').allTextContents(),['failed','completed','completed'],'newest first');
    assert.match(await page.locator('#tasks .badge').first().getAttribute('class'),/bad/);
    await page.selectOption('#taskStatus','failed');
    assert.equal(await page.locator('#tasks .task').count(),1);
    await page.selectOption('#taskStatus','');await page.fill('#taskSearch','carrier');
    assert.equal(await page.locator('#tasks .task').count(),1);
  });
});

test('the answer row menu is opaque (the page colour, not the 62%-white card tone)', () => {
  const html = require('node:fs').readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  assert.match(html, /\.answer-menu\[popover\]\{[^}]*background:var\(--bg-primary\);/);
});
