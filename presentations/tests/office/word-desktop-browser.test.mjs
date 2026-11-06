/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Word in AI Office at 1440x900 with a real mouse (the round-2 trial check, 2026-11-06: the first click on a new document's blank paragraph did not focus it and the typed text was lost; a second click worked): one click on a paragraph that is not yet selected puts the caret in it and the typing lands in the model, for the new document's empty first paragraph and for a second paragraph chosen after it. Real routes over disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT.
 */
import{test}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{fixture}from'./fixture.mjs';
const{chromium}=createRequire(import.meta.url)('playwright');
const DESKTOP={viewport:{width:1440,height:900}};
/** Where the caret is: the focused element and whether it is the paragraph with this index. */
const caret=(page,index)=>page.evaluate(index=>{const paragraphs=[...document.querySelectorAll('.office-word-page [contenteditable=true]')],active=document.activeElement;return{active:active?.className||active?.tagName,inParagraph:paragraphs.indexOf(active)===index};},index);
const typed=(page,index)=>page.evaluate(index=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.model.pages[0].blocks.filter(block=>block.type==='paragraph')[index]?.runs.map(run=>run.text).join('')),index);
/** A real mouse click at the left part of a paragraph, where a person clicks to start writing. */
async function click(page,index){const box=await page.locator('.office-word-page [contenteditable=true]').nth(index).boundingBox();assert.ok(box,'the paragraph is drawn');await page.mouse.click(box.x+Math.min(40,box.width/2),box.y+box.height/2);}

test('Word at 1440x900: one click on the new document\'s blank paragraph puts the caret there and the typing is kept',{timeout:120000},async t=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const page=await browser.newPage(DESKTOP),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.origin+'/api/presentations/editor/app?kind=docx');await page.locator('html[data-office-ready=true]').waitFor();
 assert.equal(await page.locator('.office-word-page [contenteditable=true]').count(),1,'a new document has one paragraph');
 assert.equal((await page.locator('.office-word-page [contenteditable=true]').first().textContent()).trim(),'','and it is empty');
 await click(page,0);
 assert.deepEqual(await caret(page,0),{active:'office-rich-text',inParagraph:true},'the first click focuses the paragraph');
 await page.keyboard.type('One');
 await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.model.pages[0].blocks[0].runs.map(run=>run.text).join('')==='One'),null,{timeout:5000}).catch(()=>{});
 assert.equal(await typed(page,0),'One','the typed text is in the document');
 assert.deepEqual(errors,[]);
});

test('Word at 1440x900: one click on another paragraph moves the caret there, and typing goes into it',{timeout:120000},async t=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const page=await browser.newPage(DESKTOP),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.origin+'/api/presentations/editor/app?kind=docx');await page.locator('html[data-office-ready=true]').waitFor();
 await page.locator('#office-insert-menu>summary').click();await page.locator('#add-paragraph').click();
 await page.waitForFunction(()=>document.querySelectorAll('.office-word-page [contenteditable=true]').length===2);
 await click(page,0);
 assert.deepEqual(await caret(page,0),{active:'office-rich-text',inParagraph:true},'one click on the first paragraph puts the caret there');
 await page.keyboard.type('Top');
 await click(page,1);
 assert.deepEqual(await caret(page,1),{active:'office-rich-text',inParagraph:true},'one click on the second paragraph moves the caret there');
 await page.keyboard.press('End');await page.keyboard.type(' and more');
 await page.waitForTimeout(300);
 assert.equal(await typed(page,0),'Top','the first paragraph kept its words');
 assert.match(await typed(page,1),/ and more$/,'the second paragraph received the typing');
 assert.deepEqual(errors,[]);
});
