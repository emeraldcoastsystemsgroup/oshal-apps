/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-25 23:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for NPC contestants: the bug it exists to catch is "solo night doesn't actually play" — an NPC that never acts, acts when it shouldn't (paused game, wrong team, not its buzz), machine-guns every poll, or reaches a board a human beat couldn't. Pins the engine half (skill subjects, deterministic rolls, due-timing, pacing) and both show brains through a full simulated Feud round and Jeopardy beats. Plain `node tests/npc.test.js`.
 */

'use strict';

const npc = require('../lib/npc');
const feud = require('../lib/shows/family-feud');
const jeopardy = require('../lib/shows/jeopardy');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 1000000;
const SURVEY = {
  question: 'Name a fruit',
  answers: [
    { text: 'Apple', points: 40, aliases: [] }, { text: 'Banana', points: 30, aliases: [] },
    { text: 'Orange', points: 20, aliases: [] }, { text: 'Grape', points: 10, aliases: [] },
  ],
};
function seatRow(id, team, sub, name) {
  return { seat_id: id, team, user_sub: sub, display_name: name || id, role: 'player' };
}
const HUMAN = seatRow('h1', 'A', 'auth0|human', 'Roger');
const NPC_A = seatRow('n1', 'A', npc.newNpcSub('sharp'), '🤖 Ace');
const NPC_B = seatRow('n2', 'B', npc.newNpcSub('casual'), '🤖 Marty');
const SEATS = [HUMAN, NPC_A, NPC_B];

// ── Engine: skill identity ──────────────────────────────────────────────────
check(npc.skillOf('npc:sharp:abc') === 'sharp', 'skill parses out of the synthetic subject');
check(npc.skillOf('npc:cheater:abc') === null, 'an unknown skill is not an NPC');
check(npc.skillOf('house:abc') === null && npc.skillOf('auth0|x') === null, 'house seats and humans are not NPCs');
check(npc.isNpc(NPC_A) && !npc.isNpc(HUMAN), 'isNpc reads the raw seat row');
check(npc.npcName('sharp', [{ display_name: '🤖 Ace' }]).indexOf('🤖') === 0, 'NPC names are visibly bots');
check(npc.npcName('sharp', [{ display_name: '🤖 Ace' }]) !== '🤖 Ace', 'a taken name is not reused');

// ── Engine: due-timing and stability ────────────────────────────────────────
const opened = feud.ingestGenerated(feud.initialState({}, [], NOW), SURVEY, NOW).state;
const stamped = { ...opened, timer: { kind: 'buzz', key: 'k', ms: 20000, endsAt: NOW + 20000 } };

const due1 = npc.dueMove(feud, stamped, SEATS, NOW + 60000);
const due2 = npc.dueMove(feud, stamped, SEATS, NOW + 60000);
check(due1 && due2 && due1.seatId === due2.seatId
  && JSON.stringify(due1.move) === JSON.stringify(due2.move), 'the same beat yields the SAME move on every poll — no re-roll racing');
check(npc.dueMove(feud, stamped, SEATS, NOW) === null, 'an NPC never acts the instant a window opens (humans get a head start)');
check(npc.dueMove(feud, { ...stamped, timer: { ...stamped.timer, pausedAt: NOW + 1 } }, SEATS, NOW + 60000) === null, 'a paused game freezes the bots');
check(npc.dueMove(feud, { ...stamped, phase: 'lobby' }, SEATS, NOW + 60000) === null, 'nothing moves in the lobby');
check(npc.dueMove(feud, stamped, [HUMAN], NOW + 60000) === null, 'a room with no NPC seats never fires');
check(npc.dueMove({ id: 'x' }, stamped, SEATS, NOW + 60000) === null, 'a show without an NPC brain is skipped, not crashed');

// Pacing: right after an NPC act, the next act must wait out the pace floor.
const paced = { ...stamped, npcAt: NOW + 60000, npcN: 1 };
check(npc.dueMove(feud, paced, SEATS, NOW + 60001) === null, 'an NPC act starts the pace clock — no machine-gunning every poll');
check(npc.dueMove(feud, paced, SEATS, NOW + 75000) !== null, 'the next act comes once the pace floor passes');

// ── Feud brain ──────────────────────────────────────────────────────────────
const always = () => 0, never = () => 0.999;
const prof = npc.profile('sharp');

