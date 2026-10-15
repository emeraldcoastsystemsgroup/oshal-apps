/** Genuine Chromium -> mounted app -> original-owner disposable SQL -> framed Typst.
 * Native bot/cards are an explicit browser transport seam here, not installed/provider proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/fixture.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
const {chromium}=requireRuntime('playwright');
test('real page editor saves/reopens drafts, renders exact PDF previews and handles native-shaped approval cards',{timeout:180000},async()=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 const proposal={id:'publishing-source-held-'+randomUUID(),app:'publishing-studio',toolName:'publishing-apply-edits',label:'Apply layout change',input:{operationsJson:'[{"op":"set-view","pageView":"single"}]'},mode:'ask',expiresAt:'2099-01-01T00:00:00Z'};
 let asks=0,approvals=0;
 await page.route('**/shared/ui/**',r=>r.fulfill({status:200,body:'',contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript'}));
 await page.route('**/api/swarm/bots/publishing-editor/ask',r=>{asks++;const body=r.request().postDataJSON();assert.equal(body.context.app,'publishing-studio');assert.ok(body.context.documentId);assert.ok(body.message.includes('Current saved selection'));return r.fulfill({json:{reply:'A layout change is waiting for your approval.',sessionId:'source-session',packageToolProposal:proposal}});});
 await page.route('**/api/jarvis/package-tools/proposals/*',r=>r.fulfill({json:proposal}));
 await page.route('**/api/jarvis/package-tools/execute',r=>{approvals++;assert.equal(r.request().headers()['x-oshal-package-tool'],'1');assert.deepEqual(r.request().postDataJSON(),{proposalId:proposal.id});return r.fulfill({json:{status:200,result:{sourceTransportSeam:true}}});});
 try{
  await page.goto(f.url+'/api/publishing-studio/app');await page.locator('#new-title').fill('Browser owned publication');await page.locator('#new-pages').fill('2');await page.locator('#new button').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 1'&&!document.querySelector('#render').disabled);
  assert.equal(await page.locator('#page-rail button').count(),2);assert.equal(await page.locator('#spread svg').count(),2);
  const otherFrame=page.locator('.page-board').nth(1).locator('.selection-box').first(),bounds=await otherFrame.boundingBox();assert.ok(bounds);await page.mouse.move(bounds.x+20,bounds.y+20);await page.mouse.down();await page.mouse.move(bounds.x+32,bounds.y+20,{steps:3});await page.mouse.up();assert.ok(Number(await page.locator('#x').inputValue())>36,'drag selects and moves a frame on the other facing page');await page.locator('#undo').click();assert.equal(Number(await page.locator('#x').inputValue()),36);await page.getByRole('button',{name:'Page 1',exact:false}).click();
  await page.locator('#story-text').fill('Actual human editor text saved in immutable SQL.');await page.locator('#replace-story').click();assert.match(await page.locator('#revision').innerText(),/unsaved/);assert.equal(await page.locator('#chat-send').isDisabled(),true);
  await page.locator('#undo').click();assert.equal(await page.locator('#save').isDisabled(),true);await page.locator('#redo').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 2'&&!document.querySelector('#render').disabled);
  const documents=await (await fetch(f.url+'/api/publishing-studio/documents')).json(),id=documents.documents[0].id;const saved=await (await fetch(f.url+'/api/publishing-studio/documents/'+id)).json();assert.equal(saved.document.model.stories[0].paragraphs[0].runs[0].text,'Actual human editor text saved in immutable SQL.');
  await page.locator('#x').fill('40');await page.locator('#geometry button').click();assert.equal(await page.locator('#x').inputValue(),'40');await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 3'&&!document.querySelector('#render').disabled);
  await page.locator('#page-view').selectOption('facing');assert.equal(await page.locator('#spread svg').count(),2);await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 4'&&!document.querySelector('#render').disabled);
  await page.locator('#render').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Render ready'),{timeout:90000});await page.waitForFunction(()=>document.querySelectorAll('#spread svg image').length===2);assert.match(await page.locator('#preflight').innerText(),/sourceSha256/);
  const downloaded=page.waitForEvent('download');await page.locator('#export-pdf').click();assert.match((await downloaded).suggestedFilename(),/\.pdf$/);
  const layoutDownload=page.waitForEvent('download');await page.locator('#export-layout').click();assert.match((await layoutDownload).suggestedFilename(),/\.json$/);
  await page.locator('#reopen').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 4'&&!document.querySelector('#render').disabled&&document.querySelector('#story-text').value.startsWith('Actual human'));
  await page.locator('#chat-message').fill('Suggest an edit');await page.locator('#chat-send').click();await page.waitForSelector('.approval');assert.equal(asks,1);assert.equal(approvals,0);await page.getByRole('button',{name:'Approve action',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.approval').textContent.startsWith('Action result'));assert.equal(approvals,1);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(50);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({id:e.id,tag:e.tagName,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))));assert.equal(await page.locator('#chat-form').isVisible(),true);assert.deepEqual(errors,[]);
  assert.ok(writes.some(p=>p.endsWith('/render')));assert.ok(writes.some(p=>p.endsWith('/revisions')));
 }finally{await browser.close();await f.close();}
});

