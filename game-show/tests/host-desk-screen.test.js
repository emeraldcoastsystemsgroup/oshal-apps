/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9, in Chromium at 412x915 over the shipped stage.html and ui scripts in the shell's
 *   application frame, read by the kernel's REAL screen snapshot (crates/api/src/shell_screen_state.js captureScreenState, what the
 *   concierge receives): (1) during round 2 of Family Feud the Host Desk shows "Round 2 question: <the round's question>" at the top
 *   of the answer key (it showed only the round-1 host caption, and the concierge read that as the current question); (2) each
 *   show poster in the lobby is a real button the snapshot names with "Host this show" (they were clickable divs). Seams: the game
 *   API answers a fixed owner room over a stub server (state, sync, shows, rooms), and the shell's shared theme assets are empty
 *   stand-ins. Needs the store toolchain (express, playwright, chromium) and the kernel checkout (OSHAL_KERNEL_ROOT).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A poster now names its one press, Play against the computer.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const SNAPSHOT = path.join(KERNEL, 'crates', 'api', 'src', 'shell_screen_state.js');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const ROUND2 = 'Name something people do wrong at the gym';
const STATE = {
  ok: true, now: Date.now(), rev: 1, seats: [], events: [], scoreboard: [],
  room: { roomId: 'r1', isOwner: true, showId: 'family-feud', code: 'ABCDEF' },
  show: { id: 'family-feud', title: 'Family Feud', teams: true },
  state: { phase: 'play', round: 2, host: { caption: 'Here is your first question: Name something you do to your car before a long road trip.', at: 1 },
    board: { question: ROUND2, strikes: 0, control: 'A', roundsTotal: 3,
      answers: [{ text: 'Not warming up', points: 38 }, { text: 'Lifting too heavy', points: 27 }, { text: 'Bad form', points: 19 }] } },
};
const SHOWS = [{ id: 'family-feud', title: 'Family Feud', tagline: 'Survey says' }, { id: 'jeopardy', title: 'Jeopardy', tagline: 'Answer in a question' }];

async function serve() {
  const app = express();
  app.use(express.json());
  app.get('/shell', (req, res) => res.type('html').send(`<!doctype html><title>shell</title><iframe id="active-app-frame" src="/api/game-show/app${req.url.slice('/shell'.length)}" style="width:412px;height:2400px;border:0"></iframe><script src="/snapshot.js"></script>`));
  app.get('/snapshot.js', (_req, res) => res.type('js').send(fs.readFileSync(SNAPSHOT, 'utf8')));
  app.get('/api/game-show/app', (_req, res) => res.sendFile(path.join(PKG, 'ui', 'stage.html')));
  app.get('/api/game-show/state', (_req, res) => res.json(STATE));
  app.get('/api/game-show/shows', (_req, res) => res.json({ ok: true, shows: SHOWS }));
  app.get('/api/game-show/rooms', (_req, res) => res.json({ ok: true, rooms: [] }));
  app.post('/api/game-show/sync', (_req, res) => res.json({ ok: true, changed: false }));
  app.get(/^\/api\/game-show\/[\w-]+\.(js|css)$/, (req, res) => res.sendFile(path.join(PKG, 'ui', path.basename(req.path))));
  app.use('/api/game-show', (_req, res) => res.json({ ok: true }));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function snapshot(page, base, query, ready) {
  await page.goto(`${base}/shell${query}`);
  await page.frameLocator('#active-app-frame').locator(ready).first().waitFor();
  return page.evaluate(() => window.captureScreenState(document.getElementById('active-app-frame')).text);
}

test('the Host Desk names the current round\'s question, and each show poster is a button', async (t) => {
  assert.ok(fs.existsSync(SNAPSHOT), `the kernel checkout must be present (set OSHAL_KERNEL_ROOT); missing ${SNAPSHOT}`);
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  const desk = await snapshot(page, base, '?view=host&room=r1', '.gsf-host-question');
  assert.ok(desk.split('\n').some((l) => l.includes(`Round 2 question: ${ROUND2}`)), desk);
  assert.ok(desk.indexOf(`Round 2 question: ${ROUND2}`) < desk.indexOf('Not warming up'), 'the question heads the answer key');
  const lobby = await snapshot(page, base, '?lobby=1', '.gp-poster');
  const posters = lobby.split('\n').filter((l) => l.startsWith('[button]') && l.includes('Play against the computer'));
  assert.equal(posters.length, 2, lobby);
  assert.match(posters[0], /^\[button\] .*Family Feud.*Play against the computer$/);
  assert.equal(await page.frameLocator('#active-app-frame').locator('button.gp-poster[type="button"]').count(), 2);
});
