/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Inspect actual Canvas2D pixels, raster encodings and portable asset reads in isolated headless Chromium.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove each image filter changes real pixels as named, that the fixed filter string is what reaches the canvas, and that exported PNG pixels equal the preview canvas for a filtered layer.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Inspect mask pixels through crop, rotation, inversion and feather; compare decoded PNG with preview.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Prove brush masks, mask combination and editable adjustment persistence with actual rendered pixels and UI gestures.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startFixture, ASSET } from './renderer-fixture.mjs';
import { startEditorFixture } from '../browser/create-editor-fixture.mjs';
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

test('a duplicated masked group has matching isolated pixels and independently editable child values', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    let project = model.applyOperation(model.createProject({ width: 220, height: 220 }), { type: 'add',
      images: { photo: { src: photo(), width: 40, height: 20 } },
      layer: { id: 'photo', type: 'image', assetId: 'photo', x: 10, y: 10, w: 40, h: 20,
        mask: { points: [{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}], enabled: true, inverted: false, feather: 0 } } });
    project = model.applyOperation(project, { type: 'add', layer: { id: 'grade', type: 'adjustment', scope: 'layer', targetId: 'photo', exposure: -1 } });
    project = model.applyOperation(project, { type: 'group', ids: ['photo', 'grade'], id: 'inner' });
    project = model.applyOperation(project, { type: 'add', layer: { id: 'rectangle', type: 'rect', x: 45, y: 10, w: 10, h: 20, fill: '#00ff00' } });
    project = model.applyOperation(project, { type: 'group', ids: ['inner', 'rectangle'], id: 'outer' });
    project = model.applyOperation(project, { type: 'update', id: 'outer', patch: { opacity: .5 } });
    const before = model.serializeProject(project), copied = model.applyOperation(project, { type: 'duplicate', id: 'outer', newId: 'copy', offset: 90 });
    const images = await rendering.loadProjectImages(copied);
    rendering.renderProject(ctx, copied, { images });
    const originalPixels = [...ctx.getImageData(0, 0, 70, 70).data], copyPixels = [...ctx.getImageData(90, 90, 70, 70).data];
    const originalRed = pixel(15,15), copiedRed = pixel(105,105), masked = pixel(132,105);
    const grade = copied.layers.find(layer => layer.type === 'adjustment' && layer.id !== 'grade');
    const edited = model.applyOperation(copied, { type: 'update', id: grade.id, patch: { exposure: 0 } });
    rendering.renderProject(ctx, edited, { images });
    return { originalPixels, copyPixels, originalRed, copiedRed, masked, brighterCopy: pixel(105,105), unchangedRed: pixel(15,15),
      unchangedSource: model.serializeProject(project) === before,
      roundTrip: model.serializeProject(copied) === model.serializeProject(model.parseProject(model.serializeProject(copied))) };
  });
  assert.deepEqual(result.copyPixels, result.originalPixels);
  assert.ok(result.originalRed[3] >= 127 && result.originalRed[3] <= 129);
  assert.deepEqual(result.copiedRed, result.originalRed); assert.equal(result.masked[3], 0);
  assert.ok(result.brighterCopy[0] > result.copiedRed[0]); assert.deepEqual(result.unchangedRed, result.originalRed);
  assert.equal(result.roundTrip, true); assert.equal(result.unchangedSource, true); clean(value);
});

