/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify automatic inspector/story saves and native publication refresh using real SQL/RLS, model operations and the shared kernel handoff. The internal bot response is an explicit transport seam.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify complete history replay with original CAS, immutable source, asset ownership and switched-document fences.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Share the actual public editor-card alias with workbench browser coverage.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the design-standard screen: the publication is made through the real route and its story frame chosen on the page, as a person does; story text applies as it is typed (the 64-edit cap and the automatic save before handoff are unchanged); Saved history is a sheet and the concierge is the Properties | Concierge pane's tab.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from '../fixtures/fixture.mjs';
import { requireRuntime } from '../fixtures/runtime.mjs';
import { mountSharedEditor } from '../fixtures/shared-ui.mjs';
import { createPublication, openStudio, choose, pick } from '../fixtures/publishing-ui.mjs';
const { chromium } = requireRuntime('playwright');

async function open(t) {
  const f = await fixture({ http: true, extend: mountSharedEditor });
  t.after(() => f.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const created = await createPublication(f, { title: 'Handoff publication', pageCount: 1 });
  await openStudio(page, f.url, created.id); await choose(page, 'frame1');
  await page.waitForFunction(() => window.__oshalDocumentSession);
  const list = await (await fetch(f.url + '/api/publishing-studio/documents')).json();
  const id = list.documents[0].id;
  const read = async () => (await (await fetch(f.url + '/api/publishing-studio/documents/' + id)).json()).document;
  const edit = async (revision, text) => {
    const current = await read(), story = current.model.stories[0];
    const paragraphs = structuredClone(story.paragraphs); paragraphs[0].runs = [{ ...paragraphs[0].runs[0], text }];
    const response = await fetch(f.url + '/api/publishing-studio/documents/' + id + '/edits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: revision, requestKey: randomUUID(), operationsJson: JSON.stringify([{ op: 'replace-story', story: story.id, paragraphs }]) }),
    });
    assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).document;
  };
  return { f, page, id, read, edit };
}
async function begin(page) {
  return page.evaluate(async () => {
    const api = await import('/shared/ui/js/document-handoff.js');
    window.documentHandoff = await api.beginDocumentHandoff(); return window.documentHandoff.context;
  });
}

test('unapplied text saves automatically, the concierge edits the same native story, and the next manual change is read', { timeout: 180000 }, async t => {
  const { page, id, read, edit } = await open(t);
  await page.locator('#story-text').fill('Latest manual story');
  assert.equal(await page.locator('#chat-send').isDisabled(), false);
  const first = await begin(page);
  assert.equal(first.recordId, id); assert.equal(first.fields.revision, 2);
  assert.equal((await read()).model.stories[0].paragraphs[0].runs[0].text, 'Latest manual story');
  await edit(first.fields.revision, 'The concierge updated this story');
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.locator('#story-text').inputValue(), 'The concierge updated this story');
  await page.locator('#story-text').fill('My next manual change');
  const second = await begin(page); assert.equal(second.recordId, id); assert.equal(second.fields.revision, 4);
  assert.equal((await read()).model.stories[0].paragraphs[0].runs[0].text, 'My next manual change');
  await edit(second.fields.revision, 'Continued from your change'); await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.locator('#story-text').inputValue(), 'Continued from your change');
});

test('failed saves stop the publication handoff and a concurrent field remains intact on refresh', { timeout: 180000 }, async t => {
  const { f, page, read, edit } = await open(t);
  await page.locator('#story-text').fill('My private draft'); f.states.get('alice').denied.add('document.change');
  await assert.rejects(begin(page)); assert.equal((await read()).revision, 1);
  assert.equal(await page.locator('#story-text').inputValue(), 'My private draft');
  f.states.get('alice').denied.delete('document.change'); const handed = await begin(page);
  await page.locator('#story-text').fill('My concurrent text'); await edit(handed.fields.revision, 'Saved concierge text');
  await assert.rejects(page.evaluate(() => window.documentHandoff.refresh()), /publication draft is still here/);
  assert.equal(await page.locator('#story-text').inputValue(), 'My concurrent text');
});

