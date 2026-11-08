/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the oshal design standard for Publishing Studio (docs/ux/design-standard.md §3, §4, §5.1; REFP CONVENTIONS §5.5; Roger F6; the UX audit decision publishing-studio--publishing-studio). Real Chromium over the real routes, the real publishing engine and a disposable PostgreSQL: a blank Letter page opens ready with one primary (Add text frame) and one tool row with More last; typed text is drawn in its frame at once without a save; Download PDF saves, renders and downloads the draft by itself; no page preview is asked for before a render (the 409 regression); the chosen frame raises a selection float while the row switches to its tools; menus and sheets are opaque top-layer dialogs that Back closes, and nothing asks through a browser dialog; Your publications lists newest first with one New; the desktop has Pages | page | Properties·Concierge without a fourth column; Arrange is the one inspector; the planned controls are greyed and inert.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.4.2: at 1440x900 Your publications fills the app; in 0.4.1 the editor's grid-column kept it in a 267px column on the right with the left empty (the trial check, 2026-11-06).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: replace RP-PUB-01..07 planned placeholders with live controls and verify Brand is withheld when Create has no brand kit.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: mount /cockpit/css/themes in the standalone fixture so surface-themes.css resolves theme palettes across platform snapshots.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fixture} from '../fixtures/fixture.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
import {createPublication, openStudio, choose} from '../fixtures/publishing-ui.mjs';
const {chromium} = requireRuntime('playwright'), express = requireRuntime('express');
const platform = resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(import.meta.dirname, '../../../../oshal-kernel/platform'));
const PHONE = {viewport: {width: 412, height: 915}, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625, acceptDownloads: true};
const DESKTOP = {viewport: {width: 1440, height: 900}, acceptDownloads: true};

async function start(t, size = PHONE) {
  const f = await fixture({http: true, extend: app => {
    app.get('/shared/ui/js/package-tool-cards.js', (_q, r) => r.sendFile('src/api/jarvis-package-tools.js', {root: platform}));
    app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')));
    app.use('/cockpit/css/themes', express.static(resolve(platform, 'src/pages/cockpit/css/themes')));
  }});
  t.after(() => f.close());
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  const page = await (await browser.newContext(size)).newPage(), errors = [], native = [], requests = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => {native.push(dialog.type()); void dialog.dismiss();});
  page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/publishing-studio/')) requests.push({method: response.request().method(), path: url.pathname, status: response.status()}); });
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(native, [], 'no browser dialog'); });
  return {f, page, requests};
}
/** The accent-filled controls a person sees in the app (R1 counts them). */
const primaries = page => page.evaluate(() => [...document.querySelectorAll('button.primary')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => node.getAttribute('aria-label') || node.innerText.trim()));
const alpha = color => color.startsWith('rgba') ? Number(color.split(',')[3].replace(')', '')) : 1;

test('a blank Letter page opens ready: the contract, one primary and one tool row with More last', {timeout: 180000}, async t => {
  const {f, page} = await start(t);
  await openStudio(page, f.url);
  assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.dsCategory, document.documentElement.dataset.dsFirstAction, Boolean(document.querySelector('#spread[data-ds-work]'))]), ['editor', 'tap', true]);
  assert.equal(await page.locator('#spread svg[aria-label="A blank Letter page"]').count(), 1);
  assert.deepEqual(await primaries(page), ['Add text frame'], 'one primary: the first creative action');
  const row = await page.evaluate(() => {const node = document.querySelector('[data-ds-toolrow]'), box = node.getBoundingClientRect(); return {bottom: Math.round(box.bottom), height: Math.round(box.height), last: node.lastElementChild.textContent.trim(), words: [...node.children].map(child => child.textContent.trim())};});
  assert.equal(row.last, 'More'); assert.equal(row.bottom, 915, 'the tool row is the bottom bar'); assert.ok(row.height <= 64);
  assert.deepEqual(row.words, ['Text', 'Image', 'Shape', 'Concierge', 'More']);
  assert.equal(await page.locator('[data-ds-not-yet], [data-ds-backlog]').count(), 0);
  assert.equal(await page.getByText(/create or open/i).count(), 0);
  assert.equal(await page.locator('.ef-panes').isVisible(), false, 'no Navigation / Properties / Concierge band above the work');
});