test('human group Duplicate works on a narrow screen and saves/reopens as one history edit', async t => {
  const fixture = await startEditorFixture(), context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  t.after(async () => { await context.close(); await fixture.close(); });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  let document = { version:3, name:'Group duplicate proof', width:200, height:200, background:'transparent', images:{},
    layers:[{id:'a',type:'rect',name:'Red',x:0,y:0,w:20,h:20,fill:'#ff0000'},
      {id:'b',type:'rect',name:'Blue',x:20,y:0,w:20,h:20,fill:'#0000ff'},
      {id:'g',type:'group',name:'Composition',x:20,y:20,w:40,h:20,baseWidth:40,baseHeight:20,children:['a','b']}] };
  const record = fixture.seed(document);
  await page.goto(`${fixture.origin}/api/create/editor?project=${record.id}`);
  await page.locator('[data-layer-id="g"] .layer-select').click();
  await page.locator('#duplicateLayer').click();
  assert.equal(await page.locator('[data-layer-id]').count(), 6);
  await page.locator('#undo').click(); assert.equal(await page.locator('[data-layer-id]').count(), 3);
  await page.locator('#redo').click(); assert.equal(await page.locator('[data-layer-id]').count(), 6);
  await page.locator('#saveProject').click();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  const saved = fixture.state.projects.get(record.id).document;
  assert.equal(saved.layers.length, 6); assert.equal(saved.layers.filter(layer => layer.type === 'group').length, 2);
  assert.deepEqual(saved.layers.find(layer => layer.id === 'g').children, ['a','b']);
  await page.reload();
  await page.waitForSelector('[data-layer-id="g"]');
  assert.equal(await page.locator('[data-layer-id]').count(), 6);
  assert.deepEqual(errors, []);
});

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

test('saturation, grayscale, sepia and blur change actual pixels as named without touching the source asset', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const original = imageProject(photo()), assets = await rendering.loadProjectImages(original), sample = {};
    const draw = patch => { rendering.renderProject(ctx, model.applyOperation(original, { type: 'update', id: 'photo', patch }), { images: assets }); };
    for (const [name, patch] of [['plain', {}], ['gray', { grayscale: 100 }], ['desaturated', { saturation: 0 }], ['sepia', { sepia: 100 }], ['vivid', { saturation: 200, brightness: 60 }], ['softened', { blur: 4 }]]) {
      draw(patch); sample[name] = { red: pixel(15, 20), edge: pixel(29, 20), blue: pixel(45, 20), outside: pixel(10, 5) };
    }
    return { sample, filter: rendering.imageFilter(model.applyOperation(original, { type: 'update', id: 'photo', patch: { sepia: 30, blur: 1.5, saturation: 80, grayscale: 10 } }).layers[0]),
      neutral: rendering.imageFilter(original.layers[0]), sameSource: original.images.photo.src.startsWith('data:image/png') };
  });
  const { plain, gray, desaturated, sepia, softened } = result.sample;
  assert.deepEqual(plain.red, [255, 0, 0, 255]); assert.deepEqual(plain.edge, [255, 0, 0, 255]); assert.equal(plain.outside[3], 0);
  assert.ok(Math.abs(gray.red[0] - gray.red[1]) <= 1 && Math.abs(gray.red[1] - gray.red[2]) <= 1 && gray.red[0] > 40 && gray.red[0] < 90, String(gray.red));
  assert.deepEqual(desaturated.red, gray.red);
  assert.ok(sepia.red[0] > sepia.red[1] && sepia.red[1] > sepia.red[2], String(sepia.red));
  assert.ok(softened.edge[2] > 20 && softened.edge[0] < 255, String(softened.edge)); assert.ok(softened.outside[3] > 0, 'blur softens the layer edge onto the canvas');
  assert.equal(result.filter, 'brightness(100%) contrast(100%) saturate(80%) grayscale(10%) sepia(30%) blur(1.5px)');
  assert.equal(result.neutral, 'brightness(100%) contrast(100%)'); assert.equal(result.sameSource, true); clean(value);
});

test('an exported PNG of a filtered layer decodes to exactly the preview canvas pixels', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const project = model.applyOperation(imageProject(photo()), { type: 'update', id: 'photo', patch: { saturation: 40, sepia: 50, grayscale: 20, blur: 1.5 } });
    const images = await rendering.loadProjectImages(project); rendering.renderProject(ctx, project, { images });
    const preview = [...ctx.getImageData(0, 0, project.width, project.height).data];
    const blob = await rendering.exportProjectImage(project, { type: 'image/png', images }), bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const output = document.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height;
    const paint = output.getContext('2d'); paint.drawImage(bitmap, 0, 0); bitmap.close();
    const exported = [...paint.getImageData(0, 0, output.width, output.height).data];
    let differing = 0; for (let index = 0; index < preview.length; index++) if (Math.abs(preview[index] - exported[index]) > 1) differing++;
    return { length: preview.length, exportedLength: exported.length, differing, filteredRed: preview.slice((20 * 80 + 15) * 4, (20 * 80 + 15) * 4 + 4) };
  });
  assert.equal(result.exportedLength, result.length); assert.equal(result.differing, 0);
  assert.notDeepEqual(result.filteredRed, [255, 0, 0, 255]); clean(value);
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


