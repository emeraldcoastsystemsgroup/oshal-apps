/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | PDF workbench on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06, F5: "another unusable demo, the page is locked down"): from the empty state the one primary action, Upload a PDF, is on the first screen and opens the chosen PDF in one step; Blank page opens a blank Letter page; the Document menu opens as an opaque sheet that covers neither the app bar nor the pane bar and shows only what this seat can do. Real compiled routes, real PDF engine, disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT. Taps are locator.tap(); the hidden upload input is never filled directly.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.2.4 (the trial check, 2026-11-06: 142 px of bars, "an empty, label-less link"): the app bar is one row (title, Save, More) and content starts within 74 px of the frame (120 px with the 46 px Today row); the start card's links are labelled and boxless; the Document menu waits in More and opens there in place; every item of the Properties sheet that is on screen is under the finger at its centre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fixture} from '../fixtures/fixture.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
const {chromium}=requireRuntime('playwright');
const PHONE={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5};
const overlaps=(a,b)=>Boolean(a&&b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height);

async function open(t){
 const f=await fixture();t.after(()=>f.close());const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext(PHONE),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.goto(f.url+'/api/pdf-workbench/app');await page.locator('.ef-shell').waitFor();return{f,page};
}
const hitTestable=(page,locator)=>locator.evaluate(element=>{const box=element.getBoundingClientRect();if(!box.width||box.bottom<=0||box.top>=innerHeight)return false;const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return Boolean(hit&&(hit===element||element.contains(hit)));});

test('the first screen offers Upload a PDF, and one tap opens the chosen PDF at its page',async t=>{
 const {f,page}=await open(t);
 const primary=page.locator('.ef-viewport .ef-primary');await primary.waitFor();
 assert.equal(await primary.textContent(),'Upload a PDF');assert.equal(await hitTestable(page,primary),true,'on the first screen without opening a pane');
 assert.equal(await page.locator('.pages-hint').isVisible(),false,'the sentence naming hidden controls is replaced');
 const chooser=page.waitForEvent('filechooser');await primary.tap();await (await chooser).setFiles(join(f.directory,'first.pdf'));
 await page.locator('.pdf-page-surface img').first().waitFor({timeout:60000});
 await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-page-surface img')].some(img=>img.naturalWidth>0),null,{timeout:60000});
 assert.ok(new URL(page.url()).searchParams.get('document'),'the document is open');assert.equal(await primary.isVisible(),false,'the start card leaves once a document is open');
});

test('Blank page opens a blank one-page document',async t=>{
 const {page}=await open(t);
 await page.getByRole('button',{name:'Blank page',exact:true}).tap();
 await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-page-surface img')].some(img=>img.naturalWidth>0),null,{timeout:60000});
 assert.equal(await page.locator('.pdf-page-surface').count(),1);assert.match(await page.locator('.ef-header-slot').textContent(),/Blank page/);
});

test('the Document menu waits in More, opens there as an opaque sheet between the bars and lists only what this seat can do',async t=>{
 const {page}=await open(t);
 assert.equal(await page.locator('#actions .pdf-command-menu').isVisible(),false,'not in the one-row app bar on a phone');
 await page.getByRole('button',{name:'⋯ More',exact:true}).tap();const sheet=page.locator('.ef-sheet');await sheet.waitFor();
 await page.locator('.ef-sheet .pdf-command-menu > summary').tap();
 assert.equal(await page.locator('#cancel-job').isVisible(),false,'Cancel job is not offered while no job runs');
 const remove=page.locator('.ef-sheet #delete-document');assert.equal(await hitTestable(page,remove),true);
 const boxes=await page.evaluate(()=>({sheet:document.querySelector('.ef-sheet').getBoundingClientRect().toJSON(),bar:document.querySelector('.ef-header-slot').getBoundingClientRect().toJSON(),panes:document.querySelector('.ef-panes').getBoundingClientRect().toJSON(),
  paint:getComputedStyle(document.querySelector('.ef-sheet')).backgroundColor,blur:getComputedStyle(document.querySelector('.ef-sheet')).backdropFilter}));
 assert.equal(overlaps(boxes.sheet,boxes.bar),false);assert.equal(overlaps(boxes.sheet,boxes.panes),false);
 assert.doesNotMatch(boxes.paint,/rgba\([^)]*,\s*0?\.\d+\)/,'opaque');assert.equal(boxes.blur,'none');
 await page.getByRole('button',{name:'Close',exact:true}).tap();assert.equal(await sheet.isVisible(),false);
 assert.equal(await page.locator('#actions .pdf-command-menu #delete-document').count(),1,'the item is back in its menu');
 const panes=await page.locator('.ef-panes button').allTextContents();assert.deepEqual(panes,['Documents','Properties','Concierge']);
});

