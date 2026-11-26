/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.4 (CREATE-TOOL-MOTION-STUDIO-01, -04, -05, -09): prove bounded motion-preview frame endpoint and persona contract, mouse/touch on-canvas drag/scale/rotate handles, mouse/touch timeline layer-bar and keyframe-diamond dragging, and on-screen Revision History Restore + Redo at 1440x900 and 412x915.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { startApplicationFixture, chromium } from './application-fixture.mjs';
import { parseNative, readProject } from '../tools/native-json.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REPO = resolve(ROOT, '..');
const yaml = createRequire(join(process.env.STORE_CI_TOOLCHAIN || resolve(REPO, 'scripts/toolchain'), 'package.json'))('js-yaml');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

async function callApi(origin, path, { user = 'alice', method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(origin + '/api/motion-studio' + path, {
    method,
    headers: { 'x-fixture-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path} -> ${response.status}: ${text}`);
  return parseNative(text);
}

async function readSavedProject(origin, projectId) {
  const res = await callApi(origin, '/projects/' + projectId);
  return readProject(res.project);
}

function firstComp(project) {
  return Object.values(project.document.items).find(item => item.kind.type === 'Comp');
}

function layerProp(layer, path) {
  let node = layer.props;
  for (const part of path.split('/')) node = node?.children?.find(c => c.match === part);
  return node;
}

async function openWorkbench(t, fixture, browser, contextOptions) {
  const context = await browser.newContext(contextOptions);
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  t.after(() => assert.deepEqual(errors, [], 'zero pageErrors'));
  page.setDefaultTimeout(30000);
  await page.goto(fixture.origin + '/api/motion-studio/app');
  await page.locator('.ef-shell').waitFor();
  await page.locator('#status').filter({ hasText: 'Ready' }).waitFor();
  return page;
}

async function createSolidComp(page, title) {
  await page.locator('#new button:enabled').waitFor({ state: 'attached' });
  await page.evaluate(name => {
    const form = document.getElementById('new');
    form.elements.title.value = name;
    form.elements.width.value = '640';
    form.elements.height.value = '360';
    form.elements.frameRate.value = '30';
    form.elements.duration.value = '5';
    form.requestSubmit();
  }, title);
  await page.locator('#revision').filter({ hasText: 'revision 1' }).waitFor();
  await page.locator('#add button:enabled').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const form = document.getElementById('add');
    form.elements.kind.value = 'solid';
    form.elements.text.value = 'Hero box';
    form.elements.color.value = '#ff3366';
    form.requestSubmit();
  });
  await page.locator('#revision').filter({ hasText: 'revision 2' }).waitFor();
  await page.locator('#status').filter({ hasText: 'Saved' }).waitFor();
  return page.locator('#projects').inputValue();
}

async function waitRev(page, n) {
  await page.locator('#revision').filter({ hasText: 'revision ' + n }).waitFor();
  await page.locator('#status').filter({ hasText: 'Saved' }).waitFor();
}

async function pointerDrag(page, locator, dx, dy, { pointerType = 'mouse', steps = 6 } = {}) {
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'drag target must have a non-empty box');
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  if (pointerType === 'mouse') {
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + dx, sy + dy, { steps });
    await page.mouse.up();
    return { sx, sy, ex: sx + dx, ey: sy + dy };
  }
  await locator.evaluate((el, arg) => {
    const { sx, sy, dx, dy, steps } = arg;
    const pid = 42;
    const base = { bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: sx, clientY: sy }));
    for (let i = 1; i <= steps; i++) {
      const cx = sx + (dx * i) / steps;
      const cy = sy + (dy * i) / steps;
      window.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: cx, clientY: cy }));
    }
    window.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, clientX: sx + dx, clientY: sy + dy }));
  }, { sx, sy, dx, dy, steps });
  return { sx, sy, ex: sx + dx, ey: sy + dy };
}