test('source-space image masks retain crop/rotation, invert/disable and match actual exported PNG pixels', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const original = imageProject(photo()), images = await rendering.loadProjectImages(original);
    const mask = { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] };
    const masked = model.applyOperation(original, { type: 'update', id: 'photo', patch: { mask } });
    const draw = project => rendering.renderProject(ctx, project, { images });
    draw(masked); const inside = pixel(15, 15), outside = pixel(45, 15);
    const inverted = model.applyOperation(masked, { type: 'update', id: 'photo', patch: { mask: { ...masked.layers[0].mask, inverted: true } } });
    draw(inverted); const invInside = pixel(15, 15), invOutside = pixel(45, 15);
    const disabled = model.applyOperation(masked, { type: 'update', id: 'photo', patch: { mask: { ...masked.layers[0].mask, enabled: false } } });
    draw(disabled); const restored = pixel(45, 15);
    const cropped = model.applyOperation(masked, { type: 'update', id: 'photo', patch: { crop: { x: .5, y: 0, w: .5, h: 1 } } });
    draw(cropped); const croppedAway = pixel(30, 15);
    const rotated = model.applyOperation(masked, { type: 'update', id: 'photo', patch: { rotation: 180 } });
    draw(rotated); const movedInside = pixel(45, 15), movedOutside = pixel(15, 15);
    const feathered = model.applyOperation(masked, { type: 'update', id: 'photo', patch: { mask: { ...masked.layers[0].mask, feather: 3 } } });
    draw(feathered); const edge = pixel(29, 20), expected = [...ctx.getImageData(0, 0, 80, 60).data];
    const blob = await rendering.exportProjectImage(feathered, { images }), decoded = await createImageBitmap(blob);
    ctx.clearRect(0, 0, 80, 60); ctx.drawImage(decoded, 0, 0); decoded.close();
    return { inside, outside, invInside, invOutside, restored, croppedAway, movedInside, movedOutside, edge,
      equal: JSON.stringify(expected) === JSON.stringify([...ctx.getImageData(0, 0, 80, 60).data]),
      roundTrip: model.parseProject(model.serializeProject(feathered)).layers[0].mask, unchanged: !original.layers[0].mask };
  });
  assert.deepEqual(result.inside, [255, 0, 0, 255]); assert.equal(result.outside[3], 0);
  assert.equal(result.invInside[3], 0); assert.deepEqual(result.invOutside, [0, 0, 255, 255]);
  assert.deepEqual(result.restored, [0, 0, 255, 255]); assert.equal(result.croppedAway[3], 0);
  assert.deepEqual(result.movedInside, [255, 0, 0, 255]); assert.equal(result.movedOutside[3], 0);
  assert.ok(result.edge[3] > 0 && result.edge[3] < 255); assert.equal(result.equal, true);
  assert.equal(result.roundTrip.feather, 3); assert.equal(result.unchanged, true); clean(value);
});


test('mask brush strength and polygon arithmetic render real coverage without replacing source pixels', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const original = imageProject(photo()), images = await rendering.loadProjectImages(original);
    const base = { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }] };
    const draw = operations => { const project = model.applyOperation(original, { type: 'update', id: 'photo', patch: { mask: { ...base, operations } } }); rendering.renderProject(ctx, project, { images }); };
    draw([{ kind: 'brush', mode: 'subtract', points: [{ x: 10, y: 10 }], size: 10, opacity: .5 }]); const gray = pixel(20, 20);
    draw([{ kind: 'polygon', mode: 'subtract', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }]); const erased = pixel(20, 20), kept = pixel(40, 20);
    draw([{ kind: 'polygon', mode: 'intersect', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }]); const inside = pixel(20, 20), outside = pixel(40, 20);
    return { gray, erased, kept, inside, outside, unchanged: !original.layers[0].mask };
  });
  assert.ok(result.gray[3] >= 126 && result.gray[3] <= 129); assert.equal(result.erased[3], 0);
  assert.deepEqual(result.kept, [0, 0, 255, 255]); assert.deepEqual(result.inside, [255, 0, 0, 255]);
  assert.equal(result.outside[3], 0); assert.equal(result.unchanged, true); clean(value);
});

