/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Phone geometry of the shipped Little Monsters pages in Chromium at 412 and 360px. Found as a student on a 412px phone: a long first name in the top bar made every page 83px too wide, My Files was 514px (stacked .lm-columns and .lm-stack sized to their widest item) and the Tutor's Read aloud button sat past the screen. Serves the shipped tools/ files, education.css and the page frame over a local server with the profile, identity and data routes they read.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const yaml = require(path.join(TOOLCHAIN, 'js-yaml'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const TOOLS = path.join(PKG, 'tools');
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
/** The ribbon profile the kernel answers for this package: one item per static tab. */
const profile = { profile: { ribbon: { items: manifest.ui.static.map((tab) => ({
  id: `tool-${tab.toolName}`, label: tab.label, section: tab.section, toolUi: { iframeUrl: tab.iframeUrl } })) } } };
const LONG = 'Maximiliana-Alexandrina Featherstonehaugh';
const textbooks = Array.from({ length: 3 }, (_, i) => ({ id: `tb-${i}`, title: `Comprehensive Introductory Biology and Biochemistry Volume ${i + 1}`,
  subject: 'Biology', collection: 'OpenStax Training Programs Collection', hasPdf: true }));
const DATA = {
  '/api/ui/profile': profile,
  '/api/education/me': { name: LONG, role: 'student', email: 'student@example.org' },
  '/api/education/rewards': { xp: 40, level: 1 },
  '/api/education/classes': { classes: [{ class_id: 'c1', name: 'Advanced Placement Environmental Science', subject: 'Environmental Science' }] },
  '/api/education/catalog': { textbooks },
};
const PAGES = { '/api/education/files': 'files.html', '/api/education/tutor': 'tutor-chat.html',
  '/api/education/storage': 'standard-view.html', '/api/education/dashboard': 'student-dashboard.html' };

/** @description Serve the shipped pages, the stylesheet, the page frame and the data they read. @returns {Promise<{base:string, close:Function}>} */
function serve() {
  const app = express();
  for (const [route, file] of Object.entries(PAGES)) app.get(route, (_req, res) => res.sendFile(path.join(TOOLS, file)));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  for (const [route, body] of Object.entries(DATA)) app.get(route, (_req, res) => res.json(body));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

test('every Little Monsters page fits a phone: no sideways scroll, the top bar and its controls on screen', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    for (const width of [412, 360]) {
      const page = await browser.newPage({ viewport: { width, height: 915 } });
      for (const route of Object.keys(PAGES)) {
        await page.goto(base + route);
        await page.locator('.lm-topbar .lm-pill').waitFor();
        await page.waitForLoadState('networkidle');
        const fit = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth, screen: innerWidth,
          off: [...document.querySelectorAll('button, select, input, textarea, .lm-topbar-side > *')]
            .filter((e) => e.offsetParent && !e.closest('nav') && e.getBoundingClientRect().right > innerWidth + 1)
            .map((e) => e.id || e.textContent.trim().slice(0, 30)),
        }));
        assert.ok(fit.page <= fit.screen, `${route} at ${width}px is ${fit.page}px wide`);
        assert.deepEqual(fit.off, [], `${route} at ${width}px: controls past the screen edge`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    close();
  }
});
