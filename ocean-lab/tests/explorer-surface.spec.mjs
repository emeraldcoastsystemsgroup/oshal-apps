/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the Explorer tile in a real headless browser over the COMPILED routes the box
 *                     |                             | mounts (routes/ocean-lab-routes.js), on the store double, with the framework's theme assets and a
 *                     |                             | signed-in identity injected. The operator's own walk: create the Explorer from the seed (concept,
 *                     |                             | eight open limits, the fabricable sentence beside the badge); evaluate (sized, five rows, 7,444
 *                     |                             | km/year); change the stop angle and save (concept, the table labelled STALE); evaluate again
 *                     |                             | (sized, a different year); evaluate in air (the refusal by its own name); record the embodied hull
 *                     |                             | drop (an embodied route double serving the captured answer) as a third run. And D5 in the
 *                     |                             | browser: a run whose fingerprints are stripped in flight is NOT drawn and the tile names the
 *                     |                             | missing field. FRAMEWORK-COUPLED: needs a core checkout with node_modules (OSHAL_CORE_ROOT or
 *                     |                             | OSHAL_CORE_DIR) for express, tsx and Playwright. Run:
 *                     |                             |   OSHAL_CORE_DIR=<core checkout> node --test tests/explorer-surface.spec.mjs
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the parts section in the browser: eleven watertight parts, the displacement
 *                     |                             | budget OPEN with its reason, the bought rows' masses and prices shown as NOT PUBLISHED, the
 *                     |                             | design document link; and "Open in CAD Studio" posts EXACTLY the body GET /parts/wing serves
 *                     |                             | (to a CAD Studio double that records it) and lands on the CAD Studio tile (a cockpit stub).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
assert.ok(CORE && fs.existsSync(path.join(CORE, 'node_modules', 'express')), 'OSHAL_CORE_ROOT or OSHAL_CORE_DIR must name a framework checkout with node_modules');
const coreRequire = createRequire(path.join(CORE, 'package.json'));
const require = createRequire(import.meta.url);

// The compiled package imports the framework logger by alias and express by bare name: stub the one, and
// resolve the other from the framework checkout only when this package asks for it (the box's loader does both).
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, ...rest) {
  try { return originalResolve.call(this, request, parent, ...rest); } catch (error) {
    if (!/^[a-z@]/.test(request) || !parent?.filename?.startsWith(PKG)) throw error;
    return coreRequire.resolve(request);
  }
};
coreRequire('tsx/cjs');
const express = coreRequire('express');
const { launchIsolatedBrowser } = coreRequire(path.join(CORE, 'tests', 'fixtures', 'isolated-browser.ts'));
const { createOceanLabRoutes } = require(path.join(PKG, 'routes', 'ocean-lab-routes.js'));
const { VehiclePoolDouble } = require(path.join(HERE, 'vehicle-pool-double.ts'));
const HULL_DROP = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'embodied-hull-drop-air.json'), 'utf8'));

let owned; let server; let origin; let pool;
const cadPosts = [];
before(async () => {
  pool = new VehiclePoolDouble();
  const app = express();
  app.use('/shared/ui', express.static(path.join(CORE, 'src', 'shared', 'ui')));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: 'browser-owner' } }; next(); });
  app.get('/api/embodied/physics/hull', (_req, res) => { res.json(HULL_DROP); });
  app.use('/api/ocean-lab', createOceanLabRoutes({ appPackageDir: PKG, pool }));
  app.post('/api/cad-studio/models', (req, res) => {
    cadPosts.push(req.body);
    res.status(201).json({ model: { model_id: 'cad-double-1', title: req.body?.title, revision: 1, state: 'built' }, build: { ok: true, ms: 1 } });
  });
  app.get('/cockpit/', (req, res) => { res.type('html').send(`<title>cockpit stub</title><p id="cockpit-stub">${req.originalUrl}</p>`); });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  owned = await launchIsolatedBrowser();
}, { timeout: 120000 });
after(async () => {
  await owned?.browser.close();
  await owned?.close();
  await new Promise((resolve) => server.close(resolve));
}, { timeout: 120000 });

/** A fresh page on the fixture, with every non-fixture request refused. @param {(ctx: any) => Promise<void>} [routes] Extra interception. */
async function openPage(routes) {
  const context = await owned.browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()));
  if (routes) await routes(context);
  const page = await context.newPage();
  await page.goto(`${origin}/api/ocean-lab/explorer`);
  return { context, page };
}

/** Wait until the status line says a step finished. */
const settled = (page, pattern) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), pattern.source, { timeout: 20000 });
const text = (page, selector) => page.locator(selector).textContent();

