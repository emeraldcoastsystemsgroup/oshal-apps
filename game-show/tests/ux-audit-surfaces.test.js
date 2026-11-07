/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (game-show clicker, stage, host, review). In Chromium over the
 *   shipped stage.html, ui scripts and CSS, under the light-blue theme's tokens: the clicker has one header row with a 44px ?
 *   that opens How to play as a sheet (no reload) and no New game; its dome is at most 240px and steps aside for a full-width
 *   52px Answer in the top third; its BUZZ reads at 4.5:1 and a waiting one is drawn at opacity 1; team and Show me as live in
 *   the You sheet; the answer field is at most 640px on a desktop. The stage draws no second header, puts ? and ⋯ More on its
 *   marquee, asks before New game, has a 44px ⚙, carries the host's line in the dock (no lower third under it), shows both
 *   teams side by side above the dock at 412 x 743, and gives a host without a podium one Join this game that seats them through
 *   the You sheet; the set is data-ds-game and only the game views lock zoom. The Host Desk has one primary, its answer key
 *   reveals a slot through the override, Rehearsal and Big Screen wait in ⋯ More, Show setup is a sheet with one row per
 *   answer, + Team A adds a podium with no dialog, and a host voice with no audio says "Voice off, captions only". The lobby
 *   shows Recent games with Play again; a refusal toast is drawn above an open sheet. Seam: the game API is a stub server recording every write. Needs the store toolchain.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

// The portal's default theme (cockpit/css/themes/light-blue.css as served 2026-11-06), in the variables the pages read.
const LIGHT_BLUE = `:root{--text-on-accent:#111827;--bg-primary:#eaf4ff;--bg-secondary:rgba(255,255,255,.78);--bg-tertiary:rgba(222,237,255,.74);
  --bg-card:rgba(255,255,255,.62);--bg-card-hover:rgba(255,255,255,.82);--border-color:rgba(59,130,246,.1);--text-primary:#10233f;
  --text-secondary:#315b8a;--text-muted:#5f86b5;--accent-primary:#3b82f6;--accent-primary-hover:#60a5fa;--status-warning:#b45309;
  --status-error:#b91c1c;--status-success:#15803d;}`;

const ME = { seatId: 'me', name: 'Sam Rivera', team: 'A', role: 'player', me: true, npc: null, presenceKind: 'avatar', presenceRev: 0 };
const HOST_ME = { ...ME, team: null, role: 'host' };
const BOTS = ['Ace', 'Marty', 'Ziggy', 'Bo', 'Cleo'].map((n, i) => ({ seatId: 'b' + i, name: '🤖 ' + n, team: i < 2 ? 'A' : 'B', role: 'player', me: false, npc: 'sharp', presenceKind: 'avatar', presenceRev: 0 }));
const ANSWERS = [['Refrigerator', 40, false], ['Stove', 30, true], ['Sink', 20, false], ['Toaster', 10, false]].map(([text, points, revealed]) => ({ text, points, revealed }));

/** @description A Family Feud room envelope; phase decides the buzzer and the answer box. */
function feud(phase, seats, extra) {
  const buzz = phase === 'faceoff' ? { open: true, serial: 1 } : { open: false, lockedBy: phase === 'answer' ? 'me' : null, serial: 1 };
  return { ok: true, now: Date.now(), rev: 5, events: [], seats,
    scoreboard: [{ team: 'A', name: 'Team A', score: 70 }, { team: 'B', name: 'Team B', score: 0 }],
    room: { roomId: 'r1', isOwner: true, status: 'live', joinCode: '9E8789' }, show: { id: 'family-feud', title: 'Family Feud', teams: true },
    state: { showId: 'family-feud', phase: phase === 'answer' ? 'faceoff' : phase, round: 2, buzz, host: { line: 'Round 2: Name something people do while waiting in line.', at: Date.now() },
      timer: { endsAt: Date.now() + 30000, ms: 30000, note: 'Buzz in' },
      board: { question: 'Name something people do while waiting in line.', faceoff: phase === 'answer' ? { stage: 'first', firstSeat: 'me' } : null, strikes: 0, bank: 0, multiplier: 1, control: null, answers: ANSWERS, roundsTotal: 3 } },
    ...extra };
}
const ROOMS = {
  faceoff: () => feud('faceoff', [ME, ...BOTS]),
  answer: () => feud('answer', [ME, ...BOTS]),
  hostOnly: () => feud('faceoff', [HOST_ME, ...BOTS]),
  between: () => feud('round-win', [ME, ...BOTS]),
  emptyLobby: () => { const r = feud('lobby', [HOST_ME]); r.state.round = 0; r.state.board.answers = []; return r; },
};

