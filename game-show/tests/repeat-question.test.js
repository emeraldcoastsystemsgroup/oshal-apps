/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-10-13 14:30:00 | maintainer@emeraldcoastsystemsgroup.com     | Sweep 14: round 3 of a Family Feud game asked round 2's question again ("Name something people often find stuck in their hair."). Through the REAL host service and the REAL family-feud show module with an in-memory room: the host's ▶ start of round 3, when the model repeats the played question, asks once more and plays the fresh question; two repeats in a row are refused with the board unchanged; a fresh question first time costs one host call.
 * 2026-10-13 20:40:00 | maintainer@emeraldcoastsystemsgroup.com     | Round 21 review: Wheel's round milestone is only the category, and the repeat check refused a fresh puzzle in a played category (502). Wheel case through the REAL host service and REAL wheel show: after round 1 'Phrase / BREAK A LEG', 'Phrase / PIECE OF CAKE' is played with one host call. The Family Feud cases are unchanged.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHostService } = require('../lib/host-service');

const PLAYED = 'Name something people often find stuck in their hair.';
const REPEAT = { question: 'Name something people often find stuck in their hair', answers: [
  { text: 'Gum', points: 35 }, { text: 'Tangle', points: 25 }, { text: 'Bobby pin', points: 20 }, { text: 'Leaves', points: 10 }] };
const FRESH = { question: 'Name something you bring to a picnic.', answers: [
  { text: 'Blanket', points: 40 }, { text: 'Sandwiches', points: 30 }, { text: 'Basket', points: 20 }, { text: 'Drinks', points: 10 }] };

/** A Family Feud room after round 2, with round 2's milestone recorded as the room's events do. */
function world() {
  let state = {
    showId: 'family-feud', phase: 'round-win', round: 2,
    board: { question: PLAYED, answers: [], strikes: 0, control: null, bank: 0 },
    scores: { A: 40, B: 35 }, host: { line: 'Round 2: ' + PLAYED, mode: 'round', at: 5 }, shot: { type: 'lobby', focus: null, serial: 0, at: 1 },
  };
  const room = {
    access: async () => ({ room_id: 'r1', user_sub: 'host', show_id: 'family-feud' }),
    mutate: async (_roomId, _sub, apply) => {
      const result = await apply({ state, room: { room_id: 'r1', user_sub: 'host', show_id: 'family-feud' }, seats: [], isOwner: true, db: null });
      if (!result || result.ok === false) return { ok: false, status: (result && result.status) || 400, error: (result && result.error) || 'Rejected.' };
      state = result.state || state;
      return { ok: true, rev: 2, state };
    },
    setStatus: async () => ({ ok: true }), seatsOf: async () => [], resolveActor: () => ({ actor: {} }),
  };
  const pool = {
    query: async (sql) => {
      if (/FROM gameshow_state/.test(sql)) return { rowCount: 1, rows: [{ state, rev: 1 }] };
      if (/kind='milestone'/.test(sql)) return { rowCount: 2, rows: [{ content: 'Team A wins 40 in round 2' }, { content: 'Round 2: ' + PLAYED }, { content: 'Round 1: Name a reason you might be late to work.' }] };
      return { rowCount: 0, rows: [] };
    },
  };
  return { room, pool, get state() { return state; } };
}

/** A host bot that answers the generate prompts in order. */
function scriptedHost(replies) {
  const prompts = [];
  return { prompts, orchestrator: { processMessage: async (_id, prompt) => { prompts.push(prompt); return { response: JSON.stringify(replies[Math.min(prompts.length - 1, replies.length - 1)]) }; } } };
}

test('a generated round that repeats a played question is asked for again and the fresh question is played', async () => {
  const w = world();
  const bot = scriptedHost([REPEAT, FRESH]);
  const host = createHostService({ pool: w.pool, orchestrator: bot.orchestrator, room: w.room, logger: null });
  const started = await host.run('host', 'r1', 'start');
  assert.equal(started.ok, true, started.error);
  assert.equal(w.state.round, 3);
  assert.equal(w.state.board.question, FRESH.question);
  assert.equal(bot.prompts.length, 2, 'the host was asked once more after the repeat');
  assert.match(bot.prompts[0], /stuck in their hair/, 'the played questions go to the host');
});

test('two repeats in a row are refused and the board is unchanged', async () => {
  const w = world();
  const bot = scriptedHost([REPEAT, REPEAT]);
  const host = createHostService({ pool: w.pool, orchestrator: bot.orchestrator, room: w.room, logger: null });
  const started = await host.run('host', 'r1', 'start');
  assert.deepEqual([started.ok, started.status], [false, 502]);
  assert.match(started.error, /question already played/);
  assert.equal(w.state.round, 2, 'nothing was played');
  assert.equal(w.state.board.question, PLAYED);
});

test('a fresh question first time is played with one host call', async () => {
  const w = world();
  const bot = scriptedHost([FRESH]);
  const host = createHostService({ pool: w.pool, orchestrator: bot.orchestrator, room: w.room, logger: null });
  const started = await host.run('host', 'r1', 'start');
  assert.equal(started.ok, true, started.error);
  assert.equal(w.state.board.question, FRESH.question);
  assert.equal(bot.prompts.length, 1);
});

/** A Wheel room after round 1 ('Phrase / BREAK A LEG'), its milestone recorded as the room's events do. */
function wheelWorld() {
  let state = {
    showId: 'wheel', phase: 'round-win', round: 1,
    board: { category: 'Phrase', puzzle: 'BREAK A LEG', guessed: [], control: 'A', spin: null, banks: {}, solved: true, winner: 'A', roundsTotal: 3 },
    scores: { A: 500 }, host: { line: 'Round 1: Phrase', mode: 'round', at: 5 }, shot: { type: 'lobby', focus: null, serial: 0, at: 1 }, serial: 0,
  };
  const owned = { room_id: 'r2', user_sub: 'host', show_id: 'wheel' };
  const room = {
    access: async () => owned,
    mutate: async (_roomId, _sub, apply) => {
      const result = await apply({ state, room: owned, seats: [], isOwner: true, db: null });
      if (!result || result.ok === false) return { ok: false, status: (result && result.status) || 400, error: (result && result.error) || 'Rejected.' };
      state = result.state || state;
      return { ok: true, rev: 2, state };
    },
    setStatus: async () => ({ ok: true }), seatsOf: async () => [], resolveActor: () => ({ actor: {} }),
  };
  const pool = {
    query: async (sql) => {
      if (/FROM gameshow_state/.test(sql)) return { rowCount: 1, rows: [{ state, rev: 1 }] };
      if (/kind='milestone'/.test(sql)) return { rowCount: 1, rows: [{ content: 'Round 1: Phrase' }] };
      return { rowCount: 0, rows: [] };
    },
  };
  return { room, pool, get state() { return state; } };
}

test('Wheel: a fresh puzzle in a category already played is accepted with one host call (round 21 review)', async () => {
  const w = wheelWorld();
  const bot = scriptedHost([{ category: 'Phrase', puzzle: 'PIECE OF CAKE' }, { category: 'Phrase', puzzle: 'ONCE IN A BLUE MOON' }]);
  const host = createHostService({ pool: w.pool, orchestrator: bot.orchestrator, room: w.room, logger: null });
  const started = await host.run('host', 'r2', 'start');
  assert.equal(started.ok, true, started.error);
  assert.equal(w.state.round, 2);
  assert.equal(w.state.board.puzzle, 'PIECE OF CAKE');
  assert.equal(bot.prompts.length, 1, 'a shared category is not a repeated puzzle');
});
