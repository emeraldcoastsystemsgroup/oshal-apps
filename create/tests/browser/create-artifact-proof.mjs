/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove real artifact dispatch, Home landing, isolated image layers and stale/denied import refusal with synthetic HTTP.
 */
import { test as nodeTest, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createProject, applyOperation } from '../../tools/editor/model.mjs';
import { startArtifactFixture, launchIsolatedBrowser, REF } from './create-artifact-fixture.mjs';
let owned, browser;
const test = (name, run) => nodeTest(name, { timeout: 25000 }, run);
before(async () => { owned = await launchIsolatedBrowser(); browser = owned.browser; });
after(async () => {
  const receipt = await owned.close();
  if (process.env.CREATE_ARTIFACT_CLEANUP_RECEIPT) writeFileSync(process.env.CREATE_ARTIFACT_CLEANUP_RECEIPT, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
});

/** Serve all real UI code from one bounded origin; explicit fixture ports own only synthetic records. */
async function open(t, options = {}) {
  const fixture = await startArtifactFixture(options); let context;
  t.after(async () => { try { await context?.close(); } finally { await fixture.close(); } });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [], external = [], page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const record = options.seed ? fixture.seed(options.seed) : null, query = new URLSearchParams(options.query);
  if (record) query.set('project', record.id);
  const value = { fixture, context, page, errors, external, record, surface: page.frameLocator('iframe') };
  if (options.beforeGoto) await options.beforeGoto(value);
  await page.goto(fixture.origin + (options.path || '/fixture') + (query.size ? '?' + query : ''), { waitUntil: 'domcontentloaded' });
  if (!options.path && options.waitReady !== false) await ready(value);
  return value;
}

async function ready(value) { await value.surface.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor(); }
async function frames(value) { await value.page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
function clean(value) { assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []); }
async function snapshot(value) {
  return value.surface.locator('html').evaluate(async () => {
    const { state } = await import('/api/create/editor/editor-state.mjs');
    return { project: structuredClone(state.project), id: state.id, revision: state.revision, saved: state.saved, selected: state.selected };
  });
}

/** Invoke the shipped receiver as a new dispatch on the already-visible draft, never a substituted handler. */
async function incoming(value, query = 'artifact=' + REF) {
  await value.surface.locator('html').evaluate(async (_node, query) => {
    history.replaceState(history.state, '', location.pathname + '?' + query);
    const { acceptIncomingArtifact } = await import('/api/create/editor/editor-files.mjs');
    const { handle } = await import('/api/create/editor/editor-state.mjs');
    window.artifactComplete = handle(acceptIncomingArtifact)();
  }, query);
}
async function completed(value) { await value.surface.locator('html').evaluate(() => window.artifactComplete); await frames(value); }

/** Hold a completed real HTTP response until the later current-canvas action has finished. */
async function hold(value, suffix) {
  let release, observed; const gate = new Promise(done => { release = done; }), seen = new Promise(done => { observed = done; });
  await value.context.route(value.fixture.origin + suffix, async route => {
    const response = await route.fetch(); await response.body(); observed(); await gate; await route.fulfill({ response });
  }, { times: 1 });
  return { seen, release: async () => {
    const response = value.page.waitForResponse(row => new URL(row.url()).pathname.endsWith(suffix)); release();
    await (await response).finished(); await frames(value);
  } };
}

function seed(name = 'Existing editable design') {
  return applyOperation(createProject({ name }), { type: 'add', layer: { id: 'original-text', type: 'text', text: 'Keep my headline' } });
}

test('shared open dispatch reaches actual Home/controller and creates one editable owned image layer; returning Home does not replay it', async t => {
  const value = await open(t, { path: '/source' }); await value.page.locator('#send').click();
  await value.page.waitForURL(/\/cockpit\/\?app=create/); await ready(value);
  await value.surface.locator('#layerCount').filter({ hasText: /^1$/ }).waitFor();
  const current = await snapshot(value); assert.equal(current.id, null); assert.equal(current.project.layers[0].type, 'image');
  assert.equal(value.fixture.state.reads, 1); assert.equal(value.fixture.editor.state.uploads, 1);
  assert.equal(value.fixture.editor.state.successfulWrites, 0);
  assert.match(Object.values(current.project.images)[0].src, /^\/api\/create\/project-assets\//);
  await value.surface.locator('#artboard').evaluate(canvas => new Promise((done, reject) => {
    const until = Date.now() + 3000, check = () => {
      const ctx = canvas.getContext('2d'), red = ctx.getImageData(5, 5, 1, 1).data, blue = ctx.getImageData(30, 5, 1, 1).data;
      if (red[0] === 255 && blue[2] === 255 && red[3] === 255) done(); else if (Date.now() > until) reject(new Error('Actual imported raster pixels missing')); else requestAnimationFrame(check);
    }; check();
  }));
  await incoming(value); await completed(value); assert.equal(value.fixture.state.reads, 1);
  await value.surface.locator('#saveProject').click(); await value.surface.locator('#saveStatus').filter({ hasText: /Saved/ }).waitFor();
  assert.equal(value.fixture.editor.state.projects.size, 1);
  assert.equal(new URL(value.page.url()).searchParams.has('artifact'), false);
  await value.page.locator('#home').click(); await value.surface.locator('#heroTitle').waitFor(); await frames(value);
  assert.equal(value.fixture.state.reads, 1); assert.equal(value.fixture.editor.state.uploads, 1); clean(value);
});

test('an ordinary Create visit remains Home without file reads or project writes', async t => {
  const value = await open(t, { path: '/cockpit/', query: { app: 'create', keep: 'workspace' } });
  await value.surface.locator('#recentGrid .empty').waitFor(); await frames(value);
  assert.equal(await value.surface.locator('#heroTitle').innerText(), 'Your creative workspace');
  assert.equal(value.fixture.state.reads, 0); assert.equal(value.fixture.editor.state.uploads, 0);
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), []); clean(value);
});

