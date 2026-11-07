/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit (lm-stem, 2026-11-06): the shipped STEM page in Chromium. The calculator answers tan, log, ln, EE, Ans and Deg | Rad correctly (Deg by default: sin 30 = 0.5), keeps the expression above the result and the last 5 results as a tape; Formulas carries Formula Lab's sheet byte for byte and opens from ?tab=formulas; Links is a compact list of three other websites with no disclaimer paragraph; on a 412px phone "=" is a 44px key nothing covers and the page never scrolls sideways.
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
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const TOOLS = path.join(PKG, 'tools');

/** @description Serve the shipped STEM page, its stylesheet and page frame, with the data the frame reads. @returns {Promise<{base:string, close:Function}>} */
function serve() {
  const app = express();
  app.get('/api/education/stem-helpers', (_req, res) => res.sendFile(path.join(TOOLS, 'stem-helpers.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [
    { id: 'tool-lm-stem', label: 'STEM Helpers', toolUi: { iframeUrl: '/api/education/stem-helpers' } }] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella Student', role: 'student' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 40, level: 1 }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js|png)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** @description Press keys by their key name and return the result display. */
async function keys(page, ...seq) {
  for (const k of seq) await page.click(`#keys [data-key="${k}"]`);
  return page.inputValue('#disp');
}

test('the calculator answers trig in degrees, tan, log, ln, EE and Ans, with a tape of the last 5 results', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + '/api/education/stem-helpers');
    assert.equal(await page.getAttribute('#modeDeg', 'aria-pressed'), 'true', 'Deg is the default');
    assert.equal(await keys(page, 'sin', '3', '0', ')', '='), '0.5', 'sin 30° = 0.5');
    assert.equal(await page.textContent('#exprLine'), 'sin(30) =', 'the expression stays above the result');
    assert.equal(await keys(page, 'tan', '4', '5', ')', '='), '1', 'tan 45° = 1');
    assert.equal(await keys(page, 'tan', '9', '0', '='), 'Error', 'tan 90° is undefined');
    assert.equal(await keys(page, 'C', '-', 'log', '0', '.', '0', '0', '1', ')', '='), '3', 'pH = -log(0.001) = 3');
    assert.equal(await keys(page, 'ln', '1', '0', ')', '='), '2.30258509299');
    assert.equal(await keys(page, '6', '.', '0', '2', '2', 'EE', '2', '3', '×', '2', '='), '1.2044E24', 'EE enters ×10ⁿ');
    assert.equal(await keys(page, '2', '+', '3', '='), '5');
    assert.equal(await keys(page, '×', '2', '='), '10', 'an operator after = continues from the answer');
    assert.equal(await keys(page, 'Ans', '+', '1', '='), '11', 'Ans recalls the last answer');
    await page.click('#modeRad');
    assert.equal(await keys(page, 'sin', 'π', '÷', '2', ')', '='), '1', 'Rad: sin(π/2) = 1');
    const tape = await page.locator('#tape li').allInnerTexts();
    assert.equal(tape.length, 5, 'the tape keeps the last 5 results');
    assert.match(tape[0], /sin\(π÷2\) =\s*1/, 'newest first');
    assert.equal(await page.locator('#keys [data-key="sin"], #keys [data-key="tan"], #keys [data-key="log"], #keys [data-key="ln"], #keys [data-key="EE"], #keys [data-key="Ans"]').count(), 6);
  } finally {
    await browser.close();
    close();
  }
});

test('Formulas carries Formula Lab\'s sheet and opens from ?tab=formulas; Links is a compact list of other websites', async () => {
  const lab = fs.readFileSync(path.join(TOOLS, 'formula-lab.html'), 'utf8');
  const stem = fs.readFileSync(path.join(TOOLS, 'stem-helpers.html'), 'utf8');
  const block = (html) => /var DATA = \{[\s\S]*?\n\};/.exec(html)[0];
  assert.equal(block(stem), block(lab), 'STEM\'s Formulas tab is Formula Lab\'s formula set, unchanged');
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + '/api/education/stem-helpers?tab=formulas');
    assert.equal(await page.getAttribute('#tab-formulas', 'aria-selected'), 'true');
    assert.equal(await page.locator('#panel-calculator').isVisible(), false);
    assert.equal(await page.locator('#out .f').count(), 22, 'all 22 Physics 1 and Chemistry formulas');
    await page.fill('#search', 'hooke');
    assert.equal(await page.locator('#out .f').count(), 1);
    await page.click('#out .f');
    assert.equal(await page.getAttribute('#out .f', 'aria-expanded'), 'true', 'a card opens its worked example');
    await page.click('#tab-links');
    const links = page.locator('#panel-links a');
    assert.equal(await links.count(), 3);
    for (const meta of await page.locator('#panel-links small').allInnerTexts()) assert.match(meta, /^Opens another website/);
    assert.deepEqual(await links.evaluateAll((as) => as.map((a) => a.target)), ['_blank', '_blank', '_blank']);
    assert.equal(await page.locator('.lm-callout').count(), 0, 'no disclaimer paragraph');
    await page.click('#tab-calculator');
    assert.equal(await page.locator('#keys').isVisible(), true);
  } finally {
    await browser.close();
    close();
  }
});

test('phone: "=" is a 44px key nothing covers and the page never scrolls sideways', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    await page.goto(base + '/api/education/stem-helpers');
    await page.locator('#keys [data-key="="]').scrollIntoViewIfNeeded();
    const eq = await page.evaluate(() => {
      const el = document.querySelector('#keys [data-key="="]'); const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: hit === el, h: r.height, right: r.right, vw: innerWidth, wide: document.documentElement.scrollWidth };
    });
    assert.ok(eq.ok, 'nothing sits over "="');
    assert.ok(eq.h >= 44, `"=" is ${eq.h}px tall`);
    assert.ok(eq.right <= eq.vw && eq.wide <= eq.vw, 'no sideways scroll');
    await page.tap('#keys [data-key="7"]');
    await page.tap('#keys [data-key="="]');
    assert.equal(await page.inputValue('#disp'), '7');
  } finally {
    await browser.close();
    close();
  }
});
