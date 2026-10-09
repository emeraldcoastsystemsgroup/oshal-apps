/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive region selection with a real pointer in the real editor: the same lasso at two zoom levels names the same source pixels, rotation keeps it, a crop change makes it stale in words, ambiguous and locked targets are refused, and the read-only Jarvis context carries only the bounded summary.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { contextFixture, ownedBrowser } from './create-editor-context-fixture.mjs';
import { syntheticImage } from './create-editor-fixture.mjs';

let owned;
after(async () => { await owned?.close(); });

async function open(t) {
  owned ??= await ownedBrowser();
  return contextFixture(owned.browser, {}, close => t.after(close));
}
async function latest(value, predicate, argument) {
  await value.page.waitForFunction(predicate, argument, { timeout: 3000 });
  return value.page.evaluate(() => window.contextMessages.at(-1));
}
async function change(value, selector, text) { await value.surface.locator(selector).fill(String(text)); await value.surface.locator(selector).press('Tab'); }
function clean(value) { assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []); }

async function upload(value, name) {
  const before = Number(await value.surface.locator('#layerCount').innerText());
  await value.surface.locator('#imageFile').setInputFiles({ name, mimeType: 'image/png', buffer: await syntheticImage() });
  await value.surface.locator('#layerCount').filter({ hasText: String(before + 1) }).waitFor();
}

/** A 40x20 synthetic image stretched to 400x200 at (200,200), showing only its left half. */
async function placedImage(value) {
  await upload(value, 'synthetic-region.png');
  for (const [selector, next] of [['#layerX', 200], ['#layerY', 200], ['#layerWidth', 400], ['#layerHeight', 200]]) await change(value, selector, next);
  await value.surface.locator('#cropW').fill('50'); await value.surface.locator('#applyCrop').click();
}

async function drag(value, points) {
  const box = await value.surface.locator('#artboard').boundingBox(), at = point => ({ x: box.x + point.x * box.width / 1200, y: box.y + point.y * box.height / 800 });
  await value.page.mouse.move(at(points[0]).x, at(points[0]).y); await value.page.mouse.down();
  for (const point of points.slice(1)) await value.page.mouse.move(at(point).x, at(point).y, { steps: 8 });
  await value.page.mouse.up();
}
const LASSO = [{ x: 250, y: 215 }, { x: 550, y: 215 }, { x: 550, y: 385 }, { x: 250, y: 385 }, { x: 252, y: 217 }];
const REGION_FIELDS = ['regionArea', 'regionHeight', 'regionKind', 'regionLayerId', 'regionPoints', 'regionState', 'regionWidth', 'regionX', 'regionY'];
const bounds = fields => ({ x: fields.regionX, y: fields.regionY, width: fields.regionWidth, height: fields.regionHeight });