const buzzMove = feud.npcMove(opened, { seatId: 'n1', team: 'A', name: 'Ace' }, { profile: prof, roll: always });
check(buzzMove && buzzMove.action && buzzMove.action.type === 'buzz' && !buzzMove.late, 'an open face-off buzzer draws a buzz');
const shy = feud.npcMove(opened, { seatId: 'n1', team: 'A' }, { profile: prof, roll: never });
check(shy && shy.action.type === 'buzz' && shy.late === true, 'a shy roll buzzes LATE, never never — frozen-shy bots were 20s of dead air live');

// Engine: a late move waits out most of the window instead of the normal delay.
const LATE_SHOW = { npcMove: () => ({ action: { type: 'x' }, late: true }) };
const EAGER_SHOW = { npcMove: () => ({ action: { type: 'x' } }) };
check(npc.dueMove(EAGER_SHOW, stamped, SEATS, NOW + 13000) !== null, 'a normal move is due inside the window cap');
check(npc.dueMove(LATE_SHOW, stamped, SEATS, NOW + 13000) === null, 'a late move is NOT due at normal-delay time');
check(npc.dueMove(LATE_SHOW, stamped, SEATS, NOW + 15001) !== null, 'a late move fires at 75% of the window — before the clock bails it out');

const locked = feud.reduce(opened, { type: 'buzz', serial: opened.buzz.serial }, { seatId: 'n1', team: 'A', name: 'Ace' }, NOW).state;
const hit = feud.npcMove(locked, { seatId: 'n1', team: 'A', name: 'Ace' }, { profile: prof, roll: always });
check(hit && hit.judgement && hit.judgement.matchIndex === 0 && hit.guess === 'Apple', 'a sharp hit takes the TOP remaining answer, in the show\'s own judge shape');
check(feud.npcMove(locked, { seatId: 'n2', team: 'B', name: 'Marty' }, { profile: prof, roll: always }) === null, 'only the podium that buzzed may answer the face-off');
const miss = feud.npcMove(locked, { seatId: 'n1', team: 'A', name: 'Ace' }, { profile: { ...prof, hit: 0 }, roll: never });
check(miss && miss.judgement.matchIndex === -1 && miss.guess.length > 0, 'a miss is a real spoken wrong guess, judged -1');

// Applying the brain's own judgement lands on exactly the board a human's judged
// answer lands on — the NPC path must never invent a new state shape.
const applied = feud.applyJudgement(locked, hit.judgement, { seatId: 'n1', team: 'A', name: 'Ace' }, NOW);
check(applied.ok && applied.state.phase === 'play' && applied.state.board.control === 'A', 'top face-off answer takes control, same as a human hit');
check(feud.npcMove({ ...applied.state, phase: 'round-win' }, { seatId: 'n1', team: 'A' }, { profile: prof, roll: always }) === null, 'nothing to do between rounds');

// ── Fast Money brain (delegated from Feud) ──────────────────────────────────
const FM_STATE = {
  ...applied.state, phase: 'fm-play',
  fm: {
    players: ['n1', 'h1'], team: 'A', turn: 0, current: 0,
    questions: [{ question: 'Q1', answers: [
      { text: 'Alpha', points: 40, aliases: [] }, { text: 'Beta', points: 30, aliases: [] }, { text: 'Gamma', points: 20, aliases: [] },
    ] }],
    answers: [[], []], total: 0, won: false,
  },
};
const fmHit = feud.npcMove(FM_STATE, { seatId: 'n1', name: 'Ace' }, { profile: prof, roll: always });
check(fmHit && fmHit.judgement.matchIndex === 0 && fmHit.guess === 'Alpha', 'an NPC on the Fast Money clock answers from the board');
check(feud.npcMove(FM_STATE, { seatId: 'h1', name: 'Roger' }, { profile: prof, roll: always }) === null, 'an NPC not on the Fast Money clock stays quiet');
const FM_RUN2 = { ...FM_STATE, fm: { ...FM_STATE.fm, turn: 1, players: ['h1', 'n1'], answers: [[{ text: 'Alpha', points: 40 }], []] } };
const fmDodge = feud.npcMove(FM_RUN2, { seatId: 'n1', name: 'Ace' }, { profile: prof, roll: always });
check(fmDodge && fmDodge.judgement.matchIndex === 1 && fmDodge.guess === 'Beta', 'run two dodges player one\'s answer — a sharp bot never duplicates');
const fmMiss = feud.npcMove(FM_STATE, { seatId: 'n1', name: 'Ace' }, { profile: { ...prof, hit: 0 }, roll: never });
check(fmMiss && fmMiss.judgement.matchIndex === -1 && fmMiss.guess.length > 0, 'a Fast Money miss is a spoken wrong guess judged -1');