test('the app bar is one row and content starts within 74 px; the start links are labelled and boxless',async t=>{
 const {page}=await open(t);await page.locator('.ef-viewport .ef-primary').waitFor();await page.getByRole('button',{name:'⋯ More',exact:true}).waitFor({timeout:10000});
 const bar=await page.evaluate(()=>{const head=document.querySelector('.ef-header-slot').getBoundingClientRect(),items=[...document.querySelectorAll('.ef-header-slot :is(h2,button,summary,a)')].filter(node=>node.getClientRects().length).map(node=>{const box=node.getBoundingClientRect();return{text:node.textContent.trim(),top:Math.round(box.top),bottom:Math.round(box.bottom)};});
  return{height:Math.round(head.height),viewport:Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top),items,links:[...document.querySelectorAll('.ef-start .ef-start-link')].filter(node=>node.getClientRects().length).map(node=>({text:node.textContent.trim(),shadow:getComputedStyle(node).boxShadow,image:getComputedStyle(node).backgroundImage}))};});
 assert.ok(bar.viewport<=74,`content starts ${bar.viewport}px into the frame (${JSON.stringify(bar.items)})`);
 assert.deepEqual(bar.items.map(item=>item.text),['Open a document','Save','⋯ More'],'title, Save and More');
 assert.ok(Math.max(...bar.items.map(item=>item.top))<Math.min(...bar.items.map(item=>item.bottom)),'one row: a line crosses all three '+JSON.stringify(bar.items));
 assert.deepEqual(bar.links,[{text:'Blank page',shadow:'none',image:'none'}],'one labelled text link, no empty box');
});

test('with a page open, every Properties item on screen is under the finger at its centre',async t=>{
 const {page}=await open(t);
 await page.getByRole('button',{name:'Blank page',exact:true}).tap();
 await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-page-surface img')].some(img=>img.naturalWidth>0),null,{timeout:60000});
 await page.locator('.ef-panes').getByRole('button',{name:'Properties',exact:true}).tap();await page.locator('.ef-inspector').waitFor({state:'visible'});
 // Open every section by touch, one at a time (each tap moves the ones below it).
 for(let round=0;round<24;round+=1){const closed=page.locator('.ef-inspector details:not([open]) > summary').filter({visible:true}).first();if(!await closed.count())break;await closed.scrollIntoViewIfNeeded();await closed.tap();}
 // A closed <details> keeps boxes for its hidden content (content-visibility), so only what is really drawn is probed.
 const missed=await page.evaluate(()=>{const sheet=document.querySelector('.ef-inspector').getBoundingClientRect(),drawn=node=>{for(let up=node.parentElement;up;up=up.parentElement)if(up.tagName==='DETAILS'&&!up.open&&!(node.tagName==='SUMMARY'&&node.parentElement===up))return false;return true;};return[...document.querySelectorAll('.ef-inspector :is(button,input:not([type=hidden]),select,textarea,summary)')].filter(drawn).filter(node=>{const box=node.getBoundingClientRect();return box.width>1&&box.height>1&&box.top>=sheet.top&&box.bottom<=sheet.bottom;}).filter(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return!(hit&&(hit===node||node.contains(hit)||(hit.tagName==='LABEL'&&hit.control===node)));}).map(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return{item:node.id||node.textContent.trim().slice(0,24)||node.name,hit:hit&&(hit.id||hit.className||hit.tagName)};});});
 assert.deepEqual(missed,[],'items inside the sheet that a tap at their centre would miss');
});
