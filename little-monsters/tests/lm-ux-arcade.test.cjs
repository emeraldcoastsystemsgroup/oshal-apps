/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-arcade, P0) in Chromium over the shipped files: the lobby is artwork tiles (a picture from the package's icon sheet in every tile, the whole tile is the button, 2 per row at 412px and 3 at 1440px, a lock badge for the warm-up); a wrong warm-up answer never opens a game and the right one does; once Monster 2048 opens, ArrowLeft moves its tiles without a click first (the stage frame has focus); a row with tiles keeps the height of an empty row and every cell is square; New game starts over.
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
/** The arcade's fallback warm-up bank (no flashcards here): question -> right answer. */
const ANSWERS = {
  'What is 7 × 8?': '56', 'Which planet is known as the Red Planet?': 'Mars', 'What is H2O commonly called?': 'Water',
  'A noun is a person, place, or …?': 'Thing', 'What is 12 + 19?': '31', 'The powerhouse of the cell is the …?': 'Mitochondria',
};

/** @description Serve the arcade, its games, the stylesheet, the frame, the icon sheet and the reads they make. @returns {Promise<{base:string, close:Function}>} */
function serve() {
  const app = express();
  app.get('/api/education/arcade', (_req, res) => res.sendFile(path.join(TOOLS, 'games-arcade.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/education/icons.png', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-icons.png')));
  app.use('/api/education/games', express.static(path.join(TOOLS, 'games')));
  app.get('/api/education/flashcards/sets', (_req, res) => res.json({ sets: [] }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 10, level: 1 }));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.post('/api/education/xp', (_req, res) => res.json({ xpAwarded: 0 }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** @description Read the lobby: per tile its picture, whether a click on the picture lands in the tile, and its position. */
function readLobby(page) {
  return page.evaluate(() => [...document.querySelectorAll('#grid > *')].map((tile) => {
    const img = tile.querySelector('.game-art img'), art = tile.querySelector('.game-art').getBoundingClientRect();
    const hit = document.elementFromPoint(art.left + art.width / 2, art.top + art.height / 2);
    return { tag: tile.tagName, imgs: tile.querySelectorAll('img').length, loaded: Boolean(img && img.complete && img.naturalWidth > 0),
      lock: Boolean(tile.querySelector('.game-lock')), inside: Boolean(hit && tile.contains(hit)), top: Math.round(tile.getBoundingClientRect().top),
      square: Math.abs(art.width - art.height) <= 1, text: tile.textContent.trim() };
  }));
}

test('the arcade lobby is artwork tiles: a picture in each, the whole tile is the button, 2 per row on a phone and 3 on a desktop', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    for (const [width, perRow] of [[412, 2], [1440, 3]]) {
      const page = await browser.newPage({ viewport: { width, height: 915 } });
      await page.goto(base + '/api/education/arcade');
      await page.waitForLoadState('networkidle');
      await page.locator('#grid > button').nth(5).scrollIntoViewIfNeeded();
      const tiles = await readLobby(page);
      assert.equal(tiles.length, 6, 'six games');
      for (const t of tiles) {
        assert.equal(t.tag, 'BUTTON', `${t.text}: the tile is one button`);
        assert.equal(t.imgs, 1, `${t.text}: one picture`);
        assert.ok(t.loaded, `${t.text}: the picture loaded`);
        assert.ok(t.lock, `${t.text}: lock badge for the warm-up`);
        assert.ok(t.square, `${t.text}: the picture is square`);
        assert.doesNotMatch(t.text, /Warm-up first/u, 'no grey text chip');
      }
      const firstRow = tiles.filter((t) => Math.abs(t.top - tiles[0].top) <= 2).length;
      assert.equal(firstRow, perRow, `${width}px: ${perRow} tiles per row`);
      await page.locator('#grid > button').first().scrollIntoViewIfNeeded();
      const hits = (await readLobby(page)).slice(0, perRow);
      assert.ok(hits.every((t) => t.inside), 'a press on the picture lands on the tile button');
      await page.close();
    }
  } finally {
    await browser.close();
    close();
  }
});

/** @description Open a game's warm-up and answer it; `right` picks the right answer, otherwise a wrong one. */
async function answerWarmup(page, game, right) {
  await page.locator(`#grid > button[data-game="${game}"]`).click();
  const q = await page.locator('#gateQ').textContent();
  assert.ok(ANSWERS[q], `known warm-up question: ${q}`);
  const options = page.locator('#gateOpts .opt');
  const texts = await options.allTextContents();
  const pick = right ? texts.indexOf(ANSWERS[q]) : texts.findIndex((t) => t !== ANSWERS[q]);
  await options.nth(pick).click();
}

test('the warm-up only unlocks on the right answer, and Monster 2048 takes the arrow keys at once', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await page.goto(base + '/api/education/arcade');
    await page.waitForLoadState('networkidle');
    await answerWarmup(page, '2048', false);
    assert.equal(await page.locator('#stage').evaluate((e) => e.classList.contains('is-open')), false, 'a wrong answer opens nothing');
    assert.match(await page.locator('#gateMsg').textContent(), /Not quite/u);
    await page.locator('#gateCancel').click();
    await answerWarmup(page, '2048', true);
    const frame = page.frameLocator('#stageFrame');
    await frame.locator('#board .tile').first().waitFor();
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'stageFrame');
    const game = page.frames().find((f) => /games\/2048/.test(f.url()));
    await game.evaluate(() => { grid = [[0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; render(); });
    await page.keyboard.press('ArrowLeft');
    const first = await game.evaluate(() => grid[0][0]);
    assert.equal(first, 2, 'ArrowLeft moved the tile without a click on the board');
    await page.close();
  } finally {
    await browser.close();
    close();
  }
});

test('Monster 2048: rows with tiles keep the height of empty rows, cells are square, New game starts over', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    for (const width of [412, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 915 } });
      await page.goto(base + '/api/education/games/2048/index.html');
      await page.locator('#board .tile').first().waitFor();
      const rows = await page.evaluate(() => {
        grid = [[1024, 2048, 512, 256], [0, 0, 0, 0], [8, 0, 0, 0], [0, 0, 0, 0]]; render();
        return [...document.querySelectorAll('#board .tile')].map((t) => { const r = t.getBoundingClientRect(); return { w: r.width, h: r.height }; });
      });
      const heights = rows.map((r) => r.h);
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `${width}px: every row the same height (${heights.join(',')})`);
      assert.ok(rows.every((r) => Math.abs(r.w - r.h) <= 1), `${width}px: square cells`);
      await page.evaluate(() => { score = 480; grid = [[2, 4, 8, 16], [32, 64, 128, 256], [2, 4, 8, 16], [32, 64, 128, 256]]; render(); });
      await page.locator('#newGame').click();
      const fresh = await page.evaluate(() => ({ score: document.getElementById('score').textContent, tiles: grid.flat().filter(Boolean).length }));
      assert.deepEqual(fresh, { score: '0', tiles: 2 }, 'New game: score 0 and two starting tiles');
      await page.close();
    }
  } finally {
    await browser.close();
    close();
  }
});
