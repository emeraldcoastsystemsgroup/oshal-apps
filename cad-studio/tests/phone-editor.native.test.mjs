/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | CAD Studio on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06, F9 "what a waste of header space on mobile", and the trial check: 184 px of bars, the app's own header and a Project/Rebuild row left): the app bar is one row (engine state, New part, More) with no repeated app name, content starts within 74 px of the frame (120 px with the 46 px Today row), and Rebuild runs from More, which then closes. Real routes over disposable PostgreSQL, the local OCCT engine image and the kernel's shared editor from OSHAL_PLATFORM_ROOT.
 */
import test from 'node:test';import assert from 'node:assert/strict';import{startNativeEditorFixture,chromium}from'./native-editor-fixture.mjs';
test('CAD on a phone: one app bar row, content within 74 px, and Rebuild from More',{timeout:180000},async t=>{
 const f=await startNativeEditorFixture(),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const created=await(await fetch(f.origin+'/api/cad-studio/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Phone spacer',base:{kind:'cylinder',diameter:28,height:12}})})).json();assert.ok(created.model,JSON.stringify(created));
 const page=await(await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5})).newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
 await page.goto(f.origin+'/api/cad-studio/app?model='+created.model.model_id);await page.locator('#model-heading').filter({hasText:'Phone spacer'}).waitFor();await page.getByRole('button',{name:'⋯ More',exact:true}).waitFor();
 const bar=await page.evaluate(()=>({viewport:Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top),items:[...document.querySelectorAll('.ef-header-slot :is(h1,span,button,summary)')].filter(node=>node.getClientRects().length&&node.textContent.trim()).map(node=>{const box=node.getBoundingClientRect();return{text:node.textContent.trim(),top:Math.round(box.top),bottom:Math.round(box.bottom)};})}));
 assert.ok(bar.viewport<=74,`content starts ${bar.viewport}px into the frame ${JSON.stringify(bar.items)}`);
 assert.equal(bar.items.some(item=>['CAD Studio','Design and edit your part.','Project','Rebuild'].includes(item.text)),false,'no repeated name and no second row of Project/Rebuild '+JSON.stringify(bar.items));
 assert.deepEqual(bar.items.slice(-2).map(item=>item.text),['New part','⋯ More']);assert.ok(Math.max(...bar.items.map(item=>item.top))<Math.min(...bar.items.map(item=>item.bottom)),'one row');
 const revision=created.model.revision;await page.getByRole('button',{name:'⋯ More',exact:true}).tap();await page.locator('.ef-sheet #rebuild-model').tap();
 await page.locator('.ef-sheet').waitFor({state:'hidden'});await page.locator('#model-state').filter({hasText:`revision ${revision+1}`}).waitFor({timeout:90000});
 assert.equal(await page.locator('header #rebuild-model').count(),1,'Rebuild is back in its place');assert.deepEqual(errors,[]);
});