// ── Feud: a full NPC-vs-NPC round terminates ────────────────────────────────
let state = opened, guard = 0;
const actorsBySeat = { n1: { seatId: 'n1', team: 'A', name: 'Ace' }, n2: { seatId: 'n2', team: 'B', name: 'Marty' } };
while (state.phase !== 'round-win' && guard < 60) {
  guard++;
  let acted = false;
  for (const row of [NPC_A, NPC_B]) {
    const move = feud.npcMove(state, actorsBySeat[row.seat_id], { profile: npc.profile(npc.skillOf(row.user_sub)), roll: (t) => (guard * 7 + t.length) % 10 / 10 });
    if (!move) continue;
    const result = move.action
      ? feud.reduce(state, move.action, actorsBySeat[row.seat_id], NOW + guard * 1000)
      : feud.applyJudgement(state, move.judgement, actorsBySeat[row.seat_id], NOW + guard * 1000);
    if (result.ok) { state = result.state; acted = true; break; }
  }
  if (!acted) {
    // No NPC move (e.g. nobody's roll rang in) — the round clock resolves it, same as live.
    const lapse = feud.onTimeout(state, state.timer || { kind: state.buzz && state.buzz.open ? 'buzz' : 'answer', seatId: null }, NOW + guard * 1000, { seats: SEATS });
    if (lapse.ok) state = lapse.state; else break;
  }
}
check(state.phase === 'round-win', 'a full NPC-played Feud round reaches round-win (in ' + guard + ' beats)');
check((state.scores.A || 0) + (state.scores.B || 0) > 0, 'somebody actually scored');

// ── Jeopardy brain ──────────────────────────────────────────────────────────
const J_BOARD = {
  categories: [0, 1].map((c) => ({
    title: 'Cat' + c,
    clues: [0, 1, 2, 3, 4].map((r) => ({ clue: 'clue ' + c + r, answer: 'ans' + c + r })),
  })),
};
let jState = jeopardy.ingestGenerated(jeopardy.initialState({}, [], NOW), J_BOARD, NOW).state;
const J1 = { seatId: 'n1', team: null, name: 'Ace' };
const pick = jeopardy.npcMove(jState, J1, { profile: prof, roll: always });
check(pick && pick.action && pick.action.type === 'pick', 'an open board with no control lets the NPC pick a clue');
check(jeopardy.npcMove({ ...jState, board: { ...jState.board, control: 'other' } }, J1, { profile: prof, roll: always }) === null, 'the NPC never picks over someone else\'s control');

const pickApplied = jeopardy.reduce(jState, pick.action, J1, NOW);
check(pickApplied.ok, 'the NPC pick is a legal reducer action');
jState = pickApplied.state;
if (jState.phase === 'daily-wager') {
  const wager = jeopardy.npcMove(jState, J1, { profile: prof, roll: always });
  check(wager && wager.action.type === 'wager' && wager.action.amount >= 5, 'a Daily Double draws a sane wager');
  jState = jeopardy.reduce(jState, wager.action, J1, NOW).state;
} else {
  const ring = jeopardy.npcMove(jState, J1, { profile: prof, roll: always });
  check(ring && ring.action.type === 'buzz', 'a live clue draws a ring-in');
  jState = jeopardy.reduce(jState, ring.action, J1, NOW).state;
}
check(jState.phase === 'answer', 'the NPC reaches the response beat');
const jHit = jeopardy.npcMove(jState, J1, { profile: prof, roll: always });
check(jHit && jHit.judgement && jHit.judgement.correct === true && /^What is /.test(jHit.guess), 'a hit responds in question form with the real answer');
const jMiss = jeopardy.npcMove(jState, J1, { profile: { ...prof, hit: 0 }, roll: never });
check(jMiss && jMiss.judgement.correct === false, 'a miss is judged incorrect');
const jApplied = jeopardy.applyJudgement(jState, jHit.judgement, J1, NOW);
check(jApplied.ok && (jApplied.state.scores.n1 || 0) > 0, 'the applied NPC ruling scores exactly like a human ruling');

