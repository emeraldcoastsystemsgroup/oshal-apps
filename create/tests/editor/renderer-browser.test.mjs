/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Inspect actual Canvas2D pixels, raster encodings and portable asset reads in isolated headless Chromium.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startFixture, ASSET } from './renderer-fixture.mjs';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function open(t, options = {}) {
  const fixture = await startFixture(options), context = await browser.newContext(), errors = [], external = [];
  t.after(async () => { await context.close(); await fixture.close(); });
  await context.addCookies([{ name: 'synthetic-editor-owner', value: 'fixture', url: fixture.origin }]);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(fixture.origin);
  await page.evaluate(async () => {
    window.model = await import('/editor/model.mjs'); window.rendering = await import('/editor/renderer.mjs');
    window.canvas = document.querySelector('canvas'); window.ctx = canvas.getContext('2d');
    window.pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    window.photo = () => {
      const source = document.createElement('canvas'); source.width = 40; source.height = 20; const paint = source.getContext('2d');
      paint.fillStyle = '#ff0000'; paint.fillRect(0, 0, 20, 20); paint.fillStyle = '#0000ff'; paint.fillRect(20, 0, 20, 20);
      return source.toDataURL('image/png');
    };
    window.imageProject = src => model.applyOperation(model.createProject({ width: 80, height: 60 }), { type: 'add',
      images: { photo: { src, width: 40, height: 20 } }, layer: { id: 'photo', type: 'image', assetId: 'photo', x: 10, y: 10, w: 40, h: 20 } });
  });
  return { page, fixture, errors, external };
}

function clean(value) {
  assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []);
  assert.ok(value.fixture.requests.every(row => row.method === 'GET'));
}

test('native canvas paints all five kinds with real transparency, curves, text and rotation', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    let project = model.createProject({ width: 200, height: 120 });
    for (const layer of [{ id: 'rect', type: 'rect', x: 10, y: 10, w: 40, h: 40, fill: '#ff0000' },
      { id: 'ellipse', type: 'ellipse', x: 60, y: 10, w: 40, h: 40, fill: '#0000ff' },
      { id: 'stroke', type: 'freehand', x: 10, y: 70, w: 80, h: 10, points: [{ x: 0, y: .5 }, { x: 1, y: .5 }], stroke: '#00ff00', strokeWidth: 6 },
      { id: 'text', type: 'text', x: 105, y: 10, w: 80, h: 45, fontSize: 24, fontFamily: 'monospace', text: 'Hi', fill: '#000000' },
      { id: 'turned', type: 'rect', x: 130, y: 80, w: 40, h: 10, rotation: 90, fill: '#00ff00' }]) project = model.applyOperation(project, { type: 'add', layer });
    project = model.applyOperation(project, { type: 'add', images: { photo: { src: photo(), width: 40, height: 20 } },
      layer: { id: 'image', type: 'image', assetId: 'photo', x: 10, y: 95, w: 40, h: 20 } });
    rendering.renderProject(ctx, project, { images: await rendering.loadProjectImages(project) });
    const data = ctx.getImageData(105, 10, 80, 45).data; let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] < 20 && data[i + 1] < 20 && data[i + 2] < 20) ink++;
    return { red: pixel(20, 20), blue: pixel(80, 30), curveCorner: pixel(60, 10), stroke: pixel(50, 75),
      turned: pixel(150, 100), outsideTurn: pixel(135, 85), image: pixel(40, 105), ink };
  });
  assert.deepEqual(result.red, [255, 0, 0, 255]); assert.deepEqual(result.blue, [0, 0, 255, 255]);
  assert.equal(result.curveCorner[3], 0); assert.deepEqual(result.stroke, [0, 255, 0, 255]);
  assert.deepEqual(result.turned, [0, 255, 0, 255]); assert.equal(result.outsideTurn[3], 0);
  assert.deepEqual(result.image, [0, 0, 255, 255]); assert.ok(result.ink > 80); clean(value);
});

