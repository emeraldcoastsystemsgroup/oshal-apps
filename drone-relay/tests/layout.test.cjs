/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (drone-relay--drone-relay, C): 18 flat inputs pushed
 *   Update and Preview 350px below a desktop screen, the corridor was mostly blank and Run was off with no reason. In
 *   Chromium the shipped page groups the editor into Radio, Fleet and Flight with control plane and courier under a
 *   closed Advanced, keeps Preview and Save in a sticky bar on screen, splits the chain into Plan and Simulate, crops the
 *   corridor to its track, says why Run is off, reads advisories in words, and asks before deleting in the page (no
 *   native dialog). Seams: /api/drone-relay answers from the package's own pure engine (TRANSPORTS, validateSpec,
 *   planChain) and an empty chain list; shared assets are empty stand-ins. Needs the store toolchain (express,
 *   playwright, chromium), so it is not one of the plain-node hyphenated suites.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const engine = require('../routes/engine');

async function serve() {
  const app = express();
  app.use(express.json());
  app.get('/api/drone-relay/app', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'drone-relay.html')));
  app.get('/api/drone-relay/assets/drone-relay.js', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'drone-relay.js')));
  app.get('/api/drone-relay/capabilities', (_req, res) => res.json({ app: 'drone-relay', transports: engine.TRANSPORTS, controlChannels: ['in-band'] }));
  app.get('/api/drone-relay/plans', (_req, res) => res.json({ plans: [] }));
  app.post('/api/drone-relay/plan-preview', (req, res) => { const spec = engine.validateSpec(req.body); res.json({ spec, sized: engine.planChain(spec) }); });
  app.get('/cockpit/js/app-workflows.js', (_req, res) => res.type('js').send('export async function mountConnectedActions() {}'));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use((_req, res) => res.status(404).json({}));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** WCAG contrast of two computed rgb() colours. */
function contrast(a, b) {
  const lum = (c) => { const unit = /^color\(srgb/.test(c); const [r, g, bl] = c.replace(/^color\(srgb/, '').match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v = unit ? v : v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('the editor is grouped, Preview and Save stay on screen, and a preview opens Plan with Run saying why it is off', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const dialogs = [], errors = [];
  page.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/api/drone-relay/app`);
  await page.locator('#f-transport option').first().waitFor({ state: 'attached' });
  assert.deepEqual(await page.locator('#plan-form fieldset legend').allTextContents(), ['Radio', 'Fleet', 'Flight']);
  assert.equal(await page.locator('#plan-form details.advanced').evaluate((d) => d.open), false, 'control plane and courier sit under a closed Advanced');
  assert.equal(await page.locator('#f-heartbeat').isVisible(), false);
  for (const name of ['Preview', 'Save']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    assert.ok(box && box.y + box.height <= 900, name + ' is on screen without scrolling (y ' + (box && box.y) + ')');
  }
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).getAttribute('class'), 'primary');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.locator('#plan-panel:not([hidden])').waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Plan', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#map').isVisible(), false, 'the corridor is on Simulate');
  await page.getByRole('tab', { name: 'Simulate', exact: true }).click();
  assert.equal(await page.locator('#map').isVisible(), true);
  const map = await page.locator('#map').boundingBox();
  const width = map.width, height = map.height;
  assert.ok(height < width * 300 / 1000 - 20, 'the corridor is cropped to its track (' + Math.round(height) + 'px at ' + Math.round(width) + 'px wide)');
  assert.equal(await page.getByRole('button', { name: 'Run', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#run-why').textContent(), 'Save the chain to run a scenario.');
  const notes = await page.locator('#plan-notes').textContent();
  assert.doesNotMatch(notes, /pathLossExponent|heartbeatS|requiredMarginDb|enduranceS/, 'advisories read in words');
  const warn = page.locator('#plan-notes li.warn').first();
  if (await warn.count()) {
    const [ink, panel] = await warn.evaluate((li) => [getComputedStyle(li).color, getComputedStyle(li.closest('section')).backgroundColor]);
    assert.ok(contrast(ink, panel) >= 4.5, 'an advisory is legible: ' + contrast(ink, panel).toFixed(2) + ':1 (' + ink + ' on ' + panel + ')');
  }
  assert.deepEqual(dialogs, []);
  assert.deepEqual(errors, []);
});

test('on a phone the editor fits the width and the on-station checkbox sits in a 44px row', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/api/drone-relay/app`);
  await page.locator('#f-transport option').first().waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Preview', exact: true }).tap();
  await page.locator('#plan-panel:not([hidden])').waitFor();
  await page.getByRole('tab', { name: 'Simulate', exact: true }).tap();
  const row = await page.locator('label.check-row').boundingBox();
  assert.ok(row.height >= 44, 'the on-station checkbox row is ' + row.height + 'px');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no sideways scrolling');
  assert.deepEqual(errors, []);
});
