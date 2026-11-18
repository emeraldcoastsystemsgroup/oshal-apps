/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.2.6 (Roger, 2026-11-16, "for the last time": every chat surface is the core Jarvis chat window, with its model menu). The shipped Sat Ops page in Chromium at 1440x900 and at 412x915 (touch), with the kernel's one chat window served from a kernel platform export and its stand-in kernel (scripts/one-chat-window/kernel-window.mjs), and the /api/sat reads the page makes answered by a made-up simulated fleet: the Sat operator section is that window as Sat Ops' concierge (concierge=sat-ops, bot=sat-operator) in the same place, between Selected sat and Pass windows, with its model menu, Files, Tap to talk, Keep trying and conversations; a model picked for the request rides on the turn; the person's words reach sat-operator's door as Sat Ops; the ground station, the Pass windows table, the fleet and the selected sat the page shows reach the bot on context.screen_state; the page draws no transcript, message box or chat request of its own (no POST /api/sat/chat); nothing runs sideways; no page error. A command the bot proposes is the window's approval card (it replaces the old Load draft button): nothing is sent before Approve, Approve sends exactly the held point command, and the page reads the fleet again when the window says the card ran (oshal-package-tool-done).
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {kernelPlatform,windowKernel,mountWindow,toolchain,chatWindow,windowControls,pickModel,sendInWindow} from '../../scripts/one-chat-window/kernel-window.mjs';

const express=toolchain('express'),{chromium}=toolchain('playwright');
const platform=kernelPlatform();
const TOOLS=path.resolve(import.meta.dirname,'../tools');
const SHOTS=process.env.SAT_OPS_WINDOW_SCREENSHOTS||'';
const STATION='GROUND STATION (on the operator\'s screen): lat 30.40°, lon -86.86°, alt 0.020 km';
const PASS_ANSWER='The next pass of iss rises at the time on your Pass windows table, 6 min, max elevation 45°.';
const CARD_ANSWER='I can point sat42-live 30° about [1, 1, 0]. Approve the card to send it.';

/** The made-up simulated fleet the page reads: one sat heartbeating in POINT, one gone quiet. */
function fleetRows(mode){
 const now=Date.now(),estimator={updatesApplied:120,rejected:0,reinits:0,attitudeSigmaDeg:{x:0.01,y:0.01,z:0.01},biasDegHr:{x:0.1,y:0.2,z:0.3}};
 return [
  {satId:'sat42-live',engine:'rk4',online:true,lastSeenMs:now,telemetry:{mode,pointingErrorDeg:0.12,state:{omega:{x:0.0002,y:0,z:0},q:{w:1,x:0,y:0,z:0}},adcs:{reason:'holding target',momentumFrac:0.42,dumping:false},estimator}},
  {satId:'sat-spare',engine:'nasa42',online:false,lastSeenMs:now-600000,telemetry:{mode:'SAFE',pointingErrorDeg:null,state:{omega:{x:0,y:0,z:0},q:{w:1,x:0,y:0,z:0}},adcs:{reason:'operator',momentumFrac:0.1,dumping:false},estimator}},
 ];
}
const CATALOG=[{satId:'sat42-live',satnum:90001,name:'Live sim',tleRaw:'1 90001U 26001A   26320.50000000  .00000000  00000-0  00000-0 0    17\n2 90001  51.6400 247.4627 0003000 130.5360  10.0000 15.50000000  100',updatedUtcMs:1},
 {satId:'iss',satnum:25544,name:'ISS',tleRaw:'1 25544U 98067A   26320.50000000  .00016717  00000-0  10270-3 0  9005\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50000000  100',updatedUtcMs:2}];

/** An orbit track around now, as POST /api/sat/track answers it (ECI km and the subpoint). */
function track(satId){
 const t0=Date.now()-5*60000,points=[];
 for(let i=0;i<=130;i++){const a=i*2*Math.PI/92;points.push({tUtcMs:t0+i*60000,eciKm:{x:6771*Math.cos(a),y:5417*Math.sin(a),z:4063*Math.sin(a)},latDeg:51.6*Math.sin(a),lonDeg:((i*4)%360)-180});}
 return{satId,points};
}

