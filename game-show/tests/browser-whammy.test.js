/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the real Whammy browser scenario: press the rendered board, observe rather than inject server randomness, and prove a visible Whammy zeroes the correct live bank and increments its ledger.
 */

'use strict';

const { runBrowserScenario } = require('./browser-show-harness');

const MAX_ROOMS = 20;
const MAX_PRESSES_PER_ROOM = 10;
const CONTENT = {
  panels: [
    'Trip to Maui', 'Big Bucks', 'New Bike', 'Home Theater', 'Snack Attack',
    'Mystery Money', 'Spa Day', 'Double Dip', 'Jackpot Row', 'Neon Flamingo',
  ].map((label, index) => ({ label, value: 300 + index * 100, kind: 'cash' })),
};

/** @description Read the server's lazy spin ledger exactly as the show does. */
function spinsOf(board, seatId) {
  const value = (board.spinsLeft || {})[seatId];
  return value === undefined ? (Number(board.spinsPerPlayer) || 5) : Number(value) || 0;
}

/** @description Identify press-owned state while ignoring asynchronous host-line revisions. */
function pressSignature(state) {
  const board = state.board || {};
  return JSON.stringify([state.phase, board.lastStop, board.spinsLeft, board.whammies, state.scores]);
}

/** @description Click the real current player's PRESS button and wait for TV to ingest that exact revision. */
async function pressOnce(harness, room, surfaces, before) {
  const seatId = before.state.board.control || room.seats[0].seatId;
  const page = surfaces.players[seatId];
  const press = page.locator('.gp-dock .gsy-press');
  const signature = pressSignature(before.state);
  await press.waitFor({ state: 'visible', timeout: 10000 });
  await press.click();
  const after = await harness.waitForState(room.roomId, (body) => {
    return Number(body.rev) > Number(before.rev) && body.state && pressSignature(body.state) !== signature;
  });
  if (!after || pressSignature(after.state) === signature) throw new Error('the rendered PRESS did not mutate the live board before its deadline');
  await surfaces.tv.waitForFunction((revision) => window.GS && Number(window.GS.rev) >= revision,
    Number(after.rev), { timeout: 10000 });
  return { before, after, seatId };
}

/** @description Distinguish a visible current Whammy beat from a historical stop retained in state. */
async function hasVisibleWhammy(tv) {
  try {
    await tv.locator('.gsy-scr-whammy.gsy-live .gsy-whammy-word').waitFor({ state: 'visible', timeout: 4500 });
    return true;
  } catch (_error) { return false; }
}

/** @description Work one disposable room until its two players spend their bounded cash-only allotments. */
async function searchRoom(harness, room, surfaces, counters) {
  for (let turn = 0; turn < MAX_PRESSES_PER_ROOM; turn++) {
    const before = await harness.state(room.roomId);
    if (!before.state || before.state.phase !== 'lights') return null;
    const result = await pressOnce(harness, room, surfaces, before);
    counters.presses++;
    const stop = result.after.state.board.lastStop;
    if (stop && stop.kind === 'whammy' && await hasVisibleWhammy(surfaces.tv)) return result;
  }
  return null;
}

/** @description Locate a visible server-random Whammy with a finite failure bound and no test-only outcome control. */
async function locateWhammy(harness) {
  const counters = { presses: 0 };
  for (let attempt = 1; attempt <= MAX_ROOMS; attempt++) {
    const room = await harness.createRoom('whammy', CONTENT, ` retry ${attempt}`);
    const surfaces = await harness.openRoomSurfaces(room);
    const result = await searchRoom(harness, room, surfaces, counters);
    if (result) return { room, surfaces, result, attempt, presses: counters.presses };
    await harness.closeSurfaces(surfaces);
  }
  return { presses: counters.presses };
}

/** @description Assert the Whammy's state, event, and rendered-current-beat effects against the same press. */
async function assertWhammy(harness, found) {
  const { before, after, seatId } = found.result;
  const beforeBoard = before.state.board, afterBoard = after.state.board;
  const stop = afterBoard.lastStop;
  harness.check(stop.kind === 'whammy' && stop.seatId === seatId, 'the rendered PRESS lands on a server-owned Whammy for the acting podium');
  harness.check(Number(after.state.scores[seatId]) === 0, 'the Whammy zeroes that podium\'s live bank');
  const whammyCount = Number(afterBoard.whammies[seatId]);
  harness.check(whammyCount === (Number(beforeBoard.whammies[seatId]) || 0) + 1,
    'the authoritative Whammy ledger increments exactly once');
  const expectedSpins = whammyCount >= 4 ? 0 : spinsOf(beforeBoard, seatId) - 1;
  harness.check(spinsOf(afterBoard, seatId) === expectedSpins,
    whammyCount >= 4 ? 'the fourth Whammy applies the documented knockout' : 'the Whammy consumes exactly one live spin');
  harness.check((after.events || []).some((event) => event.kind === 'strike' && /WHAMMY/.test(event.content)),
    'the room event log records the same Whammy strike');
  const word = await found.surfaces.tv.locator('.gsy-scr-whammy.gsy-live .gsy-whammy-word').textContent();
  harness.check(word === 'WHAMMY!', 'the TV center screen visibly owns the current WHAMMY! beat');
  harness.check(found.attempt <= MAX_ROOMS && found.presses <= MAX_ROOMS * MAX_PRESSES_PER_ROOM,
    `the random outcome is observed inside the explicit finite bound (${found.presses} browser presses)`);
}

/** @description Exercise Whammy's signature press-and-Whammy beat through real live browser/server seams. */
async function scenario(harness) {
  const found = await locateWhammy(harness);
  harness.require(!!found.result,
    `a visible Whammy is observed within ${MAX_ROOMS * MAX_PRESSES_PER_ROOM} real browser presses (no injected outcome)`);
  await assertWhammy(harness, found);
  await harness.closeSurfaces(found.surfaces);
}

void runBrowserScenario(
  'Whammy!',
  'the rendered PRESS reaches a visible server-random Whammy with correct bank, spin, ledger, and event effects',
  scenario,
);
