/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Publishing Studio on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06, F6 "another shifty app in demo", and the trial check: a two-row toolbar, no visible first action and two empty-looking boxes): the app bar is one row (Save revision and More) and content starts within 74 px of the frame (120 px with the 46 px Today row); with no publication the one primary action is New publication and no dead document control is drawn; one tap creates and opens a publication; a choice in More runs and closes it. Real routes, the real publishing engine over disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.3.7 (the round-2 trial check, 2026-11-06: with a publication open a touch swipe never scrolled the page, 822-843 px below the fold, and a swipe over the page dragged the story frame into an unsaved draft; four console 409s from revisions/1/preview/1-4): a CDP touch swipe that starts on a frame, on the page margin or beside the page scrolls the editor and moves nothing; a tap selects the frame and only its Move handle drags it; opening an unrendered publication asks for no preview.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fixture} from '../fixtures/fixture.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
const {chromium} = requireRuntime('playwright'), express = requireRuntime('express');
const platform = resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(import.meta.dirname, '../../../../oshal-kernel/platform'));
const PHONE = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2.5};

/** A real finger: CDP touch points from (x,y) moving dy in 12 steps, the way a phone delivers a swipe. */
async function swipe(page, cdp, x, y, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
  for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: Math.round(x + dx * i / 12), y: Math.round(y + dy * i / 12)}]}); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  // A swipe flings on: wait until the page has come to rest, as a person does before the next tap.
  for (let last = -1, still = 0; still < 3;) { await page.waitForTimeout(120); const now = await scrolled(page); still = now === last ? still + 1 : 0; last = now; }
}
const scrolled = page => page.evaluate(() => Math.round(document.querySelector('.ef-viewport').scrollTop));
const frame = (page, id = 'frame1') => page.evaluate(id => { const rect = document.querySelector(`#spread .selection-box[data-item="${id}"]`), box = rect.getBoundingClientRect(); return {x: rect.getAttribute('x'), y: rect.getAttribute('y'), cx: Math.round(box.left + box.width / 2), cy: Math.round(box.top + Math.min(box.height / 2, 120))}; }, id);

async function open(t) {
  const f = await fixture({http: true, extend: app => app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')))});
  t.after(() => f.close());
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  const context = await browser.newContext(PHONE), page = await context.newPage(), errors = [], refused = [];
  page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []));
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/api/publishing-studio/')) refused.push(response.status() + ' ' + new URL(response.url()).pathname); });
  page.refused = refused; page.cdp = () => context.newCDPSession(page);
  await page.goto(f.url + '/api/publishing-studio/app');
  await page.locator('body[data-editor-foundation="ready"]').waitFor();
  await page.locator('.ef-viewport .ef-start .ef-primary').waitFor();
  return {f, page};
}

/** Every drawn control inside the editor viewport: its words and whether a tap at its centre lands on it. */
const drawnControls = page => page.evaluate(() => [...document.querySelectorAll('.ef-viewport :is(button,summary,select,a[href])')].filter(node => {
  for (let up = node.parentElement; up; up = up.parentElement) if (up.tagName === 'DETAILS' && !up.open && !(node.tagName === 'SUMMARY' && node.parentElement === up)) return false;
  const box = node.getBoundingClientRect(); return node.getClientRects().length && box.width > 1 && box.bottom > 0 && box.top < innerHeight;
}).map(node => ({text: node.textContent.trim(), disabled: Boolean(node.disabled)})));

test('the first screen: one app bar row, content within 74 px, and New publication as the one first action', {timeout: 180000}, async t => {
  const {page} = await open(t);
  const bar = await page.evaluate(() => ({viewport: Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top),
    items: [...document.querySelectorAll('.ef-header-slot :is(h1,p,button,summary)')].filter(node => node.getClientRects().length).map(node => {const box = node.getBoundingClientRect(); return {text: node.textContent.trim(), top: Math.round(box.top), bottom: Math.round(box.bottom)};})}));
  assert.ok(bar.viewport <= 74, `content starts ${bar.viewport}px into the frame ${JSON.stringify(bar.items)}`);
  assert.deepEqual(bar.items.map(item => item.text), ['Save revision', '⋯ More'], 'no repeated app name, Save and More');
  assert.ok(Math.max(...bar.items.map(item => item.top)) < Math.min(...bar.items.map(item => item.bottom)), 'one row');
  const controls = await drawnControls(page);
  assert.deepEqual(controls.filter(control => control.disabled), [], 'no dead document control is drawn before a publication exists');
  assert.deepEqual(controls.map(control => control.text), ['New publication'], 'one primary first action');
  assert.deepEqual(await page.locator('.ef-panes button').allTextContents(), ['Publications', 'Properties', 'Concierge']);
});

