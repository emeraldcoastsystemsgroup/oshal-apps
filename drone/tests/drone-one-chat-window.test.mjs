/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2 (Roger, 2026-11-16, "for the last time": every chat surface is the core Jarvis chat window, with its model menu). The shipped Drone Ops page in Chromium at 1440x900 and at 412x915 (touch), with the kernel's one chat window served from a kernel platform export and its stand-in kernel (scripts/one-chat-window/kernel-window.mjs), and the /api/drone reads the page makes answered by a made-up fleet of two simulator drones: the Operator chat in the Plan view is that window as Drone Ops' concierge (concierge=drone, bot=drone-operator), in the same place after Missions, with its model menu, Files, Tap to talk, Keep trying and conversations; a model picked for the request rides on the turn; the person's words reach drone-operator's door as Drone Ops; the selected drone, its telemetry and home, the fleet, the geofence and the saved missions the page shows reach the bot on context.screen_state (what the old POST /api/drone/chat request made the route put in its prompt); a draft the turn saved (as draft-drone-mission saves it) is listed under Missions and drawn on the map after the turn; the page draws no transcript, message box or chat request of its own (no POST /api/drone/chat, no GET /api/drone/conversation); nothing runs sideways; no page error. A mission the bot proposes to fly is the window's approval card (execute-drone-mission): nothing flies before Approve, Approve sends exactly the held request to the route the Missions list's Execute uses, and the page reads its missions again when the window says a Drone Ops card ran. With no drone registered the window says so in its help line and every turn says why on the screen.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {kernelPlatform,windowKernel,mountWindow,toolchain,chatWindow,windowControls,pickModel,sendInWindow} from '../../scripts/one-chat-window/kernel-window.mjs';

const express=toolchain('express'),{chromium}=toolchain('playwright');
const platform=kernelPlatform();
const TOOLS=path.resolve(import.meta.dirname,'../tools');
const SHOTS=process.env.DRONE_WINDOW_SCREENSHOTS||'';
const DRAFT_ANSWER='Drafted Box 100 m at 40 m, four corners at 40 m inside the geofence. It is saved under Missions; nothing flies until you approve it.';
const CARD_ANSWER='Morning loop is ready to fly. Approve the card to start it.';
const NO_DRONE_ANSWER='No drone or flight simulator is registered with this installation, so nothing can be drafted or flown yet.';
const NO_DRONE_DETAIL='No drone or flight simulator is registered with this native runtime, so there are no drones to show.';
const HOME_A={lat:30.396,lon:-86.864,alt:0},HOME_B={lat:30.4012,lon:-86.8575,alt:0};
const STAMP='2026-11-16T20:00:00.000Z';

/** Live telemetry as GET /api/drone/fleet carries it for a drone the caller may see. */
function telemetry(home,battery){
 return{status:'disarmed',position:{...home},home,groundSpeedMps:0,distanceFromHomeM:0,headingDeg:90,batteryPct:battery,odometerM:1250,
  flightTimeS:95,rotorRpm:0,failsafe:null,mission:null,camera:null};
}
/** The made-up fleet: an embedded simulator and a simulator node, both on the ground, inside a 500 m fence. */
const FLEET=()=>({fleet:[{droneId:'alpha',kind:'sim',online:true,remote:false,telemetry:telemetry(HOME_A,88)},
 {droneId:'bravo',kind:'sim',online:true,remote:true,telemetry:telemetry(HOME_B,64)}],fence:{maxRadiusM:500,minAltM:2,maxAltM:120}});
/** The native runtime's answer with no drone registered (crates/host-process/bridge/unavailable_executor_services.js). */
const NO_DRONE=()=>({fleet:[],fence:null,native:true,configured:false,reason:'no_drone_node',detail:NO_DRONE_DETAIL});
/** One saved mission as GET /api/drone/missions lists it. */
function mission(id,name,source,waypoints){
 return{mission_id:id,name,plan:{name,waypoints,speedMps:8,rtlAfterMission:true},status:'draft',source,created_at:STAMP,updated_at:STAMP,last_flown_at:null};
}
const LOOP=()=>mission('m-seed','Morning loop','manual',[{lat:30.3965,lon:-86.864,alt:30,holdSeconds:0},{lat:30.3965,lon:-86.8635,alt:30,holdSeconds:0}]);
const BOX=()=>mission('m-box','Box 100 m at 40 m','concierge',[{lat:30.3969,lon:-86.864,alt:40,holdSeconds:0},{lat:30.3969,lon:-86.863,alt:40,holdSeconds:0},
 {lat:30.396,lon:-86.863,alt:40,holdSeconds:0},{lat:30.396,lon:-86.864,alt:40,holdSeconds:0}]);