test('the real host forwarding its first handle cannot hide a differing second parent handle', async t => {
  const value = await open(t, { path: '/cockpit/', query: [['app', 'create'], ['artifact', REF], ['artifact', 'art_other_image_1234']] });
  await value.surface.locator('#status').filter({ hasText: /one valid image/ }).waitFor();
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), []);
  assert.equal(value.fixture.state.reads, 0); assert.equal(value.fixture.editor.state.uploads, 0); clean(value);
});

for (const failure of [{ denied: true }, { accessStatus: 503 }]) test(`Home refuses artifact handoff when Create access ${failure.denied ? 'is denied' : 'cannot be checked'}`, async t => {
  const value = await open(t, { ...failure, path: '/cockpit/', query: { app: 'create', artifact: REF } });
  await value.surface.locator('#status').filter({ hasText: /access could not be confirmed/ }).waitFor();
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), []);
  assert.equal(value.fixture.state.reads, 0); assert.equal(value.fixture.editor.state.uploads, 0); clean(value);
});

test('standalone Home forwards only the valid handle and leaves unrelated context behind', async t => {
  const value = await open(t, { path: '/api/create/home', query: { artifact: REF, project: 'unrelated', template: 'unrelated', keep: 'unrelated' } });
  await value.page.waitForURL(/\/api\/create\/editor/); value.surface = value.page;
  await ready(value); await value.page.locator('#layerCount').filter({ hasText: /^1$/ }).waitFor();
  assert.equal(new URL(value.page.url()).search, ''); assert.equal(value.fixture.state.reads, 1); clean(value);
});

for (const refusal of [403, 410]) test(`artifact ${refusal} preserves the current saved document and creates no upload or revision`, async t => {
  const value = await open(t, { seed: seed(), refusal }); await value.surface.locator('#autosave').uncheck();
  const before = await snapshot(value); await incoming(value); await completed(value);
  await value.surface.locator('#editorError').filter({ hasText: /no longer available/ }).waitFor();
  assert.deepEqual(await snapshot(value), before); assert.equal(value.fixture.editor.state.uploads, 0);
  assert.equal(value.fixture.editor.state.successfulWrites, 0); clean(value);
});

test('different handles are refused before redemption while ordinary query and history state survive successful consumption', async t => {
  const value = await open(t); const before = await snapshot(value);
  await incoming(value, `artifact=${REF}&artifact=art_other_image_1234`); await completed(value);
  assert.deepEqual(await snapshot(value), before); assert.equal(value.fixture.state.reads, 0);
  await value.page.evaluate(ref => history.replaceState({ parent: 'retained' }, '', `/fixture?keep=parent&artifact=${ref}#section`), REF);
  await value.surface.locator('html').evaluate(() => history.replaceState({ sentinel: 'retained' }, '', location.href));
  await incoming(value, `keep=sentinel&artifact=${REF}&artifact=${REF}`); await completed(value);
  assert.equal(value.fixture.state.reads, 1); assert.equal(value.fixture.editor.state.uploads, 1);
  assert.deepEqual(await value.surface.locator('html').evaluate(() => ({ query: location.search, state: history.state })), { query: '?keep=sentinel', state: { sentinel: 'retained' } }); clean(value);
  assert.deepEqual(await value.page.evaluate(() => ({ query: location.search, hash: location.hash, state: history.state })), { query: '?keep=parent', hash: '#section', state: { parent: 'retained' } });
});

