/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Scan to Print on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06, F2: "after taking a picture and selecting the angle it doesn't show the image ... I can't use it due to the page layout"): from the empty state the one primary action is Take photos; one tap creates the object and, with no live camera, opens the phone camera picker; three photos land as thumbnails, placing Front, Top and Right fills the checklist with visible thumbnails and turns the primary action into Make 3D model; video, .ply and silhouettes wait under a closed, in-flow Advanced. Real compiled routes over the route fixture and the kernel's shared editor from OSHAL_PLATFORM_ROOT. The hidden inputs are never filled directly.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.8.7 (the trial check, 2026-11-06): the ruler measurement is a visible step directly above Make 3D model, which waits for it; one width then builds the model to Download STL; the app's own name is not repeated on a phone and content starts within 74 px of the frame (120 px with the 46 px Today row); a reload reopens the object; choosing an object in the Objects sheet closes it; removing a photo asks first.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.9.0, the design standard (DS-25, DS-30): the first action reads Take a photo, and removing a photo asks in an in-page sheet (Cancel removes nothing, Remove removes it); no native dialog opens in any case.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import fixtureModule from './routes-core.fixture.js';
const{startFixture,photo,coreRequire}=fixtureModule;const{chromium}=coreRequire('playwright');let browser;
before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>{await browser?.close();});
const PHONE={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5};
async function capture(page){const primary=page.locator('.ef-viewport .ef-start .ef-primary');await primary.waitFor();const chooser=page.waitForEvent('filechooser');await primary.tap();
 await (await chooser).setFiles([['front.png',await photo(60,30)],['top.png',await photo(60,40)],['right.png',await photo(40,30)]].map(([name,buffer])=>({name,mimeType:'image/png',buffer})));
 await page.waitForFunction(()=>document.querySelectorAll('#image-grid .image-card img').length===3);
 for(const [index,view] of ['front','top','right'].entries()){await page.locator('#image-grid .image-card select').nth(index).selectOption(view);await page.waitForFunction(v=>[...document.querySelectorAll('#view-checklist .view-slot:not(.missing) b')].some(b=>b.textContent.toLowerCase().startsWith(v)),view);}}
const visible=locator=>locator.evaluate(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return box.width>0&&box.top>=0&&box.bottom<=innerHeight&&(hit===node||node.contains(hit));});
test('Take a photo starts the object, the photos show at once and the checklist leads to Make 3D model',async t=>{
 const fixture=await startFixture(),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5});
 t.after(async()=>{await context.close();await fixture.close();});const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(fixture.base+'/app');await page.locator('.ef-shell').waitFor();
 const primary=page.locator('.ef-viewport .ef-start .ef-primary');await primary.waitFor();
 assert.equal(await primary.textContent(),'Take a photo');assert.equal(await page.locator('.ef-viewport .ef-primary:visible').count(),1,'one primary action');assert.equal(await visible(primary),true,'on the first screen');
 const chooser=page.waitForEvent('filechooser');await primary.tap();
 await (await chooser).setFiles([['front.png',await photo(60,30)],['top.png',await photo(60,40)],['right.png',await photo(40,30)]].map(([name,buffer])=>({name,mimeType:'image/png',buffer})));
 await page.waitForFunction(()=>document.querySelectorAll('#image-grid .image-card img').length===3);
 await page.waitForFunction(()=>[...document.querySelectorAll('#image-grid .image-card img')].every(img=>img.complete&&img.naturalWidth>0));
 assert.match(await page.locator('#job-heading').textContent(),/^Object · /,'named for today without a prompt');
 assert.equal(await page.locator('#capture-advanced').evaluate(node=>!node.open&&getComputedStyle(node).position==='static'),true,'Advanced is closed and in the flow');
 for(const [index,view] of ['front','top','right'].entries()){await page.locator('#image-grid .image-card select').nth(index).selectOption(view);await page.waitForFunction(v=>[...document.querySelectorAll('#view-checklist .view-slot:not(.missing) b')].some(b=>b.textContent.toLowerCase().startsWith(v)),view);}
 await page.waitForFunction(()=>[...document.querySelectorAll('#view-checklist .view-slot img')].filter(img=>img.complete&&img.naturalWidth>0).length===3);
 const next=page.locator('#make-model');await next.waitFor();assert.equal(await page.locator('#take-photos').textContent(),'Take more photos');
 await next.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0,'only the editor viewport scrolls');
 assert.deepEqual(await page.locator('.ef-panes button').allTextContents(),['Objects','Properties','Concierge']);
 assert.deepEqual(errors,[]);
});