test('one tap on New publication creates and opens it; a choice in More runs and closes More', {timeout: 180000}, async t => {
  const {page} = await open(t);
  await page.locator('.ef-viewport .ef-start .ef-primary').tap();
  await page.locator('#revision').filter({hasText: 'Revision 1'}).waitFor({timeout: 60000});
  await page.locator('#spread .page-board').first().waitFor();
  assert.equal(await page.locator('.ef-start').isVisible(), false, 'the start card leaves once a publication is open');
  assert.equal(await page.locator('#document-title').textContent(), 'New publication');
  await page.getByRole('button', {name: '⋯ More', exact: true}).tap();
  assert.deepEqual(await page.locator('.ef-sheet-content button').allTextContents(), ['Render & preflight', 'Undo', 'Redo', 'Refresh files']);
  await page.locator('.ef-sheet #refresh').tap();
  await page.locator('.ef-sheet').waitFor({state: 'hidden'});
  assert.equal(await page.locator('header.top #refresh').count(), 1, 'Refresh files is back in its toolbar');
});

test('with a publication open a touch swipe scrolls the page, even one that starts on a frame, and moves nothing', {timeout: 180000}, async t => {
  const {page} = await open(t);
  await page.locator('.ef-viewport .ef-start .ef-primary').tap();
  await page.locator('#revision').filter({hasText: 'Revision 1'}).waitFor({timeout: 60000});
  await page.locator('#spread .selection-box[data-item="frame1"]').waitFor();
  await page.waitForTimeout(500);
  const room = await page.evaluate(() => { const v = document.querySelector('.ef-viewport'); return v.scrollHeight - v.clientHeight; });
  assert.ok(room > 300, `the open publication runs ${room}px below the fold`);
  const cdp = await page.cdp(), start = await frame(page);
  assert.ok(start.cy > 120 && start.cy < 700, 'the story frame is under the finger ' + JSON.stringify(start));
  await swipe(page, cdp, start.cx, start.cy, 0, -260);
  const afterFrame = await scrolled(page);
  assert.ok(afterFrame >= 150, `a swipe that starts on the story frame scrolls the page (scrollTop ${afterFrame})`);
  const moved = await frame(page);
  assert.deepEqual([moved.x, moved.y], [start.x, start.y], 'and does not move the frame');
  assert.doesNotMatch(await page.locator('#revision').textContent(), /unsaved/, 'and leaves no draft');
  const margin = await page.evaluate(() => { const svg = document.querySelector('#spread .page-board svg').getBoundingClientRect(); return {x: Math.round(svg.left + 6), y: Math.round(Math.min(svg.bottom - 40, 600))}; });
  await swipe(page, cdp, margin.x, margin.y, 0, 220);
  assert.ok(await scrolled(page) < afterFrame - 100, 'a swipe down on the page margin scrolls back up');
  await swipe(page, cdp, 200, 420, 0, -300);
  assert.ok(await scrolled(page) > 150, 'a swipe on the page body scrolls down again');
  assert.doesNotMatch(await page.locator('#revision').textContent(), /unsaved/, 'no swipe left a draft');
});

test('opening a publication that was never rendered asks for no preview, so the console stays clean', {timeout: 180000}, async t => {
  const {page} = await open(t), logged = [];
  page.on('console', message => { if (message.type() === 'error' && /status of 4\d\d/.test(message.text())) logged.push(message.text()); });
  await page.locator('.ef-viewport .ef-start .ef-primary').tap();
  await page.locator('#revision').filter({hasText: 'Revision 1'}).waitFor({timeout: 60000});
  await page.locator('#spread .page-board').first().waitFor();
  const id = await page.evaluate(async () => (await (await fetch('/api/publishing-studio/documents', {credentials: 'same-origin'})).json()).documents[0].id);
  await page.goto(page.url().split('?')[0] + '?document=' + id);
  await page.locator('#revision').filter({hasText: 'Revision 1'}).waitFor({timeout: 60000});
  await page.waitForTimeout(500);
  assert.deepEqual(page.refused, [], 'no request is refused (each preview of an unrendered revision answered 409)');
  assert.deepEqual(logged, [], 'no console error');
});

