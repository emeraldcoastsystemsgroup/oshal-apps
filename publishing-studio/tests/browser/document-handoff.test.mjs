/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify automatic inspector/story saves and native publication refresh using real SQL/RLS, model operations and the shared kernel handoff. The internal bot response is an explicit transport seam.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from '../fixtures/fixture.mjs';
import { requireRuntime } from '../fixtures/runtime.mjs';
const { chromium } = requireRuntime('playwright'), express = requireRuntime('express');
const platform = resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(import.meta.dirname, '../../../../oshal-kernel/platform'));

async function open(t) {
  const f = await fixture({ http: true, extend: app => app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui'))) });
  t.after(() => f.close());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(f.url + '/api/publishing-studio/app');
  await page.locator('#new-title').fill('Handoff publication'); await page.locator('#new-pages').fill('1');
  await page.locator('#new button').click();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 1' && !document.querySelector('#render').disabled);
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
  await page.locator('#chat-message').fill('Review the current story'); await page.locator('#chat-send').click();
  await page.locator('#chat-log').filter({ hasText: 'I read your latest story.' }).waitFor(); assert.equal(asked, 1);
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
