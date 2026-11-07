/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shared inspector through real browser controls, original-owner SQL revisions and native publishing operations. Assistant choice is an explicit test seam.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep primary publishing actions selectable at phone touch sizes.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.6: on a phone only Save revision stays in the one app bar row (Render, Undo, Redo and Refresh wait in More, the trial check 2026-11-06); the touch-size proof measures the drawn actions and that one row.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the design-standard screen: the rectangle is chosen by pressing it on the page and edited in Arrange (the one inspector); on a phone Arrange is a sheet the tool row opens; the app row is one row of 44 px targets; Reopen saved lives in Saved history and a discarded draft is confirmed in the page, not by a browser dialog.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from '../fixtures/fixture.mjs';
import {choose,pick,done} from '../fixtures/publishing-ui.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
const {chromium} = requireRuntime('playwright'), express = requireRuntime('express');
const platform = resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(import.meta.dirname, '../../../../oshal-kernel/platform'));

async function open(t, width = 1440) {
  const f = await fixture({http: true, extend: app => app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')))});
  t.after(() => f.close());
  const {document} = await f.context('alice').store.create({title: 'Foundation publication', pageCount: 1, requestKey: randomUUID()});
  const rectangle = {id: 'foundation_rect', kind: 'rect', x: 36, y: 36, width: 100, height: 50, color: [30, 40, 50]};
  const pages = structuredClone(document.model.pages); pages[0].objects.push(rectangle);
  await f.context('alice').store.save(document.id, {baseRevision: document.revision, requestKey: randomUUID(), operations: [
    {op: 'replace-layout', pages, stories: document.model.stories, masters: document.model.masters, assets: document.model.assets},
  ]});
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width, height: 950}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.url + '/api/publishing-studio/app?document=' + document.id);
  await page.locator('body[data-editor-foundation="ready"]').waitFor();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 2' && !document.querySelector('#render').disabled);
  const read = async () => (await f.context('alice').store.get(document.id)).document;
  t.after(() => assert.deepEqual(errors, []));
  return {f, page, read, id: document.id};
}

async function selectRectangle(page) {
  await choose(page, 'foundation_rect');
  await page.locator('[data-editor-property="color"]').waitFor();
}

test('shared geometry and color remain undoable and survive actual saved revision reopen', {timeout: 180000}, async t => {
  const {page, read} = await open(t);
  await selectRectangle(page);
  const x = page.locator('[data-editor-property="x"]');
  await x.fill('48'); await x.press('Tab');
  await page.waitForFunction(() => !document.querySelector('#undo').disabled);
  assert.equal(await page.locator('#x').inputValue(), '48');
  await page.locator('#undo').click(); assert.equal(await x.inputValue(), '36');
  await page.locator('#redo').click(); assert.equal(await x.inputValue(), '48');
  await page.locator('[data-editor-property="color"]').fill('#55aacc');
  await page.locator('[data-editor-property="color"]').dispatchEvent('change');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 3' && !document.querySelector('#render').disabled);
  let saved = await read(); assert.equal(saved.model.pages[0].objects[0].x, 48);
  assert.deepEqual(saved.model.pages[0].objects[0].color, [85, 170, 204]);
  await page.reload(); await page.locator('body[data-editor-foundation="ready"]').waitFor();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 3' && !document.querySelector('#render').disabled);
  await selectRectangle(page); assert.equal(await x.inputValue(), '48');
  saved = await read(); assert.equal(saved.revision, 3);
  await x.fill('56');
  assert.equal(await page.locator('#save').isEnabled(), true, 'a focused property enables the original Save action');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 4' && !document.querySelector('#render').disabled);
  assert.equal((await read()).model.pages[0].objects[0].x, 56);
});

