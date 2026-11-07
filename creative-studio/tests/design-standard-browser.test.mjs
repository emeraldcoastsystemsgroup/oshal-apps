/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The design standard on this brief and storyboard editor (docs/ux/design-standard.md; UX audit decision APP--APP; REFP CONVENTIONS §5.6/§5.7), in a real Chromium over the real page, the real shared editor (OSHAL_PLATFORM_ROOT) and loopback stand-ins for the routes: the page declares its contract and the brief is the work; framed in Today the name is not repeated; there is exactly one primary in the app row (Render where Vids answers, Open episode workflow where it does not) and a Render press with no render computer online says why and sends nothing; one copy of each field; the ⋯ More menu, the scene row menu and a phone pane are layers the browser's Back closes; "discard unsaved changes?" asks in the page; every planned control of the application's backlog is in its place, greyed, says "Not available yet" and does nothing when pressed. Every case fails on the page before this change.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Controls on the general sizing (Roger F14, 2026-11-06, Stories: "open episode workflow buttons are large, refresh evidence... its just not following the general sizing of objects"). At 412x915 with touch every button the page draws keeps its label on one line and hugs it (44px, 16px at 600, radius 10, the one primary included, which wrapped to two lines in a 232px slot), and Undo, Redo and More are icon buttons with no fill or edge; at 1440x900 the app row is a 36px toolbar at 15px, content buttons stay 44px at 15px with Refresh evidence on one line (it was two lines, 187x50), and a saved source project is a list row, not a bordered button three lines tall. At 1080x800, where the Saved pane is 180px, a label too long for it stays on one line inside the pane. Red on 1.4.0 / 1.3.0.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: saving is automatic with a Saved caption instead of a Save source button in the app row, leaving the one primary as the sole word button in .source-project-actions.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),APP=root.split('/').filter(Boolean).at(-1),platform=process.env.OSHAL_PLATFORM_ROOT;
assert.ok(platform,'OSHAL_PLATFORM_ROOT selects the canonical shared editor');
const toolchain=process.env.STORE_CI_TOOLCHAIN||resolve(root,'../scripts/toolchain');const need=createRequire(resolve(toolchain,'node_modules','fixture.cjs'));
const express=need('express'),{chromium}=need('playwright');
const BACKLOG=APP==='brand-graphics'?{prefix:'RP-BRG',scene:'Edit on canvas',primaryWithVids:'Render this brand brief'}:{prefix:'RP-CRS',scene:'Trim',primaryWithVids:'Open episode workflow'};
const NAME=APP==='brand-graphics'?'Brand Graphics':'Creative Studio';
let browser;before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>{await browser?.close();});