test('stack and clipped adjustment layers change actual colors while preserving alpha and upper layers', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    let project = model.createProject({ width: 40, height: 20 });
    project = model.applyOperation(project, { type: 'add', layer: { id: 'under', type: 'rect', x: 0, y: 0, w: 30, h: 20, fill: '#804020', opacity: .5 } });
    project = model.applyOperation(project, { type: 'add', layer: { id: 'other', type: 'rect', x: 30, y: 0, w: 10, h: 20, fill: '#00ff00' } });
    const clipped = model.applyOperation(project, { type: 'add', layer: { id: 'grade', type: 'adjustment', scope: 'layer', targetId: 'under', exposure: 1 } });
    rendering.renderProject(ctx, clipped); const graded = pixel(10, 10), other = pixel(35, 10);
    const stack = model.applyOperation(clipped, { type: 'add', layer: { id: 'mono', type: 'adjustment', saturation: 0 } });
    const top = model.applyOperation(stack, { type: 'add', layer: { id: 'top', type: 'rect', x: 0, y: 0, w: 5, h: 5, fill: '#ff0000' } });
    rendering.renderProject(ctx, top); const gray = pixel(35, 10), upper = pixel(2, 2);
    const expected = [...ctx.getImageData(0, 0, 40, 20).data], blob = await rendering.exportProjectImage(top), bitmap = await createImageBitmap(blob);
    ctx.clearRect(0, 0, 40, 20); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return { graded, other, gray, upper, equal: JSON.stringify(expected) === JSON.stringify([...ctx.getImageData(0, 0, 40, 20).data]), original: project.layers[0].fill };
  });
  assert.ok(result.graded[0] >= 253); assert.ok(result.graded[1] >= 125 && result.graded[1] <= 131);
  assert.ok(result.graded[3] >= 126 && result.graded[3] <= 129); assert.deepEqual(result.other, [0, 255, 0, 255]);
  assert.equal(result.gray[0], result.gray[1]); assert.equal(result.gray[1], result.gray[2]);
  assert.deepEqual(result.upper, [255, 0, 0, 255]); assert.equal(result.equal, true); assert.equal(result.original, '#804020'); clean(value);
});


test('group opacity is isolated across overlap, nested transforms render and ungroup preserves output', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    let project = model.createProject({ width: 80, height: 60 });
    for (const layer of [{ id: 'a', type: 'rect', x: 10, y: 10, w: 20, h: 20, fill: '#ff0000' },
      { id: 'b', type: 'rect', x: 20, y: 10, w: 20, h: 20, fill: '#0000ff' }]) project = model.applyOperation(project, { type: 'add', layer });
    project = model.applyOperation(project, { type: 'group', ids: ['a', 'b'], id: 'group' });
    const half = model.applyOperation(project, { type: 'update', id: 'group', patch: { opacity: .5 } });
    rendering.renderProject(ctx, half); const overlap = pixel(25, 20), single = pixel(15, 20);
    const moved = model.applyOperation(project, { type: 'update', id: 'group', patch: { x: 30, rotation: 180 } });
    rendering.renderProject(ctx, moved); const expected = [...ctx.getImageData(0, 0, 80, 60).data];
    rendering.renderProject(ctx, model.applyOperation(moved, { type: 'ungroup', id: 'group' }));
    return { overlap, single, same: JSON.stringify(expected) === JSON.stringify([...ctx.getImageData(0, 0, 80, 60).data]) };
  });
  assert.deepEqual(result.overlap.slice(0, 3), [0, 0, 255]); assert.ok(result.overlap[3] >= 127 && result.overlap[3] <= 129);
  assert.ok(result.single[3] >= 127 && result.single[3] <= 129); assert.equal(result.same, true); clean(value);
});