test('a tap selects a frame; only its Move handle, grabbed on purpose, drags it by touch', {timeout: 180000}, async t => {
  const {page} = await open(t);
  await page.locator('.ef-viewport .ef-start .ef-primary').tap();
  await page.locator('#revision').filter({hasText: 'Revision 1'}).waitFor({timeout: 60000});
  await page.locator('#spread .selection-box[data-item="frame2"]').waitFor();
  const cdp = await page.cdp();
  assert.deepEqual(await page.locator('#spread .frame-handle').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['Move frame frame1'], 'one handle, on the frame the inspector holds');
  await swipe(page, cdp, 200, 600, 0, -420);
  const start = await frame(page, 'frame2');
  assert.ok(start.cy > 60 && start.cy < 700, 'the second page\'s frame scrolled under the finger ' + JSON.stringify(start));
  const before = await scrolled(page);
  await page.touchscreen.tap(start.cx, start.cy);
  await page.locator('#spread .frame-handle[aria-label="Move frame frame2"]').waitFor();
  assert.equal(await scrolled(page), before, 'choosing a frame keeps the page where the finger left it');
  assert.match(await page.locator('#selection').textContent(), /frame2/, 'the tap selected that frame');
  assert.equal(await page.locator('#spread .frame-handle').count(), 1, 'the handle went with the selection');
  assert.doesNotMatch(await page.locator('#revision').textContent(), /unsaved/, 'a tap moves nothing');
  const handle = await page.evaluate(() => { const node = document.querySelector('#spread .frame-handle'), box = node.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2, hit = document.elementFromPoint(x, y), style = getComputedStyle(node);
    return {w: Math.round(box.width), h: Math.round(box.height), x: Math.round(x), y: Math.round(y), hit: hit === node || node.contains(hit), touchAction: style.touchAction, alpha: style.backgroundColor.startsWith('rgba') ? Number(style.backgroundColor.split(',')[3].replace(')', '')) : 1}; });
  assert.ok(handle.w >= 44 && handle.h >= 44, 'a finger-sized handle ' + JSON.stringify(handle));
  assert.equal(handle.hit, true, 'the handle is under the finger ' + JSON.stringify(handle));
  assert.equal(handle.touchAction, 'none', 'the handle keeps the gesture for the frame');
  assert.equal(handle.alpha, 1, 'an opaque handle');
  const top = await scrolled(page);
  await swipe(page, cdp, handle.x, handle.y, 30, 40);
  const moved = await frame(page, 'frame2');
  assert.ok(Number(moved.x) > Number(start.x) + 10 && Number(moved.y) > Number(start.y) + 10, `the handle moved the frame ${JSON.stringify([start, moved])}`);
  assert.match(await page.locator('#revision').textContent(), /unsaved/, 'the move is a draft to save');
  assert.equal(await scrolled(page), top, 'dragging the handle does not scroll the page');
});

test('desktop guard at 1440x900 with a mouse: no Move handle is drawn and dragging the outline still moves the frame', {timeout: 180000}, async t => {
  const f = await fixture({http: true, extend: app => app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')))});
  t.after(() => f.close());
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  await page.goto(f.url + '/api/publishing-studio/app');
  await page.locator('body[data-editor-foundation="ready"]').waitFor();
  await page.locator('#new button').click();
  await page.locator('#revision').filter({hasText: 'Revision 1'}).waitFor({timeout: 60000});
  const story = page.locator('#spread .selection-box[data-item="frame1"]');
  await story.waitFor();
  assert.equal(await page.locator('#spread .frame-handle').count(), 1, 'the chosen frame has its handle in the page');
  assert.equal(await page.locator('#spread .frame-handle').isVisible(), false, 'but a screen without a touch pointer does not draw it');
  const box = await story.boundingBox(), before = Number(await story.getAttribute('x'));
  await page.mouse.move(box.x + 60, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 90, box.y + 60, {steps: 4}); await page.mouse.up();
  assert.ok(Number(await page.locator('#spread .selection-box[data-item="frame1"]').getAttribute('x')) > before + 5, 'a mouse drag on the outline moves the frame');
  assert.match(await page.locator('#revision').textContent(), /unsaved/);
});
