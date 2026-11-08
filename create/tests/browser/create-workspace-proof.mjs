/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual Home/New layout, keyboard navigation, owning-catalog handoffs and narrow viewports using only synthetic read-only HTTP.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the single added 3D scan starter in the existing clear-filter and catalog totals.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include the distinct layered-image starter while retaining exact filter/navigation behavior.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Verify the complete restored catalog with distinct editable templates and blank image design entries.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Include the single added Edit video starter and card (CREATE-EDIT-05d) in the existing clear-filter and catalog totals.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Include the single added Brand intro clip starter and card in the existing clear-filter and catalog totals.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (create--create-home, create--create-new): Home opens on picture cards newest first with meta in words, a real render of a saved image, skeletons while a studio answers, a tap that opens and a ⋯ with greyed planned rows; one 52px New at the bottom right opens the merged New sheet (Blank row first with real blank starts, greyed Custom size and Import, templates with 44px format chips and "No templates match" + Clear); search sits in the app row (an icon on a phone); /api/create/new forwards to Home with New open; Back closes the sheet. Light-blue screenshots at 412x915 and 1440x900 when CREATE_WORKSPACE_SCREENSHOT_DIR is set.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | The Blank row's image start is two sized blanks, Image 1080 × 1080 and 1920 × 1080.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Prove live Rename, Duplicate and in-page confirmed Delete on Home work cards (RP-CRE-01), Custom size 16..8192 px in the Blank row (RP-CRE-02), and file-to-design import for SVG, PDF and Office (RP-CRE-03).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, startFixture } from './create-theme-fixture.mjs';

const PROJECT = '00000000-0000-4000-8000-0000000000c1';
const ago = days => new Date(Date.now() - days * 864e5 - 36e5).toISOString();
const kinds = [['pptx', 'Presentation'], ['docx', 'Document'], ['xlsx', 'Spreadsheet']].map(([id, name]) =>
  ({ id, name, noun: name.toLowerCase(), opens: 'AI Office', groups: [{ id: 'work', label: 'Work' }] }));
const starters = [['pitch', 'pptx', 'Launch presentation'], ['resume', 'docx', 'Resume'], ['budget', 'xlsx', 'Budget']].map(([id, kind, name]) =>
  ({ id, kind, name, group: 'work', desc: `A synthetic ${name.toLowerCase()} for local layout checks.`, theme: 'clean', outline: 'Overview\nA local fixture\n\nNext steps\nNo provider calls' }));
const imageDocument = { version: 1, name: 'Synthetic rocket', width: 1080, height: 1080, background: '#1e3a8a',
  layers: [{ id: 'sun', type: 'rect', name: 'Sun', x: 300, y: 300, w: 480, h: 480, fill: '#fbbf24' }], images: {} };
const summaries = {
  '/api/create/home-summary': { items: [{ text: 'Synthetic rocket', detail: `Layered image · updated ${ago(2)}`, actions: [{ tool: 'create-editor', query: `project=${PROJECT}` }] }], metrics: [{ label: 'Image projects', value: '1' }] },
  '/api/cad-studio/home-summary': { items: [{ text: 'lift-1 · Carriage', detail: `built / revision 1 / ${ago(6)}`, actions: [{ integration: 'prepare-document' }] }], metrics: [] },
  '/api/scan-to-print/home-summary': { items: [{ text: 'sweep4-box', detail: `reconstructed / photos / ${ago(8)}`, actions: [{ integration: 'prepare-document' }] }], metrics: [] },
  '/api/presentations/home-summary': { items: [{ text: 'The Water Cycle', detail: `Saved pptx document · ${ago(3)} · oshal-local`, actions: [{ integration: 'prepare-campaign' }] },
    { text: 'Counts are saved document records.', tone: 'neutral' }], metrics: [{ label: 'Documents saved / 5d', value: '1' }] },
};
let fixture, browser, brandKit = null;

