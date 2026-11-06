/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Word in AI Office on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06): the pane switcher is on screen as the bottom bar (it sat at x 405-695 in the ribbon on a 390px phone), a new document opens on an empty first paragraph that shows a placeholder, and typed text is the paragraph's whole text, not appended to "Start writing"; Office's own menus still open and choose. Real routes over disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.18.7 (the trial check, 2026-11-06: 291 px of bars before content): the app bar is one row (title, Save, More) and content starts within 74 px of the frame (120 px with the 46 px Today row); Insert waits in More and opens there in place, and a choice in it runs and closes More; with Your documents open, every drawn item of the Navigation sheet is under the finger at its centre.
 */
import{test}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{fixture}from'./fixture.mjs';
const{chromium}=createRequire(import.meta.url)('playwright');
test('a new Word document on a phone: the panes are on screen, the first paragraph is empty and typing replaces the placeholder',async t=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.origin+'/api/presentations/editor/app?kind=docx');await page.locator('html[data-office-ready=true]').waitFor();
 const panes=await page.locator('.ef-panes button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return{label:node.textContent,inside:box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight,hit:hit===node||node.contains(hit)};}));
 assert.ok(panes.length>=2,JSON.stringify(panes));for(const pane of panes){assert.equal(pane.inside,true,pane.label+' is on screen');assert.equal(pane.hit,true,pane.label+' is under the finger');}
 const paragraph=page.locator('.office-word-page [contenteditable=true]').first();
 assert.equal((await paragraph.textContent()).trim(),'','the first paragraph is empty');
 assert.match(await paragraph.evaluate(node=>getComputedStyle(node,'::before').content),/Start writing/,'a placeholder shows where to type');
 await paragraph.tap();await page.keyboard.type('Hello from a phone');
 await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.model.pages[0].blocks[0].runs.map(run=>run.text).join('')==='Hello from a phone'));
 const bars=await page.evaluate(()=>({viewport:Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top),items:[...document.querySelectorAll('.ef-header-slot :is(input,button,summary,a)')].filter(node=>node.getClientRects().length).map(node=>{const box=node.getBoundingClientRect();return{text:(node.value&&node.tagName==='INPUT'?'title':node.textContent.trim()),top:Math.round(box.top),bottom:Math.round(box.bottom)};})}));
 assert.ok(bars.viewport<=74,`content starts ${bars.viewport}px into the frame ${JSON.stringify(bars.items)}`);
 assert.deepEqual(bars.items.map(item=>item.text),['title','Save','⋯ More'],'the title, Save and More');assert.ok(Math.max(...bars.items.map(item=>item.top))<Math.min(...bars.items.map(item=>item.bottom)),'one row: a line crosses all three '+JSON.stringify(bars.items));
 await page.getByRole('button',{name:'⋯ More',exact:true}).tap();await page.locator('.ef-sheet #office-insert-menu>summary').tap();
 const paragraphs=await page.locator('.office-word-page .office-block').count();
 await page.locator('.ef-sheet #add-paragraph').tap();await page.waitForFunction(count=>document.querySelectorAll('.office-word-page .office-block').length>count,paragraphs);
 await page.locator('.ef-sheet').waitFor({state:'hidden',timeout:3000});assert.equal(await page.locator('#insert-toolbar #office-insert-menu').count(),1,'Insert is back in its toolbar');
 assert.deepEqual(errors,[]);
});

test('Word on a phone: with Your documents open, every drawn Navigation item is under the finger',async t=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.origin+'/api/presentations/editor/app?kind=docx');await page.locator('html[data-office-ready=true]').waitFor();
 await page.locator('.ef-panes').getByRole('button',{name:'Navigation',exact:true}).tap();await page.locator('.ef-navigation').waitFor({state:'visible'});
 await page.locator('#office-document-library>summary').tap();
 const missed=await page.evaluate(()=>{const sheet=document.querySelector('.ef-navigation').getBoundingClientRect(),drawn=node=>{for(let up=node.parentElement;up;up=up.parentElement)if(up.tagName==='DETAILS'&&!up.open&&!(node.tagName==='SUMMARY'&&node.parentElement===up))return false;return node.getClientRects().length>0;};
  return[...document.querySelectorAll('.ef-navigation :is(button,select,summary,a[href])')].filter(drawn).filter(node=>{const box=node.getBoundingClientRect();return box.width>1&&box.height>1&&box.top>=sheet.top&&box.bottom<=sheet.bottom;}).filter(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return!(hit&&(hit===node||node.contains(hit)));}).map(node=>node.id||node.textContent.trim().slice(0,30));});
 assert.deepEqual(missed,[],'drawn items a tap at their centre would miss');
 assert.deepEqual(errors,[]);
});
