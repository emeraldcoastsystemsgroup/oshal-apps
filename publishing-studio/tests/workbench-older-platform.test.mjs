/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.1 regression guard: on a platform without the shared planned-control helper (an older kernel platform, as the store gate's fixture platform was when 0.4.0 merged) the studio still opens, draws no greyed placeholder, and its first action still makes a publication. Real Chromium, the real routes and disposable SQL; only the helper's address answers 404.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/fixture.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
import {mountSharedEditor} from './fixtures/shared-ui.mjs';
const {chromium} = requireRuntime('playwright');

test('without the planned-control helper the studio opens, draws no placeholder and Add text frame still works', {timeout: 120000}, async t => {
  const f = await fixture({http: true, extend: app => {
    app.get('/shared/ui/js/planned-control.js', (_request, response) => response.status(404).end());
    mountSharedEditor(app);
  }});
  t.after(() => f.close());
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 412, height: 915}, isMobile: true, hasTouch: true}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.url + '/api/publishing-studio/app');
  await page.locator('body[data-editor-foundation=ready]').waitFor();
  assert.equal(await page.locator('[data-ds-not-yet]').count(), 0, 'no placeholder without its helper');
  assert.deepEqual(await page.locator('[data-ds-toolrow] > button').allTextContents(), ['Text', 'Image', 'Shape', 'Concierge', 'More']);
  await page.locator('#add-first').tap();
  await page.locator('dialog[open] #story-text').waitFor();
  const list = await (await fetch(f.url + '/api/publishing-studio/documents')).json();
  assert.equal(list.documents.length, 1, 'the first action made a publication');
  assert.deepEqual(errors, []);
});