test('the ruler measurement is a visible step before Make 3D model, and one width builds the model to Download STL',{timeout:120000},async t=>{
 const fixture=await startFixture(),context=await browser.newContext(PHONE);t.after(async()=>{await context.close();await fixture.close();});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(fixture.base+'/app');await page.locator('.ef-shell').waitFor();
 const bars=await page.evaluate(()=>({viewport:Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top),brand:[...document.querySelectorAll('.ef-header-slot h1')].filter(node=>node.getClientRects().length).length}));
 assert.equal(bars.brand,0,'the Today row already names Scan to Print');assert.ok(bars.viewport<=74,`content starts ${bars.viewport}px into the frame`);
 await capture(page);
 const step=page.locator('#measure-step'),make=page.locator('#make-model');await step.waitFor();
 assert.equal(await make.isDisabled(),true,'Make 3D model waits for the measurement');
 const order=await page.evaluate(()=>({step:document.querySelector('#measure-step').getBoundingClientRect().bottom,make:document.querySelector('#make-model').getBoundingClientRect().top}));
 assert.ok(order.step<=order.make,'the measurement comes before the button');assert.equal(await visible(page.locator('#measure-width')),true,'the width field is on the page, not in a sheet');
 await page.locator('#measure-width').tap();await page.keyboard.type('60');
 assert.equal(await make.isDisabled(),false,'one width is enough');assert.equal(await page.locator('#dim-x').inputValue(),'60','it is the Width X calibration');
 await make.tap();await page.locator('#download-stl').waitFor({state:'visible',timeout:90000});
 const stl=await page.locator('#download-stl').getAttribute('href');const answer=await fetch(new URL(stl,fixture.base));assert.equal(answer.status,200);
 assert.ok((await answer.arrayBuffer()).byteLength>84,'a binary STL with facets');
 assert.deepEqual(errors,[]);
});

test('a reload reopens the object, choosing an object closes the Objects sheet, and removing a photo asks first',{timeout:120000},async t=>{
 const fixture=await startFixture(),context=await browser.newContext(PHONE);t.after(async()=>{await context.close();await fixture.close();});
 const page=await context.newPage(),errors=[],dialogs=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(fixture.base+'/app');await page.locator('.ef-shell').waitFor();await capture(page);
 const name=await page.locator('#job-heading').textContent();
 await page.reload();await page.locator('.ef-shell').waitFor();
 await page.locator('#job-heading').filter({hasText:name}).waitFor();assert.equal(await page.locator('#job-panel').isVisible(),true,'the object is open again after a reload');
 assert.equal(await page.locator('.ef-header-slot #header-title').textContent(),name,'the app bar names the open object on a phone');assert.equal(await page.locator('.ef-header-slot #header-title').isVisible(),true);
 await page.locator('.ef-panes').getByRole('button',{name:'Objects',exact:true}).tap();assert.equal(await page.locator('.ef-editor').getAttribute('data-editor-panel'),'navigation');
 await page.locator('#job-list .job-item').first().tap();await page.waitForFunction(()=>document.querySelector('.ef-editor').dataset.editorPanel==='');
 assert.equal(await page.locator('.ef-scrim').isVisible(),false,'the sheet and its scrim close on a choice');
 page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.dismiss();});
 const sheet=page.locator('#ask-sheet');
 await page.locator('#image-grid .image-card button.danger').first().tap();await sheet.waitFor();
 assert.match(await page.locator('#ask-text').textContent(),/^Remove this photo from "/,'the question is asked in the page');
 await page.locator('#ask-no').tap();await sheet.waitFor({state:'hidden'});
 assert.equal(await page.locator('#image-grid .image-card').count(),3,'Cancel removes nothing');
 await page.locator('#image-grid .image-card button.danger').first().tap();await sheet.waitFor();assert.equal(await page.locator('#ask-yes').textContent(),'Remove');
 await page.locator('#ask-yes').tap();await page.waitForFunction(()=>document.querySelectorAll('#image-grid .image-card').length===2);
 assert.deepEqual(dialogs,[],'no native dialog');
 assert.deepEqual(errors,[]);
});