test('pending field drafts and delayed create/render replies cannot overwrite another document',{timeout:120000},async()=>{
 const f=await fixture({http:true}),browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/shared/ui/**',r=>r.fulfill({status:200,body:'',contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript'}));
 const api=async(path,body)=>{const response=await fetch(f.url+'/api/publishing-studio'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const a=(await api('/documents',{title:'Fence Alpha',pageCount:2,requestKey:randomUUID()})).document;
 const b=(await api('/documents',{title:'Fence Beta',pageCount:2,requestKey:randomUUID()})).document;
 let releaseCreate,releaseRender;const createGate=new Promise(r=>releaseCreate=r),renderGate=new Promise(r=>releaseRender=r);let createArrived,renderArrived;const createSeen=new Promise(r=>createArrived=r),renderSeen=new Promise(r=>renderArrived=r);
 try{
  const direct=await fetch(f.url+'/api/publishing-studio/app?document='+a.id);assert.equal(direct.status,200);assert.equal((await fetch(f.url+'/api/publishing-studio/app?document=foreign')).status,400);
  await page.goto(f.url+'/api/publishing-studio/app?document='+a.id);await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 1'&&!document.querySelector('#render').disabled);
  await page.locator('#story-text').fill('Unapplied text must survive selection.');page.on('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Page 2',exact:false}).click();assert.equal(await page.locator('#story-text').inputValue(),'Unapplied text must survive selection.');
  await page.getByText('Typography',{exact:true}).click();await page.locator('#font-size').fill('12');await page.locator('#character-properties button').click();assert.equal(await page.locator('#story-text').inputValue(),'Unapplied text must survive selection.');assert.equal(await page.locator('#save').isDisabled(),true,'applying typography preserves the separate pending story buffer');
  await page.locator('#replace-story').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 2'&&!document.querySelector('#render').disabled);
  await page.route('**/api/publishing-studio/documents',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();createArrived();await createGate;await route.fulfill({response});});
  await page.locator('#new-title').fill('Fence Created');await page.locator('#new button').click();await createSeen;
  await page.evaluate(()=>{const text=document.querySelector('#story-text');text.value='Attempt during pending create';text.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#replace-story').click();});
  assert.equal(await page.locator('#save').isDisabled(),true,'async create locks revision changes instead of accepting then losing them');releaseCreate();await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Fence Created');await page.waitForFunction(()=>!document.querySelector('#render').disabled);
  const stillA=await (await fetch(f.url+'/api/publishing-studio/documents/'+a.id)).json();assert.equal(stillA.document.model.stories[0].paragraphs[0].runs[0].text,'Unapplied text must survive selection.');
  await page.getByRole('button',{name:'Fence Beta',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Fence Beta'&&!document.querySelector('#render').disabled);
  await page.route('**/api/publishing-studio/documents/*/render',async route=>{const response=await route.fetch();renderArrived();await renderGate;await route.fulfill({response});});
  await page.locator('#render').click();await renderSeen;await page.getByRole('button',{name:'Fence Alpha',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Fence Alpha'&&!document.querySelector('#render').disabled);releaseRender();
  await page.waitForTimeout(900);assert.equal(await page.locator('#document-title').innerText(),'Fence Alpha');assert.doesNotMatch(await page.locator('#status').innerText(),/^Render ready/);assert.equal(await page.locator('#cancel-render').isDisabled(),true);assert.equal(await page.locator('#preflight').innerText(),'');assert.deepEqual(errors,[]);
 }finally{releaseCreate();releaseRender();await browser.close();await f.close();}
});
