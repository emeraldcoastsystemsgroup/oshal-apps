/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify automatic inspector/story saves and native publication refresh using real SQL/RLS, model operations and the shared kernel handoff. The internal bot response is an explicit transport seam.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify complete history replay with original CAS, immutable source, asset ownership and switched-document fences.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Share the actual public editor-card alias with workbench browser coverage.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the design-standard screen: the publication is made through the real route and its story frame chosen on the page, as a person does; story text applies as it is typed (the 64-edit cap and the automatic save before handoff are unchanged); Saved history is a sheet and the concierge is the Properties | Concierge pane's tab.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98; Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The concierge cases ask in the window, whose turns go to the fixture's stand-in kernel (shared-ui.mjs sharedEditor): the bot's door still reads the saved publication as each turn arrives (page.route, then on to the stand-in), the person's words alone reach publishing-editor with the saved revision on the context, the second turn continues the publication's own conversation (doc:publishing-studio:<id>, the window's, in place of a session the old reply named), and a card waiting for one publication is gone from the window once another publication opens, so it is never run there. The pane's own transcript and its message suffix are gone with the old pane.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The concierge each case opens is asserted by its address (the coordinator's rule after Roger's 2026-11-17 02:22Z report, where a concierge opened as another application's): the one chat window, /api/jarvis/?concierge=publishing-studio&bot=publishing-editor, read with scripts/one-chat-window/today-host.mjs windowAddress.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from '../fixtures/fixture.mjs';
import { requireRuntime } from '../fixtures/runtime.mjs';
import { sharedEditor } from '../fixtures/shared-ui.mjs';
import { createPublication, openStudio, choose, pick } from '../fixtures/publishing-ui.mjs';
import { chatWindow, sendInWindow } from '../../../scripts/one-chat-window/kernel-window.mjs';
import { windowAddress } from '../../../scripts/one-chat-window/today-host.mjs';
const { chromium } = requireRuntime('playwright');
const click = locator => locator.click();
/** The concierge tab, opened where it is closed: the one chat window inside the pane. */
async function concierge(page) {
  if (!await page.locator('.ef-ai').isVisible()) await page.locator('.pub-tab', { hasText: 'Concierge' }).click();
  const chat = await chatWindow(page.locator('.ef-assistant')), where = await windowAddress(page.locator('.ef-assistant'));
  assert.deepEqual([where.path, where.app, where.bot], ['/api/jarvis/', 'publishing-studio', 'publishing-editor'], 'the Concierge tab opens the one chat window as Publishing\'s own concierge');
  return chat;
}

async function open(t, answer) {
  const { kernel, extend } = sharedEditor({ answer });
  const f = await fixture({ http: true, extend });
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
  return { f, page, id, read, edit, kernel };
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
  const { page, read, kernel } = await open(t, () => 'I read your latest story.'), saved = [];
  // The bot's door reads the saved publication as the turn arrives, then the turn goes on to the stand-in kernel.
  await page.route('**/api/swarm/bots/publishing-editor/ask', async route => { saved.push(await read()); await route.continue(); });
  await page.locator('#story-text').fill('Text before concierge reading');
  const chat = await concierge(page);
  const { ask } = await sendInWindow(chat, 'Review the current story', click, kernel);
  assert.equal(kernel.asks.length, 1); assert.equal(saved.length, 1); const [current] = saved;
  assert.deepEqual([ask.bot, ask.context.app, ask.message], ['publishing-editor', 'publishing-studio', 'Review the current story'], 'the person\'s words alone reach Publishing\'s bot');
  assert.equal(ask.context.recordId, current.id); assert.equal(ask.context.fields.revision, current.revision);
  assert.equal(current.model.stories[0].paragraphs[0].runs[0].text, 'Text before concierge reading', 'the unapplied field was saved before the turn arrived');
});

test('the shared concierge refreshes a saved story and reads the next manual edit in the same session', {timeout:180000}, async t=>{
 let reply='Updated the story.';
 const {page,id,read,edit,kernel}=await open(t,()=>reply),manual='Manual source '+randomUUID(),saved=[];
 // Model selection is an explicit seam; real source SQL, saves, editor refresh and the window's session transport are exercised.
 await page.route('**/api/swarm/bots/publishing-editor/ask',async route=>{
  const current=await read();saved.push(current);
  // The first turn's concierge changes the story while it works; the second answers with the saved story it reads.
  if(saved.length===1)await edit(current.revision,'Concierge source in the same story');else reply=current.model.stories[0].paragraphs[0].runs[0].text;
  await route.continue();
 });
 const chat=await concierge(page);await sendInWindow(chat,'Revise this story',click,kernel);
 await page.waitForFunction(()=>document.querySelector('#story-text').value==='Concierge source in the same story');
 // One side pane at a time (Properties | Concierge tabs): type in Properties, then ask in Concierge.
 await page.locator('.pub-tab',{hasText:'Properties'}).click();await page.locator('#story-text').fill(manual);await page.locator('.pub-tab',{hasText:'Concierge'}).click();
 const {answer}=await sendInWindow(chat,'What does the selected story say now?',click,kernel);await answer.getByText(manual,{exact:true}).waitFor();
 assert.equal(kernel.asks.length,2);const [first,second]=kernel.asks;
 for(const [turn,current] of [[first,saved[0]],[second,saved[1]]]){assert.equal(turn.context.recordId,current.id);assert.equal(turn.context.fields.revision,current.revision);}
 assert.equal(first.sessionId,'doc:publishing-studio:'+id,'the publication\'s own conversation');assert.equal(second.sessionId,first.sessionId,'the next turn continues it');
 assert.ok(!second.message.includes(manual),'the manual text travels as the saved document, not in the words');assert.equal(saved[1].model.stories[0].paragraphs[0].runs[0].text,manual);
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
 let proposal;const {f,page,id,kernel}=await open(t,()=>({answer:'Review the change.',packageToolProposal:proposal}));let executions=0;proposal={id:'fixture-stale-proposal',app:'publishing-studio',toolName:'publishing-apply-edits',label:'Change the selected publication',mode:'ask',expiresAt:new Date(Date.now()+300000).toISOString(),input:{document:id}};
 // Explicit provider/controller-card transport seams; this test proves the browser never executes the card for another publication.
 await page.route('**/api/jarvis/package-tools/proposals/'+proposal.id,route=>route.fulfill({json:proposal}));await page.route('**/api/jarvis/package-tools/execute',route=>{executions++;return route.fulfill({json:{status:200}});});
 const chat=await concierge(page);const {ask}=await sendInWindow(chat,'Edit this publication',click,kernel);assert.equal(ask.context.recordId,id);
 const approve=chat.getByRole('button',{name:'Approve',exact:true});await approve.waitFor();
 await f.context('alice').store.create({title:'Different approval context',pageCount:1,requestKey:randomUUID()});await page.locator('#back-to-list').click();await page.locator('#documents button').filter({hasText:'Different approval context'}).click();await page.locator('#document-title').filter({hasText:'Different approval context'}).waitFor();
 // The window opens the other publication's own conversation: the earlier card is not on screen to be pressed.
 await concierge(page);await approve.waitFor({state:'detached',timeout:10000});
 assert.equal(await approve.count(),0);assert.equal(executions,0);assert.equal((await f.context('alice').store.get(id)).document.revision,1);
});
