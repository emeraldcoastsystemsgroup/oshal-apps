/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-files, SPLIT + FIX-BROKEN). 'Open in editor' silently replaced an unsaved note with a book's raw text, the page showed storage ids ('staged-…-notes.txt', 'staged_books_20261014', 'little-monsters-demo'), and a Cloud accounts card offered accounts that never sync here. Guards, in Chromium over the shipped page and the frame at 412x915 with touch: My notes · Textbooks switch and ?view= deep-links; a note being typed survives opening a book, starting a note on it and opening a computer file (each starts a new note); no storage id or Cloud accounts text anywhere; the shelf shows 20 books at a time; a book opens in a reader, not the note editor.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const TOOLS = path.join(PKG, 'tools');
const SUBJECTS = ['Mathematics', 'Biology & Life Science', 'Chemistry & Physics'];
/** Catalog rows shaped as GET /catalog answers them (normalizeTextbookEntry copies sourceCollection into collection). */
const BOOKS = Array.from({ length: 25 }, (_, i) => ({
  id: i ? `staged-book-${i}` : 'staged-prealgebra-2e', title: i ? `Open Science Volume ${i}` : 'Prealgebra 2e',
  author: 'Lynn Marecek (OpenStax)', subject: SUBJECTS[i % 3], gradeLevel: 'Grades 6–9',
  sourceCollection: i % 2 ? 'staged_books_20261014' : 'little-monsters-demo', collection: i % 2 ? 'staged_books_20261014' : 'little-monsters-demo',
  txtFile: `staged-book-${i}.txt`, pdfFile: `staged-book-${i}.pdf`, hasPdf: true,
}));
const BOOK_TEXT = 'Prealgebra 2e\n\nChapter 1 Whole Numbers\n\nA whole number is a counting number or zero.\n\n' + 'Practice makes progress. '.repeat(40);
const DATA = {
  '/api/ui/profile': { profile: { ribbon: { items: [{ id: 'tool-lm-files', label: 'My Files', toolUi: { iframeUrl: '/api/education/files' } }] } } },
  '/api/education/me': { name: 'Ella Student', role: 'student', email: 'ella@example.org' },
  '/api/education/rewards': { xp: 40, level: 1 },
};

/** @description Serve the shipped page, the stylesheet, the frame, the catalog and one book's text. @returns {Promise<{base:string, close:Function}>} */
function serve() {
  const app = express();
  app.get('/api/education/files', (_q, res) => res.sendFile(path.join(TOOLS, 'files.html')));
  app.get('/api/education/education.css', (_q, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_q, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/education/catalog', (req, res) => {
    if (!req.query.textbookId) return res.json({ classes: [], textbooks: BOOKS });
    const book = BOOKS.find((b) => b.id === req.query.textbookId);
    return res.json({ textbook: { ...book, content: BOOK_TEXT }, content: BOOK_TEXT });
  });
  for (const [route, body] of Object.entries(DATA)) app.get(route, (_q, res) => res.json(body));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** @description Open My Files on a phone and wait for the frame and the catalog. */
async function openFiles(browser, base, query = '') {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await page.goto(base + '/api/education/files' + query);
  await page.locator('.lm-topbar[data-lm-ready]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#tbFilesList .files-book').length > 0);
  return page;
}

/** @description The notes kept in this browser. */
function notes(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('lm-files') || '[]')); }

test('a note being typed survives opening a book, a note on it and a computer file: each starts a new note', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await openFiles(browser, base);
    assert.equal(await page.locator('#view-notes').isVisible(), true);
    await page.getByRole('button', { name: '+ New note' }).tap();
    await page.locator('#fname').fill('Biology draft');
    await page.locator('#ftext').fill('Mitochondria make energy');
    await page.getByRole('tab', { name: 'Textbooks' }).tap();
    assert.match(page.url(), /\?view=textbooks$/);
    await page.locator('.files-book-open').first().tap();
    await page.locator('#readerText p').first().waitFor();
    assert.match(await page.locator('#readerText').textContent(), /A whole number is a counting number/);
    await page.getByRole('button', { name: '📝 Start a note on this book' }).tap();
    await page.locator('#noteEditor').waitFor();
    assert.equal(await page.locator('#fname').inputValue(), 'Prealgebra 2e notes');
    assert.equal(await page.locator('#ftext').inputValue(), '', 'the new note starts empty');
    await page.evaluate(() => { window.showOpenFilePicker = async () => [{ getFile: async () => new File(['Homework list'], 'homework.txt') }]; });
    await page.locator('#noteMore summary').tap();
    await page.getByRole('button', { name: '📂 Open from my computer' }).tap();
    await page.waitForFunction(() => document.querySelector('#ftext').value === 'Homework list');
    await page.getByRole('button', { name: '← My notes' }).tap();
    const kept = await notes(page);
    assert.deepEqual(kept.map((n) => n.name).sort(), ['Biology draft', 'Prealgebra 2e notes', 'homework.txt'].sort());
    assert.equal(kept.find((n) => n.name === 'Biology draft').text, 'Mitochondria make energy', 'the typed note is intact');
    assert.equal(await page.locator('#saved .files-note').count(), 3, 'every note is listed, newest first');
    assert.equal(await page.locator('#saved .files-note strong').first().textContent(), 'homework.txt');
  } finally {
    await browser.close();
    close();
  }
});

test('notes saved before this change keep their text, and opening one shows it full width with Saved', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await openFiles(browser, base);
    await page.evaluate(() => localStorage.setItem('lm-files', JSON.stringify([{ name: 'old-note.txt', text: 'kept from before' }])));
    await page.reload();
    await page.locator('#saved .files-note').first().waitFor();
    await page.locator('#saved .files-note').first().tap();
    assert.equal(await page.locator('#ftext').inputValue(), 'kept from before');
    await page.locator('#ftext').fill('kept from before, and more');
    await page.waitForFunction(() => document.querySelector('#savedCaption').textContent === 'Saved');
    const kept = await notes(page);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].text, 'kept from before, and more');
    const width = await page.evaluate(() => [document.querySelector('#noteEditor').getBoundingClientRect().width, document.querySelector('.lm-page').clientWidth]);
    assert.ok(width[0] >= width[1] - 80, `editor is full width: ${width}`);
  } finally {
    await browser.close();
    close();
  }
});

test('the shelf shows titles only, 20 at a time; no storage id or Cloud accounts card anywhere', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await openFiles(browser, base, '?view=textbooks');
    assert.equal(await page.locator('#view-textbooks').isVisible(), true);
    assert.equal(await page.locator('#tbFilesList .files-book').count(), 20);
    await page.getByRole('button', { name: 'Show more books' }).tap();
    assert.equal(await page.locator('#tbFilesList .files-book').count(), 25);
    const leaks = /staged|little-monsters-demo|\.txt\b|\.pdf\b/i;
    assert.doesNotMatch(await page.locator('body').innerText(), leaks, 'shelf');
    await page.locator('#tbFilesSearch').fill('Prealgebra');
    assert.equal(await page.locator('#tbFilesList .files-book').count(), 1);
    await page.locator('.files-book-open').first().tap();
    await page.locator('#readerText p').first().waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), leaks, 'reader');
    await page.getByRole('button', { name: '← Textbooks' }).tap();
    await page.getByRole('tab', { name: 'My notes' }).tap();
    assert.doesNotMatch(await page.locator('body').innerText(), /Cloud accounts|Dropbox|GitHub|Google Drive/);
    assert.equal(await page.locator('a[href="/utilities"]').count(), 0, 'no hub cloud tiles');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  } finally {
    await browser.close();
    close();
  }
});