/** The stand-in Sat Ops routes the page reads, the held-card relay, and the stand-in kernel behind the window. */
async function startFixture(){
 const app=express(),requests=[],commands=[],served={passes:null};let mode='POINT';
 const proposal=()=>({id:'fixture-point',app:'sat-ops',appName:'Sat Ops',toolName:'sat-point-command',label:'Sat Point Command',mode:'ask',
  expiresAt:new Date(Date.now()+300000).toISOString(),input:{satId:'sat42-live',axis:{x:1,y:1,z:0},angleDeg:30}});
 let held=null;
 const kernel=windowKernel({answer:ask=>{
  if(ask.bot!=='sat-operator'||ask.context?.app!=='sat-ops')return'Wrong application.';
  if(/^point /i.test(ask.message)){held=proposal();return{answer:CARD_ANSWER,packageToolProposal:held};}
  return PASS_ANSWER;
 }});
 app.use(express.json());
 app.use((req,_res,next)=>{requests.push({method:req.method,path:req.path,at:Date.now()});next();});
 // The kernel holds the proposal and runs it on Approve: here the held request goes to the package's own command route.
 app.get('/api/jarvis/package-tools/proposals/:id',(_req,res)=>res.json({proposal:held}));
 app.post('/api/jarvis/package-tools/execute',async(req,res)=>{
  assert.equal(req.body.proposalId,held?.id,'Approve sends only the held proposal id');
  const sent=await fetch(`http://127.0.0.1:${server.address().port}/api/sat/nodes/${encodeURIComponent(held.input.satId)}/point`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(held.input)});
  res.json({status:sent.status,result:await sent.json(),expiresAt:new Date(Date.now()+60000).toISOString()});
 });
 mountWindow(app,{platform,kernel});
 // Relative to a root: res.sendFile refuses an absolute path through a dot folder (a platform export under ~/.local).
 app.get('/api/sat/app',(_req,res)=>res.sendFile('sat-ops.html',{root:TOOLS}));
 app.get('/api/sat/fleet',(_req,res)=>res.json({fleet:fleetRows(mode)}));
 app.get('/api/sat/catalog',(_req,res)=>res.json({catalog:CATALOG}));
 app.post('/api/sat/track',(req,res)=>res.json(track(String(req.body.satId))));
 app.post('/api/sat/passes',(_req,res)=>{const now=Date.now();served.passes=[{riseUtcMs:now+90*60000,durationS:360,maxElevationDeg:45.2},{riseUtcMs:now+6*3600000,durationS:480,maxElevationDeg:72.6}];res.json({passes:served.passes.map(p=>({...p,riseUtc:new Date(p.riseUtcMs).toISOString()}))});});
 app.post('/api/sat/conjunctions',(_req,res)=>res.json({events:[],thresholdKm:25,horizonHours:24}));
 app.post('/api/sat/nodes/:satId/point',(req,res)=>{commands.push({satId:req.params.satId,body:req.body});mode='SLEW';res.json({ok:true,simulation:true,satId:req.params.satId,command:'point',requestId:'fixture-request'});});
 app.get('/api/sat/home-summary',(_req,res)=>res.json({metrics:[],items:[]}));
 app.get('/api/swarm/apps/home-plan',(_req,res)=>res.json({apps:[]}));
 app.use('/api',(_req,res)=>res.json({}));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 return{origin:'http://127.0.0.1:'+server.address().port,kernel,requests,commands,served,
  close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}

let browser,fixture;
before(async()=>{fixture=await startFixture();browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await fixture?.close();});

