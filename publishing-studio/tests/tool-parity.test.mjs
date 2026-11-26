/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.5.6: verify CREATE-TOOL-PUBLISHING-STUDIO-06, -07, and -15 across model operations, HTTP/concierge tools, and real Chromium at 1440x900 and 412x915.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/fixture.mjs';
import {brochureImage} from './fixtures/brochure.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
import {mountSharedEditor} from './fixtures/shared-ui.mjs';
import {createPublication, openStudio, choose, pick, done} from './fixtures/publishing-ui.mjs';
import {initial, apply, digest, CONTRACT} from '../routes/model.mjs';

const {chromium} = requireRuntime('playwright');
const yaml = requireRuntime('js-yaml');
const root = resolve(import.meta.dirname, '..');

test('model operations: move-page relinks stories, create-master adds named masters, replace-image and set-object edit in place', () => {
  const m = initial('Parity model', 2);
  const moved = apply(m, [{op: 'move-page', page: 'page2', index: 0}]);
  assert.deepEqual(moved.pages.map(p => p.id), ['page2', 'page1']);
  assert.equal(moved.stories[0].firstFrame, 'frame2');
  assert.equal(moved.pages[0].frames[0].nextFrame, 'frame1');
  assert.equal(moved.pages[1].frames[0].nextFrame, null);
  assert.throws(() => apply(m, [{op: 'move-page', page: 'missing', index: 0}]), {code: 'publishing_page_missing'});
  assert.throws(() => apply(m, [{op: 'move-page', page: 'page1', index: 5}]), {code: 'publishing_model_invalid'});

  const withMaster = apply(moved, [
    {op: 'create-master', master: 'chapter_master', objects: [{id: 'bar', kind: 'rect', x: 36, y: 12, width: 120, height: 12, color: [20, 40, 80]}]},
    {op: 'set-page', page: 'page2', values: {masterId: 'chapter_master'}},
  ]);
  assert.ok(withMaster.masters.some(x => x.id === 'chapter_master' && x.objects.length === 1));
  assert.equal(withMaster.pages[0].masterId, 'chapter_master');
  assert.throws(() => apply(withMaster, [{op: 'create-master', master: 'chapter_master'}]), {code: 'publishing_duplicate_id'});

  const img1 = {id: 'asset_one', sha256: 'a'.repeat(64), bytes: 1024, mime: 'image/png'};
  const img2 = {id: 'asset_two', sha256: 'b'.repeat(64), bytes: 2048, mime: 'image/png'};
  const withItems = apply(withMaster, [{
    op: 'replace-layout',
    pages: withMaster.pages.map((p, idx) => idx === 0 ? {
      ...p,
      objects: [
        {id: 'box1', kind: 'rect', x: 40, y: 80, width: 90, height: 45, color: [10, 20, 30]},
        {id: 'pic1', kind: 'image', x: 150, y: 80, width: 100, height: 80, assetId: img1.id},
        {id: 'lbl1', kind: 'text', x: 40, y: 140, width: 140, height: 30, paragraph: {style: 'body', runs: [{text: 'Old label', style: 'default'}]}},
      ],
    } : p),
    masters: withMaster.masters,
    stories: withMaster.stories,
    assets: [img1],
  }]);
  const updated = apply(withItems, [
    {op: 'set-object', page: 'page2', object: 'box1', values: {color: [220, 40, 60]}},
    {op: 'set-object', page: 'page2', object: 'lbl1', values: {paragraph: {style: 'body', runs: [{text: 'Updated label', style: 'header'}]}}},
    {op: 'replace-image', page: 'page2', object: 'pic1', asset: img2},
  ]);
  const objs = updated.pages[0].objects;
  assert.deepEqual(objs.find(o => o.id === 'box1').color, [220, 40, 60]);
  assert.equal(objs.find(o => o.id === 'lbl1').paragraph.runs[0].text, 'Updated label');
  const pic = objs.find(o => o.id === 'pic1');
  assert.equal(pic.assetId, img2.id);
  assert.deepEqual([pic.x, pic.y, pic.width, pic.height], [150, 80, 100, 80]);
  assert.ok(updated.assets.some(a => a.id === img2.id));
  assert.throws(() => apply(updated, [{op: 'replace-image', page: 'page2', object: 'box1', asset: img1}]), {code: 'publishing_model_invalid'});
  for (const op of ['move-page', 'create-master', 'replace-image']) assert.ok(CONTRACT.operations.includes(op));
});

