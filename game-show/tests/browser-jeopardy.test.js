/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the real Jeopardy browser scenario: locate the randomized Daily Double, prove a normal ring-in, submit both exact answers, and wager through the rendered player dock.
 */

'use strict';

const { runBrowserScenario } = require('./browser-show-harness');

const TITLES = ['World Capitals', 'Famous Firsts', 'Kitchen Science', 'The Space Race', 'Wordplay', 'Big Rivers'];
const CONTENT = {
  categories: TITLES.map((title, category) => ({
    title,
    clues: [0, 1, 2, 3, 4].map((row) => ({
      clue: `Browser clue ${row + 1} for ${title}`,
      answer: `Answer ${category + 1}-${row + 1}`,
    })),
  })),
};

/** @description Locate one ordinary clue and the server-randomized Daily Double from authoritative state. */
function locateClues(envelope) {
  const categories = (envelope.state && envelope.state.board && envelope.state.board.categories) || [];
  let regular = null, daily = null;
  categories.forEach((category, cat) => (category.clues || []).forEach((clue, row) => {
    const position = { cat, row, clue };
    if (clue.isDaily) daily = daily || position;
    else regular = regular || position;
  }));
  return { categories, regular, daily };
}

/** @description Resolve a board coordinate to the real rendered cell; category headers are outside this locator. */
function cellAt(page, categoryCount, position) {
  return page.locator('.gsj-cell').nth(position.row * categoryCount + position.cat);
}

/** @description Submit an exact answer through the rendered player dock and wait for the board to reopen. */
async function answerClue(harness, page, roomId, answer, position) {
  const input = page.locator('.gp-dock input[placeholder^="Type or say"]');
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(answer);
  await input.press('Enter');
  return harness.waitForState(roomId, (body) => {
    const board = body.state && body.state.board;
    const clue = board && board.categories[position.cat].clues[position.row];
    return body.state.phase === 'board' && clue.used === true;
  });
}

/** @description Drive the normal clue's pick, ring-in, response, and scoring entirely through the player surface. */
async function playRegularClue(harness, room, surfaces, board, position) {
  const actor = room.seats[0];
  const page = surfaces.players[actor.seatId];
  await cellAt(page, board.categories.length, position).click();
  const opened = await harness.waitForState(room.roomId, (body) => body.state && body.state.phase === 'clue');
  harness.check(opened && opened.state.board.pick.cat === position.cat && opened.state.board.pick.row === position.row,
    'the player picks the located ordinary clue on the real board');
  harness.check(await harness.waitForText(surfaces.tv, position.clue.clue), 'the TV renders the picked clue text');
  harness.check(await harness.waitForText(surfaces.tv, 'RING IN!'), 'the TV opens the Jeopardy ring-in window');
  const buzzer = page.locator('.gp-dock .gs-dockbuzz');
  await buzzer.waitFor({ state: 'visible', timeout: 10000 });
  await buzzer.click();
  const locked = await harness.waitForState(room.roomId, (body) => body.state && body.state.phase === 'answer');
  harness.check(locked && locked.state.buzz.lockedBy === actor.seatId, 'the rendered buzzer locks the response to Ana');
  const resolved = await answerClue(harness, page, room.roomId, position.clue.answer, position);
  harness.check(resolved && resolved.state.scores[actor.seatId] === position.clue.value,
    'the exact browser response scores the clue without an LLM call');
}

/** @description Drive the located Daily Double pick, rendered wager form, clue response, and wager scoring. */
async function playDailyDouble(harness, room, surfaces, board, position) {
  const actor = room.seats[0];
  const page = surfaces.players[actor.seatId];
  const liveCell = cellAt(page, board.categories.length, position);
  await liveCell.waitFor({ state: 'visible', timeout: 10000 });
  await liveCell.click();
  const daily = await harness.waitForState(room.roomId, (body) => body.state && body.state.phase === 'daily-wager');
  harness.check(daily && daily.state.board.wager.seatId === actor.seatId,
    'the located randomized cell opens Ana\'s Daily Double wager');
  harness.check(await harness.waitForText(surfaces.tv, 'DAILY DOUBLE!'), 'the TV renders the Daily Double splash');
  const wager = page.locator('.gp-dock input[type="number"]');
  await wager.waitFor({ state: 'visible', timeout: 10000 });
  await wager.fill('400');
  await page.getByRole('button', { name: 'Wager', exact: true }).click();
  const wagered = await harness.waitForState(room.roomId, (body) => body.state && body.state.phase === 'answer');
  harness.check(wagered && wagered.state.board.wager.amount === 400, 'the rendered wager form records exactly $400');
  harness.check(await harness.waitForText(surfaces.tv, position.clue.clue), 'the TV reveals the Daily Double clue after wagering');
  const resolved = await answerClue(harness, page, room.roomId, position.clue.answer, position);
  harness.check(resolved && resolved.state.scores[actor.seatId] === board.state.scores[actor.seatId] + 400,
    'the exact Daily Double response adds the live wager to the score');
}

/** @description Exercise Jeopardy's two signature browser beats against one live disposable room. */
async function scenario(harness) {
  const room = await harness.createRoom('jeopardy', CONTENT);
  const initial = await harness.state(room.roomId);
  const located = locateClues(initial);
  harness.require(!!located.regular && !!located.daily, 'the live board exposes both an ordinary clue and one randomized Daily Double');
  const surfaces = await harness.openRoomSurfaces(room);
  await playRegularClue(harness, room, surfaces, located, located.regular);
  const afterRegular = await harness.state(room.roomId);
  const scoreBeforeDaily = afterRegular.state.scores[room.seats[0].seatId];
  await playDailyDouble(harness, room, surfaces, { categories: located.categories, state: { scores: { [room.seats[0].seatId]: scoreBeforeDaily } } }, located.daily);
}

void runBrowserScenario(
  'Jeopardy',
  'a located ordinary clue rings in and a located Daily Double accepts and scores a rendered wager',
  scenario,
);
