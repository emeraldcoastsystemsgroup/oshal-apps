/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The engine half of a person being able to play against the computer. AI podiums leave a
 *   seated person the first move and the time to read before buzzing, and never wait in an all-AI room; the Jeopardy open
 *   names the drawn categories instead of asking the room for them ("send them over", live on 2026-10-30); Wheel standings
 *   stop counting round banks once a puzzle is solved; the room's owner can start Fast Money from their own seat. Real show
 *   modules and the real NPC engine, no doubles.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const npc = require('../lib/npc');
const registry = require('../lib/shows/show-registry');

const jeopardy = registry.get('jeopardy');
const feud = registry.get('family-feud');
const wheel = registry.get('wheel');
const whammy = registry.get('whammy');

const PERSON = { seat_id: 'me', role: 'player', team: 'A', display_name: 'Sam', user_sub: 'sam', seat_key: null };
const bot = (id, team) => ({ seat_id: id, role: 'player', team: team || null, display_name: '🤖 ' + id, user_sub: 'sam', seat_key: 'npc:sharp:' + id });
const clue = (text) => ({ value: 200, clue: text, answer: 'Paris', used: false });
const NOW = 1_800_000_000_000;

/** @description A Jeopardy board with a live clue and an open buzzer whose window opened at NOW. */
function jeopardyClue(text) {
  return { showId: 'jeopardy', phase: 'clue', round: 1, scores: {}, buzz: { open: true, serial: 1, order: [] }, timer: { endsAt: NOW + 12000, ms: 12000 },
    board: { control: null, pick: { cat: 0, row: 0 }, missed: [], wager: null, categories: [{ title: 'World Capitals', clues: [clue(text)] }] } };
}

test('AI podiums give a seated person time to read a clue before buzzing', () => {
  const text = 'This city on the Seine is the capital of France.';
  const state = jeopardyClue(text);
  const hold = npc.readingHold(text, [PERSON]);
  assert.ok(hold >= 4000 && hold <= 8500, `a sensible reading time, got ${hold}`);
  assert.equal(npc.dueMove(jeopardy, state, [PERSON, bot('b1'), bot('b2')], NOW + hold - 200), null, 'nobody rings in while the person is reading');
  assert.ok(npc.dueMove(jeopardy, state, [PERSON, bot('b1'), bot('b2')], NOW + 10000), 'and the race still happens before the window closes');
});

test('the first face-off counts the opening titles out of the person\'s reading time', () => {
  const state = { showId: 'family-feud', phase: 'faceoff', round: 1, scores: { A: 0, B: 0 }, buzz: { open: true, serial: 1 }, timer: { endsAt: NOW + 20000, ms: 20000 },
    board: { question: 'Name a fruit people eat every day?', faceoff: {}, answers: [] } };
  const read = npc.readingHold(state.board.question, [PERSON]);
  const seats = [PERSON, bot('b1', 'B')];
  assert.equal(npc.dueMove(feud, state, seats, NOW + read + npc.OPENING_TITLES_MS - 200), null, 'the titles do not eat the head start');
  const ctx = { profile: npc.profile('sharp'), roll: () => 0, humans: [PERSON] };
  const actor = { seatId: 'b1', team: 'B' };
  assert.equal(feud.npcMove(state, actor, ctx).hold, read + npc.OPENING_TITLES_MS);
  assert.equal(feud.npcMove({ ...state, round: 2 }, actor, ctx).hold, read, 'later rounds have no titles to wait for');
});

test('an all-AI room never waits for a person who is not there', () => {
  assert.equal(npc.readingHold('anything at all', []), 0);
  const state = jeopardyClue('x'.repeat(200));
  // The host seat is not a player: a host only running the show is no reason to wait.
  const seats = [{ ...PERSON, role: 'host' }, bot('b1'), bot('b2')];
  assert.ok(npc.dueMove(jeopardy, state, seats, NOW + 9100), 'the bots ring in on their usual clock');
});

test('after a miss the buzzer race restarts sooner, because everyone has read the clue', () => {
  const state = jeopardyClue('x'.repeat(200));
  state.board.missed = ['me'];
  const seats = [PERSON, bot('b1')];
  assert.equal(npc.dueMove(jeopardy, state, seats, NOW + npc.REOPENED_HOLD_MS - 200), null);
  assert.ok(npc.dueMove(jeopardy, state, seats, NOW + 7300), 'not the full reading hold again');
});