test('the embedded publishing concierge saves an unapplied field before its actual request', { timeout: 180000 }, async t => {
  const { page, read } = await open(t); let asked = 0;
  await page.route('**/api/swarm/bots/publishing-editor/ask', async route => {
    const body = route.request().postDataJSON(), current = await read();
    assert.equal(body.context.recordId, current.id); assert.equal(body.context.fields.revision, current.revision);
    assert.equal(current.model.stories[0].paragraphs[0].runs[0].text, 'Text before concierge reading');
    asked++; await route.fulfill({ json: { reply: 'I read your latest story.', sessionId: 'handoff-source' } });
  });
  await page.locator('#story-text').fill('Text before concierge reading');
  if(!await page.locator('.ef-ai').isVisible())await page.locator('.pub-tab', { hasText: 'Concierge' }).click();
  await page.locator('#chat-message').fill('Review the current story'); await page.locator('#chat-send').click();
  await page.locator('#chat-log').filter({ hasText: 'I read your latest story.' }).waitFor(); assert.equal(asked, 1);
});

test('the shared concierge refreshes a saved story and reads the next manual edit in the same session', {timeout:180000}, async t=>{
 const {page,read,edit}=await open(t),manual='Manual source '+randomUUID();let asks=0;
 // Model selection is an explicit seam; real source SQL, saves, editor refresh and session transport are exercised.
 await page.route('**/api/swarm/bots/publishing-editor/ask',async route=>{
  const body=route.request().postDataJSON(),current=await read();asks++;
  assert.equal(body.context.recordId,current.id);assert.equal(body.context.fields.revision,current.revision);
  if(asks===1){await edit(current.revision,'Concierge source in the same story');await route.fulfill({json:{reply:'Updated the story.',sessionId:'publishing-continuity'}});}
  else{assert.equal(body.sessionId,'publishing-continuity');assert.ok(!body.message.includes(manual));assert.equal(current.model.stories[0].paragraphs[0].runs[0].text,manual);await route.fulfill({json:{reply:current.model.stories[0].paragraphs[0].runs[0].text,sessionId:'publishing-continuity'}});}
 });
 await page.locator('.pub-tab',{hasText:'Concierge'}).click();await page.locator('#chat-message').fill('Revise this story');await page.locator('#chat-send').click();
 await page.waitForFunction(()=>document.querySelector('#story-text').value==='Concierge source in the same story');
 // One side pane at a time (Properties | Concierge tabs): type in Properties, then ask in Concierge.
 await page.locator('.pub-tab',{hasText:'Properties'}).click();await page.locator('#story-text').fill(manual);await page.locator('.pub-tab',{hasText:'Concierge'}).click();await page.locator('#chat-message').fill('What does the selected story say now?');await page.locator('#chat-send').click();
 await page.locator('#chat-log').getByText(manual,{exact:true}).waitFor();assert.equal(asks,2);
 assert.equal((await read()).revision,3);assert.equal(await page.locator('#story-text').inputValue(),manual);
});

test('a full manual edit batch is saved automatically before applying and saving the next field', { timeout: 180000 }, async t => {
  const { page, read } = await open(t);
  await page.evaluate(async () => {
    for(let n=0;n<64;n++){
      const field=document.getElementById('story-text');field.value='Manual change '+n;
      field.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('replace-story').click();
      await Promise.resolve();
    }
  });
  await page.locator('#story-text').fill('Final visible field');
  const handed=await begin(page);assert.equal(handed.fields.revision,3);
  assert.equal((await read()).model.stories[0].paragraphs[0].runs[0].text,'Final visible field');
});

test('actual assistant style/view/story changes are one undoable step and manual history survives saves and redo', {timeout:180000}, async t=>{
 const {f,page,id,read}=await open(t),original=await read();await page.locator('#story-text').fill('Manual source before assistant');const handed=await begin(page),manual=await read(),changed=structuredClone(manual.model);changed.pageView='single';changed.characterStyles.accent={...changed.characterStyles.default,size:22};changed.paragraphStyles.caption={...changed.paragraphStyles.body,align:'right'};changed.stories[0].paragraphs[0]={style:'caption',runs:[{text:'Actual saved assistant story',style:'accent'}]};
 const saved=await f.context('alice').store.save(id,{baseRevision:handed.fields.revision,requestKey:randomUUID(),operations:[{op:'replace-model',model:changed}]});await page.evaluate(()=>window.documentHandoff.refresh());assert.equal(await page.locator('#story-text').inputValue(),'Actual saved assistant story');assert.equal(await page.locator('#page-view').inputValue(),'single');assert.equal(await page.locator('#character-style option[value=accent]').count(),1);
 const save=async revision=>{await page.locator('#save').click();await page.waitForFunction(rev=>document.querySelector('#revision').textContent==='Revision '+rev&&!document.querySelector('#render').disabled,revision);};
 await page.locator('#undo').click();assert.equal(await page.locator('#story-text').inputValue(),'Manual source before assistant');assert.equal(await page.locator('#character-style option[value=accent]').count(),0);await save(4);assert.deepEqual((await read()).model,manual.model);
 await page.locator('#redo').click();await save(5);assert.deepEqual((await read()).model,saved.document.model);await page.locator('#undo').click();await page.locator('#undo').click();await save(6);assert.deepEqual((await read()).model,original.model);assert.deepEqual((await f.context('alice').store.get(id,3)).document.model,changed);
});

