/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 2: the analysis brief's Verdict line ran the verdict tiles together ("Verdict: closed
 *   ✕admissible ✕certified ✓min SOC0.0500usable margin0.9269all-up mass1.589 kg..."), and AI Office received it verbatim. In
 *   Chromium at 412x915 the shipped aero-lab.html and aero-lab.js run a 24 h energy loop against a stubbed /evaluate, the page's
 *   own renderVerdict paints the card, and the person's "Use visible results" click writes the brief: each chip and each
 *   label/value pair is its own separated part. Seams: the aero-lab API answers fixed capabilities and one evaluate result,
 *   and the shell's shared assets and connected-actions module are empty stand-ins. Needs the store toolchain (express,
 *   playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

/** The evaluate answer the demo showed: not closed, not admissible, certified, with five margins. */
const EVALUATE = {
  closed: false,
  verdict: { admissible: false, certified: true, reasons: [] },
  energy: { minSoc: 0.05, usable: 0.9269 },
  build: { massAllUpKg: 1.589, spanM: 2.5, packWh: 100 },
};
const CAPS = { engine: { present: true, version: '1.2.0', python: '3.12' }, capabilities: { polar: true, evaluate: true, screen: true, mission: true, export: true } };

async function serve() {
  const app = express();
  app.use(express.json());
  app.get('/api/aero-lab/app', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'aero-lab.html')));
  app.get('/api/aero-lab/app.js', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'aero-lab.js')));
  app.get('/api/aero-lab/geometry.js', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'aero-lab-geometry.js')));
  app.get('/api/aero-lab/capabilities', (_req, res) => res.json(CAPS));
  app.post('/api/aero-lab/evaluate', (_req, res) => res.json(EVALUATE));
  app.get('/cockpit/js/app-workflows.js', (_req, res) => res.type('js').send('export async function mountConnectedActions() {}'));
  app.use('/api/aero-lab', (_req, res) => res.json({}));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use((_req, res) => res.status(404).type('js').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('the brief separates each verdict tile after a real 24 h energy loop render', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/api/aero-lab/app`);
  await page.locator('#btnEval:not([disabled])').waitFor();
  await page.locator('#btnEval').click();
  await page.locator('#verdictCard .v-chip').first().waitFor();
  await page.locator('#labReview summary').click();
  await page.locator('#captureLabEvidence').click();
  const brief = await page.locator('#labNotes').inputValue();
  const verdict = brief.split('\n').find((l) => l.startsWith('Verdict: '));
  assert.equal(verdict, 'Verdict: closed ✕ · admissible ✕ · certified ✓ · min SOC 0.0500 · usable margin 0.9269 · all-up mass 1.589 kg · span 2.50 m · pack 100.0 Wh', brief);
  assert.match(brief, /^Run status: done in \d+\.\d s$/m);
  assert.deepEqual(errors, []);
});
