/** Genuine Chromium -> mounted app -> original-owner disposable SQL -> framed Typst.
 * CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the explicit host module seam and prove drafts no longer disable automatic-save chat.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Mount actual shared editor/cards and verify a held approval refreshes the same real SQL publication.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the design-standard screen: the same proofs through the controls a person now has (the frame chosen on the page, typing that applies as you type, Arrange's one inspector, Render and check in Share and export, Saved history, the Concierge tab, the phone's Concierge tool), and the fence test's pending buffer is a page setting, since story text no longer waits for Apply. A selection change with unapplied fields is refused in the page, never through a browser dialog.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98; Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The approval proof asks in the window through the fixture's stand-in kernel (shared-ui.mjs sharedEditor): the person's words alone reach publishing-editor with the saved publication at revision 4 on the context (the old pane's "Current saved document and selection" suffix is gone), the card waits in the window, Approve runs the held operations on the real store and the page shows revision 5 in single view; on a phone the Concierge tool opens the window in a sheet with its composer in view and nothing wider than the screen.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The concierge each case opens is asserted by its address (the coordinator's rule after Roger's 2026-11-17 02:22Z report, where a concierge opened as another application's): the one chat window, /api/jarvis/?concierge=publishing-studio&bot=publishing-editor, read with scripts/one-chat-window/today-host.mjs windowAddress.
 * Bot/controller responses are explicit transport seams here, not installed/provider proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/fixture.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
import {mountSharedEditor,sharedEditor} from './fixtures/shared-ui.mjs';
import {createPublication,openStudio,choose,pick,done} from './fixtures/publishing-ui.mjs';
import {chatWindow,sendInWindow} from '../../scripts/one-chat-window/kernel-window.mjs';
import {windowAddress} from '../../scripts/one-chat-window/today-host.mjs';
/** The window a Concierge opened is Publishing's own concierge, by its address. */
async function publishingConcierge(scope){const where=await windowAddress(scope);assert.deepEqual([where.path,where.app,where.bot],['/api/jarvis/','publishing-studio','publishing-editor'],'the one chat window as Publishing\'s own concierge');}
const {chromium}=requireRuntime('playwright');
test('real page editor saves/reopens drafts, renders exact PDF previews and handles native-shaped approval cards',{timeout:180000},async()=>{
 const proposal={id:'publishing-source-held-'+randomUUID(),app:'publishing-studio',toolName:'publishing-apply-edits',label:'Apply layout change',input:{operationsJson:'[{"op":"set-view","pageView":"single"}]'},mode:'ask',expiresAt:new Date(Date.now()+180000).toISOString()};
 // The concierge's answer carries the card for the turn's own saved publication and revision.
 const {kernel,extend}=sharedEditor({answer:ask=>{proposal.input={...proposal.input,document:ask.context.recordId,baseRevision:ask.context.fields.revision,requestKey:randomUUID()};return{answer:'A layout change is waiting for your approval.',packageToolProposal:proposal};}});
 const f=await fixture({http:true,extend}),browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 let approvals=0;
 await page.route('**/api/jarvis/package-tools/proposals/*',r=>r.fulfill({json:proposal}));
 await page.route('**/api/jarvis/package-tools/execute',async r=>{
  approvals++;assert.equal(r.request().headers()['x-oshal-package-tool'],'1');assert.deepEqual(r.request().postDataJSON(),{proposalId:proposal.id});
  // The explicit controller seam dispatches only the held operations to the real owned store.
  const result=await f.context('alice').store.save(proposal.input.document,{baseRevision:proposal.input.baseRevision,requestKey:proposal.input.requestKey,operations:JSON.parse(proposal.input.operationsJson)});
  return r.fulfill({json:{status:200,result}});
 });
 try{
  const created=await createPublication(f,{title:'Browser owned publication',pageCount:2});await openStudio(page,f.url,created.id);
  assert.equal(await page.locator('#page-rail button').count(),2);assert.equal(await page.locator('#spread .page-board > svg').count(),2);
  const otherFrame=page.locator('.page-board').nth(1).locator('.selection-box').first();await otherFrame.scrollIntoViewIfNeeded();const bounds=await otherFrame.boundingBox();assert.ok(bounds);await page.mouse.move(bounds.x+20,bounds.y+20);await page.mouse.down();await page.mouse.move(bounds.x+32,bounds.y+20,{steps:3});await page.mouse.up();assert.ok(Number(await page.locator('#x').inputValue())>36,'drag selects and moves a frame on the other facing page');await page.locator('#undo').click();assert.equal(Number(await page.locator('#x').inputValue()),36);await page.getByRole('button',{name:'Page 1',exact:true}).click();
  await choose(page,'frame1');await page.locator('#story-text').fill('Actual human editor text saved in immutable SQL.');assert.match(await page.locator('#revision').innerText(),/unsaved/);assert.equal(await page.locator('#chat-send').isDisabled(),false);
  assert.match(await page.locator('#spread [data-text-for="frame1"] .pub-text-body').innerText(),/^Actual human editor text/,'what is typed is drawn in its frame at once');
  await page.locator('#undo').click();assert.equal(await page.locator('#save').isDisabled(),true);await page.locator('#redo').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 2'&&!document.querySelector('#render').disabled);
  const documents=await (await fetch(f.url+'/api/publishing-studio/documents')).json(),id=documents.documents[0].id;const saved=await (await fetch(f.url+'/api/publishing-studio/documents/'+id)).json();assert.equal(saved.document.model.stories[0].paragraphs[0].runs[0].text,'Actual human editor text saved in immutable SQL.');
  await page.locator('.pub-toolrow').getByRole('button',{name:'Arrange'}).click();const x=page.locator('[data-editor-property="x"]');await x.fill('40');await x.press('Tab');await page.waitForFunction(()=>document.querySelector('#x').value==='40');await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 3'&&!document.querySelector('#render').disabled);
  await page.locator('#page-view').selectOption('facing');assert.equal(await page.locator('#spread .page-board > svg').count(),2);await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 4'&&!document.querySelector('#render').disabled);
  await pick(page,'#more-menu','Render and check');await page.locator('dialog[open] #render').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Render ready'),{timeout:90000});await page.waitForFunction(()=>document.querySelectorAll('#spread .page-board > svg > image').length===2);assert.match(await page.locator('#preflight').innerText(),/sourceSha256/);
  const layoutDownload=page.waitForEvent('download');await page.locator('dialog[open] #export-layout').click();assert.match((await layoutDownload).suggestedFilename(),/\.json$/);await done(page);
  const downloaded=page.waitForEvent('download');await page.locator('#export-pdf').click();assert.match((await downloaded).suggestedFilename(),/\.pdf$/);
  await pick(page,'#more-menu','Saved history');await page.locator('dialog[open] #reopen').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 4'&&!document.querySelector('#render').disabled&&document.querySelector('#story-text').value.startsWith('Actual human'));if(await page.locator('dialog[open]').count())await done(page);
  await page.locator('.pub-tab',{hasText:'Concierge'}).click();const chat=await chatWindow(page.locator('.ef-assistant'));await publishingConcierge(page.locator('.ef-assistant'));
  const {ask}=await sendInWindow(chat,'Suggest an edit',locator=>locator.click(),kernel);
  assert.deepEqual([ask.bot,ask.context.app,ask.message],['publishing-editor','publishing-studio','Suggest an edit'],'the person\'s words alone reach Publishing\'s bot');
  assert.equal(ask.context.recordId,ask.context.documentId);assert.ok(ask.context.recordId);assert.equal(ask.context.fields.revision,4);
  const card=chat.locator('.jpt-panel');await card.getByRole('button',{name:'Approve',exact:true}).waitFor();
  assert.equal(kernel.asks.length,1);assert.equal(approvals,0);assert.equal((await f.context('alice').store.get(id)).document.revision,4);assert.equal(await page.locator('#page-view').inputValue(),'facing');
  await card.getByRole('button',{name:'Approve',exact:true}).click();
  // The revision refresh retires this card; the saved document and visible view prove the accepted result.
  await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 5'&&document.querySelector('#page-view').value==='single');
  assert.equal(approvals,1);assert.equal(await card.getByRole('button',{name:'Approve',exact:true}).count(),0);
  const approved=(await f.context('alice').store.get(id)).document;assert.equal(approved.id,id);assert.equal(approved.revision,5);assert.equal(approved.model.pageView,'single');assert.equal(approved.model.stories[0].paragraphs[0].runs[0].text,saved.document.model.stories[0].paragraphs[0].runs[0].text);
  await page.setViewportSize({width:390,height:844});const finish=page.locator('.pub-toolrow').getByRole('button',{name:'Done'});if(await finish.count())await finish.click();await page.locator('.pub-toolrow').getByRole('button',{name:'Concierge',exact:true}).click();
  const phoneChat=await chatWindow(page.locator('dialog[open] .ef-assistant'));await publishingConcierge(page.locator('dialog[open] .ef-assistant'));const composer=phoneChat.locator('.jc-composer');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({id:e.id,tag:e.tagName,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))));
  assert.equal(await composer.isVisible(),true,'the window\'s message box is in the sheet');
  // Both boxes are in the page's own coordinates (Playwright measures a framed element against the main viewport).
  const sheet=await page.locator('dialog[open]:has(.ef-assistant)').boundingBox(),box=await composer.boundingBox();
  assert.ok(box.x>=sheet.x-1&&box.x+box.width<=Math.min(sheet.x+sheet.width,390)+1&&box.y+box.height<=Math.min(sheet.y+sheet.height,844)+1,'the window\'s message box is in the sheet and on screen '+JSON.stringify({sheet,box}));
  assert.deepEqual(errors,[]);
  assert.ok(writes.some(p=>p.endsWith('/render')));assert.ok(writes.some(p=>p.endsWith('/revisions')));
 }finally{await browser.close();await f.close();}
});

