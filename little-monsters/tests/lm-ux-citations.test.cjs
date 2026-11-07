/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-citations, FIX-BROKEN). APA kept full first names ('Carson, Rachel (1962).') and one list mixed MLA and APA entries, so a student handed in a wrong bibliography. Unit cases run the page's own LMCite block for a book, a website and a journal article in both styles; the browser cases drive the shipped page: switching the style re-renders every entry under 'References' / 'Works Cited', and Add source clears the form and returns focus to Author.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The Look up planned control (DS-45, RP-LM-03) at the right of the Title field: aria-disabled, its backlog id, opacity 1, not the accent, and a press makes no request and changes nothing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Look up (#lookupBtn) right of the Title field opens #lookupPanel, resolves ISBN/DOI/URL via GET /api/education/catalog?lookup=, and leaves typed fields intact on 404 (RP-LM-03).
 * -----------------------------------------------------------------------------
 *
 * The unit cases are dependency-free; the browser cases need the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const HTML = fs.readFileSync(path.join(TOOLS, 'citations.html'), 'utf8');

/** @description Load the page's own formatter block (script#lm-cite-format) without a DOM. @returns {object} LMCite. */
function loadFormatter() {
  const m = HTML.match(/<script id="lm-cite-format">([\s\S]*?)<\/script>/);
  assert.ok(m, 'citations.html carries the LMCite block');
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(m[1], sandbox);
  return sandbox.module.exports;
}
const LMCite = loadFormatter();

const BOOK = { type: 'book', author: 'Carson, Rachel', title: 'Silent Spring', source: 'Houghton Mifflin', year: '1962' };
const SITE = { type: 'website', author: 'Smith, Jane Ann', title: 'How Bees See Color', source: 'National Geographic Kids', year: '2024', url: 'https://kids.example.org/bees' };
const ARTICLE = { type: 'journal', author: 'Lee, Kim', title: 'Sleep and memory', source: 'Journal of Kids Science', year: '2020', volume: '12', issue: '3', pages: '45-67' };

test('APA uses initials and the year in parentheses (book)', () => {
  assert.equal(LMCite.format('APA', BOOK), 'Carson, R. (1962). <i>Silent Spring</i>. Houghton Mifflin.');
});

test('MLA keeps the full first name and ends with publisher, year (book)', () => {
  assert.equal(LMCite.format('MLA', BOOK), 'Carson, Rachel. <i>Silent Spring</i>. Houghton Mifflin, 1962.');
});

test('a website: APA italic page title + URL; MLA quoted page title and italic site', () => {
  assert.equal(LMCite.format('APA', SITE), 'Smith, J. A. (2024). <i>How Bees See Color</i>. National Geographic Kids. https://kids.example.org/bees');
  assert.equal(LMCite.format('MLA', SITE), 'Smith, Jane Ann. “How Bees See Color.” <i>National Geographic Kids</i>, 2024, https://kids.example.org/bees.');
});

test('a journal article: plain article title, italic journal and volume', () => {
  assert.equal(LMCite.format('APA', ARTICLE), 'Lee, K. (2020). Sleep and memory. <i>Journal of Kids Science</i>, <i>12</i>(3), 45-67.');
  assert.equal(LMCite.format('MLA', ARTICLE), 'Lee, Kim. “Sleep and memory.” <i>Journal of Kids Science</i>, vol. 12, no. 3, 2020, pp. 45-67.');
});

test('names: hyphenated initials, a group author kept whole, no year is n.d. in APA', () => {
  assert.equal(LMCite.apaAuthor('Sartre, Jean-Paul'), 'Sartre, J.-P.');
  assert.equal(LMCite.format('APA', { type: 'website', author: 'NASA', title: 'Mars Facts', source: 'NASA Science' }), 'NASA. (n.d.). <i>Mars Facts</i>. NASA Science.');
  assert.equal(LMCite.heading('APA'), 'References');
  assert.equal(LMCite.heading('MLA'), 'Works Cited');
  assert.equal(LMCite.format('MLA', { author: '<b>x</b>, y', title: 'T' }).includes('<b>'), false, 'fields are escaped');
});

