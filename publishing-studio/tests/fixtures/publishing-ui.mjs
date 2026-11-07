/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the design-standard screen: the browser steps a person takes, shared by the Publishing browser suites (open a publication, choose an item on the page, pick a row from the publication menu or a More menu, close the open sheet).
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/**
 * @description Create a publication through the real route (the brochure starter, or a blank one with a size).
 * @param {object} f the Publishing fixture
 * @param {{title?:string,pageCount?:number,size?:string}} input what to create
 * @returns {Promise<object>} the created document
 */
export async function createPublication(f, {title = 'Browser owned publication', pageCount = 1, size} = {}) {
  const response = await fetch(f.url + '/api/publishing-studio/documents', {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({title, pageCount, requestKey: randomUUID(), ...(size ? {size} : {})})});
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).document;
}

/**
 * @description Open the studio (on a publication when an id is given) and wait until the shared editor and the page are ready.
 * @param {import('playwright').Page} page the browser page
 * @param {string} url the fixture's address
 * @param {string} [id] the publication to open
 * @param {number} [revision] the revision it should open on
 * @returns {Promise<void>}
 */
export async function openStudio(page, url, id, revision = 1) {
  await page.goto(url + '/api/publishing-studio/app' + (id ? '?document=' + id : ''));
  await page.locator('body[data-editor-foundation=ready]').waitFor();
  if (id) await page.waitForFunction(rev => document.querySelector('#revision').textContent === 'Revision ' + rev && !document.querySelector('#render').disabled, revision);
}

/**
 * @description Choose an item on the page by pressing its outline, as a person does; the tool row then shows its tools.
 * @param {import('playwright').Page} page the browser page
 * @param {string} item the frame or object id
 * @returns {Promise<void>}
 */
export async function choose(page, item) {
  const outline = page.locator(`#spread .selection-box[data-item="${item}"]`).first();
  await outline.scrollIntoViewIfNeeded(); await outline.click();
  await page.waitForFunction(id => document.querySelector(`#spread .selection-box[data-item="${id}"]`)?.dataset.selected === 'true', item);
}

/**
 * @description Press a menu trigger and then one of the menu's rows.
 * @param {import('playwright').Page} page the browser page
 * @param {string} trigger a selector for the control that opens the menu
 * @param {string} label the row's words
 * @returns {Promise<void>}
 */
export async function pick(page, trigger, label) {
  await page.locator(trigger).first().click();
  await page.locator('dialog[open] .ds-menu-row', {hasText: label}).first().click();
  await page.waitForFunction(() => !document.querySelector('dialog.ds-menu[open]'));
}

/**
 * @description Close the topmost sheet with its Done.
 * @param {import('playwright').Page} page the browser page
 * @returns {Promise<void>}
 */
export async function done(page) {
  const count = await page.locator('dialog[open]').count();
  await page.locator('dialog[open] .ds-layer-done').last().click();
  await page.waitForFunction(n => document.querySelectorAll('dialog[open]').length < n, count);
}