test('focused properties flush before handoff; returned native edits stay manually editable and invalid drafts block handoff', {timeout: 180000}, async t => {
  const {f, page, read, id} = await open(t);
  await selectRectangle(page);
  await page.locator('[data-editor-property="x"]').fill('52');
  const context = await page.evaluate(async () => {
    const api = await import('/shared/ui/js/document-handoff.js');
    window.foundationHandoff = await api.beginDocumentHandoff();
    return window.foundationHandoff.context;
  });
  assert.equal(context.recordId, id); assert.equal(context.fields.revision, 3);
  assert.equal((await read()).model.pages[0].objects[0].x, 52);
  await f.context('alice').store.save(id, {baseRevision: 3, requestKey: randomUUID(), operations: [
    {op: 'set-object', page: 'page1', object: 'foundation_rect', values: {color: [255, 0, 0]}},
  ]});
  await page.evaluate(() => window.foundationHandoff.refresh());
  assert.equal(await page.locator('[data-editor-property="color"]').inputValue(), '#ff0000');
  const x = page.locator('[data-editor-property="x"]'); await x.fill('5000');
  await assert.rejects(page.evaluate(async () => {
    const api = await import('/shared/ui/js/document-handoff.js'); await api.beginDocumentHandoff();
  }));
  assert.equal((await read()).revision, 4); assert.equal(await x.inputValue(), '5000');
  await page.locator('.ef-discard').click(); assert.equal(await x.inputValue(), '52');
});

test('phone keeps the document visible and opens a usable contextual inspector', {timeout: 180000}, async t => {
  const {page} = await open(t, 412);
  await choose(page, 'foundation_rect');
  await page.locator('.pub-toolrow').getByRole('button', {name: 'Arrange'}).click();
  const input = page.locator('dialog[open] [data-editor-property="x"]');
  await input.fill('44'); await input.press('Tab');
  await done(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.locator('.ef-viewport').isVisible(), true);
  assert.equal(await page.locator('#x').inputValue(), '44');
  const actions = await page.locator('.pub-approw > button').evaluateAll(buttons => buttons.filter(button => button.getClientRects().length).map(button => {const box = button.getBoundingClientRect(); return {id: button.id, width: box.width, height: box.height, top: box.top, bottom: box.bottom};}));
  assert.ok(actions.length >= 4, 'the app row holds its controls ' + JSON.stringify(actions));
  assert.ok(Math.max(...actions.map(action => action.top)) < Math.min(...actions.map(action => action.bottom)), 'one app row ' + JSON.stringify(actions));
  for (const action of actions) assert.ok(action.width >= 44 && action.height >= 44, 'a touch-sized ' + action.id + ' ' + JSON.stringify(action));
});

test('cancelled and failed reopen preserve invalid fields; confirmed successful reopen discards them', {timeout: 180000}, async t => {
  const {f, page, id, read} = await open(t);
  await selectRectangle(page);
  const x = page.locator('[data-editor-property="x"]'); await x.fill('5000');
  const native = []; page.on('dialog', dialog => {native.push(dialog.message()); void dialog.dismiss();}); t.after(() => assert.deepEqual(native, [], 'no browser dialog'));
  async function reopen(accept) {
    await pick(page, '#more-menu', 'Saved history');
    await page.locator('dialog[open] #reopen').click();
    const confirm = page.locator('dialog.ds-confirm[open]'); await confirm.waitFor();
    await confirm.getByRole('button', {name: accept ? 'Discard changes' : 'Cancel', exact: true}).click();
    await confirm.waitFor({state: 'detached'});
    if (await page.locator('dialog[open]').count()) await done(page);
  }
  await reopen(false);
  assert.equal(await x.inputValue(), '5000');
  const target = f.url + '/api/publishing-studio/documents/' + id;
  await page.route(target, route => route.fulfill({status: 503, json: {error: 'fixture_read_unavailable'}}));
  await reopen(true);
  await page.locator('.ef-error').filter({hasText: 'fixture_read_unavailable'}).waitFor();
  assert.equal(await x.inputValue(), '5000');
  await page.unroute(target);
  await reopen(true);
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Opened saved revision 2');
  assert.equal(await page.locator('.ef-discard').isVisible(), false);
  assert.equal((await read()).revision, 2);
  await selectRectangle(page); assert.equal(await x.inputValue(), '36');
});
