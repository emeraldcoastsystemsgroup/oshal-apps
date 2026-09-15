/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual CAD model, revision and WebGL selection survive late local HTTP responses without engine or live-data access.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The generated form authors revolve, sweep and loft from the real contract: JSON path and sections, a plane select for the path and a boolean ruled reach the server as typed values.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Stop rebuild (BACKLOG B5): offered only while the SELECTED part has a rebuild in flight, it cancels that part (not another) and goes away when the rebuild settles.
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startFixture, launchIsolatedBrowser, observeStlRendering, IDS, model } from './surface-lifecycle.core.fixture.mjs';
let owned, browser, context, page, f;
before(async () => { owned = await launchIsolatedBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); browser = owned.browser; });
after(async () => {
  const receipt = await owned.close();
  if (process.env.CAD_BROWSER_CLEANUP_RECEIPT_DIR) fs.writeFileSync(path.join(process.env.CAD_BROWSER_CLEANUP_RECEIPT_DIR,
    `cad-lifecycle-cleanup-${receipt.pid}-${Date.now()}.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
});
beforeEach(async () => {
  f = await startFixture(); context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort());
  page = await context.newPage(); await page.addInitScript(observeStlRendering);
  await page.addInitScript(() => {
    const original = window.setInterval;
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 3000) { window.cadFixturePoll = callback; return original(() => {}, 3600000); }
      return original(callback, delay, ...args);
    };
    const read = Response.prototype.arrayBuffer; window.cadFixtureByteReads = [];
    Response.prototype.arrayBuffer = function () { window.cadFixtureByteReads.push(this.url); return read.call(this); };
  });
  await page.goto(f.origin + '/api/cad-studio/app'); await page.locator('.model-item').filter({ hasText: 'Beta part' }).waitFor();
});
afterEach(async () => { await context.close(); await f.close(); });

/** @description Hold a completed synthetic server response before the real browser receives it. */
async function hold(method, suffix, status) {
  let release, caught; const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { caught = resolve; });
  let used = false;
  await context.route(f.origin + '/api/cad-studio/**', async route => {
    const req = route.request();
    if (used || req.method() !== method || !suffix(new URL(req.url()))) { await route.fallback(); return; }
    used = true; const response = await route.fetch(); await response.body(); caught(); await gate; await route.fulfill(status ? { response, status, body: '{}' } : { response });
  });
  return { ready, release: async () => {
    const received = page.waitForResponse(res => res.request().method() === method && suffix(new URL(res.url()))); release();
    await (await received).finished(); await frames();
  } };
}
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function select(name) { await page.locator('.model-item').filter({ hasText: name }).click(); }
async function rendered(width, revision = 1) {
  await page.waitForFunction(({ width, revision }) => document.querySelector('#viewer-info').textContent.includes(`${width.toFixed(1)} × 40.0 × 30.0 mm · revision ${revision}`), { width, revision }, { timeout: 5000 });
  await frames();
  assert.ok(await page.evaluate(() => window.stlProof.frames.some(frame => frame.count === 36 && frame.colors > 20)), 'real triangle drawing and nonuniform pixels');
  const actual = await page.evaluate(() => window.stlProof.uploads.filter(a => a.length === 108)
    .map(a => Math.max(...a.filter((_, i) => i % 3 === 0)) - Math.min(...a.filter((_, i) => i % 3 === 0))).filter(n => n > 2).at(-1));
  assert.equal(actual, width, 'the real renderer buffer contains the current geometry');
}
const detailUrl = id => url => url.pathname === '/api/cad-studio/models/' + id;
const stlUrl = (id, revision = 1) => url => url.pathname.endsWith('/models/' + id + '/artifacts/stl') && url.searchParams.get('revision') === String(revision);

test('late part detail cannot replace a newer selected part or its artifact links', async () => {
  const held = await hold('GET', detailUrl(IDS[0])); await select('Alpha part'); await held.ready;
  await select('Beta part'); await rendered(100); await held.release();
  assert.equal(await page.locator('#model-heading').innerText(), 'Beta part'); await rendered(100);
  assert.ok((await page.locator('#downloads a').first().getAttribute('href')).includes(IDS[1]));
});
test('late STL bytes cannot replace the newer selected part geometry', async () => {
  const held = await hold('GET', stlUrl(IDS[0])); await select('Alpha part'); await held.ready;
  await select('Beta part'); await rendered(100); await held.release(); await rendered(100);
  assert.equal(await page.locator('#model-heading').innerText(), 'Beta part');
});
test('late prior-revision STL cannot replace a completed current rebuild', async () => {
  const held = await hold('GET', stlUrl(IDS[0])); await select('Alpha part'); await held.ready;
  await page.locator('#rebuild-model').click(); await rendered(80, 2); await held.release(); await rendered(80, 2);
  assert.match(await page.locator('#model-state').innerText(), /revision 2/);
});
test('late rebuild response cannot select its old part or discard another part feature draft', async () => {
  await select('Alpha part'); await rendered(60);
  const held = await hold('POST', url => url.pathname.endsWith('/' + IDS[0] + '/rebuild'));
  await page.locator('#rebuild-model').click(); await held.ready; await select('Beta part'); await rendered(100);
  await page.locator('#feature-label').fill('Unsaved Beta feature'); await page.locator('[data-param="height"]').fill('17');
  await held.release(); assert.equal(await page.locator('#model-heading').innerText(), 'Beta part'); await rendered(100);
  assert.equal(await page.locator('#feature-label').inputValue(), 'Unsaved Beta feature'); assert.equal(await page.locator('[data-param="height"]').inputValue(), '17');
});
test('deleting a part clears preview and a late STL cannot restore it', async () => {
  const held = await hold('GET', stlUrl(IDS[0])); await select('Alpha part'); await held.ready;
  page.once('dialog', dialog => dialog.accept()); await page.locator('#delete-model').click(); await page.locator('#empty-panel').waitFor();
  const draws = await page.evaluate(() => window.stlProof.frames.length); await held.release();
  assert.equal(await page.locator('#model-panel').isVisible(), false); assert.equal(await page.locator('#viewer-info').innerText(), '');
  assert.equal(await page.evaluate(() => window.stlProof.frames.length), draws); assert.equal(f.models.has(IDS[0]), false);
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});
test('late delete completion cannot clear another selected part', async () => {
  await select('Alpha part'); await rendered(60); const held = await hold('DELETE', detailUrl(IDS[0]));
  page.once('dialog', dialog => dialog.accept()); await page.locator('#delete-model').click(); await held.ready;
  await select('Beta part'); await rendered(100); await held.release();
  assert.equal(await page.locator('#model-panel').isVisible(), true); assert.equal(await page.locator('#model-heading').innerText(), 'Beta part'); await rendered(100);
});
test('late poll cannot select its old part', async () => {
  await select('Alpha part'); await rendered(60); f.models.set(IDS[0], model(IDS[0], 70, 2));
  const held = await hold('GET', detailUrl(IDS[0])); await page.evaluate(() => { window.cadFixturePoll(); }); await held.ready;
  await select('Beta part'); await rendered(100); await held.release();
  assert.equal(await page.locator('#model-heading').innerText(), 'Beta part'); await rendered(100);
});
test('late poll cannot roll a newer rebuild back to an older revision or reset draft fields', async () => {
  await select('Alpha part'); await rendered(60); f.models.set(IDS[0], model(IDS[0], 70, 2));
  const held = await hold('GET', detailUrl(IDS[0])); await page.evaluate(() => { window.cadFixturePoll(); }); await held.ready;
  await page.locator('#rebuild-model').click(); await rendered(80, 3);
  await page.locator('#feature-label').fill('Current unsaved draft'); await page.locator('[data-param="height"]').fill('23');
  await held.release(); await rendered(80, 3); assert.match(await page.locator('#model-state').innerText(), /revision 3/);
  assert.equal(await page.locator('#feature-label').inputValue(), 'Current unsaved draft'); assert.equal(await page.locator('[data-param="height"]').inputValue(), '23');
});
test('late revision-list refresh cannot attach old-part restore controls to another part', async () => {
  await select('Alpha part'); await rendered(60); const held = await hold('GET', detailUrl(IDS[0]));
  await page.locator('#rebuild-model').click(); await held.ready; await rendered(80, 2);
  await select('Beta part'); await rendered(100); await held.release();
  assert.equal(await page.locator('#revisions li').count(), 1); assert.equal(await page.locator('#revisions button').count(), 0);
  assert.equal(await page.locator('#model-heading').innerText(), 'Beta part');
});
test('late preview failure cannot overwrite another part successful preview status', async () => {
  const held = await hold('GET', stlUrl(IDS[0]), 503); await select('Alpha part'); await held.ready;
  await select('Beta part'); await rendered(100); await held.release(); await rendered(100);
});
test('STL body completing after headers cannot replace another selected part', async () => {
  const held = f.holdStlBody(IDS[0]), response = page.waitForResponse(res => stlUrl(IDS[0])(new URL(res.url())));
  await select('Alpha part'); await held.ready; const pending = await response;
  await page.waitForFunction(id => window.cadFixtureByteReads.some(url => url.includes(id)), IDS[0]);
  await select('Beta part'); await rendered(100); held.release(); await pending.finished(); await frames(); await rendered(100);
});
test('current background refresh updates real geometry while preserving unsaved feature input', async () => {
  await select('Alpha part'); await rendered(60);
  await page.locator('#feature-label').fill('Keep this unsaved feature'); await page.locator('[data-param="height"]').fill('29');
  f.models.set(IDS[0], model(IDS[0], 70, 2)); await page.evaluate(() => window.cadFixturePoll()); await rendered(70, 2);
  assert.equal(await page.locator('#feature-label').inputValue(), 'Keep this unsaved feature'); assert.equal(await page.locator('[data-param="height"]').inputValue(), '29');
  assert.equal(f.requests.filter(r => r.method !== 'GET').length, 0, 'a read-only poll never submits the unsaved form');
});
test('new feature input entered during a held submit remains after the submitted feature builds', async () => {
  await select('Alpha part'); await rendered(60);
  await page.locator('#feature-label').fill('Submitted feature'); await page.locator('[data-param="height"]').fill('7');
  const held = await hold('POST', url => url.pathname.endsWith('/' + IDS[0] + '/features'));
  await page.locator('#feature-submit').click(); await held.ready;
  assert.equal(await page.locator('#feature-submit').isDisabled(), true);
  await page.locator('#feature-label').fill('Next unsaved feature'); await page.locator('[data-param="height"]').fill('19');
  await held.release(); await rendered(60, 2);
  assert.equal(await page.locator('#feature-label').inputValue(), 'Next unsaved feature'); assert.equal(await page.locator('[data-param="height"]').inputValue(), '19');
  assert.equal(await page.locator('#feature-submit').isDisabled(), false);
  assert.deepEqual(f.requests.filter(r => r.method === 'POST').map(r => r.body), [{ type: 'boss', params: { height: 7 }, label: 'Submitted feature' }]);
  assert.match(await page.locator('#feature-list').innerText(), /Submitted feature/);
});
test('the generated form authors revolve, sweep and loft with typed JSON, plane and boolean parameters', async () => {
  await select('Alpha part'); await rendered(60);
  const submit = async (type, fill) => {
    await page.locator('#feature-type').selectOption(type); await fill();
    const held = await hold('POST', url => url.pathname.endsWith('/' + IDS[0] + '/features'));
    await page.locator('#feature-submit').click(); await held.ready; await held.release();
  };
  assert.equal(await page.locator('[data-param="pathPlane"]').count(), 0, 'boss is selected first');
  await submit('sweep', async () => {
    assert.equal(await page.locator('[data-param="path"]').getAttribute('data-json'), '1');
    assert.deepEqual(await page.locator('[data-param="pathPlane"] option').allTextContents(), ['(default)', 'XY', 'XZ', 'YZ']);
    await page.locator('[data-param="points"]').fill('[[-5,-5],[5,-5],[5,5],[-5,5]]');
    await page.locator('[data-param="path"]').fill('[[0,0],[0,40],[30,40]]'); await page.locator('[data-param="pathPlane"]').selectOption('XZ');
  });
  await submit('loft', async () => {
    assert.deepEqual(await page.locator('[data-param="ruled"] option').allTextContents(), ['(default)', 'true', 'false']);
    await page.locator('[data-param="sections"]').fill('[{"points":[[-10,-10],[10,-10],[10,10],[-10,10]],"offset":20},{"points":[[-5,-5],[5,-5],[5,5],[-5,5]],"offset":50}]');
    await page.locator('[data-param="ruled"]').selectOption('false');
  });
  await submit('revolve', async () => {
    await page.locator('[data-param="points"]').fill('[[0,0],[5,0],[5,30],[0,30]]'); await page.locator('[data-param="degrees"]').fill('90');
    await page.locator('[data-param="axis"]').selectOption('z');
  });
  assert.deepEqual(f.requests.filter(r => r.method === 'POST').map(r => r.body), [
    { type: 'sweep', params: { points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], path: [[0, 0], [0, 40], [30, 40]], pathPlane: 'XZ' } },
    { type: 'loft', params: { sections: [{ points: [[-10, -10], [10, -10], [10, 10], [-10, 10]], offset: 20 }, { points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], offset: 50 }], ruled: false } },
    { type: 'revolve', params: { points: [[0, 0], [5, 0], [5, 30], [0, 30]], axis: 'z', degrees: 90 } },
  ]);
});
test('Stop is offered only while the selected part rebuilds and cancels that part', async () => {
  await select('Alpha part'); await rendered(60);
  assert.equal(await page.locator('#cancel-rebuild').isVisible(), false, 'nothing is rebuilding');
  const held = await hold('POST', url => url.pathname.endsWith('/' + IDS[0] + '/rebuild'));
  await page.locator('#rebuild-model').click(); await held.ready;
  await page.locator('#cancel-rebuild').waitFor({ state: 'visible' });
  await select('Beta part'); await rendered(100);
  assert.equal(await page.locator('#cancel-rebuild').isVisible(), false, 'Beta is not rebuilding');
  await select('Alpha part'); await page.locator('#cancel-rebuild').waitFor({ state: 'visible' });
  // hold() forwards the rebuild to the fixture and holds only its reply, so the fixture already
  // moved on; the toast must quote whatever revision the server's cancel reply names.
  const kept = f.models.get(IDS[0]).revision;
  await page.locator('#cancel-rebuild').click();
  await page.waitForFunction(r => document.querySelector('#toast').textContent === `Rebuild stopped — the part stays at revision ${r}.`, kept);
  assert.deepEqual(f.requests.filter(r => r.path.endsWith('/cancel')).map(r => [r.method, r.path]), [['POST', '/api/cad-studio/models/' + IDS[0] + '/cancel']]);
  await held.release();
  await page.locator('#cancel-rebuild').waitFor({ state: 'hidden' });
});
test('unchanged feature input completes normally and resets after its successful build', async () => {
  await select('Alpha part'); await rendered(60);
  await page.locator('#feature-label').fill('Completed feature'); await page.locator('[data-param="height"]').fill('11');
  const held = await hold('POST', url => url.pathname.endsWith('/' + IDS[0] + '/features'));
  await page.locator('#feature-submit').click(); await held.ready; await held.release(); await rendered(60, 2);
  assert.equal(await page.locator('#feature-label').inputValue(), ''); assert.equal(await page.locator('[data-param="height"]').inputValue(), '');
  assert.equal(await page.locator('#feature-submit').isDisabled(), false); assert.match(await page.locator('#feature-list').innerText(), /Completed feature/);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});