test('editable cubic paths, gradients, clips and boolean holes render real geometry', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const geometry = await import('/editor/vector-geometry.mjs');
    let project = model.createProject({ width: 80, height: 60 });
    const outer = geometry.pathFromRings([[[10, 10], [60, 10], [60, 50], [10, 50]]], { id: 'outer', fill: '#ff0000' });
    const inner = geometry.pathFromRings([[[25, 20], [45, 20], [45, 40], [25, 40]]], { id: 'inner' });
    for (const layer of [outer, inner]) project = model.applyOperation(project, { type: 'add', layer });
    const hole = geometry.combinePaths(project, ['outer', 'inner'], 'difference'); hole.id = 'hole';
    const cut = model.applyOperation(project, { type: 'booleanResult', ids: ['outer', 'inner'], result: hole });
    rendering.renderProject(ctx, cut); const filled = pixel(15, 15), empty = pixel(35, 30);
    const styled = model.applyOperation(cut, { type: 'update', id: 'hole', patch: { gradient: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] },
      clip: [{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: .5, y: 1 }, { x: 0, y: 1 }] } });
    rendering.renderProject(ctx, styled); const clipped = pixel(55, 15), gradient = pixel(20, 15);
    return { filled, empty, clipped, gradient };
  });
  assert.deepEqual(result.filled, [255, 0, 0, 255]); assert.equal(result.empty[3], 0); assert.equal(result.clipped[3], 0);
  assert.ok(result.gradient[0] > result.gradient[2] && result.gradient[2] > 0); clean(value);
});

test('SVG cubic, gradient, clip and stroke interchange preserves pixels and rejects external or executable features', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const svg = await import('/editor/vector-svg.mjs');
    let project = model.applyOperation(model.createProject({ width: 80, height: 60 }), { type: 'add', layer: { id: 'curve', type: 'path', x: 10, y: 10, w: 50, h: 40,
      contours: [{ closed: true, nodes: [{ x: 0, y: 0, out: { x: .4, y: 0 } }, { x: 1, y: 1, in: { x: 0, y: -.4 } }, { x: 0, y: 1 }] }],
      stroke: '#00ff00', strokeWidth: 2, cap: 'round', gradient: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] },
      clip: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } });
    rendering.renderProject(ctx, project); const expected = [...ctx.getImageData(0, 0, 80, 60).data];
    const exported = svg.exportVectorSvg(project), imported = svg.importVectorSvg(exported).project;
    rendering.renderProject(ctx, imported); const actual = [...ctx.getImageData(0, 0, 80, 60).data];
    const failures = [];
    for (const element of ['<script>alert(1)</script>', '<image href="https://external.invalid/x.png"/>', '<path d="M0 0L10 10" onclick="alert(1)"/>', '<foreignObject/>']) {
      try { svg.importVectorSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60">${element}</svg>`); failures.push(false); } catch { failures.push(true); }
    }
    return { failures, equal: JSON.stringify(expected) === JSON.stringify(actual), nodes: imported.layers[0].contours[0].nodes.length,
      gradient: imported.layers[0].gradient.stops.length, clip: imported.layers[0].clip.length, xml: exported.includes('<script') };
  });
  assert.equal(result.equal, true); assert.equal(result.nodes, 3); assert.equal(result.gradient, 2); assert.equal(result.clip, 4);
  assert.ok(result.failures.every(Boolean)); assert.equal(result.xml, false); clean(value);
});


test('native SVG text metadata retains editable text, wrapping dimensions and font properties', async t => {
  const value = await open(t), result = await value.page.evaluate(async () => {
    const svg = await import('/editor/vector-svg.mjs');
    const project = model.applyOperation(model.createProject({ width: 200, height: 100 }), { type: 'add', layer: { id: 'title', type: 'text', x: 10, y: 10,
      w: 120, h: 60, text: 'Editable title\nSecond line', fontFamily: 'monospace', fontSize: 20, fontWeight: 700, fill: '#123456', align: 'center' } });
    const imported = svg.importVectorSvg(svg.exportVectorSvg(project));
    return { before: project.layers[0], after: imported.project.layers[0], warnings: imported.warnings };
  });
  for (const field of ['text', 'fontFamily', 'fontSize', 'fontWeight', 'fill', 'align', 'x', 'y', 'w', 'h']) assert.equal(result.after[field], result.before[field]);
  assert.ok(result.warnings.some(value => value.includes('fonts'))); clean(value);
});
