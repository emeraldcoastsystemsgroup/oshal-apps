/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 P1 (the dead "Your next brief" form, @ux-career's fix shape). mountConnectedActions renders nothing since kernel 5174083d, so the review page's brief took text and lost it. Drives the shipped tools/review.html in Chromium with the platform module stubbed at its real path: with no connected action the brief panel is hidden and no "Use this evidence" button is drawn; when the module renders an action the brief and the buttons appear; a throwing module also leaves the brief hidden.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const WORKFLOWS = {
  none: 'export async function mountConnectedActions() {}',
  one: "export async function mountConnectedActions({ element }) { const b = document.createElement('button'); b.textContent = 'Continue in Office'; element.append(b); }",
  throws: "export async function mountConnectedActions() { throw new Error('no target'); }",
};

/** @description Serve the review page, its stylesheet and frame, a home summary with one item, and the stubbed workflows module. */
function serve() {
  const app = express();
  const state = { mode: 'none' };
  app.get('/api/little-monsters/review', (_req, res) => res.sendFile(path.join(TOOLS, 'review.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/cockpit/js/app-workflows.js', (_req, res) => res.type('js').send(WORKFLOWS[state.mode]));
  app.get('/api/little-monsters/home-summary', (_req, res) => res.json({ metrics: [{ value: 3, label: 'Cards' }],
    items: [{ text: 'Biology flashcards', detail: 'Saved 2026-11-05T12:00:00Z', actions: [{ context: { title: 'Biology', notes: 'Review cell parts' } }] }] }));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student' }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, state, close: () => server.close() }));
  });
}

test('the review brief is shown only when a connected action renders', async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    for (const [mode, shown] of [['none', false], ['throws', false], ['one', true]]) {
      srv.state.mode = mode;
      const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
      await page.goto(`${srv.base}/api/little-monsters/review`);
      await page.locator('#records .lm-item').waitFor();
      assert.equal(await page.locator('#briefPanel').isVisible(), shown, `${mode}: brief visible`);
      assert.equal(await page.getByText('Use this evidence').count(), shown ? 1 : 0, `${mode}: evidence buttons`);
      if (shown) {
        await page.getByText('Use this evidence').click();
        assert.equal(await page.inputValue('#notes'), 'Review cell parts');
      }
      await page.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
});