test('Add text frame, type: the words are on the page at once; Download PDF saves, renders and downloads the draft by itself', {timeout: 180000}, async t => {
  const {f, page, requests} = await start(t);
  await openStudio(page, f.url);
  await page.locator('#add-first').tap();
  const area = page.locator('dialog[open] #story-text'); await area.waitFor();
  assert.equal(await area.evaluate(node => node === document.activeElement), true, 'the Text sheet opens with its field focused');
  await page.keyboard.type('Spring fair');
  await page.waitForFunction(() => [...document.querySelectorAll('#spread .pub-text-body')].some(node => node.innerText.trim() === 'Spring fair'));
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/revisions')).length, 0, 'drawn before any save (WYSIWYG)');
  const id = requests.find(r => r.method === 'GET' && /\/documents\/[0-9a-f-]{36}$/.test(r.path)).path.split('/').pop();
  const created = (await (await fetch(f.url + '/api/publishing-studio/documents/' + id)).json()).document.model;
  assert.deepEqual([created.pages.length, created.pages[0].width, created.pages[0].height, created.pages[0].margin, created.stories.length], [1, 612, 792, 54, 0], 'an untitled blank Letter publication');
  await page.locator('dialog[open] .ds-layer-done').tap();
  assert.deepEqual(await primaries(page), ['Download PDF'], 'the primary follows the document');
  assert.equal(await page.locator('#render').isDisabled(), false, 'Render is never disabled by unsaved edits');
  const downloaded = page.waitForEvent('download', {timeout: 120000});
  await page.locator('#export-pdf').tap();
  assert.match((await downloaded).suggestedFilename(), /\.pdf$/);
  assert.ok(requests.some(r => r.method === 'POST' && r.path.endsWith('/revisions') && r.status < 300), 'it saved first');
  assert.ok(requests.some(r => r.method === 'POST' && r.path.endsWith('/render') && r.status < 300), 'and rendered');
  const saved = (await (await fetch(f.url + '/api/publishing-studio/documents/' + id)).json()).document;
  assert.equal(saved.model.stories[0].paragraphs[0].runs[0].text, 'Spring fair');
  // The 409 regression (decision FIX-BROKEN, DS-41): no page preview is asked for before the revision has a render.
  const firstRender = requests.findIndex(r => r.path.endsWith('/render'));
  assert.deepEqual(requests.slice(0, firstRender).filter(r => r.path.includes('/preview/')), []);
  assert.deepEqual(requests.filter(r => r.status >= 400), [], 'no refused request');
});