test('native image crop, brightness, contrast and opacity affect pixels without changing the source asset', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const original = imageProject(photo()), assets = await rendering.loadProjectImages(original);
    const crop = model.applyOperation(original, { type: 'update', id: 'photo', patch: { crop: { x: .5, y: 0, w: .5, h: 1 } } });
    rendering.renderProject(ctx, crop, { images: assets }); const cropped = pixel(15, 15);
    const dim = model.applyOperation(crop, { type: 'update', id: 'photo', patch: { brightness: 50 } });
    rendering.renderProject(ctx, dim, { images: assets }); const darker = pixel(15, 15);
    const flat = model.applyOperation(crop, { type: 'update', id: 'photo', patch: { contrast: 0, opacity: .5 } });
    rendering.renderProject(ctx, flat, { images: assets });
    return { cropped, darker, flat: pixel(15, 15), originalCrop: original.layers[0].crop, sameSource: crop.images.photo.src === original.images.photo.src };
  });
  assert.deepEqual(result.cropped, [0, 0, 255, 255]); assert.ok(result.darker[2] >= 127 && result.darker[2] <= 129);
  assert.ok(result.flat.slice(0, 3).every(channel => channel >= 126 && channel <= 130)); assert.ok(result.flat[3] >= 127 && result.flat[3] <= 129);
  assert.deepEqual(result.originalCrop, { x: 0, y: 0, w: 1, h: 1 }); assert.equal(result.sameSource, true); clean(value);
});

