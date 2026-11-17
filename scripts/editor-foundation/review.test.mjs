/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify isolated durable review storage and actual Create/Publishing foundation editing through Chromium and genuine native publishing output.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98: the shared editor pane frames the Jarvis page as the application's concierge; Roger, 2026-11-16, every concierge is the core Jarvis chat window). The review workspace answers /api/jarvis with 503 (no AI provider), so the browser case serves the window where the workspace serves nothing (its page and assets from the same platform, the kernel routes it reads from the stand-in kernel in scripts/one-chat-window/kernel-window.mjs); everything the workspace serves, and its door, are its own. Publishing's ask is made in the window: it shows its model menu and its other controls, a model picked rides on the turn, the turn reaches publishing-editor's door with the person's words alone and the publication saved before it (revision 4) on its context, the workspace's "No AI provider" is said in the window's own bubble with the words kept in its box, and no card is drawn; the publication keeps the green it was saved with. The pane's #chat-message and #chat-send are its hidden stand-in now, and its notice line is gone.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: four editors' concierge entries did not open or could not be pressed. The concierge is now always opened by pressing its Concierge the way a person does, after asserting that the editor opens with its concierge closed; before, the press was skipped whenever a pane already showed, so a run could pass without pressing it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {ReviewStore} from './review-store.mjs';
import {startReviewServer} from './review-server.mjs';
import {kernelPlatform,windowKernel,windowAsset,chatWindow,windowControls,pickModel} from '../one-chat-window/kernel-window.mjs';

/**
 * @description Serve the one chat window in the review workspace where the workspace serves nothing: its page and
 * assets from the platform, and the kernel routes it reads from the stand-in kernel. Whatever the workspace answers
 * itself (the shared UI, the cockpit, the artifact picker) stays its own, and every turn goes to its own door, which
 * has no AI provider; each turn is kept as it was sent.
 * @param {object} context The browser context. @param {string} origin The workspace. @param {string} platform
 * @param {{handle:Function}} kernel The stand-in kernel. @param {Array<object>} doors Every turn sent to a bot's door.
 * @returns {Promise<void>}
 */
async function serveWindow(context,origin,platform,kernel,doors){
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin)return route.fallback();
  if(/^\/api\/swarm\/bots\/[^/]+\/ask$/.test(url.pathname)){if(request.method()==='POST')doors.push({door:url.pathname,...request.postDataJSON()});return route.fallback();}
  const asset=['GET','HEAD'].includes(request.method())?await windowAsset(platform,url.pathname):null;
  const own=asset?null:kernel.handle({method:request.method(),url,body:request.postData()||'',headers:request.headers()});
  if(!asset&&!own)return route.fallback();
  const served=await route.fetch();
  if(served.ok())return route.fulfill({response:served});
  return asset?route.fulfill({status:asset.status,contentType:asset.type,body:asset.body}):route.fulfill({status:own.status,json:own.json});
 });
}