test('the chosen frame raises a selection float and switches the tool row; Duplicate and Delete are undoable', {timeout: 180000}, async t => {
  const {f, page} = await start(t);
  const created = await createPublication(f, {pageCount: 1});
  await openStudio(page, f.url, created.id);
  await page.locator('#spread .selection-box[data-item="frame1"]').tap();
  const float = page.locator('#spread .pub-float'); await float.waitFor();
  assert.deepEqual(await float.locator('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['Duplicate', 'Delete text frame', 'More for this item']);
  const placed = await page.evaluate(() => {const bar = document.querySelector('.pub-float'), frame = document.querySelector('#spread .selection-box[data-item="frame1"]').getBoundingClientRect(), box = bar.getBoundingClientRect(), style = getComputedStyle(bar);
    return {gap: Math.max(frame.top - box.bottom, box.top - frame.bottom), background: style.backgroundColor};});
  assert.ok(placed.gap <= 48, 'at the selection ' + JSON.stringify(placed)); assert.equal(alpha(placed.background), 1, 'opaque');
  assert.deepEqual(await page.locator('[data-ds-toolrow] > button').allTextContents(), ['Done', 'Text', 'Font', 'Size', 'Colour', 'Align', 'Arrange', 'More']);
  await float.getByRole('button', {name: 'Duplicate'}).tap();
  await page.waitForFunction(() => document.querySelectorAll('#spread .selection-box').length === 2);
  await page.locator('#undo').tap(); await page.waitForFunction(() => document.querySelectorAll('#spread .selection-box').length === 1);
  await page.locator('#spread .selection-box[data-item="frame1"]').tap();
  await page.locator('#spread .pub-float').getByRole('button', {name: 'Delete text frame'}).tap();
  await page.waitForFunction(() => document.querySelectorAll('#spread .selection-box').length === 0);
  await page.locator('#undo').tap(); await page.waitForFunction(() => document.querySelectorAll('#spread .selection-box').length === 1);
});

test('menus and sheets are opaque top-layer dialogs that Back closes; Delete confirms in the page', {timeout: 180000}, async t => {
  const {f, page, requests} = await start(t);
  const created = await createPublication(f, {pageCount: 1});
  await openStudio(page, f.url, created.id);
  const address = page.url();
  await page.locator('#document-menu').tap();
  const menu = page.locator('dialog[open]');
  assert.deepEqual(await menu.evaluate(node => [node.matches(':modal'), getComputedStyle(node).backgroundColor]).then(([modal, color]) => [modal, alpha(color)]), [true, 1]);
  assert.equal(await menu.locator('[data-ds-not-yet]').count(), 0);
  assert.equal(await menu.locator('.ds-menu-row', {hasText: 'New from template'}).isEnabled(), true);
  await page.goBack(); await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(page.url(), address, 'Back closed the menu and stayed in the studio');
  await page.locator('#document-menu').tap();
  await page.locator('dialog[open] .ds-menu-row', {hasText: 'Delete publication'}).tap();
  const confirm = page.locator('dialog.ds-confirm[open]'); await confirm.waitFor();
  await confirm.getByRole('button', {name: 'Cancel', exact: true}).tap(); await confirm.waitFor({state: 'detached'});
  assert.equal((await fetch(f.url + '/api/publishing-studio/documents/' + created.id)).status, 200, 'Cancel kept the publication');
  await page.locator('#more-menu').tap();
  assert.equal(await page.locator('dialog[open] [data-ds-not-yet]').count(), 0);
  for (const label of ['Resize…', 'Select multiple', 'Group', 'Comment…', 'Video timeline']) assert.equal(await page.locator('dialog[open] .ds-menu-row', {hasText: label}).count(), 1, label);
});

test('with publications the first screen is Your publications, newest first, with one New at the bottom right', {timeout: 180000}, async t => {
  const {f, page} = await start(t);
  await createPublication(f, {title: 'Older flyer'}); await createPublication(f, {title: 'Newer flyer'});
  await openStudio(page, f.url);
  await page.locator('#publications').waitFor();
  assert.deepEqual(await page.locator('#documents .pub-card-title').allTextContents(), ['Newer flyer', 'Older flyer']);
  assert.deepEqual(await primaries(page), ['New']);
  const box = await page.locator('#new-publication').boundingBox();
  assert.ok(412 - (box.x + box.width) <= 24 && 915 - (box.y + box.height) <= 40, 'at the bottom right ' + JSON.stringify(box));
  assert.equal(await page.locator('#new-publication').getAttribute('data-ef-floating'), '', 'the Today orb rests above it');
  await page.locator('#new-publication').tap();
  assert.deepEqual(await page.locator('dialog[open] .ds-menu-row').allTextContents(), ['Blank Letter page', 'Blank A4 page', 'From template…']);
  assert.equal(await page.locator('dialog[open] [data-ds-not-yet]').count(), 0);
  await page.locator('dialog[open] .ds-menu-row', {hasText: 'Blank A4 page'}).tap();
  await page.locator('#document-title').filter({hasText: 'Untitled publication'}).waitFor();
  const list = await (await fetch(f.url + '/api/publishing-studio/documents')).json();
  const made = (await (await fetch(f.url + '/api/publishing-studio/documents/' + list.documents[0].id)).json()).document.model;
  assert.deepEqual([made.pages[0].width, made.pages[0].height], [595.3, 841.9], 'a blank A4 page');
});

test('desktop: Your publications takes the whole width of the app, not a side column (0.4.2 regression, trial 1440x900)', {timeout: 180000}, async t => {
  const {f, page} = await start(t, DESKTOP);
  await createPublication(f, {title: 'Older flyer'}); await createPublication(f, {title: 'Newer flyer'});
  await openStudio(page, f.url);
  await page.locator('#publications').waitFor();
  const box = await page.evaluate(() => {const b = document.querySelector('#publications').getBoundingClientRect(); return {x: Math.round(b.x), width: Math.round(b.width)};});
  assert.ok(box.x <= 24 && box.width >= 1440 - 48, 'the list fills the app ' + JSON.stringify(box));
  assert.deepEqual(await page.locator('#documents .pub-card-title').allTextContents(), ['Newer flyer', 'Older flyer']);
});

test('desktop: Pages 240 | the page | Properties·Concierge 320, one app row, no fourth column, and Arrange is the one inspector', {timeout: 180000}, async t => {
  const {f, page, requests} = await start(t, DESKTOP);
  const created = await createPublication(f, {pageCount: 4});
  await openStudio(page, f.url, created.id);
  const widths = () => page.evaluate(() => Object.fromEntries(['.ef-navigation', '.ef-inspector', '.ef-concierge', '.ef-viewport'].map(selector => {const node = document.querySelector(selector), box = node.getBoundingClientRect(); return [selector, node.getClientRects().length ? [Math.round(box.left), Math.round(box.width)] : null];})));
  let panes = await widths();
  assert.deepEqual([panes['.ef-navigation'][1], panes['.ef-inspector'][1], panes['.ef-concierge']], [240, 320, null]);
  await page.locator('.pub-tab', {hasText: 'Concierge'}).click();
  panes = await widths();
  assert.deepEqual([panes['.ef-concierge'], panes['.ef-inspector']], [[1120, 320], null], 'the concierge is the right pane\'s tab, not a fourth column');
  await page.locator('.pub-tab', {hasText: 'Properties'}).click();
  const row = await page.evaluate(() => [...document.querySelectorAll('.pub-approw > button, .pub-approw [data-ds-toolrow] > button')].filter(node => node.getClientRects().length).map(node => {const box = node.getBoundingClientRect(); return [Math.round(box.top), Math.round(box.bottom)];}));
  assert.ok(Math.max(...row.map(([top]) => top)) < Math.min(...row.map(([, bottom]) => bottom)), 'one app row with the tool row inside it');
  assert.equal(await page.locator('#comment-slot #open-comments').isEnabled(), true);
  assert.equal(await page.locator('[data-ds-not-yet], [data-ds-backlog]').count(), 0);
  await page.locator('[data-ds-toolrow]').getByRole('button', {name: 'Shape'}).click();
  await page.locator('[data-editor-property="x"]').waitFor();
  assert.equal(await page.locator('[data-editor-property="x"]:visible').count(), 1, 'one X field');
  assert.equal(await page.locator('#geometry').isVisible(), false, 'no second geometry form');
  assert.equal(await page.locator('#item').isVisible(), false, 'no second "Frame or object" form');
  await page.locator('#undo').click(); await page.waitForFunction(() => document.querySelector('#save').hidden);
  const single = await createPublication(f, {title: 'One page', pageCount: 1});
  await openStudio(page, f.url, single.id);
  assert.equal((await widths())['.ef-navigation'][1], 48, 'a one-page publication folds Pages to its button, so the page has the room');
  assert.deepEqual(requests.filter(r => r.status >= 400), []);
});