for (const type of ['image/png', 'image/jpeg']) test(`native ${type} export has real file bytes and decodes to the edited composition`, async t => {
  const value = await open(t), result = await value.page.evaluate(async format => {
    const project = imageProject(photo()), original = model.serializeProject(project);
    const blob = await rendering.exportProjectImage(project, { type: format, quality: 1 });
    const bitmap = await createImageBitmap(blob), output = document.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height;
    const paint = output.getContext('2d'); paint.drawImage(bitmap, 0, 0); bitmap.close();
    return { type: blob.type, size: blob.size, signature: [...new Uint8Array(await blob.arrayBuffer()).slice(0, 8)],
      width: output.width, height: output.height, red: [...paint.getImageData(15, 15, 1, 1).data], corner: [...paint.getImageData(0, 0, 1, 1).data],
      unchanged: model.serializeProject(project) === original };
  }, type);
  assert.equal(result.type, type); assert.ok(result.size > 100); assert.equal(result.width, 80); assert.equal(result.height, 60); assert.equal(result.unchanged, true);
  assert.ok(result.red[0] > 245 && result.red[1] < 10 && result.red[2] < 10 && result.red[3] === 255);
  if (type === 'image/png') { assert.deepEqual(result.signature, [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal(result.corner[3], 0); }
  else { assert.deepEqual(result.signature.slice(0, 2), [255, 216]); assert.ok(result.corner.every(channel => channel > 245)); }
  clean(value);
});

test('paint order, hiding and locked-layer picking agree with actual canvas pixels', async t => {
  const value = await open(t), result = await value.page.evaluate(() => {
    let project = model.createProject({ width: 100, height: 100 });
    for (const [id, fill] of [['red', '#ff0000'], ['blue', '#0000ff']]) project = model.applyOperation(project, { type: 'add', layer: { id, type: 'rect', w: 50, h: 50, fill } });
    rendering.renderProject(ctx, project); const first = pixel(20, 20), firstHit = rendering.hitTest(project, { x: 20, y: 20 }).id;
    project = model.applyOperation(project, { type: 'reorder', id: 'red', index: 1 }); rendering.renderProject(ctx, project); const reordered = pixel(20, 20);
    project = model.applyOperation(project, { type: 'update', id: 'red', patch: { locked: true } }); const lockedHit = rendering.hitTest(project, { x: 20, y: 20 }).id;
    project = model.applyOperation(project, { type: 'update', id: 'red', patch: { visible: false } }); rendering.renderProject(ctx, project);
    return { first, firstHit, reordered, lockedHit, hidden: pixel(20, 20) };
  });
  assert.deepEqual(result.first, [0, 0, 255, 255]); assert.equal(result.firstHit, 'blue'); assert.deepEqual(result.reordered, [255, 0, 0, 255]);
  assert.equal(result.lockedHit, 'blue'); assert.deepEqual(result.hidden, [0, 0, 255, 255]); clean(value);
});

test('portable export embeds the authenticated owner asset and round trips all layers unchanged', async t => {
  const value = await open(t); value.fixture.asset.bytes = Buffer.from((await value.page.evaluate(() => photo())).split(',')[1], 'base64');
  const result = await value.page.evaluate(async source => {
    const original = imageProject(source), before = model.serializeProject(original);
    const portable = await rendering.makePortableProject(original), loaded = model.parseProject(model.serializeProject(portable));
    rendering.renderProject(ctx, loaded, { images: await rendering.loadProjectImages(loaded) });
    return { embedded: loaded.images.photo.src.startsWith('data:image/png;base64,'), layersEqual: JSON.stringify(loaded.layers) === JSON.stringify(original.layers),
      originalUnchanged: model.serializeProject(original) === before, blue: pixel(40, 15) };
  }, ASSET);
  assert.equal(result.embedded, true); assert.equal(result.layersEqual, true); assert.equal(result.originalUnchanged, true); assert.deepEqual(result.blue, [0, 0, 255, 255]);
  const requests = value.fixture.requests.filter(row => row.pathname === ASSET); assert.equal(requests.length, 1); assert.equal(requests[0].hasOwnerCookie, true); clean(value);
});

for (const status of [403, 404]) test(`portable export refuses an unavailable ${status} asset instead of saving an incomplete project`, async t => {
  const value = await open(t, { status });
  const result = await value.page.evaluate(async source => {
    const project = imageProject(source), before = model.serializeProject(project);
    try { await rendering.makePortableProject(project); return { rejected: false }; }
    catch (error) { return { rejected: true, message: error.message, unchanged: model.serializeProject(project) === before }; }
  }, ASSET);
  assert.equal(result.rejected, true); assert.match(result.message, new RegExp(String(status))); assert.equal(result.unchanged, true); clean(value);
});

test('unsupported sources and missing decoded assets cannot become successful raster exports', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const failures = [];
    for (const src of ['https://example.invalid/image.png', 'file:///private.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      try { await rendering.loadProjectImages(imageProject(src)); } catch { failures.push(src); }
    }
    try { await rendering.exportProjectImage(imageProject(photo()), { images: new Map() }); } catch (error) { failures.push(error.message); }
    return failures;
  });
  assert.equal(result.length, 4); assert.match(result[3], /not loaded/); clean(value);
});

test('decoded image dimensions must agree with the declared asset before rendering', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const project = imageProject(photo()); project.images.photo.width = 1;
    try { await rendering.loadProjectImages(project); return ''; } catch (error) { return error.message; }
  });
  assert.match(result, /dimensions/); clean(value);
});

test('a cancelled asset download rejects promptly and retains the portable input', async t => {
  const value = await open(t, { hold: true }), requested = value.page.waitForRequest(request => request.url().endsWith(ASSET));
  await value.page.evaluate(source => {
    window.abort = new AbortController(); window.waiting = rendering.makePortableProject(imageProject(source), { signal: abort.signal }).then(() => 'unexpected', error => error.name);
  }, ASSET);
  await requested; await value.page.evaluate(() => abort.abort()); assert.equal(await value.page.evaluate(() => waiting), 'AbortError'); clean(value);
});

test('held image decoding has a bounded timeout without producing an empty export', async t => {
  const value = await open(t, { hold: true }); await value.page.clock.install();
  const requested = value.page.waitForRequest(request => request.url().endsWith(ASSET));
  await value.page.evaluate(source => { window.waiting = rendering.loadProjectImages(imageProject(source)).then(() => 'unexpected', error => error.message); }, ASSET);
  await requested; await value.page.clock.fastForward(30001); assert.match(await value.page.evaluate(() => waiting), /timed out/); clean(value);
});