async function serve(start) {
  const calls = [], live = { key: start };
  const app = express();
  app.use(express.json());
  app.get('/stage', (_req, res) => res.sendFile(path.join(PKG, 'ui', 'stage.html')));
  app.get('/api/game-show/state', (_req, res) => res.json(ROOMS[live.key]()));
  app.get('/api/game-show/shows', (_req, res) => res.json({ ok: true, shows: [{ id: 'family-feud', title: 'Family Feud' }, { id: 'jeopardy', title: 'Jeopardy' }] }));
  app.get('/api/game-show/rooms', (_req, res) => res.json({ ok: true, rooms: [] }));
  app.get('/api/game-show/leaderboard', (_req, res) => res.json({ ok: true, entries: [
    { name: 'Sam', team: 'A', score: 220, showId: 'family-feud', endedAt: '2026-11-05T20:00:00Z' },
    { name: 'Sam', team: null, score: 1300, showId: 'jeopardy', endedAt: '2026-11-04T20:00:00Z' },
    { name: '🤖 Ace', team: 'B', score: 90, showId: 'family-feud', endedAt: '2026-11-05T20:00:00Z' }] }));
  app.post('/api/game-show/sync', (_req, res) => { const r = ROOMS[live.key](); res.json({ ok: true, now: Date.now(), rev: 5, changed: false, seats: r.seats, scoreboard: r.scoreboard, events: [], status: 'live' }); });
  app.post('/api/game-show/tts', (req, res) => { calls.push(['tts', req.body]); res.json({ ok: true }); });
  app.post('/api/game-show/speaker', (_req, res) => res.json({ ok: true, speaker: false }));
  app.post('/api/game-show/host', (req, res, next) => {
    if (live.key !== 'emptyLobby') return next();
    calls.push(['host', req.body]);
    res.json({ ok: false, error: 'Nobody is at a podium yet. Play against the computer, or wait for someone to join with the code.' });
  });
  app.post(/^\/api\/game-show\/(\w+)$/, (req, res) => { calls.push([req.params[0], req.body]); res.json({ ok: true, room: { roomId: 'r2' } }); });
  app.get(/^\/api\/game-show\/[\w-]+\.(js|css)$/, (req, res) => res.sendFile(path.join(PKG, 'ui', path.basename(req.path))));
  app.use('/api/game-show', (_req, res) => res.json({ ok: true }));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(LIGHT_BLUE));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}`, calls, live };
}

async function open(t, start, query, viewport, touch) {
  const srv = await serve(start);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => srv.server.close(r)); });
  const page = await (await browser.newContext({ viewport, isMobile: !!touch, hasTouch: !!touch })).newPage();
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(`${srv.base}/stage?${query}`);
  return { page, dialogs, ...srv };
}
const PHONE = { width: 412, height: 915 };

/** @description WCAG contrast of an element's ink on its own (opaque) fill. */
function inkOnFill(el) {
  const rgb = (c) => c.match(/[\d.]+/g).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cs = getComputedStyle(el), a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor));
  return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), opacity: Number(cs.opacity), fill: cs.backgroundColor };
}

test('clicker: one header row with a 44px ? that opens How to play in place, and no New game', async (t) => {
  const { page } = await open(t, 'faceoff', 'view=clicker&room=r1', PHONE, true);
  await page.locator('.gs-buzz-btn').waitFor();
  assert.equal(await page.getByText('New game').count(), 0, 'a contestant cannot reset the room from the clicker');
  const help = page.locator('.gs-top [aria-label="How to play"]');
  const box = await help.boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `? is ${box.width}x${box.height}`);
  const before = page.url();
  await help.tap();
  await page.locator('#gs-sheets [role="dialog"][aria-label="How to play"]').waitFor();
  assert.match(await page.locator('#gs-sheets .gs-help-show.current h3').innerText(), /Family Feud/, 'the running show comes first');
  assert.equal(page.url(), before, 'Help opens without leaving the game');
  await page.locator('#gs-sheets .gs-sheet-done').tap();
  assert.equal(await page.locator('#gs-sheets [role="dialog"]').count(), 0);
  const top = await page.locator('.gs-clickroot .gs-top').boundingBox();
  assert.ok(top.height <= 56, `the header is one row (${top.height}px)`);
});

test('clicker: a 240px dome that reads, team and Show me as in the You sheet', async (t) => {
  const { page, calls } = await open(t, 'faceoff', 'view=clicker&room=r1', PHONE, true);
  const dome = page.locator('.gs-buzz-btn');
  await dome.waitFor();
  const size = await dome.boundingBox();
  assert.ok(size.width <= 240.5, `the dome is ${size.width}px wide`);
  const on = await dome.evaluate(inkOnFill);
  assert.ok(on.ratio >= 4.5, `BUZZ reads at ${on.ratio.toFixed(2)}:1 on ${on.fill}`);
  assert.equal(await page.getByText('Show me as').count(), 0, 'presence is not on the phone page');
  await page.locator('.gs-clickwho .gp-you-btn').tap();
  await page.locator('#gs-sheets [aria-label="You"]').waitFor();
  assert.ok(await page.locator('#gs-sheets').getByText('Show me as').count() > 0);
  await page.locator('#gs-sheets').getByRole('button', { name: 'Team B' }).tap();
  await page.waitForFunction(() => document.querySelector('#gs-sheets [aria-label="You"]'));
  assert.ok(calls.some(([k, b]) => k === 'seat' && b.team === 'B'), 'Team B moves the seat');
});

test('clicker: a waiting BUZZ is drawn at opacity 1; answering moves the dome aside for a full-width Answer', async (t) => {
  const waiting = await open(t, 'between', 'view=clicker&room=r1', PHONE, true);
  await waiting.page.locator('.gs-buzz-btn').waitFor();
  assert.equal((await waiting.page.locator('.gs-buzz-btn').evaluate(inkOnFill)).opacity, 1);
  const { page } = await open(t, 'answer', 'view=clicker&room=r1', PHONE, true);
  await page.locator('#gs-dock input.gs-input').waitFor();
  assert.equal(await page.locator('.gs-buzz-btn').isVisible(), false, 'the dome collapses while the answer box is open');
  const field = await page.locator('#gs-dock input.gs-input').boundingBox();
  const go = await page.locator('.gs-answer-go').boundingBox();
  assert.ok(field.y + field.height <= PHONE.height / 3, `the field is in the top third (ends at ${field.y + field.height})`);
  assert.ok(go.height >= 52 && go.width >= 250, `Answer is ${go.width}x${go.height}`);
});

test('clicker on a desktop: the answer field is at most 640px wide', async (t) => {
  const { page } = await open(t, 'answer', 'view=clicker&room=r1', { width: 1440, height: 900 });
  await page.locator('#gs-dock input.gs-input').waitFor();
  const box = await page.locator('.gs-answer').boundingBox();
  assert.ok(box.width <= 640.5, `the answer row is ${box.width}px`);
});

test('stage: one header on the set, ? and More there, New game asks first, a 44px ⚙, the host line in the dock', async (t) => {
  const { page } = await open(t, 'faceoff', 'view=stage&room=r1', { width: 1280, height: 800 });
  await page.locator('.gp-dock').waitFor();
  assert.equal(await page.locator('.gp-studio .gs-top').count(), 0, 'no chip strip above the set');
  assert.equal(await page.locator('.gp-studio[data-ds-game]').count(), 1);
  assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /user-scalable=no/, 'the game keeps its zoom lock');
  assert.equal(await page.locator('.gp-lower').count(), 0, 'no lower third under the dock');
  assert.match(await page.locator('.gp-dock .gp-hostline').innerText(), /HOST\s*Round 2/);
  const gear = await page.locator('.gp-tools a[aria-label="Host desk"]').boundingBox();
  assert.ok(gear.width >= 44 && gear.height >= 44, `⚙ is ${gear.width}x${gear.height}`);
  const tools = await page.locator('.gp-tools').boundingBox(), coach = await page.locator('.gp-coach').boundingBox();
  assert.ok(coach.y >= tools.y + tools.height - 0.5, `the coach line (${coach.y}) starts below the dock tools (end ${tools.y + tools.height})`);
  await page.locator('.gp-marquee [aria-label="More"]').click();
  await page.getByRole('menuitem', { name: 'New game' }).click();
  await page.locator('#gs-sheets [aria-label="Start a new game?"]').waitFor();
  const before = page.url();
  await page.getByRole('button', { name: 'Stay in this game' }).click();
  assert.equal(page.url(), before, 'staying keeps the game');
  await page.locator('.gp-marquee [aria-label="How to play"]').click();
  await page.locator('#gs-sheets [aria-label="How to play"]').waitFor();
});

test('stage on a phone: Team A and Team B side by side above the dock at 412 x 743', async (t) => {
  const { page } = await open(t, 'faceoff', 'view=stage&room=r1', { width: 412, height: 743 }, true);
  await page.locator('.gp-dock-inner').waitFor();
  await page.waitForTimeout(300);
  const [a, b] = await page.locator('.gp-team-group').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const dock = await page.locator('.gp-dock-inner').boundingBox();
  const tools = await page.locator('.gp-tools').boundingBox(), coach = await page.locator('.gp-coach').boundingBox();
  assert.ok(coach.y >= tools.y + tools.height - 0.5, `on a phone too the coach line starts below the dock tools`);
  assert.ok(Math.abs(a.top - b.top) < 4, `the teams share a row (${a.top} and ${b.top})`);
  assert.ok(a.bottom <= dock.y + 0.5 && b.bottom <= dock.y + 0.5, `both teams end (${a.bottom}, ${b.bottom}) above the dock (${dock.y})`);
  assert.ok(b.right <= 412.5, `Team B ends inside the screen (${b.right})`);
});

test('stage: a host without a podium gets one Join this game, and it seats them through the You sheet', async (t) => {
  const { page, calls } = await open(t, 'hostOnly', 'view=stage&room=r1', { width: 1280, height: 800 });
  const join = page.getByRole('button', { name: 'Join this game' });
  await join.waitFor();
  await join.click();
  await page.locator('#gs-sheets [aria-label="You"]').waitFor();
  await page.locator('#gs-sheets').getByRole('button', { name: 'Play on Team A' }).click();
  await page.waitForFunction(() => !document.querySelector('#gs-sheets [role="dialog"]'));
  assert.ok(calls.some(([k, body]) => k === 'seat' && body.role === 'player' && body.team === 'A'), 'Play on Team A takes a player seat');
});

test('host desk: one primary, a live answer key, More holds Rehearsal and Big Screen, zoom stays open', async (t) => {
  const { page, calls } = await open(t, 'faceoff', 'view=host&room=r1', { width: 1280, height: 800 });
  await page.locator('.gs-desk').waitFor();
  assert.doesNotMatch(await page.locator('meta[name="viewport"]').getAttribute('content'), /user-scalable=no/);
  assert.equal(await page.locator('.gs-desk-cues .gs-btn.primary').count(), 1);
  assert.equal(await page.getByText('Rehearsal').count(), 0, 'Rehearsal waits in More');
  const next = await page.locator('.gs-desk-next').boundingBox();
  assert.ok(next.y < 300, `Next round is in the first screen (${next.y})`);
  const hidden = page.getByRole('button', { name: 'Reveal 1. Refrigerator' });
  await hidden.click();
  assert.ok(calls.some(([k, b]) => k === 'action' && b.action.type === 'forceReveal' && b.action.index === 0), 'the row reveals slot 1');
  assert.equal(await page.getByRole('button', { name: 'Revealed: 2. Stove' }).isDisabled(), true);
  await page.locator('.gs-top [aria-label="More"]').click();
  assert.ok(await page.getByRole('menuitem', { name: 'Rehearsal' }).count());
  assert.ok(await page.getByRole('menuitem', { name: 'Big Screen (new tab)' }).count());
});

test('host desk: Show setup is a sheet with one row per answer, and + Team A adds a podium with no dialog', async (t) => {
  const { page, calls, dialogs } = await open(t, 'between', 'view=host&room=r1', { width: 1280, height: 800 });
  await page.locator('.gs-desk').waitFor();
  await page.locator('.gs-top [aria-label="More"]').click();
  await page.getByRole('menuitem', { name: 'Show setup' }).click();
  const sheet = page.locator('#gs-sheets [aria-label="Show setup"]');
  await sheet.waitFor();
  await sheet.getByLabel('Question').fill('Name something in a kitchen');
  for (const [i, [text, pts]] of [['Fridge', 40], ['Stove', 30], ['Sink', 20]].entries()) {
    await sheet.getByLabel(`Answer ${i + 1}`, { exact: true }).fill(text);
    await sheet.getByLabel(`Points for answer ${i + 1}`).fill(String(pts));
  }
  await sheet.getByLabel('Also accept for answer 1').fill('refrigerator, icebox');
  await sheet.getByRole('button', { name: '+ Team A' }).click();
  await page.waitForTimeout(200);
  assert.ok(calls.some(([k, b]) => k === 'podium' && b.team === 'A' && /^Team A \d+$/.test(b.name)), '+ Team A posts the podium with an automatic name');
  assert.deepEqual(dialogs, [], 'no browser dialog');
  await sheet.getByRole('button', { name: 'Play my questions' }).click();
  const manual = calls.find(([k, b]) => k === 'host' && b.mode === 'manual');
  assert.ok(manual, 'Play my questions sends the board');
  assert.deepEqual(manual[1].payload.content, { question: 'Name something in a kitchen', answers: [
    { text: 'Fridge', points: 40, aliases: ['refrigerator', 'icebox'] }, { text: 'Stove', points: 30, aliases: [] }, { text: 'Sink', points: 20, aliases: [] }] });
});

test('host desk: a host voice with no audio says Voice off, captions only', async (t) => {
  const { page } = await open(t, 'faceoff', 'view=host&room=r1', { width: 1280, height: 800 });
  await page.locator('.gs-desk').waitFor();
  assert.equal(await page.getByText('Voice off, captions only').count(), 0);
  await page.evaluate(() => { window.GS.isVoice = true; window.GS.speak('Welcome to the show'); });
  await page.getByText('Voice off, captions only').waitFor();
});

test('lobby: Recent games shows the last ended games with Play again', async (t) => {
  const { page, calls } = await open(t, 'faceoff', 'view=stage&lobby=1', { width: 1280, height: 800 });
  const cards = page.locator('.gp-recent-card');
  await cards.first().waitFor();
  assert.equal(await cards.count(), 2);
  assert.match(await cards.first().innerText(), /Family Feud[\s\S]*Team A · 220/);
  assert.doesNotMatch(await page.locator('meta[name="viewport"]').getAttribute('content'), /user-scalable=no/, 'the lobby is a page a person may zoom');
  await cards.nth(1).getByRole('button', { name: 'Play again' }).click();
  await page.waitForTimeout(200);
  assert.ok(calls.some(([k, b]) => k === 'rooms' && b.showId === 'jeopardy'), 'Play again opens that show');
});

test('host desk: a refusal while Show setup is open is drawn above the sheet', async (t) => {
  const { page } = await open(t, 'emptyLobby', 'view=host&room=r1', { width: 412, height: 915 }, true);
  await page.locator('.gs-desk').waitFor();
  await page.locator('.gs-top [aria-label="More"]').tap();
  await page.getByRole('menuitem', { name: 'Show setup' }).tap();
  const sheet = page.locator('#gs-sheets [aria-label="Show setup"]');
  await sheet.getByLabel('Question').fill('Name a fruit');
  for (const [i, text] of ['Apple', 'Banana', 'Pear'].entries()) await sheet.getByLabel(`Answer ${i + 1}`, { exact: true }).fill(text);
  await sheet.getByRole('button', { name: 'Play my questions' }).tap();
  const toast = page.locator('.gs-float', { hasText: 'wait for someone to join with the code' });
  await toast.waitFor();
  // A toast takes no pointer events, so it is made hittable for the probe: is it the topmost thing at its own centre?
  const onTop = await toast.evaluate((el) => { el.style.pointerEvents = 'auto'; const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit === el || el.contains(hit); });
  assert.ok(onTop, 'the refusal is on top of the sheet, not under it');
  assert.equal(await sheet.isVisible(), true, 'the sheet stays open with what was typed');
});