/** The page at a width (a phone presses with taps), with its page errors and any request that left the loopback. */
async function open(width,height){
 const phone=width<600,context=await browser.newContext({viewport:{width,height},isMobile:phone,hasTouch:phone});
 const page=await context.newPage(),errors=[],outside=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===fixture.origin)return route.continue();outside.push(route.request().url());return route.abort();});
 await page.goto(fixture.origin+'/api/sat/app');
 await page.locator('#fleetList .sat-row').nth(1).waitFor({timeout:15000});
 return{page,context,errors,outside,press:phone?locator=>locator.tap():locator=>locator.click()};
}

/** UTC "MM-DD HH:MM" with its day word, as the Pass windows lines name a pass. */
function passWords(p){const day=t=>Math.floor(t/86400000),diff=day(p.riseUtcMs)-day(Date.now());
 return`rise ${new Date(p.riseUtcMs).toISOString().slice(5,16).replace('T',' ')} (${diff===0?'today':diff===1?'tomorrow':new Date(p.riseUtcMs).toISOString().slice(0,10)}), ${Math.round(p.durationS/60)} min, max el ${p.maxElevationDeg.toFixed(0)}°`;}

for(const [width,height] of [[1440,900],[412,915]])test(`${width}x${height}: the Sat operator is the one chat window, with Sat Ops' screen on every turn`,async()=>{
 const {page,context,errors,outside,press}=await open(width,height);
 try{
  await press(page.locator('#fleetList .sat-row',{hasText:'sat42-live'}));
  await page.locator('#selBox').waitFor({state:'visible'});
  await page.locator('#passSat').selectOption('iss');
  await press(page.locator('#passRun'));
  await page.locator('#passOut table').waitFor({timeout:10000});
  const frame=page.locator('iframe.jarvis-chat-frame');
  const chat=await chatWindow(page);
  assert.match(await frame.getAttribute('src'),/[?&]concierge=sat-ops&bot=sat-operator(&|$)/,'the window is Sat Ops\' concierge, its own bot');
  await windowControls(chat);
  assert.equal(await pickModel(chat,press),'Picked model','the model picked for this request is shown on the control');
  const words='When is the next pass over my station?';
  const {ask,answer}=await sendInWindow(chat,words,press,fixture.kernel);
  assert.deepEqual([ask.bot,ask.door,ask.message,ask.context.app],['sat-operator','/api/swarm/bots/sat-operator/ask',words,'sat-ops'],'the person\'s words alone reach sat-operator as Sat Ops');
  assert.deepEqual([ask.context.provider,ask.context.model],['picked','picked-model'],'the pick rides on that request');
  await answer.getByText(/next pass of iss/).waitFor();
  // What the old chat request carried (the station and the pass table) and what the screen shows now reach the bot.
  const screen=ask.context.screen_state;
  assert.equal(screen.title,'Sat Ops fleet plane');
  assert.ok(screen.text.includes(STATION),screen.text);
  assert.ok(screen.text.includes(`PASS WINDOWS ON SCREEN for iss from that station (next 24 h, UTC): ${fixture.served.passes.map(passWords).join('; ')}`),screen.text);
  assert.match(screen.text,/# Selected sat\nsat: sat42-live · online\nmode: POINT \(holding target\)\npointing err: 0\.120°\nmomentum: 42\.0%/);
  assert.match(screen.text,/# Fleet \(attitude nodes\)\nsat42-live: online, mode POINT, pointing error 0\.12°, engine rk4\nsat-spare: offline, mode SAFE, engine nasa42/);
  assert.match(screen.text,/# Orbit catalog \(TLE\)\nsat42-live: NORAD 90001 · Live sim\niss: NORAD 25544 · ISS/);
  assert.match(screen.text,/\[button\] POINT \(approve required\)/);
  assert.equal(ask.context.recordId,undefined,'no document: the conversation stays the bot\'s own');
  // The page draws no chat of its own, and sends no chat request of its own.
  assert.equal(await page.locator('#chatLog, #chatMsg, #chatSend, #chatDraft').count(),0,'no transcript, message box or draft button of the page\'s own');
  assert.deepEqual(fixture.requests.filter(r=>r.path==='/api/sat/chat'),[],'no POST /api/sat/chat');
  // In the same place: inside the right pane, between Selected sat and Pass windows; nothing sideways.
  const place=await page.evaluate(()=>{
   const frame=document.querySelector('iframe.jarvis-chat-frame'),section=frame.closest('section'),right=document.getElementById('right');
   const sections=[...right.querySelectorAll(':scope > section')].map(s=>s.querySelector('h2')?.textContent.trim()||(s.contains(frame)?'window':''));
   const box=frame.getBoundingClientRect(),pane=right.getBoundingClientRect();
   return{sections:sections.slice(0,3),inside:box.left>=pane.left-1&&box.right<=pane.right+1,width:box.width,height:box.height,sideways:document.documentElement.scrollWidth>innerWidth};
  });
  assert.deepEqual(place.sections,['Selected sat','window','Pass windows'],'the window sits where the page\'s own chat was');
  assert.equal(place.inside,true,'inside the right pane');assert.equal(place.sideways,false,'nothing runs sideways');
  assert.ok(place.height>=320,`tall enough to read a conversation (${place.height}px)`);
  if(width<600)assert.ok(place.width<=width,'the phone column holds it');
  const composer=await chat.locator('.jc-composer').boundingBox(),box=await frame.boundingBox();
  assert.ok(composer.x>=box.x-1&&composer.x+composer.width<=box.x+box.width+1,'the message box sits inside the window');
  if(SHOTS){await chat.locator('#convo .msg.bot').last().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(SHOTS,`sat-ops-window-${width}.png`),fullPage:width>=600});}
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
 }finally{await context.close();}
});

test('412x915: a command is the window\'s approval card; Approve sends exactly the held point and the page reads the fleet again',async()=>{
 const {page,context,errors,press}=await open(412,915);
 try{
  await press(page.locator('#fleetList .sat-row',{hasText:'sat42-live'}));
  const chat=await chatWindow(page);
  const {ask}=await sendInWindow(chat,'Point sat42-live 30 degrees about 1, 1, 0',press,fixture.kernel);
  assert.equal(ask.context.app,'sat-ops');
  const approve=chat.getByRole('button',{name:'Approve',exact:true});
  await approve.waitFor({timeout:15000});
  assert.match(await chat.locator('#convo').textContent(),/sat42-live/,'the card names the sat');
  assert.deepEqual(fixture.commands,[],'nothing is sent before the person approves');
  await press(approve);
  for(const until=Date.now()+10000;!fixture.commands.length;){assert.ok(Date.now()<until,'Approve sent the command');await new Promise(done=>setTimeout(done,50));}
  assert.deepEqual(fixture.commands,[{satId:'sat42-live',body:{satId:'sat42-live',axis:{x:1,y:1,z:0},angleDeg:30}}],'exactly the held point command');
  await page.locator('#fleetList .sat-row',{hasText:'sat42-live'}).locator('.mode-chip',{hasText:'SLEW'}).waitFor({timeout:5000});
  // The page re-reads the fleet each time the window says a Sat Ops card ran, not only on its two-second poll.
  const reads=()=>fixture.requests.filter(r=>r.method==='GET'&&r.path==='/api/sat/fleet').length;
  const ours=reads();
  for(let i=0;i<5;i++){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('oshal-package-tool-done',{detail:{app:'sat-ops',toolName:'sat-mode-command'}})));await page.waitForTimeout(100);}
  await page.waitForTimeout(150);
  assert.ok(reads()-ours>=5,`five Sat Ops cards ran, five fleet reads (${reads()-ours})`);
  const theirs=reads();
  for(let i=0;i<5;i++){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('oshal-package-tool-done',{detail:{app:'another-app',toolName:'x'}})));await page.waitForTimeout(100);}
  await page.waitForTimeout(150);
  assert.ok(reads()-theirs<=1,'another application\'s card reads nothing but the usual poll');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
