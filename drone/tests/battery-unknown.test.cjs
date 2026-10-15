/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: with no drone connected the header battery bar was full and green beside "–%". In
 *   Chromium at 412x915 the shipped drone-ops.html opens over a fleet that reports no drone: the bar is empty while the
 *   percentage reads "–%". Seams: /api/drone answers the native kernel's no-drone fleet marker and empty lists; the shell's
 *   shared assets and connected-actions module are empty stand-ins. Needs the store toolchain (express, playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

async function serve() {
  const app = express();
  app.get('/api/drone/app', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'drone-ops.html')));
  app.get('/api/drone/fleet', (_req, res) => res.json({ configured: false, reason: 'no_drone', detail: 'No drone node or flight simulator ships with this installation.', drones: [], fleet: [] }));
  app.use('/api/drone', (_req, res) => res.json({ items: [], missions: [], drones: [], fleet: [] }));
  app.get('/cockpit/js/app-workflows.js', (_req, res) => res.type('js').send('export async function mountConnectedActions() {}'));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use((_req, res) => res.status(404).type('text').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('with no drone the battery bar is empty beside "–%", never full and green', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  await page.goto(`${base}/api/drone/app`);
  await page.locator('#noDroneBanner:not([hidden])').waitFor();
  assert.equal(await page.locator('#battPct').textContent(), '–%');
  const fill = await page.locator('#battFill').evaluate((el) => el.getBoundingClientRect().width);
  assert.equal(fill, 0, 'an unknown charge shows an empty bar');
});