// Final wager: only contenders, only once.
const finalState = { ...jApplied.state, phase: 'final-wager', board: { ...jApplied.state.board, wagers: {} } };
const fw = jeopardy.npcMove(finalState, J1, { profile: prof, roll: always });
check(fw && fw.action.type === 'finalWager' && fw.action.amount <= (finalState.scores.n1 || 0), 'a final wager never exceeds the score');
check(jeopardy.npcMove({ ...finalState, board: { ...finalState.board, wagers: { n1: 100 } } }, J1, { profile: prof, roll: always }) === null, 'a locked-in wager is never re-entered');
check(jeopardy.npcMove(finalState, { seatId: 'broke' }, { profile: prof, roll: always }) === null, 'a zero-score seat is out of the final');

// ── Wheel brain ─────────────────────────────────────────────────────────────
const wheel = require('../lib/shows/wheel');
const W1 = { seatId: 'n1', name: 'Ace' };
let wState = wheel.ingestGenerated(wheel.initialState({}, [], NOW), { category: 'Animal', puzzle: 'BIG CAT' }, NOW).state;
const wOpen = wheel.npcMove(wState, W1, { profile: prof, roll: always });
check(wOpen && wOpen.action && wOpen.action.type === 'spin', 'an open wheel turn with nothing revealed spins');
check(wheel.npcMove({ ...wState, board: { ...wState.board, control: 'other' } }, W1, { profile: prof, roll: always }) === null, 'the wheel bot never plays someone else\'s turn');
const wSpun = { ...wState, board: { ...wState.board, control: 'n1', spin: { value: 500 } } };
const wCall = wheel.npcMove(wSpun, W1, { profile: prof, roll: always });
check(wCall && wCall.action.type === 'guessLetter' && 'BGCT'.indexOf(wCall.action.letter) >= 0, 'a pending spin draws a consonant that is actually in the puzzle');
const wDud = wheel.npcMove(wSpun, W1, { profile: { ...prof, hit: 0 }, roll: never });
check(wDud && wDud.action.type === 'guessLetter' && 'AEIOU'.indexOf(wDud.action.letter) < 0 && 'BIGCAT'.indexOf(wDud.action.letter) < 0, 'a missed call is a plausible consonant NOT in the puzzle');
const wLate = { ...wState, board: { ...wState.board, control: 'n1', guessed: ['B', 'I', 'G', 'C', 'A'] } };
const wSolve = wheel.npcMove(wLate, W1, { profile: prof, roll: always });
check(wSolve && wSolve.judgement && wSolve.judgement.correct === true && wSolve.guess === 'BIG CAT', 'a mostly-revealed board draws the solve, in the show\'s own judge shape');
const wMust = { ...wState, board: { ...wState.board, control: 'n1', guessed: ['B', 'G', 'C', 'T'] } };
const wForced = wheel.npcMove(wMust, W1, { profile: npc.profile('wild'), roll: always });
check(wForced && wForced.judgement && wForced.judgement.correct === true, 'no consonants left to earn on forces even a wildcard to solve');
const wWon = wheel.applyJudgement(wLate, wSolve.judgement, W1, NOW);
check(wWon.ok && wWon.state.phase === 'round-win' && wWon.state.board.winner === 'n1', 'the applied NPC solve wins the round exactly like a human solve');

// A full NPC-vs-NPC Wheel round terminates (spins are server randomness).
const W_SEATS = [{ seatId: 'n1', role: 'player' }, { seatId: 'n2', role: 'player' }];
let wSim = wheel.ingestGenerated(wheel.initialState({}, [], NOW), { category: 'Phrase', puzzle: 'GOOD LUCK' }, NOW).state;
let wGuard = 0;
while (wSim.phase !== 'round-win' && wGuard < 200) {
  wGuard++;
  let acted = false;
  for (const id of ['n1', 'n2']) {
    const wActor = { seatId: id, name: id };
    const move = wheel.npcMove(wSim, wActor, { profile: npc.profile(id === 'n1' ? 'sharp' : 'casual'), roll: (t) => (wGuard * 13 + t.length) % 10 / 10 });
    if (!move) continue;
    const result = move.action
      ? wheel.reduce(wSim, move.action, wActor, NOW + wGuard * 1000, { seats: W_SEATS })
      : wheel.applyJudgement(wSim, move.judgement, wActor, NOW + wGuard * 1000, { seats: W_SEATS });
    if (result.ok) { wSim = result.state; acted = true; break; }
  }
  if (!acted) break;
}
check(wSim.phase === 'round-win' && wSim.board.winner, 'a full NPC-played Wheel round reaches a solved board (in ' + wGuard + ' beats)');

