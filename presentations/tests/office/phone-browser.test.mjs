/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Word in AI Office on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06): the pane switcher is on screen as the bottom bar (it sat at x 405-695 in the ribbon on a 390px phone), a new document opens on an empty first paragraph that shows a placeholder, and typed text is the paragraph's whole text, not appended to "Start writing"; Office's own menus still open and choose. Real routes over disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.18.7 (the trial check, 2026-11-06: 291 px of bars before content): the app bar is one row (title, Save, More) and content starts within 74 px of the frame (120 px with the 46 px Today row); Insert waits in More and opens there in place, and a choice in it runs and closes More; with Your documents open, every drawn item of the Navigation sheet is under the finger at its centre.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 2.19.0, the design standard's layout (docs/ux/design-standard.md §3.1, §5.1): the bottom bar is the app's own (Format, Insert, Comment, Concierge, More) and every item is on screen and under the finger; the new document's empty first paragraph has the caret and shows its placeholder when it does not; the app row is one row (Back, the name, Undo, Redo, Save, Export) and content still starts within 74 px of the frame; Insert is the bottom bar's sheet and a choice in it runs and closes it; Your documents is its own first screen, and every drawn card and New is under the finger.
 */
import{test}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{fixture}from'./fixture.mjs';
const{chromium}=createRequire(import.meta.url)('playwright');
const PHONE={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5};
const underFinger=nodes=>nodes.map(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return{label:node.textContent.trim()||node.getAttribute('aria-label'),inside:box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight,hit:hit===node||node.contains(hit)};});

test('a new Word document on a phone: the bottom bar is on screen, the first paragraph is empty and typing replaces the placeholder',async t=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const context=await browser.newContext(PHONE),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.origin+'/api/presentations/editor/app?kind=docx');await page.locator('html[data-office-ready=true]').waitFor();
 const items=await page.locator('.office-bottom-bar > button').evaluateAll(underFinger);
 assert.ok(items.length>=4,JSON.stringify(items));for(const item of items){assert.equal(item.inside,true,item.label+' is on screen');assert.equal(item.hit,true,item.label+' is under the finger');}
 const paragraph=page.locator('.office-word-page [contenteditable=true]').first();
 assert.equal((await paragraph.textContent()).trim(),'','the first paragraph is empty');
 assert.equal(await paragraph.evaluate(node=>node===document.activeElement),true,'the caret is on line 1');
 await paragraph.evaluate(node=>node.blur());
 assert.match(await paragraph.evaluate(node=>getComputedStyle(node,'::before').content),/Start writing/,'a placeholder shows where to type');
 await paragraph.tap();await page.keyboard.type('Hello from a phone');
 await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.model.pages[0].blocks[0].runs.map(run=>run.text).join('')==='Hello from a phone'));
 const bars=await page.evaluate(()=>({viewport:Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top),items:[...document.querySelectorAll('#office-header > :is(button,div) ')].filter(node=>node.getClientRects().length&&getComputedStyle(node).display!=='none').flatMap(node=>node.matches('button')?[node]:[...node.querySelectorAll(':scope > button')].filter(button=>!button.hidden)).map(node=>{const box=node.getBoundingClientRect();return{id:node.id,top:Math.round(box.top),bottom:Math.round(box.bottom),right:Math.round(box.right)};})}));
 assert.ok(bars.viewport<=74,`content starts ${bars.viewport}px into the frame ${JSON.stringify(bars.items)}`);
 assert.deepEqual(bars.items.map(item=>item.id),['office-back','document-name','undo','redo','save-document','office-export'],'Back, the name, Undo, Redo, Save and Export');
 assert.ok(Math.max(...bars.items.map(item=>item.top))<Math.min(...bars.items.map(item=>item.bottom)),'one row: a line crosses all of them '+JSON.stringify(bars.items));
 assert.ok(Math.max(...bars.items.map(item=>item.right))<=390,'nothing runs off the edge '+JSON.stringify(bars.items));
 await page.locator('.office-bottom-bar').getByRole('button',{name:'Insert',exact:true}).tap();
 const paragraphs=await page.locator('.office-word-page .office-block').count();
 await page.getByRole('menuitem',{name:'Paragraph',exact:true}).tap();await page.waitForFunction(count=>document.querySelectorAll('.office-word-page .office-block').length>count,paragraphs);
 await page.locator('dialog.ds-layer[open]').waitFor({state:'detached',timeout:3000});
 assert.deepEqual(errors,[]);
});

test('Word on a phone: Your documents is its own first screen, and every drawn card and New is under the finger',async t=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const context=await browser.newContext(PHONE),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.origin+'/api/presentations/editor/app?kind=docx');await page.locator('html[data-office-ready=true]').waitFor();
 await page.keyboard.type('First');await page.locator('#save-document').tap();await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.revision===1));
 await page.locator('#office-back').tap();await page.locator('#office-home').waitFor();
 const missed=(await page.locator('#office-home :is(button,a[href])').evaluateAll(underFinger)).filter(item=>!item.inside||!item.hit);
 assert.deepEqual(missed,[],'drawn items a tap at their centre would miss');
 assert.equal(await page.locator('.office-doc-card').count(),1,'the saved document is listed');
 assert.deepEqual(errors,[]);
});