test('the operator\'s walk: create, evaluate, change the stop angle, re-evaluate, refuse air by name, record the hull drop', { timeout: 120000 }, async () => {
  const { context, page } = await openPage();
  try {
    await page.locator('#create-explorer').waitFor({ timeout: 15000 });
    await page.click('#create-explorer');
    await settled(page, /created at concept/);
    assert.equal(await text(page, '#stage-badge'), 'concept');
    assert.match(await text(page, '#fabricable'), /does not mean the machine is safe to build, fly or wet/);
    assert.equal(await text(page, '#limit-count'), '8');
    assert.match(await text(page, '#table-note'), /Not evaluated yet/);

    await page.click('#evaluate');
    await settled(page, /Evaluated in seawater/);
    assert.equal(await text(page, '#stage-badge'), 'sized');
    assert.equal(await page.locator('#sea-table tbody tr').count(), 5);
    assert.equal(await page.locator('[data-figure="km/year"]').textContent(), '7,444');
    assert.match(await text(page, '#fabricable'), /files are complete and self-consistent/);

    await page.fill('#stop-angle', '25');
    await page.click('#save-design');
    await settled(page, /Saved/);
    assert.equal(await text(page, '#stage-badge'), 'concept');
    assert.match(await text(page, '#table-note'), /STALE/);

    await page.click('#evaluate');
    await settled(page, /Evaluated in seawater/);
    assert.equal(await text(page, '#stage-badge'), 'sized');
    assert.notEqual(await page.locator('[data-figure="km/year"]').textContent(), '7,444', 'the year moved with the stop angle');

    await page.click('#evaluate-air');
    await settled(page, /refused by name/);
    assert.match(await text(page, '#medium-refusal'), /medium_property_unavailable: freeSurface/);

    await page.click('#record-hull-drop');
    await settled(page, /hull drop is recorded/);
    const rows = await page.locator('#runs tbody tr').allTextContents();
    assert.equal(rows.length, 3);
    assert.match(rows[2], /air.*embodied:analytic.*embodied 0\.16\.3.*fell 2\.00 m/);
  } finally { await context.close(); }
});

test('a run whose fingerprints are stripped in flight is NOT drawn, and the tile names the missing field', { timeout: 120000 }, async () => {
  const strip = async (context) => {
    await context.route(/\/api\/ocean-lab\/vehicles\/[0-9a-f-]{36}$/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.runs?.length) delete body.runs[0].engineFingerprints.routesBuildHash;
      await route.fulfill({ response, json: body });
    });
  };
  const { context, page } = await openPage(strip);
  try {
    await settled(page, /Record loaded/);
    const rows = await page.locator('#runs tbody tr').allTextContents();
    assert.equal(rows.length, (await pool.runs.length) - 1, 'every stored run but the stripped one is drawn');
    assert.ok(!(await page.locator('#runs tbody tr[data-run="1"]').count()), 'run 1 is not drawn');
    assert.match(await text(page, '#runs-withheld'), /run 1 \(missing engine\.routesBuildHash\)/);
  } finally { await context.close(); }
});

test('the parts section: eleven parts, the budget OPEN, not-published rows, and Open in CAD Studio posts the exact part body', { timeout: 120000 }, async () => {
  const { context, page } = await openPage();
  try {
    await settled(page, /Record loaded/);
    await page.waitForFunction(() => /11 watertight parts/.test(document.getElementById('parts-count').textContent), null, { timeout: 20000 });
    assert.equal(await text(page, '#budget-badge'), 'budget open');
    assert.match(await text(page, '#budget-why'), /an unknown is never read as zero/);
    assert.equal(await page.locator('#printed-parts tbody tr').count(), 5);
    assert.match(await text(page, '#bought-parts tbody tr[data-part="solar-panel"]'), /not published.*not published/);
    assert.equal(await page.locator('#parts-problems li').count(), 3);
    assert.match(await page.locator('#design-md').getAttribute('href'), /\/api\/ocean-lab\/vehicles\/[0-9a-f-]{36}\/design\.md$/);
    assert.match(await text(page, '#fabricable'), /does not mean the machine is safe to build, fly or wet/);
    await page.locator('#printed-parts tbody tr[data-part="wing"]').getByRole('button', { name: 'Open in CAD Studio' }).click();
    await page.waitForURL('**/cockpit/?app=cad-studio', { timeout: 15000 });
    assert.match(await text(page, '#cockpit-stub'), /app=cad-studio/);
    const vehicleId = pool.vehicles.find((v) => v.owner_sub === 'browser-owner').vehicle_id;
    const served = await (await fetch(`${origin}/api/ocean-lab/vehicles/${vehicleId}/parts/wing`)).json();
    assert.equal(cadPosts.length, 1);
    assert.deepEqual(cadPosts[0], served.cadStudio, 'the tile posts exactly the body the route serves');
  } finally { await context.close(); }
});
