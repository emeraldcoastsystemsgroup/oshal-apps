/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The configuration page in headless Chromium over a loopback fixture: no account is silently selected, the chosen connection and sender save with calling still disabled, and the mobile layout fits the viewport.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience view (ADR-164 D6) with the real shared kit from a core checkout: under ?audience=company the kit paints the calls picture from GET /tasks alone, /config is never probed, no listener of the full client is attached and the full UI is hidden; without the audience, with the same kit present, the full page boots as before (configuration read, form populated, listeners attached, no kit root). Fails loudly when no core checkout with the kit can be found, so a missing kit is never a silent pass.
 * -----------------------------------------------------------------------------
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const express=require('express'),{chromium}=require('playwright');
const {defaults,summary}=require('../routes/policy');
test('configuration page saves explicit account selection and starts disabled on desktop and mobile',async()=>{
 const app=express();app.use(express.json());let saved;
 const connections=[{id:'11111111-1111-4111-8111-111111111111',label:'Personal fixture',scope:'personal'},{id:'22222222-2222-4222-8222-222222222222',label:'Shared fixture',scope:'shared'}];
 app.get('/api/calling-assistant/app',(_req,res)=>res.sendFile(path.join(__dirname,'../ui/index.html')));
 app.get('/api/calling-assistant/client.js',(_req,res)=>res.sendFile(path.join(__dirname,'../ui/client.js')));
 app.get('/api/calling-assistant/config',(_req,res)=>res.json({config:saved||defaults,connections,providers:[{id:'local-stt',configured:true}],effectiveEnabled:false}));
 app.get('/api/calling-assistant/tasks',(_req,res)=>res.json({tasks:[]}));
 app.get('/api/calling-assistant/numbers',(req,res)=>{assert.equal(req.query.connectionId,connections[1].id);res.json({numbers:[{number:'+12025550101',label:'Fixture sender'}]});});
 app.put('/api/calling-assistant/config',(req,res)=>{assert.equal(req.get('x-oshal-calling'),'1');saved=req.body;res.json({config:saved});});
 app.get('/shared/*rest',(_req,res)=>res.type('text/plain').send(''));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/api/calling-assistant/app`);
  await page.waitForSelector('#connectionId option[value="'+connections[1].id+'"]',{state:'attached'});
  assert.equal(await page.locator('#enabled').isChecked(),false);assert.equal(await page.locator('#connectionId').inputValue(),'');
  await page.selectOption('#connectionId',connections[1].id);await page.click('#loadNumbers');await page.selectOption('#from','+12025550101');
  await page.fill('#transferPhone','+12025550102');await page.fill('#publicOrigin','https://calling.example.test');await page.fill('#allowedNumbers','+12025550103');
  await page.getByRole('button',{name:'Save configuration',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent==='Configuration saved.');
  assert.equal(saved.connectionId,connections[1].id);assert.equal(saved.from,'+12025550101');assert.equal(saved.enabled,false);assert.deepEqual(saved.allowedNumbers,['+12025550103']);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});

/**
 * @description The core checkout that holds the shared kit: OSHAL_FRAMEWORK or OSHAL_ROOT when set, otherwise the
 * checkout whose node_modules resolved playwright (NODE_PATH is how these tests are pointed at a core). Asserts rather
 * than skips, because a view test that cannot find the kit proves nothing.
 * @returns {string} The checkout root.
 */
function coreRoot() {
 const fromPlaywright=path.resolve(path.dirname(require.resolve('playwright/package.json')),'..','..');
 const core=[process.env.OSHAL_FRAMEWORK,process.env.OSHAL_ROOT,fromPlaywright].find(p=>p&&fs.existsSync(path.join(p,'src/shared/ui/js/app-view.js')));
 assert.ok(core,'a core checkout with src/shared/ui/js/app-view.js is required (set OSHAL_FRAMEWORK)');
 return core;
}

test('the company audience view paints from the kit without starting the full client, and the full page still boots without the audience',async()=>{
 const core=coreRoot(),app=express(),hits=[];
 const runs=[{id:'00000000-0000-4000-8000-000000000001',status:'failed',outcome:'handoff_busy',created_at:new Date(Date.now()-2*36e5).toISOString()}];
 app.use((req,_res,next)=>{hits.push(req.method+' '+req.path);next();});
 app.get('/api/calling-assistant/app',(_req,res)=>res.sendFile(path.join(__dirname,'../ui/index.html')));
 app.get('/api/calling-assistant/client.js',(_req,res)=>res.sendFile(path.join(__dirname,'../ui/client.js')));
 app.get('/api/calling-assistant/config',(_req,res)=>res.json({config:defaults,connections:[],providers:[{id:'local-stt',configured:true}],effectiveEnabled:false}));
 app.get('/api/calling-assistant/tasks',(_req,res)=>res.json({tasks:runs,...summary(defaults,[],runs)}));
 app.use('/shared/ui',express.static(path.join(core,'src/shared/ui')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 const origin=()=>`http://127.0.0.1:${server.address().port}`;
 // True when the full client attached nothing: it assigns these handlers as its last statements.
 const idle=()=>document.getElementById('settings').onsubmit===null&&document.getElementById('refresh').onclick===null&&document.getElementById('loadNumbers').onclick===null;
 try{browser=await chromium.launch({headless:true});
  const view=await browser.newPage();const errors=[];view.on('pageerror',e=>errors.push(e.message));
  await view.goto(origin()+'/api/calling-assistant/app?audience=company');
  await view.waitForSelector('#av-root[data-audience="company"]:not(.is-loading)');
  assert.equal(await view.evaluate(()=>window.AppView.active()),'company');
  assert.equal(await view.locator('#av-root.is-error').count(),0,'painted, not the failure notice');
  assert.equal(await view.locator('.av-stat').count(),3);
  assert.equal(await view.locator('[data-stat="calling"] .av-stat-value').innerText(),'Off');
  assert.equal(await view.locator('[data-stat="last"] .av-stat-value').innerText(),'handoff busy');
  assert.equal(await view.locator('[data-section="runs"] tbody tr').count(),1);
  assert.match(await view.locator('[data-section="notes"]').innerText(),/Calling is off until/);
  assert.equal(await view.locator('.av-escape-link').getAttribute('href'),'/cockpit/?app=calling-assistant');
  assert.equal(await view.evaluate(()=>getComputedStyle(document.querySelector('main:not(#av-root)')).display),'none','the full UI is hidden');
  assert.equal(await view.evaluate(idle),true,'the full client attached no listener');
  assert.ok(!hits.some(h=>h.endsWith('/config')),'the view never probes /config: '+hits.join(', '));
  assert.equal(hits.filter(h=>h==='GET /api/calling-assistant/tasks').length,1,'one read of /tasks');
  assert.ok(hits.every(h=>h.startsWith('GET ')),'reads only');
  assert.deepEqual(errors,[]);
  await view.close();
  const full=await browser.newPage();const fullErrors=[];full.on('pageerror',e=>fullErrors.push(e.message));
  await full.goto(origin()+'/api/calling-assistant/app');
  await full.waitForSelector('#tasks .task',{state:'attached'});
  assert.equal(await full.evaluate(()=>window.AppView.active()),null);
  assert.equal(await full.locator('#av-root').count(),0,'no kit root on the full page');
  assert.equal(await full.evaluate(idle),false,'the full client attached its listeners');
  assert.ok(hits.includes('GET /api/calling-assistant/config'),'the full page reads its configuration');
  assert.deepEqual(fullErrors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