test('the first pick, spin and press on an unclaimed board are the seated person\'s to take', () => {
  const firstHold = npc.FIRST_MOVE_HOLD_MS;
  const j = { ...jeopardyClue('x'), phase: 'board', timer: null, buzz: null, shot: { at: NOW }, board: { control: null, categories: [{ title: 'A', clues: [clue('x')] }] } };
  const w = { showId: 'wheel', phase: 'puzzle', scores: {}, timer: { endsAt: NOW + 30000, ms: 30000 }, board: { puzzle: 'PEANUT BUTTER', guessed: [], banks: {}, control: null, spin: null } };
  const y = { showId: 'whammy', phase: 'lights', scores: {}, timer: { endsAt: NOW + 25000, ms: 25000 }, board: { control: null, panels: [{ value: 1, label: 'x', kind: 'cash' }], spinsLeft: {}, spinsPerPlayer: 5, whammies: {} } };
  for (const [show, state] of [[jeopardy, j], [wheel, w], [whammy, y]]) {
    const seats = [PERSON, bot('b1')];
    assert.equal(npc.dueMove(show, state, seats, NOW + Math.min(firstHold, (state.timer ? state.timer.ms * 0.8 : firstHold)) - 200), null, `${show.id}: the bot waits`);
    assert.ok(npc.dueMove(show, state, seats, NOW + firstHold + 500), `${show.id}: and moves if the person does not`);
    assert.ok(npc.dueMove(show, state, [bot('b1'), bot('b2')], NOW + 12000), `${show.id}: all-AI does not wait`);
  }
});

test('an AI teammate leaves the person on its team the first answer, but the other team\'s bots do not wait', () => {
  const state = { showId: 'family-feud', phase: 'play', round: 1, scores: { A: 0, B: 0 }, timer: { endsAt: NOW + 25000, ms: 25000 },
    board: { control: 'A', strikes: 0, bank: 0, question: 'Name a fruit.', answers: [{ text: 'Apple', points: 40, revealed: false }] } };
  const sameTeam = [PERSON, bot('b1', 'A')];
  assert.equal(npc.dueMove(feud, state, sameTeam, NOW + npc.TEAMMATE_HOLD_MS - 200), null, 'a teammate waits');
  assert.ok(npc.dueMove(feud, state, sameTeam, NOW + npc.TEAMMATE_HOLD_MS + 500), 'then helps');
  assert.ok(npc.dueMove(feud, state, [{ ...PERSON, team: 'B' }, bot('b1', 'A')], NOW + 6000), 'an opponent does not wait for you');
});

test('the Jeopardy open names the drawn categories and asks the room for nothing', () => {
  const state = { phase: 'board', board: { categories: [{ title: 'World Capitals', clues: [] }, { title: 'Animals', clues: [] }] } };
  const prompt = jeopardy.spokenPrompt('intro', state, {}, {});
  assert.match(prompt, /World Capitals, Animals/);
  assert.match(prompt, /not a survey/i);
  assert.match(prompt, /never ask the room/i);
  assert.match(jeopardy.spokenPrompt('intro', { phase: 'lobby', board: {} }, {}, {}), /not on the board yet/);
});

test('the Wheel open names the category and never the puzzle', () => {
  const prompt = wheel.spokenPrompt('intro', { board: { category: 'Food & Drink', puzzle: 'PEANUT BUTTER' } }, {}, {});
  assert.match(prompt, /Food & Drink/);
  assert.doesNotMatch(prompt, /PEANUT/);
});

test('Wheel standings stop counting round banks once a puzzle is solved', () => {
  const seats = [{ seat_id: 'a', display_name: 'A', role: 'player' }, { seat_id: 'b', display_name: 'B', role: 'player' }];
  const playing = { scores: { a: 100 }, board: { banks: { a: 600, b: 1650 }, solved: false } };
  assert.deepEqual(wheel.scoreboard(playing, seats).map((r) => [r.seatId, r.score]), [['b', 1650], ['a', 700]], 'mid-round the bank counts');
  const solved = { scores: { a: 700 }, board: { banks: { a: 600, b: 1650 }, solved: true } };
  assert.deepEqual(wheel.scoreboard(solved, seats).map((r) => [r.seatId, r.score]), [['a', 700], ['b', 0]], 'after the solve only what was paid counts: not twice, and not the loser\'s bank');
});

test('the room\'s owner starts Fast Money from their own seat; another player cannot', () => {
  const decided = { ...feud.initialState({ room_id: 'r', user_sub: 'sam' }, [], NOW), phase: 'round-win', round: 3 };
  const actor = { seatId: 'me', team: 'A', role: 'player' };
  const action = { type: 'startFastMoney', seat1: 'me', seat2: 'b1' };
  assert.equal(feud.reduce(decided, action, actor, NOW, { seats: [], isOwner: true }).ok, true);
  assert.equal(feud.reduce(decided, action, actor, NOW, { seats: [], isOwner: false }).ok, false);
});