/** @description Serve the shipped citations page with the frame and stylesheet. @returns {Promise<{base:string, close:Function}>} */
function serve(express) {
  const app = express();
  app.get('/api/education/citations', (_req, res) => res.sendFile(path.join(TOOLS, 'citations.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student' }));
  app.get('/api/education/catalog', (req, res) => {
    const q = String(req.query.lookup || '').trim();
    if (q === '9780140328721') {
      return res.json({
        source: {
          type: 'book',
          author: 'Dahl, Roald',
          title: 'Fantastic Mr. Fox',
          source: 'Puffin Books',
          year: '1988',
          url: 'https://openlibrary.org/isbn/9780140328721',
        },
      });
    }
    return res.status(404).json({ error: 'No source found for that identifier.' });
  });
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

test('browser: one style for the whole list, and Add source clears the form back to Author', async () => {
  const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
  const express = require(path.join(TOOLCHAIN, 'express'));
  const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
  const { base, close } = await serve(express);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await page.goto(`${base}/api/education/citations`);
    await page.fill('#author', 'Carson, Rachel');
    await page.fill('#title', 'Silent Spring');
    await page.fill('#source', 'Houghton Mifflin');
    await page.fill('#year', '1962');
    await page.click('#addBtn');
    for (const id of ['author', 'title', 'source', 'year']) assert.equal(await page.inputValue(`#${id}`), '', `${id} is cleared`);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'author');
    await page.selectOption('#type', 'website');
    assert.equal(await page.textContent('#sourceLabel'), 'Website name');
    await page.fill('#author', 'Smith, Jane Ann');
    await page.fill('#title', 'How Bees See Color');
    await page.fill('#source', 'National Geographic Kids');
    await page.fill('#year', '2024');
    await page.fill('#url', 'https://kids.example.org/bees');
    await page.press('#year', 'Enter');
    assert.equal(await page.locator('#saved > li').count(), 2);
    assert.match(await page.textContent('#citedTitle'), /Works Cited/);
    assert.match(await page.textContent('#saved'), /Carson, Rachel\. Silent Spring\. Houghton Mifflin, 1962\./);
    await page.click('.style-switch [data-style="APA"]');
    assert.match(await page.textContent('#citedTitle'), /References/);
    const rows = await page.locator('#saved > li .cite').allTextContents();
    assert.deepEqual(rows, ['Carson, R. (1962). Silent Spring. Houghton Mifflin.',
      'Smith, J. A. (2024). How Bees See Color. National Geographic Kids. https://kids.example.org/bees']);
    // ⋯ Edit loads the source back; ⋯ Remove removes only that one.
    await page.locator('#saved > li').first().locator('summary').click();
    await page.locator('#saved > li').first().locator('[data-act="edit"]').click();
    assert.equal(await page.inputValue('#author'), 'Carson, Rachel');
    assert.equal(await page.textContent('#addBtn'), 'Save changes');
    await page.fill('#year', '1963');
    await page.click('#addBtn');
    assert.match(await page.textContent('#saved'), /Carson, R\. \(1963\)\./);
    await page.locator('#saved > li').last().locator('summary').click();
    await page.locator('#saved > li').last().locator('[data-act="remove"]').click();
    assert.equal(await page.locator('#saved > li').count(), 1);
    assert.equal(await page.locator('input[type="file"]').count(), 0, 'no file input that only reads a name');
  } finally {
    await browser.close();
    close();
  }
});

test('browser: Look up right of Title fills citation fields by ISBN and preserves typed inputs on 404 (RP-LM-03)', async () => {
  const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
  const express = require(path.join(TOOLCHAIN, 'express'));
  const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
  const { base, close } = await serve(express);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await page.goto(`${base}/api/education/citations`);
    await page.locator('.lm-topbar[data-lm-ready]').waitFor();
    const title = await page.locator('#title').boundingBox();
    const look = await page.locator('#lookupBtn').boundingBox();
    assert.ok(look.x >= title.x + title.width && look.x + look.width <= 412, 'Look up sits right of the Title field, on screen');
    await page.fill('#title', 'Silent Spring');
    await page.click('#lookupBtn');
    await page.fill('#lookupInput', '0000000000');
    await page.click('#lookupRunBtn');
    await page.waitForFunction(() => /No source found/.test(document.getElementById('lookupStatus').textContent));
    assert.equal(await page.inputValue('#title'), 'Silent Spring', 'an unknown identifier leaves the form intact');

    await page.fill('#lookupInput', '9780140328721');
    await page.click('#lookupRunBtn');
    await page.waitForFunction(() => document.getElementById('title').value === 'Fantastic Mr. Fox');
    assert.equal(await page.inputValue('#author'), 'Dahl, Roald');
    assert.equal(await page.inputValue('#source'), 'Puffin Books');
    assert.equal(await page.inputValue('#year'), '1988');
  } finally {
    await browser.close();
    close();
  }
});
