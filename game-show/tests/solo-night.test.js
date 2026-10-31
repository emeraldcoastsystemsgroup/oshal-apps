/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger had never managed to play a game show against the computer. Driven live, it worked
 *   only in one exact click order and froze for good outside it. These run the shipped stage.html, scripts and CSS in Chromium
 *   under a light theme: one press from a poster reaches a started game, in order; a reload keeps you at your seat (it used to
 *   leave every clue locked); no dead buttons; a half typed answer survives a re-render; every control a player needs can be
 *   read; Whammy shows PRESS at your own seat; the game ends with the winner and Play again. Seam: the game API is a stub
 *   answering fixed rooms and the theme is a light stand-in. The real kernel crossing is tests/browser-solo-night.test.js.
 *   Needs the store toolchain (express, playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

// The portal's light theme in the variables the stage reads: dark ink meant for a light page.
const LIGHT_THEME = `:root{--text-primary:#1a1a2e;--text-muted:#6b7280;--bg-primary:#f5f7fb;--bg-secondary:#eef1f8;--bg-tertiary:#e6eaf4;
  --bg-card:#ffffff;--bg-card-hover:#f3f5fb;--border-color:#d9deea;--status-warning:#b45309;--status-error:#b91c1c;--status-success:#15803d;
  --accent-primary:#5b5bd6;--accent-primary-hover:#4a4ac4;--accent-secondary:#0369a1;}`;

const ME = { seatId: 'me', name: 'Sam Rivera', team: null, role: 'player', me: true, npc: null, presenceKind: 'avatar', presenceRev: 0, score: 0 };
const BOTS = [
  { seatId: 'b1', name: '🤖 Ace', team: null, role: 'player', me: false, npc: 'sharp', presenceKind: 'avatar', presenceRev: 0, score: 0 },
  { seatId: 'b2', name: '🤖 Marty', team: null, role: 'player', me: false, npc: 'casual', presenceKind: 'avatar', presenceRev: 0, score: 0 },
];
const CATEGORY = { title: 'World Capitals', clues: [0, 1, 2, 3, 4].map((i) => ({ value: (i + 1) * 200, clue: 'This city is the capital of France.', answer: 'Paris', used: false })) };

/** @description One room envelope as the API answers it. */
function room(showId, title, state, seats, extra) {
  return { ok: true, now: Date.now(), rev: 5, events: [], seats, scoreboard: seats.filter((s) => s.role !== 'host').map((s) => ({ seatId: s.seatId, name: s.name, team: s.team, score: 300 })),
    room: { roomId: 'r1', isOwner: true, status: 'live', joinCode: 'B069CC' }, show: { id: showId, title, teams: showId === 'family-feud' }, state: { showId, round: 1, host: { line: '' }, ...state }, ...extra };
}
const jeopardyBoard = { categories: [CATEGORY, CATEGORY, CATEGORY, CATEGORY, CATEGORY, CATEGORY], control: 'me', pick: null, missed: [], wager: null, wagers: {}, finalJudged: {} };
const ROOMS = {
  pick: () => room('jeopardy', 'Jeopardy', { phase: 'board', board: jeopardyBoard }, [ME, ...BOTS]),
  clue: () => room('jeopardy', 'Jeopardy', { phase: 'clue', buzz: { open: true, serial: 1 }, timer: { endsAt: Date.now() + 9000, ms: 12000, note: 'Ring in' }, board: { ...jeopardyBoard, control: null, pick: { cat: 0, row: 0 } } }, [ME, ...BOTS]),
  answer: () => room('jeopardy', 'Jeopardy', { phase: 'answer', buzz: { open: false, lockedBy: 'me', serial: 1 }, board: { ...jeopardyBoard, control: null, pick: { cat: 0, row: 0 } } }, [ME, ...BOTS]),
  midRound: () => room('jeopardy', 'Jeopardy', { phase: 'board', board: { ...jeopardyBoard, control: 'b1' } }, [ME, ...BOTS]),
  wheel: () => room('wheel', 'Wheel of Fortune', { phase: 'puzzle', board: { puzzle: 'PEANUT BUTTER', category: 'Food', guessed: ['T'], banks: { me: 600 }, control: 'me', spin: { value: 300 }, solved: false, roundsTotal: 3 } }, [ME, ...BOTS]),
  whammy: () => room('whammy', 'Whammy!', { phase: 'lights', scores: { me: 500 }, board: { panels: [{ label: '$500', value: 500, kind: 'cash' }], control: 'me', spinsLeft: { me: 3 }, spinsPerPlayer: 5, whammies: {} } }, [ME, ...BOTS]),
  feud: () => room('family-feud', 'Family Feud', { phase: 'play', scores: { A: 100, B: 0 }, board: { question: 'Name a fruit.', strikes: 1, bank: 40, multiplier: 1, control: 'B', answers: [{ text: '', points: 0 }] } }, [{ ...ME, team: 'A' }, { ...BOTS[0], team: 'B' }]),
  decided: () => room('jeopardy', 'Jeopardy', { phase: 'round-win', board: { ...jeopardyBoard, winner: 'me' } }, [ME, ...BOTS], { gameOver: true }),
  over: () => { const r = room('jeopardy', 'Jeopardy', { phase: 'outro', board: { ...jeopardyBoard, winner: 'me' } }, [ME, ...BOTS], { gameOver: true }); r.room.status = 'ended'; r.scoreboard[0].score = 1300; return r; },
  empty: () => room('jeopardy', 'Jeopardy', { phase: 'lobby', round: 0, board: { categories: [] } }, [{ ...ME, role: 'host', me: true }]),
};

/** @description Serve the shipped page over a stub that records every write, in order. */
async function serve(start) {
  const calls = [];
  const live = { key: start, seats: null, seq: 0, rev: 5, events: [] };
  const envelope = () => {
    const r = ROOMS[live.key]();
    if (live.seats) r.seats = live.seats;
    r.rev = live.rev;
    return r;
  };
  const app = express();
  app.use(express.json());
  app.get('/api/game-show/app', (_req, res) => res.sendFile(path.join(PKG, 'ui', 'stage.html')));
  app.get('/stage', (_req, res) => res.sendFile(path.join(PKG, 'ui', 'stage.html')));
  app.get('/api/game-show/state', (_req, res) => res.json(envelope()));
  app.get('/api/game-show/shows', (_req, res) => res.json({ ok: true, shows: [{ id: 'jeopardy', title: 'Jeopardy', tagline: 'Pick a category.' }] }));
  app.get('/api/game-show/rooms', (_req, res) => res.json({ ok: true, rooms: [] }));
  app.get('/api/game-show/leaderboard', (_req, res) => res.json({ ok: true, entries: [] }));
  app.post('/api/game-show/sync', (req, res) => {
    const r = envelope();
    const changed = live.rev > (Number(req.body.rev) || 0);
    const events = live.events.filter((e) => e.seq > (Number(req.body.seq) || 0));
    res.json({ ok: true, now: Date.now(), rev: live.rev, changed, state: changed ? r.state : undefined, seats: r.seats, scoreboard: r.scoreboard, gameOver: !!r.gameOver, status: r.room.status, events });
  });
  app.post('/api/game-show/rooms', (req, res) => { calls.push(['rooms', req.body]); res.json({ ok: true, room: { roomId: 'r1' } }); });
  app.post('/api/game-show/seat', (req, res) => {
    calls.push(['seat', req.body]);
    live.seats = [{ ...ME, team: req.body.team || null }];
    res.json({ ok: true });
  });
  app.post('/api/game-show/podium', (req, res) => {
    calls.push(['podium', req.body]);
    (live.seats || (live.seats = [])).push({ ...BOTS[0], seatId: 'n' + calls.length, team: req.body.team || null, npc: req.body.npc });
    res.json({ ok: true, seatId: 'n' + calls.length });
  });
  app.post('/api/game-show/host', (req, res) => { calls.push(['host', req.body]); live.key = 'pick'; live.rev++; res.json({ ok: true, rev: live.rev, state: ROOMS.pick().state }); });
  app.get(/^\/api\/game-show\/[\w-]+\.(js|css)$/, (req, res) => res.sendFile(path.join(PKG, 'ui', path.basename(req.path))));
  app.use('/api/game-show', (_req, res) => res.json({ ok: true }));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(LIGHT_THEME));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}`, calls, live };
}

/** @description Open a stage page; closes everything when the test ends. */
async function open(t, start, query) {
  const srv = await serve(start);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => srv.server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(`${srv.base}/stage?${query || 'view=stage&room=r1'}`);
  return { page, ...srv };
}

/** @description The element's text colour as relative luminance (WCAG), 1 is white. */
async function inkLuminance(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const [r, g, b] = getComputedStyle(el).color.match(/[\d.]+/g).map(Number);
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  });
}

test('one press on a poster seats you, seats the computer players and starts, in that order', async (t) => {
  const { page, calls } = await open(t, 'empty', 'view=stage&lobby=1');
  const poster = page.locator('button.gp-poster').first();
  await poster.waitFor();
  assert.match(await poster.innerText(), /play against the computer/i);
  await poster.click();
  await page.locator('.gsj-wall').waitFor();
  assert.equal(calls[0][0], 'rooms');
  assert.deepEqual([calls[1][0], calls[1][1].role], ['seat', 'player'], 'you step up to your own seat first');
  assert.ok(calls.slice(2, -1).every((c) => c[0] === 'podium' && c[1].npc), 'then only computer players are added');
  assert.deepEqual([calls.at(-1)[0], calls.at(-1)[1].mode], ['host', 'start'], 'and the show starts last');
  assert.ok(!calls.slice(2, -1).some((c) => c[1].name), 'no second podium is made for you');
});

test('an empty stage offers the computer, never a Start that strands you', async (t) => {
  const { page } = await open(t, 'empty');
  await page.locator('.gp-dock').waitFor();
  const dock = await page.locator('.gp-dock').innerText();
  assert.match(dock, /play against the computer/i);
  assert.doesNotMatch(dock, /start the show/i);
});

test('after a reload you are still at your seat and the clues can be picked', async (t) => {
  const { page } = await open(t, 'pick');
  await page.locator('.gsj-wall').waitFor();
  assert.equal(await page.locator('.gsj-cell.locked').count(), 0, 'no clue is locked on your pick');
  await page.reload();
  await page.locator('.gsj-wall').waitFor();
  assert.equal(await page.locator('.gsj-cell.locked').count(), 0, 'still none after a reload');
  assert.match(await page.locator('.gp-coach').innerText(), /your pick/i);
});

test('mid-round there is no dead Next round button, and whose turn it is is said', async (t) => {
  const { page } = await open(t, 'midRound');
  await page.locator('.gp-coach').waitFor();
  assert.match(await page.locator('.gp-coach').innerText(), /Ace is picking/);
  assert.equal(await page.getByText('Next round').count(), 0);
});

test('a half typed answer survives the page re-rendering around it', async (t) => {
  const { page, live } = await open(t, 'answer');
  const box = page.locator('.gp-dock input.gs-input');
  await box.waitFor();
  await box.click();
  await page.keyboard.type('Par');
  live.events.push({ seq: 1, kind: 'reveal', content: 'The room moved on' });
  live.rev++;
  await page.getByText('The room moved on').waitFor();
  assert.equal(await box.inputValue(), 'Par', 'the text is still there');
  await page.keyboard.type('is');
  assert.equal(await box.inputValue(), 'Paris', 'and the field still has the keyboard');
});

test('when the answer box appears the keyboard is already in it', async (t) => {
  const { page } = await open(t, 'answer');
  await page.locator('.gp-dock input.gs-input').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.className), 'gs-input');
});

test('the same event delivered by two overlapping polls counts once', async (t) => {
  const { page } = await open(t, 'pick');
  await page.locator('.gsj-wall').waitFor();
  const counted = await page.evaluate(() => {
    const e = { seq: 9, kind: 'reveal', content: 'once' };
    window.GS.ingest({ events: [e] });
    window.GS.ingest({ events: [e] });
    return window.GS.events.filter((x) => x.content === 'once').length;
  });
  assert.equal(counted, 1);
});

test('under a light theme everything on the set is light ink on the dark studio', async (t) => {
  for (const [key, selectors] of [
    ['clue', ['.gsj-clue-text', '.gp-nameplate', '.gp-coach', '.gs-bigclock']],
    ['pick', ['.gsj-cat', '.gsj-cell', '.gp-charscore']],
    ['wheel', ['.gsw-letter', '.gsw-pod-name']],
    ['whammy', ['.gsy-pass', '.gsy-pod .name', '.gsy-pod .bank']],
    ['feud', ['.gsf-question', '.gp-coach']],
  ]) {
    await t.test(key, async (sub) => {
      const { page } = await open(sub, key);
      await page.locator('.gp-dock').waitFor();
      for (const selector of selectors) {
        await page.locator(selector).first().waitFor();
        assert.ok(await inkLuminance(page, selector) > 0.4, `${selector} reads on the dark set`);
      }
    });
  }
});

test('a refusal toast can be read', async (t) => {
  const { page } = await open(t, 'pick');
  await page.locator('.gsj-wall').waitFor();
  const color = await page.evaluate(() => { window.GS.toast('Not your turn'); return getComputedStyle(document.querySelector('.gs-float')).color; });
  assert.equal(color, 'rgb(255, 255, 255)');
});

test('Whammy shows PRESS to a person at their own seat, and PRESS does not move', async (t) => {
  const { page } = await open(t, 'whammy');
  const press = page.locator('.gp-dock .gsy-press');
  await press.waitFor();
  const before = await press.boundingBox();
  await page.evaluate(() => { window.GS.state.board.control = null; window.GS.render(); });
  const after = await press.boundingBox();
  assert.equal(Math.round(before.x), Math.round(after.x), 'Pass my spins coming and going leaves PRESS where it was');
});

test('Feud hides the answer box while the other team holds the board', async (t) => {
  const { page } = await open(t, 'feud');
  await page.locator('.gp-coach').waitFor();
  assert.equal(await page.locator('.gp-dock input.gs-input').count(), 0);
  assert.match(await page.locator('.gp-coach').innerText(), /Team B has the board/);
});

test('a decided game offers the finish, and the finished game names the winner and offers another', async (t) => {
  const decided = await open(t, 'decided');
  await decided.page.getByText('Finish the show').waitFor();
  assert.equal(await decided.page.getByText('Next round').count(), 0);
  const over = await open(t, 'over');
  await over.page.getByText('Play again').waitFor();
  assert.match(await over.page.locator('.gp-coach').innerText(), /You win with \$1300/);
  await over.page.getByText('Pick another game').waitFor();
});