/** Every response is local fixture data; policy refusal and provider unavailability remain visible. */
function respond(path, query) {
  if (path === '/api/presentations/sections/starters') return { kinds, starters };
  if (path === '/api/authorization/me' && query.app === 'lora') return { status: 'catalog', tier: 'deny', denied: true };
  if (path === '/api/create/brand-kit') return { kit: brandKit };
  if (path === `/api/create/projects/${PROJECT}`) return { project: { id: PROJECT, title: 'Synthetic rocket', document: imageDocument } };
  if (path === '/api/video/home-summary') return { status: 503, body: { error: 'fixture_unavailable' } };
  if (path.endsWith('/home-summary')) return summaries[path] || { items: [], metrics: [] };
}

before(async () => { fixture = await startFixture({ respond }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await fixture?.close(); });

const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
/** Use actual page scripts and parent theme code, with no external requests or desktop browser. */
async function open(t, { device = DESKTOP, embedded = true, path = 'home', theme = 'light-blue', hold } = {}) {
  const context = await browser.newContext({ ...device, reducedMotion: 'reduce' });
  t.after(() => context.close());
  await context.addInitScript(value => localStorage.setItem('cockpit-theme', value), theme);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.origin) return route.abort();
    if (hold && url.pathname === hold.path) await hold.promise;
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  await page.goto(`${fixture.origin}/${embedded ? 'fixture' : 'api/create'}/${path}`);
  const surface = embedded ? page.frameLocator('iframe') : page;
  await surface.locator('#newBtn').waitFor();
  return { page, surface };
}
const settled = surface => surface.locator('#recentGrid[aria-busy="false"]').waitFor();
const messages = page => page.evaluate(() => window.navigationMessages);
/** postMessage is asynchronous: wait until the parent recorded n navigations, then read them. */
async function sent(page, n) { await page.waitForFunction(count => window.navigationMessages.length >= count, n); return messages(page); }
/** Screenshots are opt-in artifacts containing only the synthetic fixture records. */
async function capture(page, name) {
  if (!process.env.CREATE_WORKSPACE_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATE_WORKSPACE_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(process.env.CREATE_WORKSPACE_SCREENSHOT_DIR, `${name}.png`) });
}
async function overflow(surface) {
  return surface.locator('html').evaluate(() => ({ page: document.documentElement.scrollWidth, width: innerWidth }));
}

test('Home opens on your work: picture cards newest first, meta in words, one New at the bottom right', async t => {
  const { page, surface } = await open(t);
  await settled(surface);
  assert.deepEqual(await surface.locator('#recentGrid .wcard .title').allTextContents(), ['Synthetic rocket', 'The Water Cycle', 'lift-1 · Carriage', 'sweep4-box']);
  assert.deepEqual(await surface.locator('#recentGrid .wcard .meta').allTextContents(), ['Image editor · 2 days ago', 'AI Office · 3 days ago', 'CAD Studio · 6 days ago', '3D Scan-to-Print · ' + new Date(Date.parse(ago(8))).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })]);
  assert.deepEqual(await surface.locator('#recentGrid .wcard .state').allTextContents(), ['Layered image', 'Saved PowerPoint', 'Built · revision 1', 'Reconstructed from photos']);
  assert.doesNotMatch(await surface.locator('#recentGrid').innerText(), /\s\/\s|\/$|oshal-local|pptx/m, 'no raw slash strings or provider ids');
  await surface.locator('#recentGrid .wcard').first().locator('canvas.render').waitFor();
  assert.equal(await surface.locator('#recentGrid .wcard .thumb').count(), 4, 'every card is a picture card');
  for (const gone of ['.seg', '#studioGrid', '#starterTiles', '.hero', '#seeAll']) assert.equal(await surface.locator(gone).count(), 0, `${gone} is gone`);
  const first = await surface.locator('#recentGrid .wcard').first().boundingBox();
  assert.ok(first.y < 260, 'the work starts on the first screen');
  const fab = await surface.locator('#newBtn').boundingBox(), frame = await page.locator('iframe').boundingBox();
  assert.equal(Math.round(fab.height), 52);
  assert.ok(frame.x + frame.width - (fab.x + fab.width) <= 24 && frame.y + frame.height - (fab.y + fab.height) <= 140, 'New sits at the bottom right');
  assert.equal((await surface.locator('#newBtn').textContent()).trim(), 'New');
  await capture(page, 'create-home-light-blue-desktop');
});

