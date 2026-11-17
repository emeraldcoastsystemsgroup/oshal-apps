/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: "portrait has a jarvis ball that opens create-editor not a concierge". Portrait Studio's page carried no concierge of its own (1.17.7 left it to "the shell's one Concierge"), so Today's ball opened whichever application framed it: Create's concierge on Create's Portrait screen. This opens Portrait Studio inside the shipped Today page (scripts/one-chat-window/today-host.mjs over the kernel platform export, with the one chat window from kernel-window.mjs), alone (/cockpit/?app=portrait-studio) and as Create's Portrait screen (/cockpit/?app=create&screen=create-portrait), on both of the page's views (the studio with no portraits yet, and Your portraits once portraits exist), at 1440x900 with a mouse and at 412x915 with touch. It presses every concierge entry a person can see there with Playwright's own actionability (never forced, never a script click) and asserts that exactly one window opens and that it is Portrait Studio's own: the one Jarvis chat window the page carries, at /api/jarvis/?concierge=portrait-studio&bot=portrait-artist, with its model menu and other controls, never Today's rail and never Create's concierge. A message sent there reaches portrait-artist's door with context.app portrait-studio and the photo source the page saved for the turn (recordId and revision), as the page's document hand-over gives it.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {kernelPlatform,mountWindow,windowKernel,chatWindow,windowControls,sendInWindow,toolchain} from '../../scripts/one-chat-window/kernel-window.mjs';
import {mountToday,conciergeEntries,openWindows} from '../../scripts/one-chat-window/today-host.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),store=resolve(root,'..');
// The kernel platform the gate pins (or a sibling kernel checkout); a platform without the window fails here, never skips.
const platform=kernelPlatform(resolve(store,'../oshal-kernel/platform'));
const express=toolchain('express'),{chromium}=toolchain('playwright');
const {clientCatalog}=createRequire(resolve(root,'oshal-app.yaml'))('./routes/portrait-catalog.js');
const SIZES=[{name:'1440x900',options:{viewport:{width:1440,height:900}}},
 {name:'412x915',options:{viewport:{width:412,height:915},isMobile:true,hasTouch:true}}];
/** Where a person opens Portrait Studio: alone, and as Create's Portrait screen (create/oshal-app.yaml ui.static create-portrait). */
const PLACES=[{name:'Portrait Studio alone',address:'/cockpit/?app=portrait-studio'},
 {name:'Create\'s Portrait screen',address:'/cockpit/?app=create&screen=create-portrait'}];
const portraitsDone=()=>[1,2].map(n=>({portrait_id:'fixture-portrait-'+n,status:'done',mode:'professional',style:clientCatalog().presets.professional[0].id,
 created_at:new Date(Date.now()-n*60000).toISOString(),title:'Fixture portrait '+n}));
/** The page's two views (portrait-studio.html showView): the studio while there are no portraits, Your portraits once there are. */
const VIEWS=[{name:'the studio',portraits:()=>[],view:'studio',ready:'#stepPhoto'},
 {name:'Your portraits',portraits:portraitsDone,view:'portraits',ready:'#galleryGrid .g-item'}];
const SOURCE='fixture-source-1';

let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

/**
 * @description Portrait Studio's page, the modules it loads and the reads it makes, as its routes answer them (the same
 * stand-ins as studio-steps.test.mjs), plus a photo source store so the page can save the source a turn is asked about.
 * @param {object} app The Express app. @param {{portraits:Array<object>}} data The portraits the gallery lists.
 * @returns {{saved:Array<object>}} Every source the page saved.
 */
function portraitRoutes(app,{portraits}){
 const saved=[],permissions={view:true,read:true,create:true,change:true,export:true};
 const project=()=>({id:SOURCE,title:'Portrait source',revision:1,currentRevision:1,
  model:{version:1,kind:'portrait',title:'Portrait source',mode:'professional',style:null,aspect:0.8,notes:'',settings:{},photos:[]}});
 app.get('/api/portrait-studio/app',(_q,res)=>res.sendFile(resolve(root,'tools/portrait-studio.html')));
 app.get('/api/portrait-studio/capture-module',(_q,res)=>res.sendFile(resolve(root,'tools/portrait-capture.js')));
 app.get('/api/portrait-studio/face-module',(_q,res)=>res.sendFile(resolve(root,'tools/portrait-face.js')));
 app.get('/api/portrait-studio/permissions',(_q,res)=>res.json({permissions,unavailable:{email:true}}));
 app.get('/api/portrait-studio/provider',(_q,res)=>res.json({configured:true,provider:'fixture-no-generation'}));
 app.get('/api/portrait-studio/catalog',(_q,res)=>res.json(clientCatalog()));
 app.get('/api/portrait-studio/portraits',(_q,res)=>res.json({portraits}));
 app.get('/api/portrait-studio/source-projects',(_q,res)=>res.json({projects:saved.length?[{id:SOURCE,title:'Portrait source',revision:1}]:[]}));
 app.get('/api/portrait-studio/source-projects/:id',(req,res)=>req.params.id===SOURCE&&saved.length?res.json({project:project()}):res.status(404).json({error:'fixture_source_not_found'}));
 app.post('/api/portrait-studio/source-projects',express.json(),(req,res)=>{saved.push(req.body);res.json({project:{id:SOURCE,revision:1}});});
 app.get('/api/artifacts/picker.js',(_q,res)=>res.type('js').send('window.oshalArtifactPicker=undefined;'));
 return{saved};
}

