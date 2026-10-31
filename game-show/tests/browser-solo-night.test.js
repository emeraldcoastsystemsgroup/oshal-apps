/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The real kernel crossing for "a person can play against the computer": on the desktop and at
 *   phone size, from the lobby of a running stack, one press on each show's poster reaches a started game; the person takes a real
 *   turn through the rendered controls; a reload keeps them at their seat with a move still possible; the control they need is on
 *   screen and not covered; and the finished game offers Play again. The real routes, room service, kernel SQL and CSS, with one
 *   seam: the start is rewritten to the same zero-LLM manual rail the other browser scenarios use, so the board is deterministic
 *   and costs nothing. Needs GS_BASE_URL and GS_PAT for the live stack, and PLAYWRIGHT_MODULE when it is not resolvable.
 */
'use strict';

const { runBrowserScenario } = require('./browser-show-harness');

const CLUE = 'This city on the Seine, home of the Eiffel Tower and the Louvre, has been the capital of France for centuries and is known around the world.';
const CONTENT = {
  'family-feud': { question: 'Name a fruit people eat every day?', answers: [{ text: 'Apple', points: 40, aliases: [] }, { text: 'Banana', points: 30, aliases: [] }, { text: 'Orange', points: 20, aliases: [] }, { text: 'Pear', points: 10, aliases: [] }] },
  jeopardy: { categories: ['Cities', 'Rivers', 'Stars', 'Films', 'Foods', 'Words'].map((title) => ({ title, clues: [1, 2, 3, 4, 5].map(() => ({ clue: CLUE, answer: 'Paris' })) })) },
  wheel: { category: 'Food', puzzle: 'PEANUT BUTTER AND JELLY' },
  whammy: { panels: ['Maui', 'Bucks', 'Bike', 'Theater', 'Snack', 'Money', 'Spa', 'Dip', 'Row', 'Flamingo'].map((label, i) => ({ label, value: 300 + i * 100, kind: 'cash' })) },
};

/** @description Prove a control is on screen, on top, and pressable: not behind the dock, not scrolled away. */
async function isPressable(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  });
}

/** @description The first turn each show asks of a person, through the rendered controls. */
const TURNS = {
  async 'family-feud'(harness, page) {
    await page.locator('.gs-dockbuzz').first().waitFor({ timeout: 15000 });
    harness.check(await isPressable(page, '.gs-dockbuzz'), 'BUZZ IN is on screen and pressable');
    await page.locator('.gs-dockbuzz').first().click();
    const box = page.locator('.gp-dock input.gs-input');
    await box.waitFor({ timeout: 8000 });
    await box.fill('Apple');
    await box.press('Enter');
    harness.check(await harness.waitForText(page, 'Apple'), 'the answer lands on the board');
  },
  async jeopardy(harness, page) {
    harness.check(await harness.waitForText(page, 'Your pick', 15000), 'the dock says it is your pick');
    harness.check(await isPressable(page, '.gsj-cell'), 'a dollar amount is on screen and pressable');
    await page.locator('.gsj-cell').first().click();
    await page.locator('.gs-dockbuzz').first().waitFor({ timeout: 8000 });
    const dockTop = await page.locator('.gp-dock-inner').evaluate((el) => el.getBoundingClientRect().top);
    const clueBottom = await page.locator('.gsj-clue-text').evaluate((el) => el.getBoundingClientRect().bottom);
    harness.check(clueBottom <= dockTop, `the whole clue clears the dock (${Math.round(clueBottom)} <= ${Math.round(dockTop)})`);
    await page.locator('.gs-dockbuzz').first().click();
    const box = page.locator('.gp-dock input.gs-input');
    await box.waitFor({ timeout: 8000 });
    await box.fill('Paris');
    await box.press('Enter');
    harness.check(await harness.waitForText(page, '+$200', 8000), 'the dock reports the right answer and the money');
    harness.check(await harness.waitForText(page, 'Your pick', 8000), 'and hands you the next pick');
  },
  async wheel(harness, page) {
    await page.locator('.gsw-spinbtn').waitFor({ timeout: 15000 });
    harness.check(await isPressable(page, '.gsw-spinbtn'), 'SPIN is on screen and pressable');
    await page.locator('.gp-dock input.gs-input').fill('peanut butter and jelly');
    await page.locator('.gp-dock input.gs-input').press('Enter');
    harness.check(await harness.waitForText(page, 'SOLVES IT', 8000), 'typing the puzzle solves it');
    harness.check(await harness.waitForText(page, 'Next puzzle', 8000), 'and the next step is named');
  },
  async whammy(harness, page) {
    await page.locator('.gsy-press').waitFor({ timeout: 15000 });
    harness.check(await isPressable(page, '.gsy-press'), 'PRESS is on screen and pressable');
    await page.locator('.gsy-press').click();
    harness.check(await harness.waitForText(page, 'stops on', 6000) || await harness.waitForText(page, 'WHAMMY', 2000), 'the press lands on a panel');
  },
};