test('CREATE-TOOL-MOTION-STUDIO-05: motion-preview returns bounded verified PNG frames and enforces read-only own grants', async t => {
  const manifest = yaml.load(await readFile(join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const authz = yaml.load(await readFile(join(ROOT, 'authorization.yaml'), 'utf8'));
  const persona = yaml.load(await readFile(join(ROOT, 'personas/motion-editor.yaml'), 'utf8'));
  const toolDef = manifest.tools.find(item => item.name === 'motion-preview');
  assert.ok(toolDef, 'motion-preview declared in oshal-app.yaml');
  assert.equal(toolDef.defaultAuthMode, 'auto');
  assert.equal(toolDef.requiresApproval, false);
  assert.equal(persona.authorizations['motion-preview'], 'auto');
  assert.match(persona.perspective, /motion-preview/, 'persona instructs concierge to call motion-preview');
  assert.deepEqual(authz.bindings.tools.find(b => b.id === 'motion-preview')?.allOf, ['project.view', 'project.read']);
  assert.deepEqual(authz.bindings.http.find(b => b.id === 'preview-frame')?.allOf, ['project.view', 'project.read']);

  const fixture = await startApplicationFixture();
  t.after(() => fixture.close());
  const created = await callApi(fixture.origin, '/projects', {
    method: 'POST',
    body: { title: 'Preview frame proof', width: 640, height: 360, frameRate: 30, duration: 5, requestKey: randomUUID() },
  });
  const projectId = created.project.id;
  const before = await callApi(fixture.origin, `/projects/${projectId}/revisions/1/preview-frame/0/auto/320`);
  assert.equal(before.ok, true);
  assert.equal(before.projectId, projectId);
  assert.equal(before.revision, 1);
  assert.equal(before.mimeType, 'image/png');
  assert.ok(before.width <= 320 && before.height <= 320 && before.width > 0 && before.height > 0);
  assert.ok(before.dataUrl.startsWith('data:image/png;base64,'));
  const pngBefore = Buffer.from(before.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  assert.deepEqual(pngBefore.subarray(0, 8), PNG_MAGIC);
  assert.equal(pngBefore.length, before.bytes);
  assert.equal(createHash('sha256').update(pngBefore).digest('hex'), before.sha256);
  assert.ok(Buffer.byteLength(JSON.stringify(before)) <= 60 * 1024, 'bounded under 60 KiB');

  await callApi(fixture.origin, `/projects/${projectId}/operations`, {
    method: 'POST',
    body: {
      baseRevision: 1,
      requestKey: randomUUID(),
      commands: [{ command: 'layer.newSolid', params: { name: 'Red square', color: '#ff0000', width: 200, height: 200 } }],
    },
  });
  const after = await callApi(fixture.origin, `/projects/${projectId}/revisions/2/preview-frame/0/${before.compId}/320`);
  assert.equal(after.revision, 2);
  assert.notEqual(after.sha256, before.sha256, 'preview frame reflects saved visual edit');

  await callApi(fixture.origin, `/projects/${projectId}/revisions/2/preview-frame/0/auto/320`, { user: 'bob', status: 404 });
  await callApi(fixture.origin, `/projects/${projectId}/revisions/2/preview-frame/0/auto/2048`, { status: 400 });
  await callApi(fixture.origin, `/projects/${projectId}/revisions/2/preview-frame/-1/auto/320`, { status: 400 });
  fixture.state.denied.set('alice', new Set(['project.read']));
  try {
    await callApi(fixture.origin, `/projects/${projectId}/revisions/2/preview-frame/0/auto/320`, { status: 403 });
  } finally {
    fixture.state.denied.delete('alice');
  }
});

test('CREATE-TOOL-MOTION-STUDIO-01, -04, -09: desktop (1440x900 mouse) canvas handles, timeline drag, and History sheet Restore + Redo', { timeout: 180000 }, async t => {
  const fixture = await startApplicationFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await openWorkbench(t, fixture, browser, DESKTOP);
  const projectId = await createSolidComp(page, 'Desktop parity');

  // 1) Canvas drag position, corner scale, and rotation (mouse).
  await page.locator('.motion-transform-overlay .motion-position-handle').waitFor({ state: 'visible' });
  const previewBox = await page.locator('#preview').boundingBox();
  const beforePos = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/position').value.v;
  await pointerDrag(page, page.locator('.motion-transform-overlay .motion-position-handle'), 36, -18, { pointerType: 'mouse' });
  await waitRev(page, 3);
  const afterPos = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/position').value.v;
  assert.ok(Math.abs(afterPos[0] - (beforePos[0] + 36 * 640 / previewBox.width)) < 2, `position X saved: ${afterPos[0]}`);
  assert.ok(Math.abs(afterPos[1] - (beforePos[1] - 18 * 360 / previewBox.height)) < 2, `position Y saved: ${afterPos[1]}`);

  const seHandle = page.locator('.motion-scale-handle[data-corner="se"]');
  await seHandle.waitFor({ state: 'visible' });
  await pointerDrag(page, seHandle, 30, 24, { pointerType: 'mouse' });
  await waitRev(page, 4);
  const afterScale = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/scale').value.v;
  assert.ok(afterScale[0] > 115 && afterScale[1] > 115, `scale grew after SE corner drag: ${JSON.stringify(afterScale)}`);

  const rotHandle = page.locator('.motion-rotate-handle');
  await rotHandle.waitFor({ state: 'visible' });
  await pointerDrag(page, rotHandle, 45, 20, { pointerType: 'mouse' });
  await waitRev(page, 5);
  const afterRot = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/rotation').value.v;
  assert.ok(Math.abs(afterRot) > 5, `rotation changed after rotate handle drag: ${afterRot}`);

  // 2) Timeline layer-bar trim + move AND keyframe diamond drag (mouse).
  const rightTrim = page.locator('#timeline .motion-span-trim-out').first();
  await rightTrim.waitFor({ state: 'visible' });
  const laneBox = await page.locator('#timeline .motion-lane').first().boundingBox();
  await pointerDrag(page, rightTrim, -Math.round(laneBox.width * 0.4), 0, { pointerType: 'mouse' });
  await waitRev(page, 6);
  const trimmedLayer = firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0];
  assert.ok(Number(trimmedLayer.out_point) < 4 * 254016000000, `out_point trimmed: ${trimmedLayer.out_point}`);

  const spanBar = page.locator('#timeline .motion-span').first();
  await pointerDrag(page, spanBar, Math.round(laneBox.width * 0.2), 0, { pointerType: 'mouse' });
  await waitRev(page, 7);
  const shiftedLayer = firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0];
  assert.ok(Number(shiftedLayer.in_point) > 0 && Number(shiftedLayer.start_time) > 0, `layer bar shifted: in=${shiftedLayer.in_point}, start=${shiftedLayer.start_time}`);

  // Add an opacity keyframe at 1s and drag its diamond right along the timeline.
  await page.evaluate(() => {
    const t = document.getElementById('time');
    t.value = '1';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#timeLabel').filter({ hasText: '1.00 s' }).waitFor();
  await page.evaluate(() => {
    const form = document.getElementById('key');
    form.elements.path.value = 'transform/opacity';
    form.elements.value.value = '50';
    form.requestSubmit();
  });
  await waitRev(page, 8);
  const keyBtn = page.locator('#timeline .keyButton').first();
  await keyBtn.waitFor({ state: 'visible' });
  const keyBefore = Number(layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/opacity').keys[0].time);
  await pointerDrag(page, keyBtn, Math.round(laneBox.width * 0.2), 0, { pointerType: 'mouse' });
  await waitRev(page, 9);
  const keyAfter = Number(layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/opacity').keys[0].time);
  assert.ok(keyAfter > keyBefore, `keyframe diamond moved right: ${keyBefore} -> ${keyAfter}`);

  // Clicking a diamond without dragging still opens #keyEditor.
  await page.locator('#timeline .keyButton').first().click();
  await page.locator('#keyEditor').waitFor({ state: 'visible' });

  // 3) History sheet Restore + Redo parity with motion-revision-history.
  const conciergeHistory = await callApi(fixture.origin, `/projects/${projectId}/revision-index/9/0`);
  await page.locator('.motion-doc').click();
  await page.getByRole('menuitem', { name: 'Revision history…', exact: true }).click();
  const list = page.locator('dialog[open] #historyList');
  await list.waitFor({ state: 'visible' });
  assert.equal(await list.locator('.motion-history-row').count(), conciergeHistory.revisions.length, 'History sheet matches concierge revision count');
  assert.equal(await list.locator('button[data-restore-revision="9"]').isDisabled(), true, 'current revision restore disabled');
  await list.locator('button[data-restore-revision="2"]').click();
  await waitRev(page, 10);
  const restoredProj = await readSavedProject(fixture.origin, projectId);
  assert.equal(restoredProj.revision, 10);
  assert.equal((layerProp(firstComp(restoredProj).kind.layers[0], 'transform/opacity').keys ?? []).length, 0, 'revision 2 had no opacity key');

  // Redo returns the undone revision (rev 9 content as rev 11).
  const redoBtn = page.getByRole('button', { name: 'Redo', exact: true });
  assert.equal(await redoBtn.isEnabled(), true, 'Redo enabled after restoring earlier revision');
  await redoBtn.click();
  await waitRev(page, 11);
  const redoneProj = await readSavedProject(fixture.origin, projectId);
  assert.equal(layerProp(firstComp(redoneProj).kind.layers[0], 'transform/opacity').keys.length, 1, 'Redo restored the opacity key');
});

test('CREATE-TOOL-MOTION-STUDIO-01, -04, -09: phone (412x915 touch) canvas handles, timeline drag, and History sheet with zero overflow', { timeout: 180000 }, async t => {
  const fixture = await startApplicationFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await openWorkbench(t, fixture, browser, PHONE);
  const projectId = await createSolidComp(page, 'Phone parity');

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow at 412x915');

  // Touch drag move, scale, and rotate on canvas.
  await page.locator('.motion-transform-overlay .motion-position-handle').waitFor({ state: 'visible' });
  const beforePos = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/position').value.v;
  await pointerDrag(page, page.locator('.motion-transform-overlay .motion-position-handle'), 24, 14, { pointerType: 'touch' });
  await waitRev(page, 3);
  const afterPos = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/position').value.v;
  assert.ok(afterPos[0] > beforePos[0] + 5 && afterPos[1] > beforePos[1] + 2, `touch move saved: ${JSON.stringify(afterPos)}`);

  await pointerDrag(page, page.locator('.motion-scale-handle[data-corner="se"]'), 22, 18, { pointerType: 'touch' });
  await waitRev(page, 4);
  const afterScale = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/scale').value.v;
  assert.ok(afterScale[0] > 110, `touch scale saved: ${JSON.stringify(afterScale)}`);

  await pointerDrag(page, page.locator('.motion-rotate-handle'), 36, 16, { pointerType: 'touch' });
  await waitRev(page, 5);
  const afterRot = layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/rotation').value.v;
  assert.ok(Math.abs(afterRot) > 4, `touch rotation saved: ${afterRot}`);

  // Touch trim & drag layer bar and keyframe diamond on #timeline.
  const laneBox = await page.locator('#timeline .motion-lane').first().boundingBox();
  await pointerDrag(page, page.locator('#timeline .motion-span-trim-out').first(), -Math.round(laneBox.width * 0.35), 0, { pointerType: 'touch' });
  await waitRev(page, 6);
  await pointerDrag(page, page.locator('#timeline .motion-span').first(), Math.round(laneBox.width * 0.18), 0, { pointerType: 'touch' });
  await waitRev(page, 7);
  const movedLayer = firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0];
  assert.ok(Number(movedLayer.in_point) > 0, `touch layer bar drag saved: in=${movedLayer.in_point}`);

  await page.evaluate(() => {
    const form = document.getElementById('key');
    form.elements.path.value = 'transform/opacity';
    form.elements.value.value = '75';
    form.requestSubmit();
  });
  await waitRev(page, 8);
  const keyBefore = Number(layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/opacity').keys[0].time);
  await pointerDrag(page, page.locator('#timeline .keyButton').first(), Math.round(laneBox.width * 0.25), 0, { pointerType: 'touch' });
  await waitRev(page, 9);
  const keyAfter = Number(layerProp(firstComp(await readSavedProject(fixture.origin, projectId)).kind.layers[0], 'transform/opacity').keys[0].time);
  assert.ok(keyAfter > keyBefore, `touch keyframe drag saved: ${keyBefore} -> ${keyAfter}`);

  // Open Revision history via More bottom bar menu, Restore rev 2, then Redo.
  await page.locator('.motion-tool[data-tool="more"]').tap();
  await page.getByRole('menuitem', { name: 'Revision history…', exact: true }).tap();
  const list = page.locator('dialog[open] #historyList');
  await list.waitFor({ state: 'visible' });
  assert.equal(await list.locator('.motion-history-row').count(), 9);
  await list.locator('button[data-restore-revision="2"]').tap();
  await waitRev(page, 10);
  await page.getByRole('button', { name: 'Redo', exact: true }).tap();
  await waitRev(page, 11);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'still no overflow at 412x915');
});