test('concierge tool publishing-delete-asset refuses in-use assets, deletes unused assets, and export preview returns page 2 PNG', {timeout: 180000}, async t => {
  const manifest = yaml.load(await readFile(resolve(root, 'oshal-app.yaml'), 'utf8'));
  const auth = yaml.load(await readFile(resolve(root, 'authorization.yaml'), 'utf8'));
  const delTool = manifest.tools.find(tool => tool.name === 'publishing-delete-asset');
  assert.ok(delTool, 'publishing-delete-asset declared in manifest');
  assert.equal(delTool.executor.apiEndpoint, 'DELETE /api/publishing-studio/assets/{input.asset}');
  assert.equal(delTool.defaultAuthMode, 'ask');
  assert.equal(delTool.requiresApproval, true);
  assert.ok(delTool.cardText && delTool.cardText.length > 0);
  const delBind = auth.bindings.tools.find(b => b.id === 'publishing-delete-asset');
  assert.deepEqual(delBind?.allOf, ['document.view', 'asset.delete']);

  const f = await fixture({http: true});
  t.after(() => f.close());
  const call = (path, {method = 'GET', body} = {}) => fetch(f.url + '/api/publishing-studio' + path, {
    method,
    headers: {'x-test-owner': 'alice', ...(body !== undefined ? {'content-type': 'application/json'} : {})},
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  });
  const uploadAsset = async (title, w, h) => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('requestKey', randomUUID());
    fd.append('file', new Blob([brochureImage(w, h)], {type: 'image/png'}), `${title}.png`);
    const res = await fetch(f.url + '/api/publishing-studio/assets/upload', {method: 'POST', headers: {'x-test-owner': 'alice'}, body: fd});
    assert.equal(res.status, 201);
    return (await res.json()).asset;
  };
  const used = await uploadAsset('Used graphic', 640, 480);
  const unused = await uploadAsset('Unused graphic', 640, 480);
  const created = await (await call('/documents', {method: 'POST', body: {title: 'Concierge parity', pageCount: 2, requestKey: randomUUID()}})).json();
  const docId = created.document.id;
  const page1 = structuredClone(created.document.model.pages);
  page1[0].objects.push({id: 'img_used', kind: 'image', x: 36, y: 120, width: 120, height: 90, assetId: used.id});
  const saveRes = await call(`/documents/${docId}/edits`, {
    method: 'POST',
    body: {
      baseRevision: 1,
      requestKey: randomUUID(),
      operationsJson: JSON.stringify([{
        op: 'replace-layout',
        pages: page1,
        masters: created.document.model.masters,
        stories: created.document.model.stories,
        assets: [{id: used.id, sha256: used.sha256, bytes: used.bytes, mime: used.mime}],
      }]),
    },
  });
  assert.equal(saveRes.status, 200);

  // Refuses deleting in-use asset via concierge tool body shape { asset }
  const refuseRes = await call(`/assets/${used.id}`, {method: 'DELETE', body: {asset: used.id}});
  assert.equal(refuseRes.status, 409);
  assert.equal((await refuseRes.json()).error, 'publishing_asset_retained_by_history');

  // Refuses path/body mismatch
  const mismatchRes = await call(`/assets/${unused.id}`, {method: 'DELETE', body: {asset: used.id}});
  assert.equal(mismatchRes.status, 400);
  assert.equal((await mismatchRes.json()).error, 'publishing_path_body_mismatch');

  // Deletes unused asset cleanly via concierge tool body shape { asset }
  const delRes = await call(`/assets/${unused.id}`, {method: 'DELETE', body: {asset: unused.id}});
  assert.equal(delRes.status, 200);
  assert.deepEqual(await delRes.json(), {deleted: true});
  const listAfter = await (await call('/assets')).json();
  assert.deepEqual(listAfter.assets.map(a => a.id), [used.id]);

  // Render and export page 2 PNG via publishing-export contract
  const renderRes = await call(`/documents/${docId}/render`, {method: 'POST', body: {revision: 2, requestKey: randomUUID()}});
  assert.equal(renderRes.status, 202);
  const {job} = await renderRes.json();
  for (let i = 0; i < 600; i++) {
    const status = (await (await call('/jobs/' + job.id)).json()).job;
    if (status.state === 'ready') break;
    assert.notEqual(status.state, 'failed', JSON.stringify(status));
    await new Promise(r => setTimeout(r, 100));
  }
  const expRes = await call(`/documents/${docId}/export`, {method: 'POST', body: {revision: 2, format: 'preview', page: 2}});
  assert.equal(expRes.status, 200);
  const exp = await expRes.json();
  assert.equal(exp.format, 'preview');
  assert.equal(exp.page, 2);
  const pngRes = await fetch(f.url + exp.contentUrl, {headers: {'x-test-owner': 'alice'}});
  assert.equal(pngRes.status, 200);
  const pngBytes = Buffer.from(await pngRes.arrayBuffer());
  assert.equal(pngBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(digest(pngBytes), exp.sha256);
});

