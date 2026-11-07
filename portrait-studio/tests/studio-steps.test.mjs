/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-05 (grade D, P0): Generate portrait sat near y=11,800 behind a duplicate settings column. Proves at 412x915 that, once Steps 1-2 are done, Generate is within the first two screens, that only one set of generation settings exists, and that Generate sends the values of the set it reads (Step 3's #notes and #tune*). The POST is a fake: no image model is called.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The rest of the audit's fixSpec, each measured: the source commands in one document menu with undo and redo crop only once a photo is loaded, Mode's selected segment in inverted ink, the Style tile grid with 44px chips and one description on tap, the engine line beside Generate only while the model is asleep, and the SPLIT (Your portraits first once portraits exist with one New portrait bottom right, Step 1 with Add a photo in the top third when none, a reader on Your portraits only, no embedded concierge column).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Generate rides the sticky step bar: at Step 3 it is on the phone's first screen with no scroll, and the engine line is within 24px of it on any side.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | New portrait carries data-ef-floating, so the shell orb rests above it on a phone.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-06 (F15): a person without the create permission (every trial visitor) reached Step 3 and found Back alone, because Generate was hidden. Generate is on screen at Step 3 for everyone, uncovered, disabled with the reason beside it when it cannot run: no create access, no image model. The stepper is numbered with the current step in ink, Step 1 names the next two steps, each step bar is data-ef-floating, the native kernel's asleep answer (no ready field) shows the line, and a press whose first answer only woke the model makes the portrait without a second press.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-06 (1.17.4): prove Step 1's cropper stays bounded (<=460x340px with Next: Style on screen) for both landscape and tall portrait photos, and Step 3 pairs a live cropped/generated preview (#step3Preview) with a two-column minor-adjustment grid (#tuneOpts) while keeping Generate on the first screen.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),core=process.env.OSHAL_CORE_ROOT,platform=process.env.OSHAL_PLATFORM_ROOT;
assert.ok(core&&platform,'Matching core dependencies (OSHAL_CORE_ROOT) and kernel platform (OSHAL_PLATFORM_ROOT) roots are required.');
const requireCore=createRequire(resolve(core,'package.json')),requireOwn=createRequire(resolve(root,'oshal-app.yaml'));
const express=requireCore('express'),{chromium}=requireCore('playwright'),sharp=requireCore('sharp'),multer=requireCore('multer');
const {clientCatalog}=requireOwn('./routes/portrait-catalog.js');
let browser,photo,tallPhoto;
before(async()=>{
  browser=await chromium.launch({headless:true});
  photo=await sharp({create:{width:800,height:600,channels:3,background:'#4488aa'}}).png().toBuffer();
  tallPhoto=await sharp({create:{width:600,height:1200,channels:3,background:'#665544'}}).png().toBuffer();
});
after(async()=>{await browser?.close();});

/** @description Serve the real page over loopback with synthetic reads and a recording fake for POST /portraits. */
async function fixture(t,{width=412,height=915,phone=true,portraits=[],provider={configured:true,provider:'fixture-no-generation'},permissions={view:true,read:true,create:true,change:true,export:true},answer=null}={}){
  const app=express(),posts=[],deletes=[];
  app.get('/api/portrait-studio/app',(_q,res)=>res.sendFile(resolve(root,'tools/portrait-studio.html')));
  app.get('/api/portrait-studio/capture-module',(_q,res)=>res.sendFile(resolve(root,'tools/portrait-capture.js')));
  app.get('/api/portrait-studio/face-module',(_q,res)=>res.sendFile(resolve(root,'tools/portrait-face.js')));
  app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));
  app.get('/api/portrait-studio/permissions',(_q,res)=>res.json({permissions,unavailable:{email:true}}));
  app.get('/api/portrait-studio/provider',(_q,res)=>res.json(typeof provider==='function'?provider(posts):provider));
  app.delete('/api/portrait-studio/portraits/:id',(req,res)=>{deletes.push(req.params.id);res.status(204).end();});
  app.get('/api/portrait-studio/catalog',(_q,res)=>res.json(clientCatalog()));
  app.get('/api/portrait-studio/portraits',(_q,res)=>res.json({portraits}));
  app.get('/api/portrait-studio/source-projects',(_q,res)=>res.json({projects:[]}));
  app.post('/api/portrait-studio/portraits',multer({storage:multer.memoryStorage()}).single('photo'),(req,res)=>{posts.push({fields:req.body,bytes:req.file?.size||0});const [code,body]=answer?answer(posts.length):[202,{portraitId:'fake-'+posts.length,status:'queued'}];res.status(code).json(body);});
  app.get('/api/artifacts/picker.js',(_q,res)=>res.type('js').send('window.oshalArtifactPicker=undefined;'));
  app.use((_q,res)=>res.status(404).json({error:'outside_fixture'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  const context=await browser.newContext({viewport:{width,height},isMobile:phone,hasTouch:phone});
  t.after(async()=>{await context.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/portrait-studio/app');await page.locator('.ef-shell').waitFor({state:'attached'});
  if(permissions.create)await page.locator('#styleCards .card').first().waitFor({state:'attached'});
  return {page,posts,deletes,errors};
}
/** @description How far down the page a control starts once every scroller is back at its top: the scroll a person needs. */
function startsAt(page,selector){
  return page.evaluate(sel=>{for(const el of document.querySelectorAll('*'))if(el.scrollTop)el.scrollTop=0;scrollTo(0,0);const box=document.querySelector(sel).getBoundingClientRect();return box.top;},selector);
}
const visibleLabelled=(page,text)=>page.locator('label').filter({hasText:new RegExp('^'+text+'$')}).evaluateAll(rows=>rows.filter(row=>row.getClientRects().length).length);

test('phone: after Photo and Style, Generate portrait is within the first two screens and sends Step 3 settings',async t=>{
  const {page,posts,errors}=await fixture(t);
  await page.locator('#fileInput').setInputFiles({name:'Synthetic.png',mimeType:'image/png',buffer:photo});
  await page.locator('#cropStage').waitFor();
  await page.getByRole('button',{name:'Next: Style',exact:true}).click();
  await page.locator('#styleCards .card').first().click();
  await page.getByRole('button',{name:'Next: Generate',exact:true}).click();
  const generate=page.locator('#generateBtn');
  await generate.waitFor();assert.equal(await generate.isVisible(),true,'Generate is drawn on the phone');
  const top=await startsAt(page,'#generateBtn');
  assert.ok(top<915*2,'Generate starts at y='+Math.round(top)+', beyond the first two 915px screens');
  const onScreen=await generate.evaluate(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});
  assert.equal(onScreen,true,'at Step 3 Generate is on screen without a scroll (it rides the sticky step bar beside Back)');
  await page.locator('#notes').fill('soft key light');
  const background=page.locator('#tuneBackground');const choice=await background.locator('option').nth(1).getAttribute('value');await background.selectOption(choice);
  await generate.scrollIntoViewIfNeeded();await generate.click();
  await page.locator('#genStatus').filter({hasText:'Queued'}).waitFor();
  assert.equal(posts.length,1);const options=JSON.parse(posts[0].fields.options);
  assert.equal(options.notes,'soft key light');assert.equal(options.background,choice);assert.ok(posts[0].bytes>0);
  assert.deepEqual(errors,[]);
});

test('one set of generation settings: no duplicate notes or setting selects anywhere in the editor',async t=>{
  for(const [width,phone] of [[412,true],[1440,false]]){
    const {page,errors}=await fixture(t,{width,height:width===412?915:900,phone});
    await page.locator('#fileInput').setInputFiles({name:'Synthetic.png',mimeType:'image/png',buffer:photo});
    await page.locator('#cropStage').waitFor();
    assert.equal(await page.locator('[data-editor-property="notes"], [data-editor-property^="tune"]').count(),0,'the inspector carries no copy of the generation settings');
    for(const name of ['Background','Clothing','Hat','Prop \\(in hand\\)','Finish','Framing'])assert.ok(await page.locator('label').filter({hasText:new RegExp('^'+name+'$')}).count()<=1,name+' appears once');
    assert.equal(await page.locator('[data-editor-property="crop-w"]').count(),1,'the face crop stays editable in the inspector');
    await page.locator('#stepper').getByRole('button',{name:'3 Generate',exact:true}).click();
    assert.equal(await visibleLabelled(page,'Background'),1);assert.equal(await page.locator('#notes').isVisible(),true);
    assert.deepEqual(errors,[]);
  }
});

test('the stepper shows one step at a time',async t=>{
  const {page,errors}=await fixture(t);
  const shown=()=>page.locator('#portraitSteps > .step-pane').evaluateAll(rows=>rows.filter(row=>row.getClientRects().length).map(row=>row.dataset.stepPane));
  assert.deepEqual(await shown(),['1']);
  await page.locator('#stepper').getByRole('button',{name:'2 Style',exact:true}).click();assert.deepEqual(await shown(),['2']);
  assert.equal(await page.locator('#stepper [aria-current=step]').innerText(),'2 Style');
  await page.locator('#stepper').getByRole('button',{name:'3 Generate',exact:true}).click();assert.deepEqual(await shown(),['3']);
  await page.getByRole('button',{name:'Back',exact:true}).click();assert.deepEqual(await shown(),['2']);
  assert.deepEqual(errors,[]);
});

test('the source document commands sit in one menu in the app row; undo and redo crop appear once a photo is loaded',async t=>{
  for(const [width,phone] of [[412,true],[1440,false]]){
    const {page,errors}=await fixture(t,{width,height:width===412?915:900,phone});
    for(const name of ['New source','Save source','Save copy','Reload saved'])assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),false,name+' is not on the first screen');
    assert.equal(await page.getByLabel('Source title',{exact:true}).isVisible(),false);
    const menu=page.locator('header #sourceMenu > summary');assert.equal(await menu.isVisible(),true);assert.match(await menu.innerText(),/Portrait source/);
    assert.equal(await page.getByRole('button',{name:'Undo crop',exact:true}).isVisible(),false);assert.equal(await page.getByRole('button',{name:'Redo crop',exact:true}).isVisible(),false);
    await menu.click();await page.getByRole('button',{name:'Save source',exact:true}).waitFor();assert.equal(await page.getByLabel('Source title',{exact:true}).isVisible(),true);
    await page.keyboard.press('Escape');if(await page.locator('#sourceMenu').evaluate(d=>d.open))await menu.click();
    await page.locator('#fileInput').setInputFiles({name:'Synthetic.png',mimeType:'image/png',buffer:photo});await page.locator('#cropStage').waitFor();
    assert.equal(await page.getByRole('button',{name:'Undo crop',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Redo crop',exact:true}).isVisible(),true);
    assert.deepEqual(errors,[]);
  }
});

test('Mode is a segmented control with inverted-ink selection; Style is a tile grid with 44px chips and one description on tap',async t=>{
  const {page,errors}=await fixture(t);
  const ink=await page.locator('#modeProfessional').evaluate(el=>{const css=getComputedStyle(el),root=getComputedStyle(document.documentElement),probe=document.createElement('i');probe.style.color=root.getPropertyValue('--text-primary');probe.style.backgroundColor=root.getPropertyValue('--accent-primary');document.body.append(probe);const p=getComputedStyle(probe),out={bg:css.backgroundColor,ink:p.color,accent:p.backgroundColor,pressed:el.getAttribute('aria-pressed')};probe.remove();return out;});
  assert.equal(ink.bg,ink.ink,'the selected mode is filled with the text ink');assert.notEqual(ink.bg,ink.accent,'the selected mode is not the accent fill');assert.equal(ink.pressed,'true');
  await page.locator('#modeCharacter').click();assert.equal(await page.locator('#modeCharacter').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#modeProfessional').getAttribute('aria-pressed'),'false');
  await page.locator('#modeProfessional').click();
  await page.locator('#stepper').getByRole('button',{name:'2 Style',exact:true}).click();
  const chips=await page.locator('#groupChips button').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
  assert.ok(chips.length>1&&chips.every(height=>height>=44),'every category chip is at least 44px tall: '+chips.join(','));
  assert.equal(await page.locator('#styleCards .desc').count(),0,'no description is drawn inline on a tile');
  const columns=await page.locator('#styleCards').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.ok(columns>=2,'profiles are a grid, '+columns+' columns at 412px');
  const second=page.locator('#styleCards .card').nth(1),name=(await second.innerText()).trim().split('\n').pop();
  await second.click();assert.match(await page.locator('#styleDetail').innerText(),new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+': '));
  assert.equal(await page.locator('#styleCards .card.active').count(),1);
  assert.deepEqual(errors,[]);
});

test('the engine line sits beside Generate only while the image model is asleep',async t=>{
  const asleep={configured:true,provider:'comfyui',ready:false,wakeable:true,detail:'the local image model is asleep; the first image wakes it (allow about a minute)'};
  const sleeping=await fixture(t,{provider:asleep});
  await sleeping.page.locator('#stepper').getByRole('button',{name:'3 Generate',exact:true}).click();
  const meta=sleeping.page.locator('#engineMeta');await meta.waitFor();assert.match(await meta.innerText(),/^The local image model is asleep; the first image wakes it/);
  assert.equal(await sleeping.page.locator('#providerBanner').isVisible(),false,'no banner above the work');
  const gap=await sleeping.page.evaluate(()=>{const m=document.querySelector('#engineMeta').getBoundingClientRect(),g=document.querySelector('#generateBtn').getBoundingClientRect();return Math.max(m.top-g.bottom,g.top-m.bottom,m.left-g.right,g.left-m.right);});assert.ok(gap<24,'the line is directly beside Generate ('+gap+'px)');
  const awake=await fixture(t,{provider:{...asleep,ready:true,detail:'the local image model is running'}});
  await awake.page.locator('#stepper').getByRole('button',{name:'3 Generate',exact:true}).click();await awake.page.waitForTimeout(200);
  assert.equal(await awake.page.locator('#engineMeta').isVisible(),false);assert.equal(await awake.page.locator('#providerBanner').isVisible(),false);
  assert.deepEqual(sleeping.errors,[]);assert.deepEqual(awake.errors,[]);
});

const donePortraits=[1,2].map(n=>({portrait_id:'p'+n,status:'done',mode:'professional',style:clientCatalog().presets.professional[0].id,created_at:new Date(Date.now()-n*60000).toISOString(),title:'Portrait '+n}));
test('SPLIT: with portraits, Your portraits is the first screen with one New portrait at the bottom right; New portrait opens Step 1',async t=>{
  for(const [width,phone] of [[412,true],[1440,false]]){
    const height=width===412?915:900,{page,errors}=await fixture(t,{width,height,phone,portraits:donePortraits});
    await page.locator('#galleryGrid .g-item').first().waitFor();
    assert.equal(await page.locator('.wrap').getAttribute('data-portrait-view'),'portraits');
    assert.equal(await page.locator('#gallery').isVisible(),true);assert.equal(await page.locator('.ef-shell').isVisible(),false,'the studio is its own view');
    const order=await page.locator('#galleryGrid .g-item .lbl').evaluateAll(rows=>rows.map(row=>row.firstChild.textContent));assert.deepEqual(order,['Portrait 1','Portrait 2']);
    const fresh=page.getByRole('button',{name:'＋ New portrait',exact:true});assert.equal(await page.getByRole('button',{name:/New portrait/}).count(),1);assert.equal(await fresh.getAttribute('data-ef-floating'),'','New portrait is marked as the floating control the orb rests above');
    const box=await fresh.boundingBox();assert.ok(box.x+box.width>width-40&&box.y+box.height>height-80,'New portrait sits at the bottom right');
    const sources=await page.locator('#gallery .source-library').boundingBox(),grid=await page.locator('#galleryGrid').boundingBox();assert.ok(sources.y>=grid.y+grid.height-1,'saved photo sources are the row after the portraits');
    await fresh.click();assert.equal(await page.locator('.wrap').getAttribute('data-portrait-view'),'studio');
    assert.equal(await page.locator('#stepPhoto').isVisible(),true);assert.equal(await page.locator('#gallery').isVisible(),false,'no gallery strip beside the studio');
    await page.getByRole('button',{name:'‹ Your portraits',exact:true}).click();assert.equal(await page.locator('#gallery').isVisible(),true);
    assert.deepEqual(errors,[]);
  }
});

test('SPLIT: with no portraits the studio opens on Step 1 with Add a photo in the top third, and no embedded concierge column',async t=>{
  for(const [width,phone] of [[412,true],[1440,false]]){
    const height=width===412?915:900,{page,errors}=await fixture(t,{width,height,phone});
    await page.locator('#galleryEmpty').waitFor({state:'attached'});await page.waitForTimeout(150);
    assert.equal(await page.locator('.wrap').getAttribute('data-portrait-view'),'studio');assert.equal(await page.locator('#stepPhoto').isVisible(),true);
    assert.equal(await page.locator('#gallery').isVisible(),false);
    for(const id of ['#pickFileBtn','#browseFilesBtn']){const top=await startsAt(page,id);assert.ok(top<height/3,id+' starts at y='+Math.round(top)+', below the top third');}
    assert.equal(await page.locator('.ef-ai, .ef-concierge').count(),0,'the shell Concierge is the one assistant entry');
    assert.equal(await page.evaluate(()=>typeof window.__oshalDocumentSession?.prepare),'function','the shell Concierge still gets the document session');
    assert.deepEqual(errors,[]);
  }
});

test('SPLIT: a reader without create access lands on Your portraits with no New portrait and no studio',async t=>{
  const {page,posts,errors}=await fixture(t,{portraits:donePortraits,permissions:{view:true,read:true,create:false,change:false,export:true}});
  await page.locator('#galleryGrid .g-item').first().waitFor();
  assert.equal(await page.locator('.wrap').getAttribute('data-portrait-view'),'portraits');
  assert.equal(await page.getByRole('button',{name:/New portrait/}).isVisible(),false);assert.equal(await page.locator('#studioComposer').isVisible(),false);
  assert.equal(posts.length,0);assert.deepEqual(errors,[]);
});

/** @description Load the synthetic photo, take Next to Style, pick the first profile and Next to Generate, as a person does. */
async function toStepThree(page){
  await page.locator('#fileInput').setInputFiles({name:'Synthetic.png',mimeType:'image/png',buffer:photo});await page.locator('#cropStage').waitFor();
  await page.getByRole('button',{name:'Next: Style',exact:true}).click();await page.locator('#styleCards .card').first().click();
  await page.getByRole('button',{name:'Next: Generate',exact:true}).click();
}
/** @description Generate as a person meets it: drawn, on screen, the top element at its centre, and the line beside it. */
function generateFacts(page){
  return page.evaluate(()=>{const b=document.querySelector('#generateBtn'),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),why=document.querySelector('#generateWhy'),w=why.getBoundingClientRect();
    return {drawn:b.getClientRects().length>0,onScreen:r.top>=0&&r.bottom<=innerHeight,uncovered:hit===b||b.contains(hit),disabled:b.disabled,label:b.textContent,why:why.hidden?'':why.innerText,whyGap:why.hidden?null:Math.max(w.top-r.bottom,r.top-w.bottom),floating:b.closest('.step-nav').hasAttribute('data-ef-floating')};});
}

test('F15: without the create permission Step 3 still shows Generate, on screen, disabled, with why beside it',async t=>{
  for(const [width,phone] of [[412,true],[1440,false]]){
    const {page,posts,errors}=await fixture(t,{width,height:width===412?915:900,phone,permissions:{view:true,read:true,create:false,'source.create':true,change:true,export:true}});
    await page.locator('#styleCards .card').first().waitFor({state:'attached'});
    await toStepThree(page);
    const g=await generateFacts(page);
    assert.equal(g.drawn,true,'Generate is drawn at the last step (it was hidden, leaving Back alone)');
    assert.equal(g.onScreen,true,'Generate is on screen without a scroll');assert.equal(g.uncovered,true,'nothing covers Generate');
    assert.match(g.label,/Generate/);assert.equal(g.disabled,true);
    assert.match(g.why,/not included in your access here\. This server's administrator can add it\./);assert.ok(g.whyGap<24,'the reason sits beside Generate');
    assert.equal(g.floating,true,'the sticky bar is marked data-ef-floating so the orb rests above it');
    await page.locator('#generateBtn').click({force:true});assert.equal(posts.length,0,'a disabled Generate sends nothing');
    assert.deepEqual(errors,[]);
  }
});

test('F15: with no image model Generate is still drawn at Step 3, disabled, saying why once',async t=>{
  const {page,posts,errors}=await fixture(t,{provider:{configured:false,provider:'native-unconfigured',unavailable:'portrait_provider_unavailable'}});
  await page.locator('#providerBanner').waitFor();assert.equal(await page.locator('#providerBanner').isVisible(),true,'Step 1 says so before the person starts');
  await toStepThree(page);
  const g=await generateFacts(page);
  assert.equal(g.drawn&&g.onScreen&&g.uncovered,true);assert.equal(g.disabled,true);assert.match(g.label,/Generate my headshot/);
  assert.match(g.why,/no image-generation provider is configured on this installation/);
  assert.equal(await page.locator('#providerBanner').isVisible(),false,'at Step 3 the reason is said once, beside Generate');
  assert.equal(posts.length,0);assert.deepEqual(errors,[]);
});

test('F15: the first screen names the three steps; the current step is a filled numbered circle',async t=>{
  const {page,errors}=await fixture(t);
  assert.deepEqual(await page.locator('#stepper button').evaluateAll(rows=>rows.map(row=>row.innerText.trim())),['1 Photo','2 Style','3 Generate']);
  const circles=await page.locator('#stepper .step-num').evaluateAll(rows=>rows.map(row=>{const css=getComputedStyle(row);return {w:Math.round(row.getBoundingClientRect().width),radius:css.borderRadius,bg:css.backgroundColor};}));
  assert.ok(circles.every(c=>c.w>=24&&c.radius==='50%'),'each step number is a circle: '+JSON.stringify(circles));
  assert.notEqual(circles[0].bg,circles[1].bg,'the current step is filled');
  assert.match(await page.locator('#stepsLead').innerText(),/pick a style, then press Generate/);assert.equal(await page.locator('#stepsLead').isVisible(),true);
  assert.equal(await page.locator('#stepPhoto .step-nav').getAttribute('data-ef-floating'),'');
  assert.deepEqual(errors,[]);
});

test('F15: the native kernel\'s asleep answer (no ready field) shows the line beside Generate',async t=>{
  const {page,errors}=await fixture(t,{provider:{configured:true,provider:'comfyui',costClass:'free',detail:'the local image model is asleep; the first image wakes it (allow about a minute)'}});
  await page.locator('#stepper').getByRole('button',{name:'3 Generate',exact:true}).click();
  await page.locator('#engineMeta').waitFor();assert.match(await page.locator('#engineMeta').innerText(),/^The local image model is asleep/);
  assert.deepEqual(errors,[]);
});

test('F15: one press makes the portrait when the first answer only woke the image model',async t=>{
  const asleep={configured:true,provider:'comfyui',detail:'the local image model is asleep; the first image wakes it (allow about a minute)'};
  let checks=0;// after the wake: asleep at the first check, running at the next, so the press must wait
  const {page,posts,deletes,errors}=await fixture(t,{permissions:{view:true,read:true,create:true,change:true,export:true,delete:true},
    provider:sent=>sent.length&&++checks>1?{configured:true,provider:'comfyui',detail:'the local image model is running'}:asleep,
    answer:n=>n===1?[503,{error:'portrait_generation_failed',portraitId:'wake-1',detail:'the image model is starting; try again in about a minute'}]:[201,{portraitId:'made-2',status:'done'}]});
  await toStepThree(page);
  await page.locator('#generateBtn').click();
  await page.locator('#genStatus').filter({hasText:'Waking the image model'}).waitFor();
  assert.equal(posts.length,1,'nothing is resent while the model is still asleep');assert.equal(await page.locator('#generateBtn').isDisabled(),true);
  await page.locator('#genStatus').filter({hasText:'Done! Your portrait is in Your portraits.'}).waitFor({timeout:15000});
  assert.equal(posts.length,2,'the same portrait was sent once more after the wake');assert.deepEqual(deletes,['wake-1'],'the empty record the wake left is removed');
  assert.equal(posts[0].fields.style,posts[1].fields.style);assert.equal(posts[0].bytes,posts[1].bytes);
  assert.equal(await page.locator('#generateBtn').isDisabled(),false);assert.deepEqual(errors,[]);
});

test('1.17.4: Step 1 cropper stays bounded for landscape and tall portrait photos with Next: Style on screen',async t=>{
  for(const [width,phone] of [[412,true],[1440,false]]){
    const height=width===412?915:900,{page,errors}=await fixture(t,{width,height,phone});
    for(const [name,buf] of [['Landscape.png',photo],['TallPortrait.png',tallPhoto]]){
      await page.locator('#fileInput').setInputFiles({name,mimeType:'image/png',buffer:buf});
      await page.locator('#cropStage').waitFor();
      const box=await page.evaluate(()=>{const c=document.querySelector('#cropCanvas').getBoundingClientRect(),n=document.querySelector('#stepPhoto .step-next').getBoundingClientRect();return {cw:c.width,ch:c.height,nextOnScreen:n.top>=0&&n.bottom<=innerHeight};});
      assert.ok(box.cw>80&&box.cw<=461,'crop width bounded for '+name+': '+box.cw);
      assert.ok(box.ch>80&&box.ch<=Math.min(341,Math.round(height*0.40)+2),'crop height bounded for '+name+': '+box.ch);
      assert.equal(box.nextOnScreen,true,'Next: Style stays on screen without scrolling for '+name);
    }
    assert.deepEqual(errors,[]);
  }
});

test('1.17.4: Step 3 pairs a live image preview with a two-column minor-adjustment grid and Roman Soldier preset',async t=>{
  for(const [width,phone] of [[412,true],[1440,false]]){
    const height=width===412?915:900,{page,errors}=await fixture(t,{width,height,phone});
    await page.locator('#modeCharacter').click();
    await page.locator('#fileInput').setInputFiles({name:'TallPortrait.png',mimeType:'image/png',buffer:tallPhoto});
    await page.locator('#cropStage').waitFor();
    await page.getByRole('button',{name:'Next: Style',exact:true}).click();
    await page.locator('#styleCards .card',{hasText:'Roman Soldier'}).click();
    await page.getByRole('button',{name:'Next: Generate',exact:true}).click();
    const layout=await page.evaluate(()=>{
      const p=document.querySelector('#step3PreviewCanvas').getBoundingClientRect(),cols=getComputedStyle(document.querySelector('#tuneOpts')).gridTemplateColumns.trim().split(/\s+/).length;
      const g=document.querySelector('#generateBtn').getBoundingClientRect(),stage=document.querySelector('#step3Stage').getBoundingClientRect();
      return {pw:p.width,ph:p.height,cols,stageW:stage.width,onScreen:g.top>=0&&g.bottom<=innerHeight,title:document.querySelector('#step3PreviewTitle').innerText,meta:document.querySelector('#step3PreviewMeta').innerText};
    });
    assert.ok(layout.pw>40&&layout.ph>40,'live cropped photo preview renders on Step 3');
    assert.equal(layout.cols,2,'minor adjustment dropdowns render in a compact 2-column grid');
    assert.ok(layout.stageW<=821,'Step 3 stage width stays bounded ('+Math.round(layout.stageW)+'px)');
    assert.equal(layout.onScreen,true,'Generate stays on screen without scrolling');
    assert.match(layout.title,/Roman Soldier/);assert.match(layout.meta,/Roman Legion Armor/);
    assert.deepEqual(errors,[]);
  }
});
