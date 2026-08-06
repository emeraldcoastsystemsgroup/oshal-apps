/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the real Wheel browser scenario: follow live turn ownership through random wheel outcomes, call a puzzle consonant, and solve through the rendered player dock.
 */

'use strict';

const { runBrowserScenario } = require('./browser-show-harness');

const PUZZLE = 'A BLESSING IN DISGUISE';
const CONTENT = { category: 'Phrase', puzzle: PUZZLE };
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const MAX_SPINS = 30;

/** @description Identify the board fields a spin must change, ignoring asynchronous host-line revisions. */
function spinSignature(board) {
  return JSON.stringify([board.control, board.spin, board.banks]);
}

/** @description Pick a consonant that is actually present instead of assuming a generated puzzle shape. */
function presentConsonant(puzzle, guessed) {
  return String(puzzle || '').split('').find((letter) => CONSONANTS.includes(letter) && !(guessed || []).includes(letter));
}

/** @description Wait for one rendered button-driven spin to change the authoritative room revision. */
async function clickSpin(harness, room, surfaces, before) {
  const seatId = before.state.board.control || room.seats[0].seatId;
  const page = surfaces.players[seatId];
  const button = page.locator('.gp-dock .gsw-spinbtn');
  const signature = spinSignature(before.state.board);
  await button.waitFor({ state: 'visible', timeout: 10000 });
  await button.click();
  const after = await harness.waitForState(room.roomId, (body) => {
    const board = body.state && body.state.board;
    return Number(body.rev) > Number(before.rev) && board && spinSignature(board) !== signature;
  });
  if (!after || spinSignature(after.state.board) === signature) throw new Error('the rendered spin did not mutate the live wheel before its deadline');
  return { after, page, seatId };
}

/** @description Follow whichever player owns the wheel until the server lands on a dollar segment. */
async function spinForValue(harness, room, surfaces) {
  for (let attempt = 1; attempt <= MAX_SPINS; attempt++) {
    const before = await harness.state(room.roomId);
    const result = await clickSpin(harness, room, surfaces, before);
    const spin = result.after && result.after.state && result.after.state.board.spin;
    if (spin && spin.value != null) return { ...result, attempt, value: spin.value };
  }
  return null;
}

/** @description Call one live puzzle consonant through its actual rendered letter button. */
async function callConsonant(harness, room, surfaces, spun) {
  const board = spun.after.state.board;
  const letter = presentConsonant(board.puzzle, board.guessed);
  harness.require(!!letter, 'the live puzzle has an uncalled consonant');
  const choice = spun.page.locator('.gsw-letters').getByRole('button', { name: letter, exact: true });
  await choice.waitFor({ state: 'visible', timeout: 10000 });
  await choice.click();
  const called = await harness.waitForState(room.roomId, (body) => {
    const guessed = body.state && body.state.board && body.state.board.guessed;
    return Array.isArray(guessed) && guessed.includes(letter);
  });
  harness.check(called && called.state.board.control === spun.seatId, 'a present consonant keeps the live wheel with its caller');
  harness.check(Number(called.state.board.banks[spun.seatId]) > 0, 'the consonant pays the live spin value into the caller\'s round bank');
  await surfaces.tv.waitForFunction((expected) => {
    return Array.from(document.querySelectorAll('.gsw-tile.shown')).some((tile) => tile.textContent === expected);
  }, letter, { timeout: 10000 });
  harness.check(true, `the TV flips the called ${letter} tiles into view`);
  return called;
}

/** @description Submit the exact full-puzzle solve through the current player's rendered input. */
async function solvePuzzle(harness, room, surfaces, spun) {
  const input = spun.page.locator('.gp-dock input[placeholder^="Type or say"]');
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(PUZZLE);
  await input.press('Enter');
  const solved = await harness.waitForState(room.roomId, (body) => body.state && body.state.phase === 'round-win');
  harness.check(solved && solved.state.board.solved === true && solved.state.board.winner === spun.seatId,
    'the exact browser solve retires the puzzle and crowns the acting player');
  const actor = room.seats.find((seat) => seat.seatId === spun.seatId);
  harness.check(await harness.waitForText(surfaces.tv, actor.name + ' SOLVES IT!'), 'the TV renders the solver celebration');
  harness.check(Number(solved.state.scores[spun.seatId]) >= 500, 'the round award reaches the durable live scoreboard');
}

/** @description Exercise Wheel's spin, consonant, and solve signature beats against live browser/server seams. */
async function scenario(harness) {
  const room = await harness.createRoom('wheel', CONTENT);
  const surfaces = await harness.openRoomSurfaces(room);
  const spun = await spinForValue(harness, room, surfaces);
  harness.require(!!spun, `a dollar segment is observed within ${MAX_SPINS} rendered spins`);
  harness.check(spun.value > 0, `the live server owns the observed $${spun.value} wheel outcome (attempt ${spun.attempt})`);
  await callConsonant(harness, room, surfaces, spun);
  await solvePuzzle(harness, room, surfaces, spun);
}

void runBrowserScenario(
  'Wheel of Fortune',
  'a rendered spin follows live turn ownership, a present consonant flips, and the exact puzzle solve wins',
  scenario,
);