/**
 * @description The kernel files a concierge turn that names a document under that document's own conversation and
 * answers with it (doc:<app>:<recordId>), which the window then continues in; the shared stand-in echoes the session
 * the turn was sent in, so this answers as the kernel does.
 * @param {object} kernel The windowKernel stand-in. @returns {object} The same stand-in.
 */
function filedUnderDocument(kernel){
 const handle=kernel.handle;
 kernel.handle=request=>{
  const answer=handle(request),job=/^saved-(\d+)$/.exec(answer?.json?.jobId||''),ask=job&&kernel.asks[Number(job[1])-1];
  if(request.url.pathname==='/api/jarvis/ask/result'&&ask?.context?.recordId)answer.json={...answer.json,sessionId:`doc:${ask.context.app}:${ask.context.recordId}`};
  return answer;
 };
 return kernel;
}

/** @description A loopback Today over Portrait Studio's page and the one chat window. @returns {Promise<object>} */
async function host(t,data){
 const app=express(),kernel=filedUnderDocument(windowKernel({answer:()=>'Portrait Studio fixture answer.'})),routes=portraitRoutes(app,data);
 mountWindow(app,{platform,kernel});
 mountToday(app,{platform,apps:['portrait-studio','create']});
 app.use((_q,res)=>res.status(404).json({error:'outside_fixture'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));});
 return{origin:'http://127.0.0.1:'+server.address().port,kernel,routes};
}

/** @description Open the place inside Today and wait until Portrait Studio's view is on screen in the framed screen. */
async function openPlace(context,origin,place,view){
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+place.address);
 const screen=page.frameLocator('.tool-view-container > iframe');
 await screen.locator(view.ready).first().waitFor({state:'visible',timeout:20000});
 assert.equal(await screen.locator('.wrap').getAttribute('data-portrait-view'),view.view,`Portrait Studio opens on ${view.name}`);
 await page.waitForTimeout(1500);   // Today's startup and the framed editor's binding of the bar settle
 return{page,screen,errors};
}

/** @description The one window an entry opened, waited for: its address, whether it is Today's rail, and the window. */
async function openedWindow(page,screen){
 // A pane frames the window once it is on screen (jarvis-chat-frame.js lazy), so its address is read once it has one.
 let found=[];
 for(const until=Date.now()+15000;Date.now()<until&&!(found.length&&found.every(Boolean));await page.waitForTimeout(250))found=await openWindows(page);
 assert.equal(found.length,1,`exactly one chat window opens (${JSON.stringify(found)})`);
 const rail=await page.evaluate(()=>document.getElementById('chatWorkspaceFrame')?.getAttribute('src')||'');
 return{address:new URL(found[0],'http://window.fixture'),rail:found[0]===rail,chat:found[0]===rail?null:await chatWindow(screen)};
}

for(const place of PLACES)for(const view of VIEWS)for(const {name,options} of SIZES){
 test(`${name}: ${place.name}, ${view.name} - every concierge entry a person sees opens Portrait Studio's own chat window`,{timeout:240000},async t=>{
  const press=locator=>options.hasTouch?locator.tap({timeout:5000}):locator.click({timeout:5000});
  const {origin,kernel,routes}=await host(t,{portraits:view.portraits()});
  const context=await browser.newContext(options);t.after(()=>context.close());
  const first=await openPlace(context,origin,place,view),shown=[];
  for(const entry of conciergeEntries(first.page))if(await entry.locator.isVisible())shown.push(entry.name);
  await first.page.close();
  assert.ok(shown.length>0,`a person sees a concierge entry on ${view.name} (${place.name}, ${name})`);
  let asked=false;
  for(const entryName of shown){
   const {page,screen,errors}=await openPlace(context,origin,place,view),entry=conciergeEntries(page).find(each=>each.name===entryName);
   await press(entry.locator);
   const opened=await openedWindow(page,screen);
   const where=`${entryName} on ${view.name} (${place.name}, ${name}) opened ${opened.address.pathname}${opened.address.search}`;
   assert.equal(opened.address.pathname,'/api/jarvis/',`${where}: the one Jarvis chat window`);
   assert.equal(opened.rail,false,`${where}: Portrait Studio's own window, not Today's rail`);
   assert.equal(opened.address.searchParams.get('concierge'),'portrait-studio',`${where}: Portrait Studio's concierge`);
   assert.equal(opened.address.searchParams.get('bot'),'portrait-artist',`${where}: bound to portrait-artist`);
   await windowControls(opened.chat);
   if(!asked){
    asked=true;
    const {ask}=await sendInWindow(opened.chat,'Tighten the crop around the face a little.',press,kernel);
    assert.equal(ask.bot,'portrait-artist','the turn reaches portrait-artist\'s door');
    assert.equal(ask.context.app,'portrait-studio','the turn is Portrait Studio\'s');
    assert.equal(routes.saved.length,1,'the page saved its photo source before the turn');
    assert.equal(ask.context.recordId,SOURCE,'the turn carries the photo source the page saved');
    assert.equal(ask.context.fields?.revision,1,'and its revision');
   }
   assert.deepEqual(errors,[],'no page error');
   await page.close();
  }
 });
}
