/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | PDF Workbench 0.3.0 against the oshal design standard (docs/ux/design-standard.md §3.1, §4.3, §4.4, §4.10, §5.1; Acrobat and PDFgear, REFP CONVENTIONS §5.2), at 412x743 with real touch and at 1440x900.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | PDF Workbench 0.4.0: verify zero [data-ds-not-yet] placeholders remain and all RP-PDF-01..10 and RP-ALL-01 controls are live inside modal opaque menus, mode strips and sheets at phone and desktop sizes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../fixtures/fixture.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
import {screenToPdf,pdfLine} from '../../tools/editor.mjs';
const {chromium}=requireRuntime('playwright');
const SIZES=[['phone 412x743',{viewport:{width:412,height:743},isMobile:true,hasTouch:true,deviceScaleFactor:2.625}],['desktop 1440x900',{viewport:{width:1440,height:900}}]];

async function open(t,options){
 const f=await fixture();t.after(()=>f.close());const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext(options),page=await context.newPage(),errors=[],dialogs=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.type());void dialog.dismiss();});
 await page.goto(f.url+'/api/pdf-workbench/app');await page.locator('.ef-shell').waitFor();await page.locator('[data-pdf-view="blank"],[data-pdf-view="home"]').first().waitFor();return{f,page,errors,dialogs,touch:Boolean(options.hasTouch)};
}
const press=(o,locator)=>o.touch?locator.tap():locator.click();
const primaries=page=>page.evaluate(()=>[...document.querySelectorAll('button.primary,button.ef-primary')].filter(button=>{const box=button.getBoundingClientRect();return box.width&&box.bottom>0&&box.top<innerHeight&&!button.disabled;}).map(button=>button.textContent.trim()));

test('screenToPdf puts a tap where the finger was at every page rotation, and pdfLine keeps one Latin-1 line',()=>{
 const box=[0,0,612,792];
 assert.deepEqual(screenToPdf(0,0,box,0),[0,792]);assert.deepEqual(screenToPdf(1,1,box,0),[612,0]);assert.deepEqual(screenToPdf(.5,.25,box,0),[306,594]);
 assert.deepEqual(screenToPdf(.25,.5,box,90),[306,198]);assert.deepEqual(screenToPdf(.25,.5,box,180),[459,396]);assert.deepEqual(screenToPdf(.25,.5,box,270),[306,594]);
 assert.equal(pdfLine(' Hello\n  world ☃ '),'Hello world');assert.equal(pdfLine('\n'),'');
});