test('the same lasso at two zoom levels names the same source pixels and reaches context as a bounded, read-only summary', async t => {
  const value = await open(t); await placedImage(value); const regions = [];
  for (const zoom of ['0.5', '0.25']) {
    await value.surface.locator('#zoom').selectOption(zoom); await value.surface.locator('#regionMode').click();
    assert.equal(await value.surface.locator('#regionMode').getAttribute('aria-pressed'), 'true');
    await drag(value, LASSO);
    const context = await latest(value, () => window.contextMessages.at(-1)?.fields?.regionKind === 'lasso');
    regions.push(bounds(context.fields));
    assert.equal(context.fields.regionState, 'ready'); assert.equal(context.fields.readOnly, true); assert.deepEqual(context.can, []);
    assert.equal(/data:|project-assets|points\\?":/.test(JSON.stringify(context)), false);
    assert.deepEqual(Object.keys(context.fields).filter(key => key.startsWith('region')).sort(), REGION_FIELDS);
    assert.ok(REGION_FIELDS.every(key => ['string', 'number'].includes(typeof context.fields[key])));
    assert.match(await value.surface.locator('#regionStatus').innerText(), /Region: 16 × 18 source pixels of synthetic-region\.png/);
    const overlay = await value.surface.locator('#selection').evaluate(canvas => canvas.getContext('2d').getImageData(400, 300, 1, 1).data[3]);
    assert.ok(overlay > 0, 'the region is outlined on the overlay canvas');
    await value.surface.locator('#artboard').press('Escape');
    await latest(value, () => window.contextMessages.at(-1)?.fields?.available && !('regionKind' in window.contextMessages.at(-1).fields));
    assert.equal(await value.surface.locator('#regionMode').getAttribute('aria-pressed'), 'false');
  }
  assert.deepEqual(regions, [{ x: 2, y: 1, width: 16, height: 18 }, { x: 2, y: 1, width: 16, height: 18 }]);
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('rotation keeps the region, a crop change makes it stale in words, and whole-image selection follows the crop', async t => {
  const value = await open(t); await placedImage(value);
  await value.surface.locator('#regionMode').click(); await drag(value, LASSO);
  const first = await latest(value, () => window.contextMessages.at(-1)?.fields?.regionState === 'ready');
  const alpha = (x, y) => value.surface.locator('#selection').evaluate((canvas, at) => canvas.getContext('2d').getImageData(at.x, at.y, 1, 1).data[3], { x, y });
  assert.equal(await alpha(400, 170), 0); assert.ok(await alpha(270, 300) > 0);
  await change(value, '#layerRotation', 90); await value.page.evaluate(() => window.requestContext());
  const turned = await latest(value, epoch => window.contextMessages.at(-1)?.fields?.contextEpoch > epoch, first.fields.contextEpoch);
  assert.equal(turned.fields.regionState, 'ready'); assert.deepEqual(bounds(turned.fields), bounds(first.fields));
  assert.ok(await alpha(400, 170) > 0, 'the outline turned with the layer'); assert.equal(await alpha(270, 300), 0);
  await value.surface.locator('#cropX').fill('50'); await value.surface.locator('#applyCrop').click();
  const stale = await latest(value, () => window.contextMessages.at(-1)?.fields?.regionState === 'stale');
  assert.match(stale.fields.regionIssue, /crop changed/); assert.match(await value.surface.locator('#regionStatus').innerText(), /needs reselecting/);
  await value.surface.locator('#selectWholeImage').click();
  const whole = await latest(value, () => window.contextMessages.at(-1)?.fields?.regionKind === 'layer');
  assert.deepEqual(bounds(whole.fields), { x: 20, y: 0, width: 20, height: 20 }); assert.equal(whole.fields.regionState, 'ready');
  await value.surface.locator('#clearRegion').click();
  await latest(value, () => !('regionKind' in (window.contextMessages.at(-1)?.fields ?? { regionKind: 1 })));
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('stacked images with none selected, and a locked image, are refused before any region exists', async t => {
  const value = await open(t); await upload(value, 'synthetic-lower.png'); await upload(value, 'synthetic-upper.png');
  const box = await value.surface.locator('#artboard').boundingBox();
  await value.page.mouse.click(box.x + box.width * .9, box.y + box.height * .9);
  assert.equal(await value.surface.locator('#noSelection').isVisible(), true);
  await value.surface.locator('#regionMode').click(); await drag(value, [{ x: 2, y: 2 }, { x: 30, y: 2 }, { x: 30, y: 18 }, { x: 2, y: 18 }]);
  await value.surface.locator('#editorError').filter({ hasText: /More than one image/ }).waitFor();
  assert.equal(await value.surface.locator('#clearRegion').isDisabled(), true);
  await value.surface.getByRole('button', { name: 'Lock synthetic-upper.png', exact: true }).click();
  await value.surface.getByRole('button', { name: 'Select synthetic-upper.png', exact: true }).click();
  await drag(value, [{ x: 2, y: 2 }, { x: 30, y: 2 }, { x: 30, y: 18 }, { x: 2, y: 18 }]);
  await value.surface.locator('#editorError').filter({ hasText: /Unlock the image layer/ }).waitFor();
  assert.equal(await value.surface.locator('#clearRegion').isDisabled(), true);
  const context = await value.page.evaluate(() => window.contextMessages.at(-1));
  assert.equal('regionKind' in (context.fields ?? {}), false); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});