/** @description Play one show from its poster to its end. */
async function playShow(harness, showId, viewport, label) {
  const context = await harness.browser.newContext({ extraHTTPHeaders: harness.headers, viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/game-show/host', async (route) => {
    const body = route.request().postDataJSON();
    if (body.mode !== 'start') return route.continue();
    return route.continue({ postData: JSON.stringify({ ...body, mode: 'manual', payload: { content: CONTENT[showId] } }) });
  });
  await page.goto(harness.base + '/api/game-show/stage?view=stage&lobby=1', { waitUntil: 'domcontentloaded' });
  const poster = page.locator(`button.gp-poster[data-show="${showId}"]`);
  await poster.waitFor({ timeout: 10000 });
  harness.check(/play against the computer/i.test(await poster.innerText()), `${label}: the poster says what it does`);
  await poster.click();
  await page.waitForFunction(() => window.GS && window.GS.state && window.GS.state.phase && window.GS.state.phase !== 'lobby', null, { timeout: 30000 });
  const roomId = await page.evaluate(() => window.GS.roomId);
  harness.roomIds.push(roomId);
  const started = await harness.state(roomId);
  const me = started.seats.find((s) => s.me);
  harness.check(me && me.role === 'player', `${label}: one press seated you at your own seat`);
  harness.check(started.seats.length >= 4 && started.seats.filter((s) => s.npc).length >= 3, `${label}: and filled the stage with computer players`);
  harness.check(!started.seats.some((s) => String(s.name).startsWith('⭐')), `${label}: with no second podium for you`);

  await page.locator('.gp-intro').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await TURNS[showId](harness, page);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.gp-dock').waitFor({ timeout: 10000 });
  harness.check(await page.evaluate(() => window.GS.canPlay()), `${label}: after a reload you still play at your seat`);
  harness.check(await page.evaluate(() => window.GS.actingSeat() === window.GS.mySeat().seatId), `${label}: as yourself, not a podium held in memory`);

  await page.evaluate(() => window.GS.act({ type: 'endGame' }));
  await harness.post('/status', { roomId, status: 'ended' });
  harness.check(await harness.waitForText(page, 'Play again', 15000), `${label}: the finished game offers Play again`);
  harness.check(await harness.waitForText(page, 'Pick another game', 3000), `${label}: and another game`);
  harness.check(errors.length === 0, `${label}: no script errors${errors.length ? ': ' + errors[0] : ''}`);
  await context.close();
}

runBrowserScenario('Solo night', 'one press to a played game on every show, desktop and phone', async (harness) => {
  for (const showId of Object.keys(CONTENT)) {
    await playShow(harness, showId, { width: 1280, height: 720 }, showId + ' desktop');
    await playShow(harness, showId, { width: 412, height: 838 }, showId + ' phone');
  }
});