/** The stand-in Drone Ops routes the page reads, the held-card relay, and the stand-in kernel behind the window. */
async function startFixture(){
 const app=express(),requests=[],executes=[],state={noDrone:false,missions:[LOOP()]};let held=null;
 const proposal=()=>({id:'fixture-execute',app:'drone',appName:'Drone Ops',toolName:'execute-drone-mission',label:'Execute Drone Mission',mode:'ask',
  expiresAt:new Date(Date.now()+300000).toISOString(),input:{missionId:'m-seed'}});
 const kernel=windowKernel({answer:ask=>{
  if(ask.bot!=='drone-operator'||ask.context?.app!=='drone')return'Wrong application.';
  if(/^execute/i.test(ask.message)){held=proposal();return{answer:CARD_ANSWER,packageToolProposal:held};}
  if(state.noDrone)return NO_DRONE_ANSWER;
  // What draft-drone-mission does in the kernel: POST /api/drone/chat validates the plan and saves it as a 'concierge' draft.
  if(!state.missions.some(m=>m.mission_id==='m-box'))state.missions.unshift(BOX());
  return DRAFT_ANSWER;
 }});
 app.use(express.json());
 app.use((req,_res,next)=>{requests.push({method:req.method,path:req.path,at:Date.now()});next();});
 // The kernel holds the proposal and, on Approve, replays the held request: the route the tool declares, with the tool's
 // input as its JSON body (package_api_tools.rs). Here it goes to the fixture's own execute route.
 app.get('/api/jarvis/package-tools/proposals/:id',(_req,res)=>res.json({proposal:held}));
 app.post('/api/jarvis/package-tools/execute',async(req,res)=>{
  assert.equal(req.body.proposalId,held?.id,'Approve sends only the held proposal id');
  const sent=await fetch(`http://127.0.0.1:${server.address().port}/api/drone/missions/${encodeURIComponent(held.input.missionId)}/execute`,
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(held.input)});
  res.json({status:sent.status,result:await sent.json(),expiresAt:new Date(Date.now()+60000).toISOString()});
 });
 mountWindow(app,{platform,kernel});
 // Relative to a root: res.sendFile refuses an absolute path through a dot folder (a platform export under ~/.local).
 app.get('/api/drone/app',(_req,res)=>res.sendFile('drone-ops.html',{root:TOOLS}));
 app.get('/api/drone/fleet',(_req,res)=>res.json(state.noDrone?NO_DRONE():FLEET()));
 app.get('/api/drone/missions',(_req,res)=>res.json({missions:state.missions}));
 app.get('/api/drone/fleet/patterns',(_req,res)=>res.json({patterns:[{id:'box-split',name:'Box-split survey',description:'One square split into bands.',minDrones:2,maxDrones:8}],
  defaults:{sizeM:160,altBaseM:30,altStepM:12,speedMps:8}}));
 app.get('/api/drone/show/status',(_req,res)=>res.json({active:false,phase:'idle',name:null,drones:[]}));
 app.get('/api/drone/fleet/:id/events',(_req,res)=>res.json({events:[]}));
 app.get('/api/drone/fleet/:id/captures',(_req,res)=>res.json({captures:[]}));
 app.post('/api/drone/missions/:id/execute',(req,res)=>{
  executes.push({missionId:req.params.id,body:req.body});
  const row=state.missions.find(m=>m.mission_id===req.params.id);if(row)row.status='flown';
  res.json({ok:true,state:{droneId:'alpha',telemetry:telemetry(HOME_A,88)}});
 });
 app.get('/api/drone/home-summary',(_req,res)=>res.json({metrics:[],items:[]}));
 app.get('/api/swarm/apps/home-plan',(_req,res)=>res.json({apps:[]}));
 app.use('/api',(_req,res)=>res.json({}));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 return{origin:'http://127.0.0.1:'+server.address().port,kernel,requests,executes,state,
  reset(noDrone=false){state.noDrone=noDrone;state.missions.splice(0,state.missions.length,LOOP());executes.length=0;},
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
 await page.goto(fixture.origin+'/api/drone/app');
 await page.waitForFunction(()=>document.getElementById('statusPill').textContent!=='…');
 return{page,context,errors,outside,press:phone?locator=>locator.tap():locator=>locator.click()};
}

