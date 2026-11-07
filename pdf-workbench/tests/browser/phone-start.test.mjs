/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | PDF workbench on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06, F5: "another unusable demo, the page is locked down"): from the empty state the one primary action, Upload a PDF, is on the first screen and opens the chosen PDF in one step; Blank page opens a blank Letter page; the Document menu opens as an opaque sheet that covers neither the app bar nor the pane bar and shows only what this seat can do. Real compiled routes, real PDF engine, disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT. Taps are locator.tap(); the hidden upload input is never filled directly.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.2.4 (the trial check, 2026-11-06: 142 px of bars, "an empty, label-less link"): the app bar is one row (title, Save, More) and content starts within 74 px of the frame (120 px with the 46 px Today row); the start card's links are labelled and boxless; the Document menu waits in More and opens there in place; every item of the Properties sheet that is on screen is under the finger at its centre.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.0 (the oshal design standard §3.1, §4.3, §5.1): the first screen is a blank Letter page under one app row (the document menu, Undo, Redo, Add text, More) with the modes as the bottom bar; Upload a PDF is in the document menu and still opens the chosen PDF in one step; More lists only what this seat can do now as an opaque modal menu; every item of the Format sheet that is on screen is under the finger at its centre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fixture} from '../fixtures/fixture.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
import {openFormat} from './workbench-ui.mjs';
const {chromium}=requireRuntime('playwright');
const PHONE={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5};
const overlaps=(a,b)=>Boolean(a&&b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height);

async function open(t){
 const f=await fixture();t.after(()=>f.close());const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext(PHONE),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.goto(f.url+'/api/pdf-workbench/app');await page.locator('.ef-shell').waitFor();return{f,page};
}
const hitTestable=(page,locator)=>locator.evaluate(element=>{const box=element.getBoundingClientRect();if(!box.width||box.bottom<=0||box.top>=innerHeight)return false;const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return Boolean(hit&&(hit===element||element.contains(hit)));});

test('Upload a PDF in the document menu opens the chosen PDF at its page in one step',async t=>{
 const {f,page}=await open(t);
 await page.locator('#doc-menu').tap();const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'Upload a PDF…'}).tap();await (await chooser).setFiles(join(f.directory,'first.pdf'));
 await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-page-surface img')].some(img=>img.naturalWidth>0),null,{timeout:60000});
 assert.ok(new URL(page.url()).searchParams.get('document'),'the document is open');assert.equal(await page.locator('.pdf-paper').isVisible(),false,'the blank page leaves once a document is open');
});

test('the first screen is a blank page under one app row, with the modes in the bottom bar',async t=>{
 const {page}=await open(t);await page.locator('.pdf-paper').waitFor();
 const bar=await page.evaluate(()=>{const head=document.querySelector('.ef-header-slot').getBoundingClientRect(),items=[...document.querySelectorAll('.ef-header-slot :is(button,a)')].filter(node=>!node.closest('.pdf-modebar')&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>{const box=node.getBoundingClientRect();return{name:node.getAttribute('aria-label')||node.textContent.trim(),top:Math.round(box.top),bottom:Math.round(box.bottom)};});
  return{height:Math.round(head.height),work:Math.round(document.querySelector('[data-ds-work]').getBoundingClientRect().top),items};});
 assert.ok(bar.work<=74,`content starts ${bar.work}px into the frame (${JSON.stringify(bar.items)})`);
 assert.deepEqual(bar.items.map(item=>item.name),['Untitled PDF▾','Undo','Redo','Add text','More'],'the document menu, Undo, Redo, the one primary and More');
 assert.ok(Math.max(...bar.items.map(item=>item.top))<Math.min(...bar.items.map(item=>item.bottom)),'one row: a line crosses every item');
 const modes=await page.locator('.pdf-modebar .pdf-mode').evaluateAll(nodes=>nodes.map(node=>node.querySelector('.pdf-word').textContent));assert.deepEqual(modes,['Annotate','Edit','Sign','Pages','Concierge']);
 const modebar=await page.locator('.pdf-modebar').boundingBox();assert.ok(modebar.y+modebar.height>=844-1&&modebar.width>=389,'the modes are the bottom bar');
});

test('More lists only what this seat can do now, as an opaque modal menu',async t=>{
 const {f,page}=await open(t);
 await page.locator('#doc-menu').tap();const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'Upload a PDF…'}).tap();await (await chooser).setFiles(join(f.directory,'first.pdf'));
 await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});
 await page.getByRole('button',{name:'More',exact:true}).tap();const menu=page.locator('dialog.ds-layer[open]');await menu.waitFor();
 assert.equal(await menu.getByRole('menuitem',{name:'Cancel job'}).count(),0,'Cancel job is not offered while no job runs');
 assert.equal(await hitTestable(page,menu.getByRole('menuitem',{name:'Delete history'})),true,'Delete history is offered to a seat that may delete');
 const paint=await menu.evaluate(node=>({paint:getComputedStyle(node).backgroundColor,blur:getComputedStyle(node).backdropFilter,modal:node.matches(':modal')}));
 assert.doesNotMatch(paint.paint,/rgba\([^)]*,\s*0?\.\d+\)/,'opaque');assert.equal(paint.blur,'none');assert.equal(paint.modal,true,'in the top layer');
 await menu.getByRole('button',{name:'Done'}).tap();await menu.waitFor({state:'detached'});
});

test('with a page open, every Format item on screen is under the finger at its centre',async t=>{
 const {page}=await open(t);await page.locator('.pdf-paper').waitFor();
 const paper=await page.locator('.pdf-paper').boundingBox();await page.touchscreen.tap(paper.x+paper.width*.3,paper.y+paper.height*.3);await page.keyboard.type('Probe');
 await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});
 await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-page-surface img')].some(img=>img.naturalWidth>0),null,{timeout:60000});
 await page.locator('[data-pdf-stage]').first().getByRole('button',{name:/^Text: Probe/}).tap();await openFormat(page);
 const missed=await page.evaluate(()=>{const sheet=document.querySelector('dialog.ds-layer[open]').getBoundingClientRect();return[...document.querySelectorAll('dialog.ds-layer[open] :is(button,input:not([type=hidden]),select,textarea)')].filter(node=>{const box=node.getBoundingClientRect();return box.width>1&&box.height>1&&box.top>=sheet.top&&box.bottom<=sheet.bottom;}).filter(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return!(hit&&(hit===node||node.contains(hit)||hit.control===node));}).map(node=>node.getAttribute('aria-label')||node.textContent.trim()||node.tagName);});
 assert.deepEqual(missed,[],'items inside the sheet that a tap at their centre would miss');
});