// ── Whammy brain ────────────────────────────────────────────────────────────
const whammy = require('../lib/shows/whammy');
const PANELS = { panels: Array.from({ length: 8 }, (_, i) => ({ label: 'Cash ' + i, value: 500 + i * 100, kind: 'cash' })) };
let yState = whammy.ingestGenerated(whammy.initialState({}, [], NOW), PANELS, NOW).state;
const Y_SEATS = [{ seatId: 'n1', role: 'player' }, { seatId: 'n2', role: 'player' }];
const yPress = whammy.npcMove(yState, { seatId: 'n1', name: 'Ace' }, { profile: prof, roll: always, seats: Y_SEATS });
check(yPress && yPress.action.type === 'pressYourLuck', 'an open Whammy board draws a press');
check(whammy.npcMove({ ...yState, board: { ...yState.board, control: 'n2' } }, { seatId: 'n1' }, { profile: prof, roll: always, seats: Y_SEATS }) === null, 'the bot never presses on someone else\'s board');
check(whammy.npcMove({ ...yState, board: { ...yState.board, spinsLeft: { n1: 0 } } }, { seatId: 'n1' }, { profile: prof, roll: always, seats: Y_SEATS }) === null, 'no spins left means no move');
const yLead = { ...yState, scores: { n1: 5000, n2: 100 }, board: { ...yState.board, control: 'n1' } };
const yPass = whammy.npcMove(yLead, { seatId: 'n1', name: 'Ace' }, { profile: prof, roll: always, seats: Y_SEATS });
check(yPass && yPass.action.type === 'passSpins', 'a sharp leader protects the bank — passes the spins to the chaser');
const yWild = whammy.npcMove(yLead, { seatId: 'n1', name: 'Ziggy' }, { profile: npc.profile('wild'), roll: always, seats: Y_SEATS });
check(yWild && yWild.action.type === 'pressYourLuck', 'a wildcard leader presses anyway — that is the bit');

// A full NPC-vs-NPC Whammy round terminates (stops are server randomness).
let yGuard = 0;
while (yState.phase !== 'round-win' && yGuard < 200) {
  yGuard++;
  let acted = false;
  for (const id of ['n1', 'n2']) {
    const yActor = { seatId: id, name: id };
    const move = whammy.npcMove(yState, yActor, { profile: npc.profile('casual'), roll: (t) => (yGuard * 17 + t.length) % 10 / 10, seats: Y_SEATS });
    if (!move) continue;
    const result = whammy.reduce(yState, move.action, yActor, NOW + yGuard * 1000, { seats: Y_SEATS });
    if (result.ok) { yState = result.state; acted = true; break; }
  }
  if (!acted) break;
}
check(yState.phase === 'round-win', 'a full NPC-played Whammy round spends every spin and crowns a bank (in ' + yGuard + ' beats)');

// ── Engine: bots stay quiet during an interview ─────────────────────────────
const ivState = { ...stamped, interview: { active: true, status: 'asked', seatId: 'h1', at: NOW } };
check(npc.dueMove(feud, ivState, SEATS, NOW + 60000) === null, 'a live interview silences the bots');

// ── Engine drive(): applies under the lock, racers no-op ────────────────────
(async () => {
  let stored = { state: { ...stamped }, rev: 1 };
  const env = {
    registry: { get: () => feud },
    mutate: async (roomId, sub, apply) => {
      const result = await apply({ state: stored.state, seats: SEATS, room: { room_id: roomId, show_id: 'family-feud' }, isOwner: true, db: null });
      if (!result || result.ok === false) return { ok: false, status: result && result.status, error: result && result.error };
      stored = { state: result.state, rev: stored.rev + 1 };
      return { ok: true, rev: stored.rev, state: stored.state };
    },
  };
  const room = { room_id: 'r1', show_id: 'family-feud', status: 'live' };
  const fired = await npc.drive(env, room, 'auth0|human', stamped, SEATS, NOW + 60000);
  check(fired.fired === true, 'drive applies a due move');
  check(Number(stored.state.npcN) === 1 && Number(stored.state.npcAt) > 0, 'drive stamps the pace counter into the state');
  const again = await npc.drive(env, room, 'auth0|human', stored.state, SEATS, NOW + 60001);
  check(again.fired === false, 'an immediate second poll no-ops on the pace floor');
  const ended = await npc.drive(env, { ...room, status: 'ended' }, 'auth0|human', stamped, SEATS, NOW + 60000);
  check(ended.fired === false, 'an ended room never moves');

  console.log(`npc: ${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
})();
