/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Prove every store page (each package ships tests/audience-view.fixture.cjs; nothing is listed here, so packages never edit a shared table) that provides an audience view (ADR-164 D6) in headless Chromium: the real page file served at its declared URL, the real shared kit from a core checkout, synthetic read-only data for the page's own routes, no provider calls and no writes. Each audience must paint from the kit (root, stats, sections, escape to the cockpit), the full UI must stay hidden, and without an audience the full page must run untouched.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | A package fixture may export one entry or an array of entries, one per page that provides views: Shopping serves views on two pages (the dashboard, which the Home preset opens, and the concierge chat page, its first surface, which the shells frame), and the one-entry contract could prove only one of them. A single entry is read exactly as before; entries of one package keep their fixture order.
 * -----------------------------------------------------------------------------
 *
 * Usage: node scripts/audience-views.browser.cjs            (all pages)
 *        node scripts/audience-views.browser.cjs home        (one package)
 *        SHOTS=<dir> ...                                       (also save a screenshot per view)
 * Needs a core checkout with express + playwright + js-yaml: OSHAL_FRAMEWORK, OSHAL_ROOT or ../oshal.
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const store = path.resolve(__dirname, '..');
const core = [process.env.OSHAL_FRAMEWORK, process.env.OSHAL_ROOT, path.resolve(store, '../oshal')].find(p => p && fs.existsSync(path.join(p, 'node_modules', 'playwright')));
if (!core) { console.error('audience-views: no core checkout with playwright (set OSHAL_FRAMEWORK)'); process.exit(2); }
const express = require(path.join(core, 'node_modules/express'));
const yaml = require(path.join(core, 'node_modules/js-yaml'));
const { chromium } = require(path.join(core, 'node_modules/playwright'));

const iso = h => new Date(Date.now() + h * 36e5).toISOString();
/** One entry per page that provides audience views: each package ships tests/audience-view.fixture.cjs (page, declared URL, synthetic reads, expectations), exporting one entry or an array of them (a package with views on several pages). */
const PAGES = fs.readdirSync(store, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(store, d.name, 'tests', 'audience-view.fixture.cjs')))
  .flatMap(d => [].concat(require(path.join(store, d.name, 'tests', 'audience-view.fixture.cjs'))({ iso }))).sort((a, b) => a.app.localeCompare(b.app));

function serve(entry) {
  const app = express(); const writes = []; const reads = [];
  app.use((req, res, next) => { if (req.method !== 'GET') { writes.push(req.method + ' ' + req.path); return res.status(405).end(); } next(); });
  app.get(entry.url, (_req, res) => res.sendFile(path.join(store, entry.file)));
  for (const extra of entry.assets || []) app.get(extra.url, (_req, res) => res.sendFile(path.join(store, extra.file)));
  for (const [route, body] of Object.entries(entry.reads)) app.get(route, (req, res) => { reads.push(req.path); res.json(typeof body === 'function' ? body(req) : body); });
  app.use('/cockpit', express.static(path.join(core, 'src/pages/cockpit')));
  app.use('/shared/ui', express.static(path.join(core, 'src/shared/ui')));
  app.get('/cockpit/', (req, res) => res.type('html').send('<!doctype html><title>Synthetic cockpit</title><h1>Cockpit ' + String(req.query.app || '') + '</h1>'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Synthetic endpoint unavailable' }));
  return new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve({ server, writes, reads, origin: 'http://127.0.0.1:' + server.address().port })); });
}

async function checkAudience(page, entry, audience, expect, origin) {
  const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(origin + entry.url + (entry.url.includes('?') ? '&' : '?') + 'audience=' + audience);
  await page.waitForSelector('#av-root[data-audience="' + audience + '"]:not(.is-loading)', { timeout: 20000 });
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-audience')), audience, entry.app + ': html carries the audience');
  assert.equal(await page.locator('#av-root.is-error').count(), 0, entry.app + '/' + audience + ': painted, not the failure notice: ' + (await page.locator('#av-root').innerText()).slice(0, 200));
  assert.equal(await page.locator('.av-stat').count(), expect.stats, entry.app + '/' + audience + ': stat count');
  for (const id of expect.sections) assert.equal(await page.locator('[data-section="' + id + '"]').count(), 1, entry.app + '/' + audience + ': section ' + id);
  // textContent, not innerText: the kit upper-cases kickers and section titles through CSS, and the expectation names the model text.
  const text = (await page.locator('#av-root').textContent() || '').replace(/\s+/g, ' ');
  for (const t of expect.text) assert.ok(text.includes(t), entry.app + '/' + audience + ': text "' + t + '" missing in: ' + text.slice(0, 400));
  for (const [id, value] of Object.entries(expect.statValues || {})) assert.equal(await page.locator('[data-stat="' + id + '"] .av-stat-value').innerText(), value, entry.app + '/' + audience + ': stat ' + id);
  assert.equal(await page.locator('.av-escape-link').getAttribute('href'), '/cockpit/?app=' + entry.app, entry.app + ': escape to the cockpit entry');
  const hidden = await page.evaluate(() => Array.from(document.body.children).filter(el => el.id !== 'av-root' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'LINK').map(el => getComputedStyle(el).display));
  assert.ok(hidden.every(d => d === 'none'), entry.app + '/' + audience + ': full UI hidden');
  assert.deepEqual(errors, [], entry.app + '/' + audience + ': page errors');
  if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, entry.app + '-' + audience + '.png'), fullPage: true }); }
}

async function checkFull(page, entry, origin) {
  const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(origin + entry.url);
  await page.waitForFunction(() => window.AppView && typeof window.AppView.active === 'function');
  assert.equal(await page.evaluate(() => window.AppView.active()), null, entry.app + ': no audience => full page');
  assert.equal(await page.locator('#av-root').count(), 0, entry.app + ': kit root absent on the full page');
  await page.waitForSelector(entry.fullMarker, { state: 'attached', timeout: 20000 });
  assert.deepEqual(errors.filter(e => !/import|module/i.test(e)), [], entry.app + ': full page errors');
}

(async () => {
  const only = process.argv[2];
  const entries = PAGES.filter(e => !only || e.app === only);
  if (!entries.length) { console.error('audience-views: no page for ' + only); process.exit(2); }
  const browser = await chromium.launch({ headless: true });
  let passed = 0;
  try {
    for (const entry of entries) {
      const manifest = yaml.load(fs.readFileSync(path.join(store, entry.app, 'oshal-app.yaml'), 'utf8'));
      assert.ok(manifest.ui.static.some(s => s.iframeUrl === entry.url), entry.app + ': ' + entry.url + ' is a declared surface');
      const { server, writes, origin } = await serve(entry);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      try {
        for (const [audience, expect] of Object.entries(entry.audiences)) { const page = await context.newPage(); await checkAudience(page, entry, audience, expect, origin); await page.close(); passed++; console.log('PASS ' + entry.app + ' ' + audience); }
        const page = await context.newPage(); await checkFull(page, entry, origin); await page.close(); passed++; console.log('PASS ' + entry.app + ' full page untouched');
        assert.deepEqual(writes, [], entry.app + ': no writes while reading');
      } finally { await context.close(); server.close(); }
    }
  } finally { await browser.close(); }
  console.log('audience-views: ' + passed + ' passed');
})().catch(e => { console.error('audience-views FAIL: ' + (e && e.stack || e)); process.exit(1); });