test('skeleton pictures hold the grid while a studio is still answering', async t => {
  let release; const promise = new Promise(done => { release = done; });
  const { surface } = await open(t, { hold: { path: '/api/cad-studio/home-summary', promise } });
  await surface.locator('#recentGrid .wcard .title').filter({ hasText: 'Synthetic rocket' }).waitFor();
  assert.ok(await surface.locator('#recentGrid .skel').count() >= 2, 'skeletons while CAD answers');
  assert.equal(await surface.locator('#recentGrid').getAttribute('aria-busy'), 'true');
  release(); await settled(surface);
  assert.equal(await surface.locator('#recentGrid .skel').count(), 0);
});

test('a tap on a card opens it; its ⋯ executes owner-scoped Rename, Duplicate and confirmed Delete (RP-CRE-01)', async t => {
  const COPY_ID = '00000000-0000-4000-8000-0000000000c2';
  const CAD_ID = '00000000-0000-4000-8000-0000000000d1';
  const store = new Map([
    [PROJECT, { id: PROJECT, title: 'Synthetic rocket', revision: 1, updatedAt: ago(2), document: structuredClone(imageDocument) }],
  ]);
  const cadModels = new Map([[CAD_ID, { modelId: CAD_ID, title: 'lift-1 · Carriage', revision: 1, updatedAt: ago(6), base: { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 20 }, features: [], source: {}, settings: {} }]]);
  const local = await startFixture({
    respond(path, query) {
      if (path === '/api/create/home-summary') {
        const items = [...store.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .map(p => ({ text: p.title, detail: `Layered image · updated ${p.updatedAt}`, actions: [{ tool: 'create-editor', query: `project=${p.id}` }] }));
        return { items, metrics: [{ label: 'Image projects', value: String(items.length) }] };
      }
      if (path === '/api/cad-studio/home-summary') {
        const items = [...cadModels.values()].map(m => ({ text: m.title, detail: `built / revision ${m.revision} / ${m.updatedAt}`, actions: [{ integration: 'prepare-document' }] }));
        return { items, metrics: [] };
      }
      if (path === '/api/cad-studio/models') return { models: [...cadModels.values()] };
      if (path.startsWith('/api/cad-studio/models/')) {
        const m = cadModels.get(path.split('/').pop());
        return m ? { model: m } : { status: 404, body: { error: 'model_not_found' } };
      }
      if (path.startsWith('/api/create/projects/')) {
        const p = store.get(path.split('/').pop());
        return p ? { project: p } : { status: 404, body: { error: 'project_not_found' } };
      }
      return respond(path, query);
    },
    mutate(req, res) {
      if (req.method === 'POST' && req.path === `/api/create/projects/${PROJECT}/revisions`) {
        const p = store.get(PROJECT);
        p.title = req.body.title; p.revision += 1; p.document = req.body.document; p.updatedAt = ago(0);
        return res.json({ project: p });
      }
      if (req.method === 'POST' && req.path === '/api/create/projects') {
        const copy = { id: COPY_ID, title: req.body.title, revision: 1, updatedAt: ago(0), document: req.body.document };
        store.set(COPY_ID, copy);
        return res.status(201).json({ project: copy });
      }
      if (req.method === 'DELETE' && req.path.startsWith('/api/create/projects/')) {
        const id = req.path.split('/').pop();
        store.delete(id);
        return res.json({ deleted: id });
      }
      if (req.method === 'PATCH' && req.path === `/api/cad-studio/models/${CAD_ID}`) {
        const m = cadModels.get(CAD_ID); m.title = req.body.title;
        return res.json({ model: m });
      }
      return res.status(404).json({ error: 'unexpected_mutation' });
    },
  });
  const context = await browser.newContext({ ...DESKTOP, reducedMotion: 'reduce' });
  t.after(async () => { await context.close(); await local.close(); });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  await page.goto(`${local.origin}/fixture/home`);
  const surface = page.frameLocator('iframe');
  await surface.locator('#newBtn').waitFor();
  await settled(surface);

  await surface.locator('#recentGrid .wcard').first().locator('.wopen').click();
  assert.deepEqual(await sent(page, 1), [{ type: 'app-navigate', tool: 'create-editor', query: `project=${PROJECT}` }]);

  await surface.locator('#recentGrid .wcard').first().locator('.more').click();
  const menu = surface.locator('#cardMenu');
  await menu.locator('button').first().waitFor();
  assert.equal(await menu.locator('[data-ds-not-yet]').count(), 0, 'no planned placeholders remain');
  assert.deepEqual(await menu.locator('button').allTextContents(), ['Open in Image editor', 'Rename', 'Duplicate', 'Delete']);
  await capture(page, 'create-home-card-menu-light-blue-desktop');

  // Rename (RP-CRE-01)
  await menu.locator('button', { hasText: 'Rename' }).click();
  await surface.locator('#renameDialog[open]').waitFor();
  await surface.locator('#renameInput').fill('Renamed rocket');
  await surface.locator('#renameSave').click();
  await surface.locator('#renameDialog:not([open])').waitFor({ state: 'attached' });
  await surface.locator('#recentGrid .wcard .title').filter({ hasText: 'Renamed rocket' }).waitFor();
  assert.equal(store.get(PROJECT).title, 'Renamed rocket', 'studio record updated');

  // Duplicate (RP-CRE-01)
  await surface.locator('#recentGrid .wcard').first().locator('.more').click();
  await menu.locator('button', { hasText: 'Duplicate' }).click();
  await surface.locator('#recentGrid .wcard .title').filter({ hasText: 'Renamed rocket (copy)' }).waitFor();
  assert.equal(store.has(COPY_ID), true, 'duplicate project stored');

  // Delete with in-page confirmation (RP-CRE-01)
  const copyCard = surface.locator('#recentGrid .wcard').filter({ hasText: 'Renamed rocket (copy)' });
  await copyCard.locator('.more').click();
  await menu.locator('button', { hasText: 'Delete' }).click();
  await surface.locator('#deleteDialog[open]').waitFor();
  await surface.locator('#deleteCancel').click();
  assert.equal(await copyCard.count(), 1, 'cancelling keeps the card');
  await copyCard.locator('.more').click();
  await menu.locator('button', { hasText: 'Delete' }).click();
  await surface.locator('#deleteDialog[open]').waitFor();
  await surface.locator('#deleteConfirm').click();
  await surface.locator('#deleteDialog:not([open])').waitFor({ state: 'attached' });
  await page.waitForFunction(() => !Array.from(document.querySelector('iframe').contentDocument.querySelectorAll('#recentGrid .wcard .title')).some(n => n.textContent === 'Renamed rocket (copy)'));
  assert.equal(store.has(COPY_ID), false, 'deleted from owning studio');

  // Member studio Rename (CAD Studio)
  const cadCard = surface.locator('#recentGrid .wcard').filter({ hasText: 'lift-1 · Carriage' });
  await cadCard.locator('.more').click();
  await menu.locator('button', { hasText: 'Rename' }).click();
  await surface.locator('#renameDialog[open]').waitFor();
  await surface.locator('#renameInput').fill('lift-2 · Bracket');
  await surface.locator('#renameSave').click();
  await surface.locator('#recentGrid .wcard .title').filter({ hasText: 'lift-2 · Bracket' }).waitFor();
  assert.equal(cadModels.get(CAD_ID).title, 'lift-2 · Bracket');
});

test('New opens one sheet: Blank row with live Custom size (RP-CRE-02) and file-to-design Import (RP-CRE-03)', async t => {
  const IMPORTED_SVG = '00000000-0000-4000-8000-0000000000e1';
  const IMPORTED_PDF = '00000000-0000-4000-8000-0000000000e2';
  const IMPORTED_PPTX = '00000000-0000-4000-8000-0000000000e3';
  const local = await startFixture({
    respond,
    mutate(req, res) {
      if (req.method === 'POST' && req.path === '/api/create/projects') {
        return res.status(201).json({ project: { id: IMPORTED_SVG, title: req.body.title, revision: 1, document: req.body.document } });
      }
      if (req.method === 'POST' && req.path === '/api/pdf-workbench/sources/upload') {
        return res.status(201).json({ source: { id: '00000000-0000-4000-8000-0000000000f1' } });
      }
      if (req.method === 'POST' && req.path === '/api/pdf-workbench/documents') {
        return res.status(201).json({ document: { id: IMPORTED_PDF, title: req.body.title, revision: 1 } });
      }
      if (req.method === 'POST' && req.path === '/api/presentations/editor/import/inspect') {
        return res.json({ sha256: 'a'.repeat(64), requiresConversion: true, findings: [{ message: 'Animations are simplified into static slides.' }] });
      }
      if (req.method === 'POST' && req.path === '/api/presentations/editor/import') {
        assert.equal(req.body.acceptConversion, true);
        return res.status(201).json({ document: { id: IMPORTED_PPTX, title: 'Launch deck', kind: 'pptx', currentRevision: 1 } });
      }
      return res.status(404).json({ error: 'unexpected_mutation' });
    },
  });
  const context = await browser.newContext({ ...DESKTOP, reducedMotion: 'reduce' });
  t.after(async () => { await context.close(); await local.close(); });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  await page.goto(`${local.origin}/fixture/home`);
  const surface = page.frameLocator('iframe');
  await surface.locator('#newBtn').waitFor();

  await surface.locator('#newBtn').click();
  const sheet = surface.locator('#newSheet[open]'); await sheet.waitFor();
  assert.deepEqual(await sheet.locator('h3').allTextContents(), ['Start blank', 'Templates']);
  assert.deepEqual(await sheet.locator('#blankRow .blank b').allTextContents(), ['Image', 'Image', 'Presentation', 'Document', 'Spreadsheet', 'Video', 'Portrait', 'Story', '3D scan', 'Custom size']);
  assert.deepEqual(await sheet.locator('#blankRow .blank .hint').evaluateAll(n => n.slice(0, 2).map(x => x.textContent)), ['1080 × 1080', '1920 × 1080']);
  assert.equal(await sheet.locator('[data-ds-not-yet]').count(), 0, 'Custom size and Import are live');
  await capture(page, 'create-new-sheet-light-blue-desktop');

  // Custom size validation + navigation (RP-CRE-02)
  await sheet.locator('#blankRow [data-blank="custom"]').click();
  await sheet.locator('#customSizeForm:not([hidden])').waitFor();
  await sheet.locator('#customWidth').fill('12');
  await sheet.locator('#customHeight').fill('9000');
  await sheet.locator('#customSizeGo').click();
  assert.match(await sheet.locator('#customSizeError:not([hidden])').textContent(), /16 and 8192/);
  assert.deepEqual(await messages(page), [], 'invalid custom size does not navigate');
  await sheet.locator('#customWidth').fill('1200');
  await sheet.locator('#customHeight').fill('628');
  await sheet.locator('#customSizeGo').click();
  assert.deepEqual(await sent(page, 1), [{ type: 'app-navigate', tool: 'create-editor', query: 'size=1200x628' }]);
  assert.equal(await surface.locator('#newSheet[open]').count(), 0, 'the sheet closes as the studio opens');

  // Import SVG -> Image editor (RP-CRE-03)
  await surface.locator('#newBtn').click();
  await sheet.waitFor();
  await sheet.locator('#importInput').setInputFiles({
    name: 'badge.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="10" y="10" width="180" height="80" fill="#7c3aed"/></svg>'),
  });
  assert.deepEqual((await sent(page, 2))[1], { type: 'app-navigate', tool: 'create-editor', query: `project=${IMPORTED_SVG}` });

  // Import PDF -> PDF Workbench (RP-CRE-03)
  await surface.locator('#newBtn').click();
  await sheet.waitFor();
  await sheet.locator('#importInput').setInputFiles({
    name: 'handbook.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  });
  assert.deepEqual((await sent(page, 3))[2], { type: 'app-navigate', tool: 'create-pdf-workbench', query: `document=${IMPORTED_PDF}` });

  // Import PPTX with conversion review -> AI Office (RP-CRE-03)
  await surface.locator('#newBtn').click();
  await sheet.waitFor();
  await sheet.locator('#importInput').setInputFiles({
    name: 'launch.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from('PK\x03\x04synthetic-pptx-bytes'),
  });
  await sheet.locator('#importReviewActions:not([hidden])').waitFor();
  assert.match(await sheet.locator('#importFindings').textContent(), /Animations are simplified/);
  await sheet.locator('#importAccept').click();
  assert.deepEqual((await sent(page, 4))[3], { type: 'app-navigate', tool: 'create-office', query: `document=${IMPORTED_PPTX}` });
});

test('templates: image designs first, one row of 44px format chips, search, and "No templates match" with Clear', async t => {
  const { page, surface } = await open(t);
  await surface.locator('#newBtn').click();
  const sheet = surface.locator('#newSheet[open]'); await sheet.locator('#sections .card .name').filter({ hasText: 'Budget' }).waitFor();
  assert.equal(await sheet.locator('#sections .card .name').first().textContent(), 'Image templates', 'image designs before office formats');
  const chips = await sheet.locator('#cats button').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { h: r.height, top: r.top }; }));
  assert.ok(chips.length === 10 && chips.every(c => c.h >= 44 && c.top === chips[0].top), 'ten 44px chips in one row');
  await sheet.locator('#cats button[data-cat="xlsx"]').click();
  assert.equal(await sheet.locator('#cats button[data-cat="xlsx"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await sheet.locator('#sections .card .name').allTextContents(), ['Budget']);
  await sheet.locator('#tq').fill('no such synthetic thing');
  assert.equal(await sheet.locator('.nomatch b').textContent(), 'No templates match');
  await sheet.locator('#tplReset').click();
  assert.equal(await sheet.locator('#cats button[data-cat="foryou"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await sheet.locator('#sections .card').count() > 10);
  await sheet.locator('#tq').fill('Budget'); await sheet.locator('#tq').press('Enter');
  assert.deepEqual(await sent(page, 1), [{ type: 'app-navigate', tool: 'create-office', query: 'kind=xlsx&starter=budget&theme=clean' }]);
});

test('Home search in the app row covers work and templates and counts "1 match" / "2 matches"', async t => {
  const { surface } = await open(t);
  await settled(surface);
  await surface.locator('#q').fill('Carriage');
  assert.equal(await surface.locator('#filterStatus span').textContent(), '1 match');
  assert.equal(await surface.locator('#recentGrid .wcard:not(.hidden)').count(), 1);
  await surface.locator('#q').fill('Budget');
  assert.equal(await surface.locator('#filterStatus span').textContent(), '1 match');
  assert.deepEqual(await surface.locator('#templateHits:not([hidden]) .card .name').allTextContents(), ['Budget']);
  await surface.locator('#q').fill('sweep4');
  assert.equal(await surface.locator('#filterStatus span').textContent(), '1 match');
  await surface.locator('#q').fill('synthetic');
  assert.match(await surface.locator('#filterStatus span').textContent(), /^\d+ matches$/);
  await surface.locator('#q').fill('no such synthetic thing');
  assert.equal(await surface.locator('#filterStatus span').textContent(), 'No matches.');
  await surface.locator('#filterStatus .link').click();
  assert.equal(await surface.locator('#q').inputValue(), '');
  assert.equal(await surface.locator('#recentGrid .wcard:not(.hidden)').count(), 4);
});

test('phone: work in two columns, search behind an icon, New opens a full sheet that Back closes', async t => {
  const { page, surface } = await open(t, { device: PHONE });
  await settled(surface);
  assert.equal(await surface.locator('#q').isVisible(), false, 'search waits behind its icon');
  const cols = await surface.locator('#recentGrid .wcard').evaluateAll(nodes => new Set(nodes.map(n => Math.round(n.getBoundingClientRect().left))).size);
  assert.equal(cols, 2, 'two columns');
  assert.equal(Math.round((await surface.locator('#newBtn').boundingBox()).height), 52);
  const ov = await overflow(surface); assert.ok(ov.page <= ov.width + 1, 'no sideways page');
  await capture(page, 'create-home-light-blue-phone');
  await surface.locator('#searchToggle').tap();
  assert.equal(await surface.locator('#q').isVisible(), true);
  await surface.locator('#searchToggle').tap();
  await surface.locator('#newBtn').tap();
  const sheet = surface.locator('#newSheet[open]'); await sheet.waitFor();
  const box = await sheet.boundingBox();
  assert.ok(box.width >= 410 && box.y < 40, 'a full-width sheet from the top bar down');
  assert.ok(await sheet.locator('#blankRow .blank').first().isVisible(), 'the Blank row is on the first screen');
  await capture(page, 'create-new-sheet-light-blue-phone');
  await page.evaluate(() => history.back());   // the phone's Back: the joint history pops New's entry
  await surface.locator('#newSheet:not([open])').waitFor({ state: 'attached' });
  assert.equal(await surface.locator('#newSheet[open]').count(), 0, 'Back closes New and stays on Home');
  assert.equal(await surface.locator('#recentGrid .wcard').count(), 4);
});

test('the old New address lands on Home with New open and keeps its format', async t => {
  const { page } = await open(t, { embedded: false, path: 'new?cat=xlsx' });
  await page.waitForURL(`${fixture.origin}/api/create/home`);
  await page.locator('#newSheet[open]').waitFor();
  assert.equal(await page.locator('#cats button[data-cat="xlsx"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('h1').count(), 1);
});

test('Set up your brand is one 44px row only while no kit exists', async t => {
  brandKit = null;
  const empty = await open(t);
  const row = empty.surface.locator('#brandBand:not([hidden])'); await row.waitFor();
  const box = await row.boundingBox(); assert.ok(box.height >= 44 && box.height <= 52, 'one 44px row');
  const work = await empty.surface.locator('#recentGrid').boundingBox(); assert.ok(box.y < work.y, 'above the work');
  brandKit = { name: 'Synthetic brand', colors: {}, fonts: {} };
  const saved = await open(t); await settled(saved.surface); await saved.page.waitForTimeout(150);
  assert.equal(await saved.surface.locator('#brandBand').isHidden(), true);
  brandKit = null;
});

test('locked studios do not navigate or probe and unavailable summaries never masquerade as zero work', async t => {
  const { page, surface } = await open(t);
  await settled(surface);
  assert.equal(fixture.requests.some(request => request.path === '/api/lora/home-summary'), false);
  assert.match(await surface.locator('#weekNote').innerText(), /Can't check: Video Studio/);
  await surface.locator('#newBtn').click();
  await surface.locator('#cats button[data-cat="training"]').click();
  const locked = surface.locator('#sections .card').filter({ hasText: 'LoRA character' });
  assert.equal(await locked.getAttribute('aria-disabled'), 'true');
  await locked.click({ force: true }); await page.waitForTimeout(150);
  assert.deepEqual(await messages(page), []);
  assert.deepEqual(fixture.requests.filter(request => !['GET', 'HEAD'].includes(request.method)), []);
});

for (const width of [320, 412, 768, 1440]) test(`Home and the New sheet stay inside a ${width}px viewport`, async t => {
  const { surface } = await open(t, { device: { viewport: { width, height: 900 } } });
  await settled(surface);
  let ov = await overflow(surface); assert.ok(ov.page <= ov.width + 1, `home overflow ${ov.page}/${ov.width}`);
  await surface.locator('#newBtn').click(); await surface.locator('#newSheet[open]').waitFor();
  ov = await overflow(surface); assert.ok(ov.page <= ov.width + 1, `sheet overflow ${ov.page}/${ov.width}`);
  const sheet = await surface.locator('#newSheet').boundingBox(); assert.ok(sheet.x >= -1 && sheet.x + sheet.width <= width + 1);
});

test('unavailable AI Office templates keep all three blank Office starts, and Blank opens the real editor URL', async t => {
  const local = await startFixture({ respond: path => path === '/api/presentations/sections/starters'
    ? { status: 403, body: { error: 'fixture_generation_access_denied' } } : undefined });
  const context = await browser.newContext(PHONE);
  t.after(async () => { await context.close(); await local.close(); });
  const page = await context.newPage();
  await page.goto(local.origin + '/api/create/home?new=1');
  for (const label of ['presentation', 'document', 'spreadsheet']) {
    const card = page.getByRole('button', { name: new RegExp('^Blank ' + label + ' — opens AI Office$') });
    await card.waitFor(); assert.equal(await card.getAttribute('aria-disabled'), null);
  }
  await page.getByRole('button', { name: /^Blank document — opens AI Office$/ }).tap();
  await page.waitForURL(local.origin + '/api/presentations/editor/app?kind=docx');
  assert.deepEqual(local.requests.filter(request => !['GET', 'HEAD'].includes(request.method)), []);
});