/** The rail's Plan view, where the Operator chat sits after Missions. */
async function planView(page,press){await press(page.locator('#tabPlan'));await page.locator('#sidePlan').waitFor({state:'visible'});}

for(const [width,height] of [[1440,900],[412,915]])test(`${width}x${height}: the Operator chat is the one chat window, with Drone Ops' screen on every turn`,async()=>{
 fixture.reset();
 const {page,context,errors,outside,press}=await open(width,height);
 try{
  // The person picks bravo in the Fleet list, as the old chat sent its droneId with every request.
  await press(page.locator('#fleetList .mission-row',{hasText:'bravo'}));
  await page.locator('#statusPill',{hasText:/^BRAVO/}).waitFor();
  await planView(page,press);
  const frame=page.locator('iframe.jarvis-chat-frame');
  const chat=await chatWindow(page);
  assert.match(await frame.getAttribute('src'),/[?&]concierge=drone&bot=drone-operator(&|$)/,'the window is Drone Ops\' concierge, its own bot');
  await windowControls(chat);
  assert.equal(await pickModel(chat,press),'Picked model','the model picked for this request is shown on the control');
  const words='Fly a 100 m box at 40 m and come home';
  const {ask,answer}=await sendInWindow(chat,words,press,fixture.kernel);
  assert.deepEqual([ask.bot,ask.door,ask.message,ask.context.app],['drone-operator','/api/swarm/bots/drone-operator/ask',words,'drone'],'the person\'s words alone reach drone-operator as Drone Ops');
  assert.deepEqual([ask.context.provider,ask.context.model],['picked','picked-model'],'the pick rides on that request');
  await answer.getByText(/saved under Missions/).waitFor();
  // What the old chat request made the route put in its prompt (the selected drone, its telemetry and home, the fleet,
  // the fence, the saved missions) now reaches the bot from the screen.
  const screen=ask.context.screen_state;
  assert.deepEqual([screen.title,screen.tab],['Drone Ops','Plan']);
  assert.match(screen.text,/^Drone Ops, Plan view; map: Plan waypoints$/m);
  assert.match(screen.text,/# Fleet\nalpha: sim, embedded, online, disarmed, battery 88%, home 30\.396000, -86\.864000\nbravo \(selected\): sim, node, online, disarmed, battery 64%, home 30\.401200, -86\.857500\n/);
  assert.match(screen.text,/# Selected drone: bravo\nTelemetry: disarmed, altitude 0\.0 m, speed 0\.0 m\/s, 0 m from home, heading 90°, battery 64%, mission –\nPosition 30\.401200, -86\.857500; home \(launch point\) 30\.401200, -86\.857500\n/);
  assert.match(screen.text,/# Geofence: within 500 m of home, altitude 2–120 m/);
  assert.match(screen.text,/# Missions \(newest first\)\nMorning loop: 2 waypoints · draft · manual/);
  assert.equal(ask.context.recordId,undefined,'no document: the conversation stays the bot\'s own');
  // The draft the turn saved is listed under Missions and drawn on the map, as the old chat's reply drew it.
  await page.locator('#missionList .mission-row',{hasText:'Box 100 m at 40 m'}).waitFor({timeout:10000});
  await page.waitForFunction(()=>typeof shownMission!=='undefined'&&shownMission&&shownMission.name==='Box 100 m at 40 m',null,{timeout:10000});
  // The page draws no chat of its own, and sends no chat request of its own.
  assert.equal(await page.locator('#chatLog, #chatInput, button[onclick="sendChat()"]').count(),0,'no transcript, message box or Send of the page\'s own');
  assert.deepEqual(fixture.requests.filter(r=>r.path==='/api/drone/chat'||r.path==='/api/drone/conversation'),[],'no POST /api/drone/chat, no GET /api/drone/conversation');
  // In the same place: the Plan view's last panel, after Missions, inside the rail; nothing sideways.
  const place=await page.evaluate(()=>{
   const frame=document.querySelector('iframe.jarvis-chat-frame'),plan=document.getElementById('sidePlan'),rail=document.querySelector('.side');
   const panels=[...plan.querySelectorAll(':scope > .panel-box')].map(p=>(p.contains(frame)?'window: ':'')+(p.querySelector('h2')?.textContent.trim()||''));
   const box=frame.getBoundingClientRect(),pane=rail.getBoundingClientRect();
   return{panels,inside:box.left>=pane.left-1&&box.right<=pane.right+1,width:box.width,height:box.height,sideways:document.documentElement.scrollWidth>innerWidth};
  });
  assert.deepEqual(place.panels.slice(-2),['Missions','window: Operator chat — drafts only, you approve every flight'],'the window sits where the page\'s own chat was');
  assert.equal(place.inside,true,'inside the rail');assert.equal(place.sideways,false,'nothing runs sideways');
  assert.ok(place.height>=320,`tall enough to read a conversation (${place.height}px)`);
  if(width<600)assert.ok(place.width<=width,'the phone column holds it');
  const composer=await chat.locator('.jc-composer').boundingBox(),box=await frame.boundingBox();
  assert.ok(composer.x>=box.x-1&&composer.x+composer.width<=box.x+box.width+1,'the message box sits inside the window');
  if(SHOTS){await frame.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(SHOTS,`drone-window-${width}.png`),fullPage:width>=600});}
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
 }finally{await context.close();}
});

test('412x915: flying a saved mission is the window\'s approval card; Approve sends exactly the held request and the page reads its missions again',async()=>{
 fixture.reset();
 const {page,context,errors,press}=await open(412,915);
 try{
  await planView(page,press);
  const chat=await chatWindow(page);
  const {ask}=await sendInWindow(chat,'Execute Morning loop',press,fixture.kernel);
  assert.equal(ask.context.app,'drone');
  const approve=chat.getByRole('button',{name:'Approve',exact:true});
  await approve.waitFor({timeout:15000});
  assert.deepEqual(fixture.executes,[],'nothing flies before the person approves');
  const reads=()=>fixture.requests.filter(r=>r.method==='GET'&&r.path==='/api/drone/missions').length;
  const before=reads();
  await press(approve);
  for(const until=Date.now()+10000;!fixture.executes.length;){assert.ok(Date.now()<until,'Approve sent the held request');await new Promise(done=>setTimeout(done,50));}
  assert.deepEqual(fixture.executes,[{missionId:'m-seed',body:{missionId:'m-seed'}}],'exactly the held request, to the route the Missions list\'s Execute uses');
  // The window says a Drone Ops card ran: the page reads its missions again (Morning loop now reads flown).
  await page.locator('#missionList .mission-row',{hasText:'Morning loop'}).getByText(/· flown ·/).waitFor({timeout:10000});
  assert.ok(reads()>before,'the page read its missions again after the card ran');
  const ours=reads();
  for(let i=0;i<3;i++){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('oshal-package-tool-done',{detail:{app:'drone',toolName:'execute-drone-mission'}})));await page.waitForTimeout(100);}
  await page.waitForTimeout(200);
  assert.ok(reads()-ours>=3,`three Drone Ops cards ran, three missions reads (${reads()-ours})`);
  const theirs=reads();
  for(let i=0;i<3;i++){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('oshal-package-tool-done',{detail:{app:'another-app',toolName:'x'}})));await page.waitForTimeout(100);}
  await page.waitForTimeout(200);
  assert.equal(reads()-theirs,0,'another application\'s card reads nothing');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('412x915: with no drone registered the window says so, and every turn carries why on the screen',async()=>{
 fixture.reset(true);
 const {page,context,errors,press}=await open(412,915);
 try{
  await page.locator('#canvasEmpty:not([hidden])').waitFor();
  await planView(page,press);
  const chat=await chatWindow(page);
  await chat.locator('.jc-concierge-help',{hasText:'No drone or flight simulator is registered here'}).waitFor({timeout:10000});
  const {ask,answer}=await sendInWindow(chat,'Why can\'t I fly?',press,fixture.kernel);
  await answer.getByText(/nothing can be drafted or flown yet/).waitFor();
  assert.ok(ask.context.screen_state.text.includes(`No drone connected: ${NO_DRONE_DETAIL}`),ask.context.screen_state.text);
  assert.match(ask.context.screen_state.text,/# Fleet\nno drones\n/);
  assert.deepEqual(fixture.requests.filter(r=>r.path==='/api/drone/chat'),[]);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
