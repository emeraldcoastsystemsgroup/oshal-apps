/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove common Motion selection, exact native properties, inline caption handoff and responsive layout over actual owned SQL and compositor pixels.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Assert real saved-document/selection context and unchanged owned content through an explicit unavailable-provider boundary.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.0 layout: the composition's settings are filled in the docked panel and its native New form is submitted (the first layer does the same in the person's flow); the caption is added through the native Add form the + Add menu drives; a reopened composition is chosen from the list; the Properties tool is pressed only where it is drawn (on a phone).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98; Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The unavailable-provider proof asks in the window: the person's words alone reach motion-editor once, with the saved composition, its revision and the selected layer on the context; the window says in words that the model is unavailable and keeps the words in its box; no card is shown and the prepared caption stays saved. The pane's own notice line, transcript and message suffix are gone with the old pane.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The concierge each case opens is asserted by its address (the coordinator's rule after Roger's 2026-11-17 02:22Z report, where a concierge opened as another application's): the one chat window, /api/jarvis/?concierge=motion-studio&bot=motion-editor, read with scripts/one-chat-window/today-host.mjs windowAddress.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {startApplicationFixture,chromium} from '../application-fixture.mjs';
import {chatWindow} from '../../../scripts/one-chat-window/kernel-window.mjs';
import {windowAddress} from '../../../scripts/one-chat-window/today-host.mjs';
import {parseNative,readProject} from '../../tools/native-json.mjs';
test('Motion common editor changes the selected native layer and text, saves/reopens and retains rendered output',{timeout:180000},async t=>{
 const f=await startApplicationFixture(),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
 await page.goto(f.origin+'/api/motion-studio/app');await page.locator('.ef-shell').waitFor();await page.locator('#new [name=title]:enabled').waitFor();
 await page.locator('#new [name=title]').fill('Common Motion editor');await page.locator('#new [name=width]').fill('320');await page.locator('#new [name=height]').fill('180');await page.locator('#new').evaluate(form=>form.requestSubmit());await page.locator('#revision').filter({hasText:'revision 1'}).waitFor();
 await page.locator('#add button:enabled').waitFor({state:'attached'});await page.locator('#add').evaluate(form=>{form.elements.kind.value='text';form.elements.text.value='Selectable native title';form.requestSubmit();});await page.locator('#revision').filter({hasText:'revision 2'}).waitFor();
 const x=page.locator('[data-editor-property="transform/position:0"]');await x.waitFor();await x.fill('120');await x.press('Tab');await page.locator('#revision').filter({hasText:'revision 3'}).waitFor().catch(async error=>{throw new Error('Common native transform: '+await page.locator('.ef-field-status').textContent()+' / '+await page.locator('#error').textContent()+' / '+await page.locator('#revision').textContent());});
 const handle=page.getByRole('button',{name:'Move selected layer in composition'});await handle.waitFor();const box=await handle.boundingBox(),previewBox=await page.locator('#preview').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2,{steps:3});await page.mouse.up();await page.locator('#revision').filter({hasText:'revision 4'}).waitFor();
 const text=page.locator('[data-editor-property="text"]');await text.waitFor();await text.fill('Edited native title');await text.press('Tab');await page.locator('#revision').filter({hasText:'revision 5'}).waitFor();
 const id=await page.locator('#projects').inputValue();let saved=readProject(parseNative(await(await fetch(f.origin+'/api/motion-studio/projects/'+id)).text()).project);const comp=Object.values(saved.document.items).find(i=>i.kind.type==='Comp'),layer=comp.kind.layers[0];assert.ok(Math.abs(layer.props.children.find(p=>p.match==='transform').children.find(p=>p.match==='position').value.v[0]-(120+20*320/previewBox.width))<0.001);assert.equal(layer.props.children.find(p=>p.match==='text').children.find(p=>p.match==='sourceText').value.v.text,'Edited native title');
 await page.locator('[data-editor-property="text"]:enabled').waitFor();await page.locator('#preview').dblclick({position:{x:10,y:10}});await page.getByRole('textbox',{name:'Edit text in composition'}).fill('Inline native title');await page.locator('.motion-inline-text button[type=submit]').click();await page.locator('#revision').filter({hasText:'revision 6'}).waitFor().catch(async error=>{throw new Error('Inline native save: '+await page.locator('#error').textContent()+' / '+await page.locator('#revision').textContent());});
 await page.reload();await page.locator('.ef-shell').waitFor();await page.locator('.motion-home-row').filter({hasText:'Common Motion editor'}).click();await page.locator('[data-editor-property="text"]').filter({hasText:''}).waitFor();assert.equal(await page.locator('[data-editor-property="text"]').inputValue(),'Inline native title');
 await page.locator('#textEdit [name=content]').evaluate(el=>{for(let n=el;n;n=n.parentElement)if(n.tagName==='DETAILS')n.open=true;});await page.locator('#textEdit [name=content]').fill('Prepared native caption for AI');await proveUnavailableAssistant(page,'motion-studio','motion-editor',id,7);saved=readProject(parseNative(await(await fetch(f.origin+'/api/motion-studio/projects/'+id)).text()).project);assert.equal(Object.values(saved.document.items).find(i=>i.kind.type==='Comp').kind.layers[0].props.children.find(p=>p.match==='text').children.find(p=>p.match==='sourceText').value.v.text,'Prepared native caption for AI');
 assert.ok((await page.locator('#preview').getAttribute('src')).startsWith('data:image/png;base64,'));
 if(process.env.EDITOR_REVIEW_SCREENSHOT_DIR){await mkdir(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,'motion-desktop.png'),fullPage:true});}
 await page.setViewportSize({width:412,height:915});if(!await page.locator('.ef-inspector').isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.ef-inspector').waitFor({state:'visible'});
 if(process.env.EDITOR_REVIEW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,'motion-phone.png'),fullPage:true});
 assert.deepEqual(errors,[]);
});

// The unavailable provider is an explicit boundary seam; saving and document context use genuine app routes.
async function proveUnavailableAssistant(page,app,bot,recordId,revision){
 const requests=[];await page.route('**/api/swarm/bots/'+bot+'/ask',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'AI provider unavailable in this isolated review fixture. Your document is kept.'})});});
 if(!await page.locator('.ef-ai').isVisible())await page.getByRole('button',{name:'Concierge',exact:true}).click();
 // The concierge is the one chat window: the person types in its box and presses its Send.
 const chat=await chatWindow(page.locator('.ef-assistant'));const where=await windowAddress(page.locator('.ef-assistant'));
 assert.deepEqual([where.path,where.app,where.bot],['/api/jarvis/',app,bot],'the Concierge opens the one chat window as Motion\'s own concierge');
 await chat.locator('#typein').fill('Adjust the selected object.');await chat.locator('#typer button[type=submit]').click();
 const failure=chat.locator('#convo .msg.bot .bx .err');await failure.waitFor();assert.match(await failure.textContent(),/unavailable/i,'the window says in words that no model could answer');
 assert.equal(await chat.locator('#typein').inputValue(),'Adjust the selected object.','the words stay in the box to send again');
 assert.equal(requests.length,1);assert.equal(requests[0].message,'Adjust the selected object.','the person\'s words alone: the document is on the context');
 const context=requests[0].context;assert.equal(context.app,app);assert.equal(context.recordId,recordId);assert.equal(context.fields.revision,revision);assert.equal(context.selection.ids.length,1);assert.ok(context.selection.kind);
 assert.equal(await chat.locator('#convo .jpt-panel').count(),0,'no card without an answer');const properties=page.getByRole('button',{name:'Properties',exact:true});if(await properties.isVisible())await properties.click();
}