test('incoming images wait for current permissions before reading or uploading bytes', async t => {
  let pending;
  const value = await open(t, { query: { artifact: REF }, waitReady: false,
    beforeGoto: async value => { pending = await hold(value, '/api/create/permissions'); } });
  await pending.seen; assert.equal(value.fixture.state.reads, 0); assert.equal(value.fixture.editor.state.uploads, 0);
  await pending.release(); await ready(value); await value.surface.locator('#layerCount').filter({ hasText: /^1$/ }).waitFor();
  assert.equal(value.fixture.state.reads, 1); assert.equal(value.fixture.editor.state.uploads, 1); clean(value);
});

test('a role without create/change cannot redeem an incoming image or write an asset', async t => {
  const value = await open(t, { query: { artifact: REF }, permissions: { create: false, change: false } });
  assert.equal(await value.surface.locator('#uploadImage').isDisabled(), true);
  assert.equal(value.fixture.state.reads, 0); assert.equal(value.fixture.editor.state.uploads, 0); clean(value);
});

test('typing while artifact content is held preserves the newer draft and never uploads stale bytes', async t => {
  const value = await open(t); await value.surface.locator('#autosave').uncheck();
  const held = await hold(value, `/api/artifacts/handles/${REF}/content`); await incoming(value); await held.seen;
  await value.surface.locator('#addText').click(); await value.surface.locator('#layerText').fill('Newer draft must win'); await value.surface.locator('#layerText').press('Tab');
  const latest = await snapshot(value); await held.release(); await completed(value);
  assert.deepEqual(await snapshot(value), latest); assert.equal(value.fixture.editor.state.uploads, 0);
  assert.equal(value.fixture.editor.state.successfulWrites, 0); clean(value);
});

test('opening another saved design during a held artifact read preserves that design without importing the old file', async t => {
  const value = await open(t, { seed: seed() }); const next = value.fixture.seed(seed('Second design'));
  await value.surface.locator('#autosave').uncheck();
  const held = await hold(value, `/api/artifacts/handles/${REF}/content`); await incoming(value); await held.seen;
  await value.surface.locator('#openProjects').click(); await value.surface.locator(`[data-project-id="${next.id}"]`).getByRole('button', { name: 'Open', exact: true }).click();
  await value.surface.locator('#projectDialog').waitFor({ state: 'hidden' }); await ready(value);
  const latest = await snapshot(value); assert.equal(latest.id, next.id); await held.release(); await completed(value);
  assert.deepEqual(await snapshot(value), latest); assert.equal(value.fixture.editor.state.uploads, 0); clean(value);
});

test('an already-started upload cannot attach its response to a different document opened by a later state transition', async t => {
  const value = await open(t); const held = await hold(value, '/api/create/project-assets');
  await incoming(value); await held.seen;
  await value.surface.locator('html').evaluate(async () => {
    const { openDocument, state, notify } = await import('/api/create/editor/editor-state.mjs');
    const { createProject } = await import('/api/create/editor/model.mjs');
    openDocument(createProject({ name: 'Later opened document' })); state.loading = false; notify();
  });
  const latest = await snapshot(value); await held.release(); await completed(value);
  assert.deepEqual(await snapshot(value), latest); assert.equal(value.fixture.editor.state.uploads, 1);
  assert.equal(value.fixture.editor.state.successfulWrites, 0); clean(value);
});

for (const invalid of ['oversize', 'unsupported']) test(`${invalid} source bytes leave the current draft untouched before owner upload`, async t => {
  const value = await open(t); const before = await snapshot(value);
  if (invalid === 'oversize') value.fixture.state.image = Buffer.alloc(8388609);
  else value.fixture.state.type = 'image/svg+xml';
  await incoming(value); await completed(value); await value.surface.locator('#editorError').waitFor();
  assert.deepEqual(await snapshot(value), before); assert.equal(value.fixture.editor.state.uploads, 0); clean(value);
});
