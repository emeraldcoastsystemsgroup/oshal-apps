/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The design standard on this brief and storyboard editor (docs/ux/design-standard.md; UX audit decision APP--APP; REFP CONVENTIONS §5.6/§5.7), in a real Chromium over the real page, the real shared editor (OSHAL_PLATFORM_ROOT) and loopback stand-ins for the routes: the page declares its contract and the brief is the work; framed in Today the name is not repeated; there is exactly one primary in the app row (Render where Vids answers, Open episode workflow where it does not) and a Render press with no render computer online says why and sends nothing; one copy of each field; the ⋯ More menu, the scene row menu and a phone pane are layers the browser's Back closes; "discard unsaved changes?" asks in the page; every planned control of the application's backlog is in its place, greyed, says "Not available yet" and does nothing when pressed. Every case fails on the page before this change.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Controls on the general sizing (Roger F14, 2026-11-06, Stories: "open episode workflow buttons are large, refresh evidence... its just not following the general sizing of objects"). At 412x915 with touch every button the page draws keeps its label on one line and hugs it (44px, 16px at 600, radius 10, the one primary included, which wrapped to two lines in a 232px slot), and Undo, Redo and More are icon buttons with no fill or edge; at 1440x900 the app row is a 36px toolbar at 15px, content buttons stay 44px at 15px with Refresh evidence on one line (it was two lines, 187x50), and a saved source project is a list row, not a bordered button three lines tall. At 1080x800, where the Saved pane is 180px, a label too long for it stays on one line inside the pane. Red on 1.4.0 / 1.3.0.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0 (open-work audit 2026-11-10): the seven RP-BRG functions are working controls, not greyed placeholders. The page draws no [data-ds-not-yet] control; Templates opens a gallery whose choice becomes a new unsaved brief with its storyboard and sends nothing; Brand kit writes the person's Create kit into the brief (hidden when Create does not answer, "Make a brand kit" without a saved kit); Download appears only for a finished build whose file Vids holds, and says why when Vids keeps none; Comment posts a thread on the brief that is saved with the source (the POST carries it), and the ⋯ More menu holds Resize for other formats and Schedule or post as real rows, a scene's menu Edit on canvas. Red on 1.3.2 (greyed controls), green on 1.4.0.
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
async function fixture(t,{width=1440,height=900,phone=false,vids=null,builds=0,project=null,kit=null,artifact=null,items=null}={}){
 const app=express(),requests=[];app.use(express.json());app.use((req,_res,next)=>{requests.push(req.method+' '+req.path);next();});
 let saved=project;
 app.get('/today',(_q,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div class="tool-view-container"><div class="tool-view-header" style="height:56px">${NAME}</div><iframe id="app" src="/api/${APP}/review" style="border:0;width:100vw;height:calc(100vh - 56px)"></iframe></div></body></html>`));
 app.get('/api/'+APP+'/review',(_q,res)=>res.sendFile(resolve(root,'tools/review.html')));
 app.get('/api/'+APP+'/source-project-editor.mjs',(_q,res)=>res.type('text/javascript').sendFile(resolve(root,'tools/source-project-editor.mjs')));
 app.get('/api/'+APP+'/source-projects',(_q,res)=>res.json({projects:saved?[{id:saved.id,title:saved.model.title,revision:1}]:[]}));
 app.post('/api/'+APP+'/source-projects',(req,res)=>{saved={id:'11111111-1111-4111-8111-111111111111',model:req.body.model};res.json({project:{id:saved.id,revision:1}});});
 app.get('/api/'+APP+'/home-summary',(_q,res)=>res.json({metrics:[{id:'a',label:'In progress',value:'0'}],items:items??Array.from({length:builds},(_,i)=>({text:'Build '+(i+1),detail:'done · updated 2026-11-05T10:00:00Z',actions:[{context:{title:'Built',notes:'Built notes'}}]}))}));
 // Create's brand kit (kit: an answer body, or a status number for a refusal) and Vids' file for a finished build (artifact: a body).
 app.get('/api/create/brand-kit',(_q,res)=>typeof kit==='number'?res.status(kit).json({error:'fixture_refusal'}):kit?res.json(kit):res.status(404).json({error:'not_installed'}));
 app.get('/api/vids/jobs/:job/artifact',(req,res)=>artifact?res.json(artifact(req.params.job)):res.status(404).json({error:'not_installed'}));
 app.get('/api/vids/jobs/:job/artifact/video.mp4',(_q,res)=>res.type('video/mp4').send(Buffer.from('fixture-mp4-bytes')));
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

test('framed at 1440x900: contract, one primary in one app row, the name once, one copy of each field, every reference function a working control (no greyed control)',async t=>{
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
 // No greyed "Not available yet" control anywhere: each reference function is a working control in its reference place.
 assert.equal(await frame.locator('[data-ds-not-yet]').count(),0,'no planned (greyed) control remains');
 assert.equal(await frame.getByText('Not available yet').count(),0);
 assert.equal(await frame.locator('.brief-choices #templates').isEnabled(),true,'Templates beside the build kinds works');
 assert.equal(await frame.locator('#brandKit').isVisible(),false,'Brand kit is not drawn where Create does not answer');
 assert.equal(await frame.locator('.source-project-actions').getByRole('button',{name:'Comments',exact:true}).isEnabled(),true,'Comment in the app row works');
 assert.equal(await frame.locator('.source-project-actions a.source-download').isVisible(),false,'Download is not drawn before a finished file exists');
 await frame.getByRole('button',{name:'More',exact:true}).click();const menu=frame.getByRole('menu');await menu.waitFor();
 for(const name of ['Resize for other formats','Schedule or post'])assert.equal(await menu.getByRole('menuitem',{name,exact:true}).isEnabled(),true,name+' is a real ⋯ More row');
 await frame.locator('body').press('Escape');await menu.waitFor({state:'hidden'});
 await frame.getByRole('button',{name:'Add scene',exact:true}).click();await frame.getByRole('button',{name:'Scene 1 actions',exact:true}).click();
 const sceneMenu=frame.getByRole('menu');await sceneMenu.waitFor();
 assert.deepEqual(await sceneMenu.getByRole('menuitem').evaluateAll(items=>items.map(i=>i.textContent.trim())),['Move up','Move down','Duplicate',BACKLOG.scene,'Delete'],'Delete is last');
 assert.equal(await sceneMenu.getByRole('menuitem',{name:BACKLOG.scene,exact:true}).isEnabled(),true,'Edit on canvas is a real scene row');
 await frame.locator('body').press('Escape');
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
 assert.ok(row.filter(b=>!b.icon).length>=2,'Save source and the one primary are in the row');for(const b of row.filter(b=>!b.icon))assertWordButton(b,{h:36,size:'15px'});
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

test('Templates: a gallery of prefilled briefs opens one as a new unsaved brief with its storyboard; Back closes it; nothing is sent',async t=>{
 const {page,frame,requests,errors,dialogs}=await fixture(t,{width:412,height:915,phone:true});
 await frame.getByRole('button',{name:'Templates',exact:true}).click();const gallery=frame.locator('dialog.brand-templates');await gallery.waitFor();
 assert.equal(await gallery.locator('.brand-template').count(),6);await back(page);await gallery.waitFor({state:'detached'});assert.match(page.url(),/\/today$/,'Back closed the gallery, not the app');
 await frame.getByRole('button',{name:'Templates',exact:true}).click();await frame.locator('dialog.brand-templates [data-template="countdown"]').click();
 await frame.locator('#status').filter({hasText:'Event countdown bumper'}).waitFor();
 assert.equal(await frame.locator('#title').inputValue(),'Event countdown bumper');assert.match(await frame.locator('#notes').inputValue(),/counting down/);
 assert.equal(await frame.locator('.brief-kinds [data-mode="graphic"]').getAttribute('aria-checked'),'true','the template sets Graphic bumper');
 assert.equal(await frame.locator('.source-scene').count(),2,'the storyboard comes with it');
 assert.equal(requests.filter(r=>!r.startsWith('GET')).length,0,'opening a template saves and renders nothing');assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
});

test('Brand kit: the person\'s Create kit is written into the brief once; without a kit it opens Create; refused by Create it is not drawn',async t=>{
 const kit={kit:{version:1,name:'Northwind',colors:{primary:'#1d4ed8',secondary:'#f59e0b',accent:'#ef4444',dark:'#111827',light:'#ffffff'},extras:[],fonts:{heading:'Georgia',body:'Calibri'},voice:'Warm and plain',logo:null},revision:1,words:{phrase:'royal blue, amber and red'}};
 const {frame,errors}=await fixture(t,{kit});
 const button=frame.getByRole('button',{name:'Use my brand kit',exact:true});await button.waitFor();await frame.locator('#notes').fill('An intro for the launch');
 await button.click();await button.click();
 const notes=await frame.locator('#notes').inputValue();assert.match(notes,/^An intro for the launch\n\nBrand kit: Northwind\. Colors: royal blue, amber and red \(#1d4ed8, #f59e0b, #ef4444\)\. Headings in Georgia, body text in Calibri\. Voice: Warm and plain\.$/);
 assert.equal(notes.match(/Brand kit:/g).length,1,'a second press replaces the line instead of adding another');
 await frame.getByRole('button',{name:'Undo',exact:true}).click();assert.doesNotMatch(await frame.locator('#notes').inputValue(),/Brand kit:/,'Undo takes it out');assert.deepEqual(errors,[]);
 const none=await fixture(t,{kit:{kit:null,revision:0,words:null}});await none.frame.getByRole('button',{name:'Make a brand kit',exact:true}).waitFor();
 const refused=await fixture(t,{kit:403});await refused.frame.waitForTimeout(300);assert.equal(await refused.frame.locator('#brandKit').isVisible(),false);
});

test('Download: shown only for a finished build whose file Vids holds; where Vids keeps none it says why',async t=>{
 const job='7c9e6679-7425-40de-944b-e07fc1f90ae7',item={text:'Launch intro',detail:'done · updated 2026-11-05T10:00:00Z',jobId:job,status:'done',actions:[{context:{title:'Launch intro',notes:'n'}}]};
 const {page,frame,errors}=await fixture(t,{items:[item],artifact:id=>({artifact:{jobId:id,previewUrl:'/api/vids/jobs/'+id+'/artifact/video.mp4'},attach:{available:true}})});
 const link=frame.locator('.source-project-actions a.source-download');await link.waitFor();assert.equal(await link.getAttribute('href'),'/api/vids/jobs/'+job+'/artifact/video.mp4');
 const row=frame.locator('#records a.brand-download');assert.equal(await row.count(),1);
 const [file]=await Promise.all([page.waitForEvent('download'),row.click()]);assert.equal(file.suggestedFilename(),'brand-build.mp4');assert.deepEqual(errors,[]);
 const kept=await fixture(t,{items:[item],artifact:()=>({artifact:null,attach:{available:false,detail:'Video exports cannot be kept on this installation yet.'}})});
 await kept.frame.locator('#records').getByText('Download: Video exports cannot be kept on this installation yet.').waitFor();
 assert.equal(await kept.frame.locator('.source-project-actions a.source-download').isVisible(),false);assert.equal(await kept.frame.locator('#records a.brand-download').count(),0);
});

test('Comment: a thread on the brief is saved with the source, and the app row counts open threads',async t=>{
 const {frame,requests,errors}=await fixture(t);let posted=null;
 frame.page().on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/'+APP+'/source-projects'))posted=r.postDataJSON();});
 await frame.locator('#title').fill('Launch');await frame.locator('#notes').fill('An intro for the launch');
 await frame.locator('.source-project-actions').getByRole('button',{name:'Comments',exact:true}).click();const sheet=frame.locator('dialog.source-comments');await sheet.waitFor();
 await sheet.getByLabel('Add a comment',{exact:true}).fill('Make the logo hold one beat longer');await sheet.getByRole('button',{name:'Comment',exact:true}).click();
 await sheet.locator('.source-comment').filter({hasText:'Make the logo hold one beat longer'}).waitFor();
 assert.equal(requests.filter(r=>r==='POST /api/'+APP+'/source-projects').length,1,'posting a comment saved the source');
 assert.equal(posted.model.comments.length,1);assert.equal(posted.model.comments[0].target,'brief');assert.equal(posted.model.comments[0].text,'Make the logo hold one beat longer');assert.equal(posted.model.comments[0].resolved,false);
 await sheet.getByRole('button',{name:'Close',exact:true}).click();
 assert.equal(await frame.locator('.source-project-actions').getByRole('button',{name:'Comments, 1 open',exact:true}).count(),1);assert.deepEqual(errors,[]);
});