test('Create review revisions survive a fresh store and refuse stale writes without changing bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'editor-review-store-'));try{
  const file=join(dir,'documents.json'),store=new ReviewStore(file),id=store.list()[0].id;
  const first=store.read(id),document=structuredClone(first.document);document.layers[0].fill='#00aa55';
  const next=store.save(id,{baseRevision:1,title:document.name,document});assert.equal(next.revision,2);
  const before=await readFile(file);assert.throws(()=>store.save(id,{baseRevision:1,title:document.name,document}),{status:409});assert.deepEqual(await readFile(file),before);
  const restored=new ReviewStore(file);assert.equal(restored.read(id).document.layers[0].fill,'#00aa55');assert.equal(restored.read(id,1).document.layers[0].fill,'#3b82f6');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('real adapters edit and reopen the same objects, retain native output and keep the review isolated',{timeout:240000},async t=>{
 if(!process.env.STORE_CI_TOOLCHAIN)throw new Error('Set STORE_CI_TOOLCHAIN to the pinned Store toolchain; genuine Chromium is required.');
 // The window comes from the same platform as the shared UI (the review server's own sibling default); none fails here.
 const platform=kernelPlatform(resolve(import.meta.dirname,'../../../kernel-editor-foundation/platform')),kernel=windowKernel(),doors=[],click=locator=>locator.click();
 const {chromium}=createRequire(join(resolve(process.env.STORE_CI_TOOLCHAIN),'package.json'))('playwright');
 const dir=await mkdtemp(join(tmpdir(),'editor-foundation-browser-'));
 let review,browser;const errors=[],outside=[];
 t.after(async()=>{await browser?.close();await review?.close();await rm(dir,{recursive:true,force:true});});
 review=await startReviewServer({port:0,stateFile:join(dir,'create.json')});browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(()=>{if(!localStorage.getItem('cockpit-theme'))localStorage.setItem('cockpit-theme','workspace');localStorage.setItem('cockpit-application-colors','false');});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==review.origin){outside.push(route.request().url());return route.abort();}return route.continue();});
 await serveWindow(context,review.origin,platform,kernel,doors);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 const api=async(path,options={})=>{const response=await fetch(review.origin+path,{...options,headers:{'content-type':'application/json',...options.headers}});return {response,value:await response.json().catch(()=>null)};};
 const status=await api('/review/status');assert.equal(status.value.ai.available,false);
 const refused=await api('/api/swarm/bots/create-editor/ask',{method:'POST',body:JSON.stringify({message:'Edit my shape'})});assert.equal(refused.response.status,503);assert.match(refused.value.error,/No AI provider/);
 const foreign=await api('/api/create/projects',{method:'POST',headers:{origin:'https://unrelated.example'},body:'{}'});assert.equal(foreign.response.status,403);
 await page.goto(review.origin+'/?editor=create');const image=page.frameLocator('#review-editor');await image.locator('.ef-shell').waitFor();
 await image.locator('.layer-select').filter({hasText:'Select this shape'}).click();
 const width=image.locator('[data-editor-property="w"]');await width.fill('500');await width.press('Tab');
 const color=image.locator('[data-editor-property="fill"]');await color.fill('#e11d48');await color.press('Tab');
 await image.locator('#saveProject').click();await image.locator('#saveStatus').filter({hasText:'revision 2'}).waitFor();
 let saved=(await api('/api/create/projects/'+review.info.createId)).value.project;assert.equal(saved.document.layers[0].w,500);assert.equal(saved.document.layers[0].fill,'#e11d48');assert.equal(saved.document.layers[1].text,'Make something together');
 await page.reload();await image.locator('.ef-shell').waitFor();await image.locator('.layer-select').filter({hasText:'Select this shape'}).click();assert.equal(await image.locator('[data-editor-property="w"]').inputValue(),'500');
 await image.locator('[data-editor-property="w"]').fill('520');await image.locator('[data-editor-property="w"]').press('Tab');await image.locator('#undo').click();assert.equal(await image.locator('[data-editor-property="w"]').inputValue(),'500');await image.locator('#redo').click();assert.equal(await image.locator('[data-editor-property="w"]').inputValue(),'520');
 await image.locator('#saveProject').click();await image.locator('#saveStatus').filter({hasText:'revision 3'}).waitFor();
 const imageFrame=page.frames().find(frame=>frame.url().includes('/api/create/editor'));
 await image.locator('[data-editor-property="w"]').fill('540');
 const imageContext=await imageFrame.evaluate(async()=>{const handoff=await import('/shared/ui/js/document-handoff.js');return (await handoff.beginDocumentHandoff()).context;});assert.equal(imageContext.recordId,review.info.createId);assert.equal(imageContext.fields.revision,4);assert.equal((await api('/api/create/projects/'+review.info.createId)).value.project.document.layers[0].w,540);
 const downloaded=page.waitForEvent('download');await image.locator('#exportMenu summary').click();await image.locator('#exportPng').click();const png=await downloaded,stream=await png.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.equal(Buffer.concat(chunks).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 if(process.env.EDITOR_REVIEW_SCREENSHOT_DIR){await mkdir(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,'create-desktop.png'),fullPage:true});}
 await page.goto(review.origin+'/?editor=publishing');const publishing=page.frameLocator('#review-editor');await publishing.locator('.ef-shell').waitFor();await publishing.locator('#document-title').filter({hasText:'Foundation review publication'}).waitFor();
 await publishing.locator('[data-item="reviewShape"]').click();
 const publishingWidth=publishing.locator('[data-editor-property="width"]');await publishingWidth.fill('250');await publishingWidth.press('Tab');
 await publishing.locator('#save').click();await publishing.locator('#status').filter({hasText:'Saved revision 3'}).waitFor();
 let pub=(await api('/api/publishing-studio/documents/'+review.info.publishingId)).value;assert.equal(pub.document.model.pages[0].objects.find(item=>item.id==='reviewShape').width,250);assert.equal(pub.document.model.pages[0].frames[0].height,230);
 await publishing.locator('#reopen').click();assert.equal(await publishing.locator('[data-editor-property="width"]').inputValue(),'250');
 await publishing.locator('#render').click();await publishing.locator('#status').filter({hasText:'Render ready'}).waitFor({timeout:90000});
 const pdf=await fetch(`${review.origin}/api/publishing-studio/documents/${review.info.publishingId}/revisions/3/content?format=pdf`);assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 await publishing.locator('[data-item="reviewShape"]').click();
 if(process.env.EDITOR_REVIEW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,'publishing-desktop.png'),fullPage:true});
 await publishing.locator('[data-editor-property="color"]').fill('#22c55e');
 // Publishing opens its concierge from its side pane's Concierge tab (publishing-shell.mjs); "AI partner" was an older name.
 assert.equal(await publishing.locator('.ef-ai').isVisible(),false,'Publishing opens with its concierge closed');await publishing.getByRole('tab',{name:'Concierge',exact:true}).click();
 const pane=publishing.locator('.ef-ai'),chat=await chatWindow(pane);await windowControls(chat);assert.match(await pane.locator('iframe.jarvis-chat-frame').getAttribute('src'),/[?&]concierge=publishing-studio&bot=publishing-editor(&|$)/,'the concierge is the one chat window as Publishing\'s bot');
 assert.equal(await pickModel(chat,click),'Picked model','the model picked for this request is shown on the control');
 const words='Make this selected shape green.';await chat.locator('#typein').fill(words);await click(chat.locator('#typer button[type=submit]'));await chat.locator('#convo .msg.bot .err').filter({hasText:'No AI provider'}).waitFor();
 assert.equal(doors.length,1);assert.deepEqual([doors[0].door,doors[0].message,doors[0].context.app,doors[0].context.recordId,doors[0].context.fields.revision],['/api/swarm/bots/publishing-editor/ask',words,'publishing-studio',review.info.publishingId,4],'the person\'s words alone reach Publishing\'s bot, with the publication saved before the turn');
 assert.deepEqual([doors[0].context.provider,doors[0].context.model],['picked','picked-model'],'the pick rides on that request');
 assert.equal(await chat.locator('#typein').inputValue(),words,'the words stay in the box');assert.equal(await chat.locator('.jpt-panel').count(),0,'no card');assert.equal(await publishing.locator('.ef-assistant-reply,.ef-assistant-user,.ef-assistant-cards').count(),0,'the page draws no conversation of its own');
 const afterAsk=(await api('/api/publishing-studio/documents/'+review.info.publishingId)).value.document;assert.equal(afterAsk.revision,4);assert.deepEqual(afterAsk.model.pages[0].objects.find(item=>item.id==='reviewShape').color,[34,197,94]);assert.equal(afterAsk.model.pages[0].objects.find(item=>item.id==='reviewShape').width,250);
 await page.getByRole('button',{name:'Switch theme'}).click();await publishing.locator('.ef-shell').waitFor();assert.equal(await publishing.locator('html').getAttribute('data-theme'),'midnight');
 if(process.env.EDITOR_REVIEW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,'publishing-midnight.png'),fullPage:true});
 await page.getByRole('button',{name:'Switch theme'}).click();await publishing.locator('.ef-shell').waitFor();assert.equal(await publishing.locator('html').getAttribute('data-theme'),'workspace');
 await page.setViewportSize({width:412,height:915});
 for(const kind of ['create','publishing']){
  await page.goto(review.origin+'/?editor='+kind);const surface=page.frameLocator('#review-editor');await surface.locator('.ef-shell').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await surface.locator('html').evaluate(node=>node.scrollWidth<=innerWidth),true);
  if(kind==='create'){await surface.getByRole('button',{name:'Navigation',exact:true}).click();await surface.locator('.layer-select').filter({hasText:'Select this shape'}).click();await surface.getByRole('button',{name:'Close navigation'}).click();}
  else{await surface.locator('#document-title').filter({hasText:'Foundation review publication'}).waitFor();await surface.locator('[data-item="reviewShape"]').click();}
  await surface.getByRole('button',{name:'Properties',exact:true}).click();await surface.locator('.ef-inspector').waitFor({state:'visible'});
  assert.equal(await surface.locator('.ef-viewport').evaluate(node=>node.getBoundingClientRect().width>100),true);
  if(process.env.EDITOR_REVIEW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.EDITOR_REVIEW_SCREENSHOT_DIR,kind+'-phone.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
});
