/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify real manual organization, parenting, nested timing, native agent parity and original grants.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startApplicationFixture, chromium } from './application-fixture.mjs';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
import { readProject, stringifyNative, parseNative } from '../tools/native-json.mjs';
const exec = promisify(execFile); let http, native, server, browser;
before(async () => { http = await startApplicationFixture(); native = await startNativeSqlFixture(); server = await chromium.launchServer({ headless: true, host: '127.0.0.1' }); browser = await chromium.connect(server.wsEndpoint()); });
after(async () => { await server?.close(); await native?.close(); await http?.close(); });
async function page(t) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } }); t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === http.origin ? route.continue() : route.abort());
  const p = await context.newPage(), errors = []; p.on('pageerror', error => errors.push(error.message)); p.setDefaultTimeout(10000);
  await p.goto(http.origin + '/api/motion-studio/app'); await p.locator('#status').filter({ hasText: 'Ready' }).waitFor(); return { p, errors };
}
async function saved(p, revision) { await p.locator('#revision').filter({ hasText: 'revision ' + revision }).waitFor(); await p.locator('#status').filter({ hasText: 'Saved' }).waitFor(); }
async function create(p, title) { await p.locator('#new [name=title]').fill(title); await p.locator('#new [name=width]').fill('160'); await p.locator('#new [name=height]').fill('90'); await p.locator('#new button').click(); await saved(p, 1); }
async function add(p, name, color) { await p.locator('#add [name=kind]').selectOption('solid'); await p.locator('#add [name=text]').fill(name); await p.locator('#add [name=color]').evaluate((input, value) => input.value = value, color); await p.locator('#add button').click(); }
async function pixel(p, x = 80, y = 45) { return p.locator('#preview').evaluate(async (img, { x, y }) => { await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data]; }, { x, y }); }
async function document(p) { const id = await p.locator('#projects').inputValue(), response = await fetch(http.origin + '/api/motion-studio/projects/' + id); return readProject(parseNative(await response.text()).project); }
const compositions = project => Object.values(project.document.items).filter(item => item.kind.type === 'Comp');
async function nativeCall(path, options = {}, status = 200) { const answer = await native.call(path, options); assert.equal(answer.status, status, stringifyNative(answer.body)); return answer.body; }
async function exact(project, comp, commands) {
  const input = { id: project.id, baseRevision: project.revision, requestKey: randomUUID(), compId: String(comp), commandsJson: stringifyNative(commands), response: 'receipt' };
  const tool = native.contract.tools.find(tool => tool.name === 'motion-apply-exact-edits'); assert.equal(tool.bound, true); assert.equal(tool.approvalRequired, true);
  await exec(process.env.MOTION_NATIVE_BINARY || '/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture', ['--tool-input', native.definition, tool.name, JSON.stringify(input)]);
  const { id, ...body } = input; await nativeCall('/projects/' + id + '/operations', { method: 'POST', body }); return readProject((await nativeCall('/projects/' + id)).project);
}
test('manual order, rename, visibility and duplicate/delete change saved pixels and preserve undo', async t => {
  const { p, errors } = await page(t); await create(p, 'Organized layers'); await add(p, 'Red logo', '#ff0000'); await saved(p, 2); await add(p, 'Blue logo', '#0000ff'); await saved(p, 3);
  assert.deepEqual(await pixel(p), [0, 0, 255, 255]); await p.locator('#layerDown').click(); await saved(p, 4); assert.deepEqual(await pixel(p), [255, 0, 0, 255]);
  await p.locator('#layerSettings [name=name]').fill('Bottom blue'); await p.locator('#layerSettings [name=visible]').uncheck(); await p.locator('#layerSettings button').click(); await saved(p, 5);
  assert.deepEqual(compositions(await document(p))[0].kind.layers.map(l => l.name), ['Red logo', 'Bottom blue']);
  await p.locator('#duplicateLayer').click(); await saved(p, 6); assert.equal(compositions(await document(p))[0].kind.layers.length, 3);
  p.once('dialog', d => d.accept()); await p.locator('#deleteLayer').click(); await saved(p, 7); assert.equal(compositions(await document(p))[0].kind.layers.length, 2);
  await p.locator('#undo').click(); await saved(p, 8); assert.equal(compositions(await document(p))[0].kind.layers.length, 3);
  const id = await p.locator('#projects').inputValue(); await p.goto(http.origin + '/api/motion-studio/app?project=' + id); await saved(p, 8); assert.equal(await p.locator('#projects').inputValue(), id);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
});
test('manual parenting preserves placement, follows transforms and refuses a cycle without a new revision', async t => {
  const { p, errors } = await page(t); await create(p, 'Parented layers'); await add(p, 'Child', '#ff0000'); await saved(p, 2); await add(p, 'Parent', '#0000ff'); await saved(p, 3);
  await p.locator('#layerSettings [name=visible]').uncheck(); await p.locator('#layerSettings button').click(); await saved(p, 4);
  const parent = compositions(await document(p))[0].kind.layers.find(l => l.name === 'Parent'); await p.locator('#layers button').filter({ hasText: /^Child$/ }).click();
  await p.locator('#layerSettings [name=parent]').selectOption(String(parent.id)); await p.locator('#layerSettings button').click(); await saved(p, 5); assert.deepEqual(await pixel(p, 35), [255, 0, 0, 255]);
  await p.locator('#layers button').filter({ hasText: /^Parent$/ }).click(); await p.locator('#transform [name=x]').fill('100'); await p.locator('#transform button').click(); await saved(p, 6);
  assert.equal((await pixel(p, 35))[3], 0); assert.equal((await pixel(p, 55))[0], 255);
  const before = await document(p), child = compositions(before)[0].kind.layers.find(l => l.name === 'Child'); await p.locator('#layerSettings [name=parent]').selectOption(String(child.id)); await p.locator('#layerSettings button').click(); await p.locator('#error').waitFor(); assert.match(await p.locator('#error').innerText(), /Choose a parent/);
  assert.equal((await document(p)).revision, 6); assert.deepEqual((await document(p)).document, before.document); assert.deepEqual(errors, []);
});
test('manual multi-layer nesting retains animation and source timing through parent preview, reopen and undo', async t => {
  const { p, errors } = await page(t); await create(p, 'Nested manual'); await add(p, 'Animated red', '#ff0000'); await saved(p, 2);
  await p.locator('#key [name=value]').fill('0'); await p.locator('#key [name=ease]').selectOption('ease'); await p.locator('#key button').click(); await saved(p, 3);
  await p.locator('#time').evaluate(i => { i.value = '4'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.locator('#key [name=value]').fill('100'); await p.locator('#key button').click(); await saved(p, 4);
  await add(p, 'Hidden blue', '#0000ff'); await saved(p, 5); await p.locator('#layerSettings [name=visible]').uncheck(); await p.locator('#layerSettings button').click(); await saved(p, 6);
  const parentId = await p.locator('#comps').inputValue(); await p.getByLabel('Select Animated red for precompose', { exact: true }).check(); await p.getByLabel('Select Hidden blue for precompose', { exact: true }).check();
  await p.locator('#nest [name=name]').fill('Editable nested'); await p.locator('#nest button').click(); await saved(p, 7); const nestedId = await p.locator('#comps').inputValue(); assert.notEqual(nestedId, parentId);
  const nested = (await document(p)).document.items[nestedId]; assert.equal(nested.kind.layers.length, 2);
  const opacity = nested.kind.layers.find(l => l.name === 'Animated red').props.children.find(n => n.match === 'transform').children.find(n => n.match === 'opacity'); assert.equal(opacity.keys.length, 2); assert.equal(opacity.keys[0].out_interp, 'Bezier');
  await p.locator('#comps').selectOption(parentId); const old = await p.locator('#preview').getAttribute('src'); await p.locator('#time').evaluate(i => { i.value = '2'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForFunction(previous => document.getElementById('preview').src !== previous, old); assert.equal((await pixel(p))[3], 128);
  await p.locator('#layerTiming [name=start]').fill('1'); await p.locator('#layerTiming button').click(); await saved(p, 8); assert.equal((await document(p)).document.items[parentId].kind.layers[0].start_time, 254016000000); assert.ok((await pixel(p))[3] < 128);
  const id = await p.locator('#projects').inputValue(); await p.reload(); await p.locator('#status').filter({ hasText: 'Ready' }).waitFor(); await p.locator('#projects').selectOption(id); await saved(p, 8); assert.equal(compositions(await document(p)).length, 2);
  await p.locator('#undo').click(); await saved(p, 9); assert.equal((await document(p)).document.items[parentId].kind.layers[0].start_time, 0); assert.deepEqual(errors, []);
});
test('declared native agent edits organize and nest the same graph; foreign and withdrawn grants refuse', async () => {
  let project = readProject((await nativeCall('/projects', { method: 'POST', body: { title: 'Agent graph', width: 160, height: 90, duration: 5, frameRate: 30, requestKey: randomUUID() } })).project); const root = compositions(project)[0].id;
  project = await exact(project, root, [{ command: 'layer.newSolid', params: { name: 'Agent red', color: '#ff0000', width: 40, height: 20 } }, { command: 'prop.addKey', params: { layer: 'Agent red', path: 'transform/opacity', time: 0, value: 0 } }, { command: 'prop.addKey', params: { layer: 'Agent red', path: 'transform/opacity', time: 4, value: 100 } }]); const layer = project.document.items[String(root)].kind.layers[0].id;
  project = await exact(project, root, [{ command: 'layer.select', params: { layers: [layer] } }, { command: 'layer.rename', params: { layer, name: 'Agent renamed' } }, { command: 'layer.precompose', params: { layers: [layer], name: 'Agent source', mode: 'move', open: true } }]); assert.equal(compositions(project).length, 2);
  const preview = await nativeCall('/projects/' + project.id + '/revisions/' + project.revision + '/preview/2/' + root + '/160/1'); const { data, info } = await native.sharp(Buffer.from(preview.png, 'base64')).raw().toBuffer({ resolveWithObject: true }); assert.equal(data[(45 * info.width + 80) * info.channels + 3], 128);
  project = await exact(project, root, [{ command: 'layer.newNull', params: { name: 'Agent rig' } }]);
  const rootLayers = project.document.items[String(root)].kind.layers, rig = rootLayers.find(l => l.name === 'Agent rig'), wrapper = rootLayers.find(l => l.name === 'Agent source');
  project = await exact(project, root, [{ command: 'layer.select', params: { layers: [wrapper.id] } }, { command: 'layer.setParent', params: { layers: [wrapper.id], parent: rig.id, compensate: true } }]);
  await nativeCall('/projects/' + project.id + '/operations', { method: 'POST', body: { baseRevision: project.revision, requestKey: randomUUID(), compId: String(root), commandsJson: stringifyNative([{ command: 'layer.select', params: { layers: [rig.id] } }, { command: 'layer.setParent', params: { layers: [rig.id], parent: wrapper.id } }]) } }, 400);
  assert.deepEqual(readProject((await nativeCall('/projects/' + project.id)).project).document, project.document, 'native cycle refusal preserves the exact graph');
  await nativeCall('/projects/' + project.id, { actor: 'bob' }, 404); const body = { baseRevision: project.revision, requestKey: randomUUID(), compId: String(root), commandsJson: stringifyNative([{ command: 'layer.newSolid', params: {} }]) };
  native.deny('alice', 'project.change'); try { await nativeCall('/projects/' + project.id + '/operations', { method: 'POST', body }, 403); } finally { native.allow('alice', 'project.change'); }
  assert.equal(readProject((await nativeCall('/projects/' + project.id)).project).revision, project.revision); await nativeCall('/projects/' + project.id, { method: 'DELETE' });
});
test('Reader organization controls remain disabled while the saved composition is readable', async t => {
  const { p, errors } = await page(t); await create(p, 'Readable layers'); await add(p, 'Read only logo', '#ff0000'); await saved(p, 2); const id = await p.locator('#projects').inputValue(); http.state.denied.set('alice', new Set(['project.change', 'project.create', 'project.delete', 'project.export']));
  try { await p.reload(); await p.locator('#status').filter({ hasText: 'Ready' }).waitFor(); await p.locator('#projects').selectOption(id); await saved(p, 2);
    for (const selector of ['#layerSettings button', '#layerTiming button', '#layerUp', '#layerDown', '#duplicateLayer', '#deleteLayer', '#nest button']) assert.equal(await p.locator(selector).isDisabled(), true, selector); assert.deepEqual(await pixel(p), [255, 0, 0, 255]); assert.deepEqual(errors, []);
  } finally { http.state.denied.delete('alice'); }
});

test('manual layer settings and unchanged timing keep wide native ticks exact', async t => {
  const { p, errors } = await page(t); await create(p, 'Precise timing seed'); await add(p, 'Wide source', '#ff0000'); await saved(p, 2);
  const seed = await document(p), comp = compositions(seed)[0]; comp.kind.duration = 9007199254740993n; comp.kind.layers[0].out_point = 9007199254740993n;
  await p.locator('#importDocument [name=title]').fill('Precise timing copy'); await p.locator('#importDocument [name=document]').setInputFiles({ name: 'precise.ecproj', mimeType: 'application/json', buffer: Buffer.from(stringifyNative(seed.document)) });
  await p.locator('#importDocument button').click(); await saved(p, 1); await p.locator('#layerSettings [name=name]').fill('Renamed precise source'); await p.locator('#layerSettings button').click(); await saved(p, 2);
  assert.equal(compositions(await document(p))[0].kind.layers[0].out_point, 9007199254740993n);
  const writes = http.state.requests.filter(request => request.path.endsWith('/operations')).length; await p.locator('#layerTiming button').click();
  assert.equal((await document(p)).revision, 2); assert.equal(http.state.requests.filter(request => request.path.endsWith('/operations')).length, writes); assert.equal(compositions(await document(p))[0].kind.layers[0].out_point, 9007199254740993n); assert.deepEqual(errors, []);
});

test('manual trim-to-range nesting keeps source timing and parent active-range pixels', async t => {
  const { p, errors } = await page(t); await create(p, 'Trimmed source'); await add(p, 'Trimmed red', '#ff0000'); await saved(p, 2);
  await p.locator('#layerTiming [name=in]').fill('1'); await p.locator('#layerTiming [name=out]').fill('3'); await p.locator('#layerTiming button').click(); await saved(p, 3);
  const parentId = await p.locator('#comps').inputValue(); await p.getByLabel('Select Trimmed red for precompose', { exact: true }).check();
  await p.locator('#nest [name=trim]').check(); await p.locator('#nest [name=name]').fill('Two-second nested'); await p.locator('#nest button').click(); await saved(p, 4);
  const nestedId = await p.locator('#comps').inputValue(), project = await document(p), nested = project.document.items[nestedId].kind, wrapper = project.document.items[parentId].kind.layers[0];
  assert.equal(nested.duration, 508032000000); assert.equal(nested.layers[0].start_time, -254016000000); assert.equal(wrapper.start_time, 254016000000); assert.equal(wrapper.in_point, 254016000000); assert.equal(wrapper.out_point, 762048000000);
  const ready = p.waitForResponse(response => response.url().includes('/preview/0/' + parentId + '/')); await p.locator('#comps').selectOption(parentId); const frame = await (await ready).json();
  await p.waitForFunction(png => document.getElementById('preview').src === 'data:image/png;base64,' + png, frame.png); assert.equal((await pixel(p))[3], 0);
  const old = await p.locator('#preview').getAttribute('src'); await p.locator('#time').evaluate(i => { i.value = '2'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForFunction(previous => document.getElementById('preview').src !== previous, old); assert.deepEqual(await pixel(p), [255, 0, 0, 255]); assert.deepEqual(errors, []);
});
