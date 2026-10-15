/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 1, in Chromium at 412x915 over the shipped stage.html, ui scripts and CSS in
 *   the shell's application frame: during a Family Feud face-off with the buzzer open and the round clock running, (1) the
 *   BUZZ IN bar stays inside its dock and the screen (it was min(760px, 96vw) inside a padded dock, right edge 421 on a 412
 *   screen), and (2) the round clock does not sit on the question ("Name something you always d[o]"). Seams: the game API
 *   answers a fixed room over a stub server and the shell's shared theme assets are empty stand-ins. Needs the store
 *   toolchain (express, playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const QUESTION = 'Name something you always do before going to bed.';
function state() {
  return {
    ok: true, now: Date.now(), rev: 1, events: [], scoreboard: [],
    seats: [{ seatId: 's1', name: 'You', team: 'A', kind: 'human', mine: true }],
    room: { roomId: 'r1', isOwner: true, showId: 'family-feud', code: 'B069CC', joinCode: 'B069CC' },
    show: { id: 'family-feud', title: 'Family Feud', teams: true },
    state: { phase: 'faceoff', round: 1, host: { line: '' },
      buzz: { open: true, serial: 1 }, timer: { endsAt: Date.now() + 60000 },
      board: { question: QUESTION, strikes: 0, bank: 0, multiplier: 1,
        answers: [{ text: '', points: 0 }, { text: '', points: 0 }, { text: '', points: 0 }] } },
  };
}

async function serve() {
  const app = express();
  app.use(express.json());
  app.get('/shell', (req, res) => res.type('html').send(`<!doctype html><title>shell</title><style>body{margin:0}</style><iframe id="active-app-frame" src="/api/game-show/app${req.url.slice('/shell'.length)}" style="width:412px;height:915px;border:0"></iframe>`));
  app.get('/api/game-show/app', (_req, res) => res.sendFile(path.join(PKG, 'ui', 'stage.html')));
  app.get('/api/game-show/state', (_req, res) => res.json(state()));
  app.get('/api/game-show/shows', (_req, res) => res.json({ ok: true, shows: [{ id: 'family-feud', title: 'Family Feud' }] }));
  app.get('/api/game-show/rooms', (_req, res) => res.json({ ok: true, rooms: [] }));
  app.post('/api/game-show/sync', (_req, res) => res.json({ ok: true, changed: false }));
  app.get(/^\/api\/game-show\/[\w-]+\.(js|css)$/, (req, res) => res.sendFile(path.join(PKG, 'ui', path.basename(req.path))));
  app.use('/api/game-show', (_req, res) => res.json({ ok: true }));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('on a phone the BUZZ IN bar stays inside its dock and the clock leaves the question readable', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  await page.goto(`${base}/shell?view=stage&room=r1`);
  const frame = page.frameLocator('#active-app-frame');
  await frame.locator('.gs-dockbuzz').first().waitFor();
  await frame.locator('.gs-bigclock').first().waitFor();
  const buzz = await frame.locator('.gs-dockbuzz').first().boundingBox();
  const dock = await frame.locator('.gp-dock-inner').first().boundingBox();
  assert.ok(buzz.x + buzz.width <= dock.x + dock.width + 0.5, `the bar ends at ${buzz.x + buzz.width}, its dock at ${dock.x + dock.width}`);
  assert.ok(buzz.x + buzz.width <= 412, `the bar ends inside the screen (${buzz.x + buzz.width})`);
  const clock = await frame.locator('.gs-bigclock').first().boundingBox();
  const question = await frame.locator('.gsf-question').first().boundingBox();
  assert.ok(!overlap(clock, question), `the clock ${JSON.stringify(clock)} sits on the question ${JSON.stringify(question)}`);
});