test('browser 1440x900 and 412x915: drag-reorder pages, master canvas without JSON, new named styles, in-place recolour/retext/image swap, and Download page 2 PNG', {timeout: 240000}, async t => {
  const f = await fixture({http: true, extend: mountSharedEditor});
  t.after(() => f.close());
  const browser = await chromium.launch({headless: true});
  t.after(() => browser.close());

  // Seed 2 owned PNG assets for in-place picture replacement
  const uploadAsset = async (title, w, h) => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('requestKey', randomUUID());
    fd.append('file', new Blob([brochureImage(w, h)], {type: 'image/png'}), `${title}.png`);
    const res = await fetch(f.url + '/api/publishing-studio/assets/upload', {method: 'POST', body: fd});
    assert.equal(res.status, 201);
    return (await res.json()).asset;
  };
  const photoA = await uploadAsset('Photo Alpha', 640, 480);
  const photoB = await uploadAsset('Photo Beta', 640, 480);

  const created = await createPublication(f, {title: 'Parity Studio Doc', pageCount: 2});
  const docId = created.id;
  // Seed a placed rect, text object, and image on page 1 so we verify in-place edits
  const seededPages = structuredClone(created.model.pages);
  seededPages[0].objects.push(
    {id: 'rect_inplace', kind: 'rect', x: 40, y: 100, width: 90, height: 50, color: [40, 60, 120]},
    {id: 'text_inplace', kind: 'text', x: 40, y: 170, width: 160, height: 32, paragraph: {style: 'body', runs: [{text: 'Initial heading', style: 'default'}]}},
    {id: 'img_inplace', kind: 'image', x: 200, y: 100, width: 120, height: 90, assetId: photoA.id},
  );
  await f.context('alice').store.save(docId, {
    baseRevision: 1,
    requestKey: randomUUID(),
    operations: [{
      op: 'replace-layout',
      pages: seededPages,
      masters: created.model.masters,
      stories: created.model.stories,
      assets: [{id: photoA.id, sha256: photoA.sha256, bytes: photoA.bytes, mime: photoA.mime}],
    }],
  });

  const page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });

  await openStudio(page, f.url, docId, 2);

  // 1. CREATE-TOOL-PUBLISHING-STUDIO-06: drag-and-drop page reorder (Page 2 -> Page 1)
  assert.equal(await page.locator('#page-rail button').count(), 2);
  await page.locator('#page-rail button[data-page-id="page2"]').dragTo(page.locator('#page-rail button[data-page-id="page1"]'));
  await page.waitForFunction(() => document.querySelector('#page-rail button')?.dataset.pageId === 'page2');
  // Move back with Move later button
  await page.locator('#move-page-down').click();
  await page.waitForFunction(() => document.querySelector('#page-rail button')?.dataset.pageId === 'page1');
  // Move Page 2 to top again and save
  await page.locator('#page-rail button[data-page-id="page2"]').dragTo(page.locator('#page-rail button[data-page-id="page1"]'));
  await page.waitForFunction(() => document.querySelector('#page-rail button')?.dataset.pageId === 'page2');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 3');
  let saved = (await f.context('alice').store.get(docId)).document;
  assert.deepEqual(saved.model.pages.map(p => p.id), ['page2', 'page1']);

  // 2. CREATE-TOOL-PUBLISHING-STUDIO-06: raw JSON hidden by default; create & name master; edit master items on canvas
  assert.equal(await page.locator('#master-objects').isVisible(), false, 'raw JSON box is hidden by default');
  await page.locator('#new-master-name').fill('chapter_master');
  await page.locator('#create-master').click();
  await page.locator('#apply-master-to-page').click();
  await page.locator('#toggle-master-edit').click();
  await page.locator('#master-edit-banner').waitFor({state: 'visible'});
  await page.locator('#master-add-rect').click();
  const masterBox = page.locator('#spread .selection-box[data-master-item="true"]').first();
  await masterBox.waitFor();
  const mb = await masterBox.boundingBox();
  assert.ok(mb);
  await page.mouse.move(mb.x + 12, mb.y + 12);
  await page.mouse.down();
  await page.mouse.move(mb.x + 42, mb.y + 28, {steps: 4});
  await page.mouse.up();
  await page.locator('#exit-master-edit').click();
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 4');
  saved = (await f.context('alice').store.get(docId)).document;
  const chapterMaster = saved.model.masters.find(m => m.id === 'chapter_master');
  assert.ok(chapterMaster && chapterMaster.objects.length === 1);
  assert.ok(chapterMaster.objects[0].x > 36, 'master item dragged visually on canvas');
  assert.equal(saved.model.pages[0].masterId, 'chapter_master');

  // 3. CREATE-TOOL-PUBLISHING-STUDIO-07: create new named styles appearing in both dropdown lists
  await page.locator('.pub-toolrow').getByRole('button', {name: 'Styles'}).click();
  await page.locator('#font').fill('Liberation Sans');
  await page.locator('#font-size').fill('16');
  await page.locator('#font-weight').selectOption('700');
  await page.locator('#new-character-style-name').fill('accent_sans');
  await page.locator('#create-character-style').click();
  const charOpts1 = await page.locator('#character-style option').allTextContents();
  const charOpts2 = await page.locator('#story-character-style option').allTextContents();
  assert.ok(charOpts1.includes('accent_sans') && charOpts2.includes('accent_sans'), 'new character style appears in both lists');

  await page.locator('#align').selectOption('center');
  await page.locator('#new-paragraph-style-name').fill('lead_center');
  await page.locator('#create-paragraph-style').click();
  const paraOpts1 = await page.locator('#paragraph-style option').allTextContents();
  const paraOpts2 = await page.locator('#story-paragraph-style option').allTextContents();
  assert.ok(paraOpts1.includes('lead_center') && paraOpts2.includes('lead_center'), 'new paragraph style appears in both lists');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 5');

  // 4. CREATE-TOOL-PUBLISHING-STUDIO-07: recolour rect, retext text item, and replace picture in place on page1 (now index 1)
  await page.locator('#page-rail button[data-page-id="page1"]').click();
  await choose(page, 'rect_inplace');
  await page.locator('#item-color').fill('#cc3344');
  await page.locator('#apply-item-color').click();
  await choose(page, 'text_inplace');
  await page.locator('#item-text-value').fill('Retexted heading in place');
  await page.locator('#apply-item-text').click();
  await choose(page, 'img_inplace');
  await page.locator('#replace-image-asset').selectOption(photoB.id);
  await page.locator('#apply-replace-image').click();
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#revision').textContent === 'Revision 6');
  saved = (await f.context('alice').store.get(docId)).document;
  const page1After = saved.model.pages.find(p => p.id === 'page1');
  assert.deepEqual(page1After.objects.find(o => o.id === 'rect_inplace').color, [204, 51, 68]);
  assert.equal(page1After.objects.find(o => o.id === 'text_inplace').paragraph.runs[0].text, 'Retexted heading in place');
  const imgAfter = page1After.objects.find(o => o.id === 'img_inplace');
  assert.equal(imgAfter.assetId, photoB.id);
  assert.deepEqual([imgAfter.x, imgAfter.y, imgAfter.width, imgAfter.height], [200, 100, 120, 90], 'image replaced in place keeping geometry');

  // 5. CREATE-TOOL-PUBLISHING-STUDIO-15: Download page 2 PNG on screen
  await page.locator('#page-rail button').nth(1).click();
  await pick(page, '#document-menu', 'Share and export');
  const pngDownload = page.waitForEvent('download', {timeout: 120000});
  await page.locator('dialog[open] #export-png').click();
  const dl = await pngDownload;
  assert.match(dl.suggestedFilename(), /-page-2\.png$/);
  const dlPath = await dl.path();
  const dlBytes = await readFile(dlPath);
  assert.equal(dlBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await done(page);

  // 6. Phone 412x915 touch viewport layout & overflow check
  const phoneCtx = await browser.newContext({viewport: {width: 412, height: 915}, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625});
  t.after(() => phoneCtx.close());
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', e => errors.push('phone: ' + e.message));
  await openStudio(phone, f.url, docId, 6);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal overflow at 412x915');
  await phone.locator('.pub-toolrow').getByRole('button', {name: 'Pages'}).tap();
  assert.equal(await phone.locator('dialog[open] #move-page-up').isVisible(), true);
  assert.equal(await phone.locator('dialog[open] #move-page-down').isVisible(), true);
  await done(phone);

  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
});