test('pending field drafts and delayed create/render replies cannot overwrite another document',{timeout:120000},async()=>{
 const f=await fixture({http:true,extend:mountSharedEditor}),browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const api=async(path,body)=>{const response=await fetch(f.url+'/api/publishing-studio'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const a=(await api('/documents',{title:'Fence Alpha',pageCount:2,requestKey:randomUUID()})).document;
 const b=(await api('/documents',{title:'Fence Beta',pageCount:2,requestKey:randomUUID()})).document;
 let releaseCreate,releaseRender;const createGate=new Promise(r=>releaseCreate=r),renderGate=new Promise(r=>releaseRender=r);let createArrived,renderArrived;const createSeen=new Promise(r=>createArrived=r),renderSeen=new Promise(r=>renderArrived=r);
 try{
  const direct=await fetch(f.url+'/api/publishing-studio/app?document='+a.id);assert.equal(direct.status,200);assert.equal((await fetch(f.url+'/api/publishing-studio/app?document=foreign')).status,400);
  await page.goto(f.url+'/api/publishing-studio/app?document='+a.id);await page.locator('body[data-editor-foundation=ready]').waitFor();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 1'&&!document.querySelector('#render').disabled);
  // A page setting typed but not applied is a pending buffer: choosing another page is refused in the page, never by a browser dialog, and keeps it.
  const dialogs=[];page.on('dialog',dialog=>{dialogs.push(dialog.message());void dialog.dismiss();});
  await page.locator('#page-width').fill('420');await page.getByRole('button',{name:'Page 2',exact:true}).click();
  await page.locator('.ef-error').filter({hasText:'Discard field edits'}).waitFor();assert.equal(await page.locator('#page-width').inputValue(),'420');
  await page.locator('.pub-toolrow').getByRole('button',{name:'Styles'}).click();await page.locator('#font-size').fill('12');await page.locator('#character-properties button').click();
  assert.equal(await page.locator('#page-width').inputValue(),'420');assert.equal(await page.locator('#save').isDisabled(),true,'applying a style keeps the separate pending page buffer');
  await pick(page,'.pub-toolrow button:last-child','Page settings');await page.locator('#page-properties > button').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 2'&&!document.querySelector('#render').disabled);
  await page.route('**/api/publishing-studio/documents',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();createArrived();await createGate;await route.fulfill({response});});
  const making=pick(page,'#document-menu','New blank Letter page');await createSeen;
  await page.evaluate(()=>{const text=document.querySelector('#story-text');text.value='Attempt during pending create';text.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.locator('#save').isDisabled(),true,'async create locks revision changes instead of accepting then losing them');releaseCreate();await making;await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Untitled publication');await page.waitForFunction(()=>!document.querySelector('#render').disabled);
  const stillA=await (await fetch(f.url+'/api/publishing-studio/documents/'+a.id)).json();assert.equal(stillA.document.model.pages[0].width,420);assert.equal(stillA.document.model.stories[0].paragraphs[0].runs[0].text,a.model.stories[0].paragraphs[0].runs[0].text);
  await page.locator('#back-to-list').click();await page.getByRole('button',{name:/^Fence Beta/}).click();await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Fence Beta'&&!document.querySelector('#render').disabled);
  await page.route('**/api/publishing-studio/documents/*/render',async route=>{const response=await route.fetch();renderArrived();await renderGate;await route.fulfill({response});});
  await pick(page,'#more-menu','Render and check');await page.locator('dialog[open] #render').click();await renderSeen;await done(page);
  await page.locator('#back-to-list').click();await page.getByRole('button',{name:/^Fence Alpha/}).click();await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Fence Alpha'&&!document.querySelector('#render').disabled);releaseRender();
  await page.waitForTimeout(900);assert.equal(await page.locator('#document-title').innerText(),'Fence Alpha');assert.doesNotMatch(await page.locator('#status').textContent(),/^Render ready/);assert.equal(await page.locator('#cancel-render').isDisabled(),true);assert.equal(await page.locator('#preflight').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
 }finally{releaseCreate();releaseRender();await browser.close();await f.close();}
});