test('a delayed same-document assistant refresh cannot replace another publication or its history', {timeout:180000},async t=>{
 const {f,page,id,edit}=await open(t);await page.locator('#story-text').fill('History on first document');const handed=await begin(page);await edit(handed.fields.revision,'Saved on first document');const other=await f.context('alice').store.create({title:'Other publication',pageCount:1,requestKey:randomUUID()});await page.locator('#back-to-list').click();await page.locator('#documents button').filter({hasText:'Other publication'}).waitFor();
 let release,arrived;const held=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>arrived=resolve);await page.route('**/api/publishing-studio/documents/'+id,async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response});});const refresh=page.evaluate(()=>window.documentHandoff.refresh());await seen;await page.locator('#documents button').filter({hasText:'Other publication'}).click();await page.locator('#document-title').filter({hasText:'Other publication'}).waitFor();release();await refresh;assert.equal(await page.locator('#document-title').textContent(),'Other publication');assert.equal(await page.locator('#undo').isDisabled(),true);assert.equal(await page.locator('#redo').isDisabled(),true);assert.equal((await f.context('alice').store.get(other.document.id)).document.revision,1);
});

test('an unchanged saved assistant revision preserves the existing redo branch', {timeout:180000},async t=>{
 const {page,read,edit}=await open(t),original=await read();await page.locator('#story-text').fill('Local redo survives');await page.locator('#undo').click();assert.equal(await page.locator('#redo').isEnabled(),true);const handed=await begin(page);await edit(handed.fields.revision,original.model.stories[0].paragraphs[0].runs[0].text);await page.evaluate(()=>window.documentHandoff.refresh());assert.equal(await page.locator('#redo').isEnabled(),true);await page.locator('#redo').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 3'&&!document.querySelector('#render').disabled);assert.equal((await read()).model.stories[0].paragraphs[0].runs[0].text,'Local redo survives');
});

test('an earlier handoff cannot replace a historical view chosen later in the same publication', {timeout:180000},async t=>{
 const {page,edit}=await open(t);await page.locator('#story-text').fill('Handed current source');const handed=await begin(page);await pick(page,'#more-menu','Saved history');await page.locator('dialog[open] #history').selectOption('1');await page.locator('#open-history').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 1 · historical'&&!document.querySelector('#open-history').disabled);await edit(handed.fields.revision,'Later saved assistant source');await page.evaluate(()=>window.documentHandoff.refresh());assert.equal(await page.locator('#revision').textContent(),'Revision 1 · historical');assert.equal(await page.locator('#save').isDisabled(),true);assert.equal(await page.locator('#undo').isDisabled(),true);
});

test('an old approval card cannot execute after opening another publication', {timeout:180000},async t=>{
 const {f,page,id}=await open(t);let executions=0;const proposal={id:'fixture-stale-proposal',app:'publishing-studio',toolName:'publishing-apply-edits',label:'Change the selected publication',mode:'ask',expiresAt:new Date(Date.now()+300000).toISOString(),input:{document:id}};
 // Explicit provider/controller-card transport seams; this test proves the browser refuses execution entirely.
 await page.route('**/api/swarm/bots/publishing-editor/ask',route=>route.fulfill({json:{reply:'Review the change.',packageToolProposal:proposal.id}}));await page.route('**/api/jarvis/package-tools/proposals/'+proposal.id,route=>route.fulfill({json:{proposal}}));await page.route('**/api/jarvis/package-tools/execute',route=>{executions++;return route.fulfill({json:{status:200}});});
 if(!await page.locator('.ef-ai').isVisible())await page.locator('.pub-tab',{hasText:'Concierge'}).click();await page.locator('#chat-message').fill('Edit this publication');await page.locator('#chat-send').click();await page.getByRole('button',{name:'Approve',exact:true}).waitFor();await f.context('alice').store.create({title:'Different approval context',pageCount:1,requestKey:randomUUID()});await page.locator('#back-to-list').click();await page.locator('#documents button').filter({hasText:'Different approval context'}).click();await page.locator('#document-title').filter({hasText:'Different approval context'}).waitFor();assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),0);assert.equal(executions,0);assert.equal((await f.context('alice').store.get(id)).document.revision,1);
});