for(const[size,options]of SIZES){
 test(`${size}: a blank Letter page whose one primary is Add text; a tap and typing put the words on an untitled PDF`,async t=>{
  const o=await open(t,options),{page,f}=o;
  assert.equal(await page.locator('html').getAttribute('data-ds-category'),'editor');assert.equal(await page.locator('html').getAttribute('data-ds-first-action'),'type');
  assert.equal(await page.locator('[data-ds-work]').count(),1,'one work surface');
  assert.equal(await page.locator('[data-ds-not-yet],[data-ds-backlog]').count(),0,'zero planned placeholders');
  const paper=page.locator('.pdf-paper');await paper.waitFor();const box=await paper.boundingBox();assert.ok(Math.abs(box.width/box.height-612/792)<.01,'a Letter page');
  assert.deepEqual(await primaries(page),['Add text'],'the first action is the one primary');assert.equal(await page.locator('#save').isVisible(),false,'nothing to save yet');
  if(o.touch)await page.touchscreen.tap(box.x+box.width*.3,box.y+box.height*.2);else await page.mouse.click(box.x+box.width*.3,box.y+box.height*.2);
  await page.keyboard.type('Hello',{delay:30});assert.equal(await page.locator('.pdf-local-text').textContent(),'Hello','the words are on the page');
  await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});await page.locator('#status').filter({hasText:'unsaved operation'}).waitFor();
  assert.deepEqual(await primaries(page),['Export'],'with content the finishing action is the one primary');assert.equal(await page.locator('#save').isVisible(),true,'Save shows while there is something to save');
  await press(o,page.locator('#save'));await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 2'),null,{timeout:60000});
  const id=new URL(page.url()).searchParams.get('document'),saved=await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json();
  assert.equal(saved.document.title,'Untitled PDF');assert.ok(JSON.stringify(saved.document.model).includes('"text":"Hello"'),'the saved revision holds the typed text object');
  assert.deepEqual(o.errors,[]);assert.deepEqual(o.dialogs,[]);
 });

 test(`${size}: menus and sheets are modal and opaque, Back closes them, and all RP-PDF-01..10 and RP-ALL-01 controls are live`,async t=>{
  const o=await open(t,options),{page}=o,url=page.url();
  await press(o,page.getByRole('button',{name:'More',exact:true}));const menu=page.locator('dialog.ds-layer[open]');await menu.waitFor();
  assert.equal(await menu.evaluate(node=>node.matches(':modal')),true,'in the top layer');
  assert.equal(await menu.locator('[role=menu]').evaluate(node=>getComputedStyle(node).backgroundColor.match(/[\d.]+/g).length===3||getComputedStyle(node).backgroundColor.endsWith(', 1)')),true,'opaque');
  assert.equal(await menu.locator('[data-ds-not-yet],[data-ds-backlog]').count(),0,'no planned items in More');
  for(const label of ['Continuous pages','Single page','Two pages','Night mode','Reduce file size…','Convert to Word (.docx)…','Convert to Excel (.xlsx)…','Convert to PowerPoint (.pptx)…']){
   assert.equal(await menu.getByRole('menuitem',{name:label}).count(),1,label+' in More');
  }
  await page.goBack();await menu.waitFor({state:'detached'});assert.equal(page.url(),url,'Back closed the menu inside the editor');
  await press(o,page.getByRole('button',{name:/Annotate/}));const strip=page.locator('.pdf-strip[data-ds-toolrow]');await strip.waitFor();
  assert.equal(await strip.locator('[data-ds-not-yet],[data-ds-backlog]').count(),0,'no planned items in Annotate');
  const labels=await strip.locator('button').evaluateAll(buttons=>buttons.map(button=>button.querySelector('.pdf-word')?.textContent??button.textContent));
  for(const expected of ['Highlight','Underline','Strikethrough','Note','Pen','Eraser'])assert.ok(labels.includes(expected),expected+' is live in Annotate');
  assert.equal(labels.at(-1),'More','More is last');
  assert.equal(await page.getByRole('button',{name:'Done',exact:true}).isVisible(),true,'Done at the top left');
  await press(o,page.getByRole('button',{name:'Done',exact:true}));await press(o,page.getByRole('button',{name:/Sign/}));
  assert.equal(await strip.locator('[data-ds-not-yet],[data-ds-backlog]').count(),0,'no planned items in Sign');
  const signLabels=await strip.locator('button').evaluateAll(buttons=>buttons.map(button=>button.querySelector('.pdf-word')?.textContent??button.textContent));
  for(const expected of ['Text','Check','Cross','Signature','Fields'])assert.ok(signLabels.includes(expected),expected+' is live in Sign');
  await press(o,page.getByRole('button',{name:'Done',exact:true}));await press(o,page.getByRole('button',{name:/Pages/}));
  const pages=page.locator('dialog.ds-layer[open]');await pages.waitFor();
  assert.equal(await pages.locator('[data-ds-not-yet],[data-ds-backlog]').count(),0,'no planned items in Pages');
  assert.equal(await pages.getByRole('button',{name:'Add blank page'}).isEnabled(),true,'Add blank page is live in Pages');
  assert.equal(await pages.locator('#rotate').isVisible(),true,'the page tools are in the Pages sheet');
  await page.goBack();await pages.waitFor({state:'detached'});
  await press(o,page.getByRole('button',{name:/Concierge/}));
  for(const promptText of ['Summarize this PDF','Ask about this page']){
   assert.equal(await page.getByRole('button',{name:promptText,exact:true}).isVisible(),true,promptText+' prompt chip is visible');
  }
  assert.equal(await page.locator('[data-ds-not-yet],[data-ds-backlog]').count(),0,'zero planned placeholders anywhere');
  assert.deepEqual(o.errors,[]);assert.deepEqual(o.dialogs,[]);
 });
}

test('phone 412x743: with PDFs the editor opens on their thumbnails and one New with live From photos, and a delete asks in the page',async t=>{
 const o=await open(t,SIZES[0][1]),{page,f}=o;
 const paper=await page.locator('.pdf-paper').boundingBox();await page.touchscreen.tap(paper.x+paper.width*.2,paper.y+paper.height*.2);await page.keyboard.type('First');
 await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});await page.locator('#save').tap();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 2'),null,{timeout:60000});
 await page.goto(f.url+'/api/pdf-workbench/app');await page.locator('[data-pdf-view="home"]').waitFor();
 assert.equal(await page.locator('.pdf-card').count(),1,'the PDF is on the home screen');assert.deepEqual(await primaries(page),['New'],'one New');
 await page.locator('.pdf-new').tap();const menu=page.locator('dialog.ds-layer[open]');await menu.waitFor();
 assert.equal(await menu.getByRole('menuitem',{name:'From photos…'}).isEnabled(),true,'From photos is live in New');
 await menu.getByRole('button',{name:'Done'}).tap();await menu.waitFor({state:'detached'});
 await page.locator('.pdf-card').tap();await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});
 await page.getByRole('button',{name:'More',exact:true}).tap();await page.getByRole('menuitem',{name:'Delete history'}).tap();
 const confirm=page.locator('dialog.ds-confirm[open]');await confirm.waitFor();await confirm.getByRole('button',{name:'Delete history'}).tap();
 await page.locator('#status').filter({hasText:'Document history deleted'}).waitFor({timeout:30000});
 assert.deepEqual(o.dialogs,[],'no native confirm');assert.deepEqual(o.errors,[]);
});