/** The page on loopback, framed by a Today-like page (its .tool-view-header names the app), with recorded routes. */
async function fixture(t,{width=1440,height=900,phone=false,vids=null,builds=0,project=null}={}){
 const app=express(),requests=[];app.use(express.json());app.use((req,_res,next)=>{requests.push(req.method+' '+req.path);next();});
 let saved=project;
 app.get('/today',(_q,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div class="tool-view-container"><div class="tool-view-header" style="height:56px">${NAME}</div><iframe id="app" src="/api/${APP}/review" style="border:0;width:100vw;height:calc(100vh - 56px)"></iframe></div></body></html>`));
 app.get('/api/'+APP+'/review',(_q,res)=>res.sendFile(resolve(root,'tools/review.html')));
 app.get('/api/'+APP+'/source-project-editor.mjs',(_q,res)=>res.type('text/javascript').sendFile(resolve(root,'tools/source-project-editor.mjs')));
 app.get('/api/'+APP+'/source-projects',(_q,res)=>res.json({projects:saved?[{id:saved.id,title:saved.model.title,revision:1}]:[]}));
 app.post('/api/'+APP+'/source-projects',(req,res)=>{saved={id:'11111111-1111-4111-8111-111111111111',model:req.body.model};res.json({project:{id:saved.id,revision:1}});});
 app.get('/api/'+APP+'/home-summary',(_q,res)=>res.json({metrics:[{id:'a',label:'In progress',value:'0'}],items:Array.from({length:builds},(_,i)=>({text:'Build '+(i+1),detail:'done · updated 2026-11-05T10:00:00Z',actions:[{context:{title:'Built',notes:'Built notes'}}]}))}));
 app.get('/api/vids/jobs',(_q,res)=>vids?res.json(vids):res.status(404).json({error:'not_installed'}));
 app.post('/api/vids/brand',(_q,res)=>res.status(503).json({error:'No Vids worker is registered.'}));
 app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));app.use('/cockpit',express.static(resolve(platform,'src/pages/cockpit')));
 app.get('/api/swarm/apps/home-plan',(_q,res)=>res.json({apps:[]}));app.use((_q,res)=>res.status(404).json({error:'outside_fixture'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 const context=await browser.newContext({viewport:{width,height},isMobile:phone,hasTouch:phone});t.after(async()=>{await context.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
 const page=await context.newPage(),errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.type()+': '+d.message());d.dismiss();});page.setDefaultTimeout(8000);
 await page.goto('http://127.0.0.1:'+server.address().port+'/today');const frame=page.frame({url:/\/review$/});await frame.locator('.ef-shell').waitFor();await frame.locator('.source-project-actions').waitFor();await frame.waitForTimeout(300);
 return{page,frame,requests,errors,dialogs};
}
/** The browser's Back: the history entry belongs to the frame, so the top page never navigates and goBack's wait is not an error (the design audit's DS-39 step presses Back the same way). */
const back=page=>page.goBack({timeout:1500}).catch(()=>{}).then(()=>page.waitForTimeout(300));
/** The visible primaries (the accent-filled .primary buttons). */
const primaries=frame=>frame.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.checkVisibility()&&b.classList.contains('primary')).map(b=>b.textContent.trim()));
/** A planned control: greyed, inert, named "<label>, not available yet", linked to its backlog id. */
async function assertPlanned(frame,requests,locator,id){
 assert.equal(await locator.getAttribute('aria-disabled'),'true');assert.equal(await locator.getAttribute('data-ds-backlog'),id);assert.match(await locator.getAttribute('aria-label'),/not available yet$/);
 const before=requests.length,html=await frame.locator('body').innerHTML();await locator.click({force:true});await frame.waitForTimeout(300);assert.equal(requests.length,before,`${id} sent a request`);
 return html;
}

test('framed at 1440x900: contract, one primary in one app row, the name once, one copy of each field, planned controls in place',async t=>{
 const {frame,requests,errors,dialogs}=await fixture(t,{builds:1});
 assert.equal(await frame.locator('html').getAttribute('data-ds-category'),'editor');assert.equal(await frame.locator('html').getAttribute('data-ds-first-action'),'type');
 assert.equal(await frame.locator('[data-ds-work] #notes').count(),1,'the brief text is inside the declared work');
 assert.equal(await frame.locator('h1').isVisible(),false,'the Today bar names the app; the page does not repeat it');
 assert.equal(await frame.getByText('Review recorded work. Shape the next brief.').count(),0,'no generic subtitle above the work');
 // Vids does not answer in this fixture: Render is withheld and the episode workflow is the one primary.
 assert.deepEqual(await primaries(frame),['Open episode workflow']);
 assert.equal(await frame.locator('.source-project-actions').evaluate(el=>new Set([...el.querySelectorAll('button')].filter(b=>b.checkVisibility()).map(b=>Math.round(b.getBoundingClientRect().top))).size),1,'the app row is one row');
 // One copy of each field: no Title property, one visible Source link.
 assert.equal(await frame.locator('[data-editor-property="title"]').count(),0);assert.equal(await frame.locator('[data-editor-property="sourceUrl"]').count(),1);assert.equal(await frame.locator('#sourceUrl').isVisible(),false);
 // The planned controls, in their reference places.
 const P=BACKLOG.prefix;
 await assertPlanned(frame,requests,frame.locator('.brief-choices [data-ds-not-yet]'),P+'-01');
 await assertPlanned(frame,requests,frame.locator('.brief-kit [data-ds-not-yet]'),P+'-03');
 await assertPlanned(frame,requests,frame.locator('.source-project-actions [data-ds-backlog="'+P+'-06"]'),P+'-06');
 await assertPlanned(frame,requests,frame.locator('.source-project-actions [data-ds-backlog="'+P+'-04"]'),P+'-04');
 await frame.getByRole('button',{name:'More',exact:true}).click();const menu=frame.getByRole('menu');await menu.waitFor();
 for(const id of [P+'-02',P+'-05']){const row=menu.locator(`[data-ds-backlog="${id}"]`);assert.match(await row.innerText(),/Not available yet/);assert.equal(await row.getAttribute('aria-disabled'),'true');}
 await menu.locator(`[data-ds-backlog="${P}-02"]`).click({force:true});await frame.waitForTimeout(200);assert.equal(await menu.isVisible(),true,'a planned row is not a choice: the menu stays');
 await frame.locator('body').press('Escape');await menu.waitFor({state:'hidden'});
 await frame.getByRole('button',{name:'Add scene',exact:true}).click();await frame.getByRole('button',{name:'Scene 1 actions',exact:true}).click();
 const sceneMenu=frame.getByRole('menu');await sceneMenu.waitFor();const tool=sceneMenu.locator(`[data-ds-backlog="${P}-07"]`);assert.match(await tool.innerText(),new RegExp(BACKLOG.scene));
 assert.deepEqual(await sceneMenu.getByRole('menuitem').evaluateAll(items=>items.map(i=>i.textContent.replace('Not available yet','').trim())),['Move up','Move down','Duplicate',BACKLOG.scene,'Delete'],'Delete is last');
 assert.equal(requests.filter(r=>!r.startsWith('GET')).length,0);assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
});

test('Vids answers with no render computer online: the one primary stays and a press says why without rendering',async t=>{
 const {frame,requests,errors}=await fixture(t,{vids:{jobs:[],workers:[]}});
 assert.deepEqual(await primaries(frame),[BACKLOG.primaryWithVids]);
 if(APP!=='brand-graphics')return;
 await frame.locator('#title').fill('Launch');await frame.locator('#notes').fill('An intro for the launch');
 await frame.getByRole('button',{name:'Render this brand brief',exact:true}).click();await frame.locator('#status').filter({hasText:'No render computer is online'}).waitFor();
 assert.equal(requests.filter(r=>r==='POST /api/vids/brand').length,0,'nothing was sent to render');assert.deepEqual(errors,[]);
});

test('Back closes the ⋯ menu; replacing an unsaved brief asks in the page; no native dialog',async t=>{
 const {page,frame,dialogs,errors}=await fixture(t);
 await frame.getByRole('button',{name:'More',exact:true}).click();const menu=frame.getByRole('menu');await menu.waitFor();await back(page);await menu.waitFor({state:'hidden'});assert.match(page.url(),/\/today$/);
 await frame.locator('#notes').fill('Unsaved words');await frame.getByRole('button',{name:'More',exact:true}).click();await frame.getByRole('menuitem',{name:'New source',exact:true}).click();
 const ask=frame.locator('dialog.source-confirm');await ask.waitFor();await ask.getByRole('button',{name:'Cancel',exact:true}).click();await ask.waitFor({state:'detached'});
 assert.equal(await frame.locator('#notes').inputValue(),'Unsaved words','Cancel keeps the draft');assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
});

test('on a phone (412x743): the work within 120px, one app row, a pane is a layer Back closes',async t=>{
 const {page,frame,errors}=await fixture(t,{width:412,height:743,phone:true});
 const top=(await page.locator('#app').boundingBox()).y+await frame.locator('[data-ds-work]').evaluate(el=>el.getBoundingClientRect().top);assert.ok(top<=120,`the work starts at ${top}px`);
 assert.deepEqual(await primaries(frame),['Open episode workflow']);
 assert.equal(await frame.locator('.source-project-actions').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'nothing in the app row runs off the side');
 await frame.locator('.ef-panes').getByRole('button',{name:'Properties',exact:true}).click();await frame.locator('.ef-inspector').waitFor();
 await back(page);await frame.locator('.ef-inspector').waitFor({state:'hidden'});assert.match(page.url(),/\/today$/);assert.deepEqual(errors,[]);
});

/** What a button looks like as the browser lays it out: its box, its label's lines and width, its type, corner, fill and edge. */
const controls=(frame,selector)=>frame.locator(selector).evaluateAll(list=>list.filter(b=>b.checkVisibility()).map(b=>{
 const box=b.getBoundingClientRect(),cs=getComputedStyle(b),range=document.createRange();range.selectNodeContents(b);
 const text=[...range.getClientRects()].filter(r=>r.width>0),label=range.getBoundingClientRect().width;
 return{name:b.getAttribute('aria-label')||b.textContent.trim(),icon:b.classList.contains('source-icon'),w:Math.round(box.width),h:Math.round(box.height),lines:new Set(text.map(r=>Math.round(r.top))).size,
  slack:Math.round(box.width-label-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-parseFloat(cs.borderLeftWidth)-parseFloat(cs.borderRightWidth)),
  size:cs.fontSize,weight:cs.fontWeight,radius:cs.borderRadius,fill:cs.backgroundColor,edge:cs.borderLeftWidth==='0px'?'none':cs.borderLeftColor,
  inside:box.left>=b.parentElement.getBoundingClientRect().left-1&&box.right<=b.parentElement.getBoundingClientRect().right+1};}));
const clear='rgba(0, 0, 0, 0)';
/** A word button on the standard's scale: one line, hugging its label, at the given height and size, 600, radius 10. */
function assertWordButton(b,{h,size}){
 assert.equal(b.lines,1,`${b.name} keeps its label on one line (${b.w}x${b.h})`);assert.ok(b.slack<=2,`${b.name} hugs its label (${b.slack}px to spare)`);
 assert.equal(b.h,h,`${b.name} is ${h}px tall, not ${b.h}`);assert.equal(b.size,size,`${b.name} text`);assert.equal(b.weight,'600',`${b.name} weight`);assert.equal(b.radius,'10px',`${b.name} corner`);
}

test('on a phone (412x915, touch): every button hugs a one-line label at 44px and 16px; the app row icons have no fill or edge',async t=>{
 const {frame,errors}=await fixture(t,{width:412,height:915,phone:true,project:{id:'22222222-2222-4222-8222-222222222222',model:{title:'Customer Case Study Ep 1'}}});
 const row=await controls(frame,'.source-project-actions button');
 assert.ok(row.some(b=>!b.icon),'the one primary is in the row');for(const b of row.filter(b=>!b.icon))assertWordButton(b,{h:44,size:'16px'});
 for(const name of ['Undo','Redo','More']){const b=row.find(x=>x.name===name);assert.ok(b,name);assert.deepEqual([b.w,b.h],[44,44],`${name} is a 44px icon button`);assert.equal(b.fill,clear,`${name} has no fill`);assert.equal(b.edge==='none'||b.edge===clear,true,`${name} has no edge`);}
 for(const b of await controls(frame,'.brief-doc button, .source-story>button'))assertWordButton(b,{h:44,size:'16px'});
 await frame.locator('.ef-panes').getByRole('button',{name:'Saved',exact:true}).click();await frame.locator('#refresh').waitFor({state:'visible'});
 const [refresh]=await controls(frame,'#refresh');assertWordButton(refresh,{h:44,size:'16px'});
 assert.deepEqual(errors,[]);
});

test('at 1440x900: the app row is a 36px toolbar at 15px, content buttons 44px at 15px on one line, a saved project is a list row',async t=>{
 const {frame,errors}=await fixture(t,{project:{id:'22222222-2222-4222-8222-222222222222',model:{title:'Customer Case Study Ep 1'}}});
 const row=await controls(frame,'.source-project-actions button');
 assert.equal(row.filter(b=>!b.icon).length,1,'the one primary is in the row; saving is automatic with a Saved caption');for(const b of row.filter(b=>!b.icon))assertWordButton(b,{h:36,size:'15px'});
 for(const name of ['Undo','Redo','More']){const b=row.find(x=>x.name===name);assert.deepEqual([b.w,b.h],[36,36],`${name} is a 36px icon button`);assert.equal(b.fill,clear,`${name} has no fill`);}
 for(const b of await controls(frame,'#refresh, .brief-doc button, .source-story>button'))assertWordButton(b,{h:44,size:'15px'});
 const [saved]=await controls(frame,'.source-library-row');assert.ok(saved,'the saved project is listed');
 assert.equal(saved.fill,clear,'a saved project is a list row, not a filled button');assert.equal(saved.radius,'0px','a list row has no button corner');
 assert.deepEqual(errors,[]);
});

test('at 1080x800 (the 180px Saved pane): a label too long for its pane stays on one line inside the pane',async t=>{
 const {frame,errors}=await fixture(t,{width:1080,height:800});
 for(const b of await controls(frame,'#refresh, .brief-doc button, .source-story>button, .source-project-actions button')){
  assert.equal(b.lines,1,`${b.name} keeps one line (${b.w}x${b.h})`);assert.equal(b.inside,true,`${b.name} stays inside its pane`);
 }
 assert.deepEqual(errors,[]);
});
