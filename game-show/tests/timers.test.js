/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 03:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for the round clock: the bug it exists to catch is "a round hangs forever because nobody buzzed". Pins the clock primitive, both shows' declared windows, and every lapse — including that a lapse lands on exactly the board a played miss would. Plain `node tests/timers.test.js`.
 */

'use strict';

const clock = require('../lib/clock');
const feud = require('../lib/shows/family-feud');
const jeopardy = require('../lib/shows/jeopardy');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 100000;
const A1 = { seatId: 'a1', team: 'A', name: 'Ana' };
const B1 = { seatId: 'b1', team: 'B', name: 'Bo' };
const SEATS = [
  { seat_id: 'a1', team: 'A', display_name: 'Ana', role: 'player' },
  { seat_id: 'b1', team: 'B', display_name: 'Bo', role: 'player' },
];
const SURVEY = {
  question: 'Name a fruit',
  answers: [
    { text: 'Apple', points: 40, aliases: [] }, { text: 'Banana', points: 30, aliases: [] },
    { text: 'Orange', points: 20, aliases: [] }, { text: 'Grape', points: 10, aliases: [] },
  ],
};
const BOARD = {
  categories: [0, 1].map((c) => ({
    title: 'Cat' + c,
    clues: [0, 1, 2, 3, 4].map((r) => ({ clue: 'clue ' + c + r, answer: 'ans' + c + r })),
  })),
};

// ── Clock primitive ─────────────────────────────────────────────────────────
const SHOW = { windowFor: (s) => (s.phase === 'race' ? { kind: 'buzz', ms: 10000 } : null) };
let s = clock.stamp({ phase: 'race' }, SHOW, NOW);
check(s.timer.endsAt === NOW + 10000 && s.timer.kind === 'buzz', 'stamp writes the declared deadline');
check(clock.expired(s, NOW + 9999) === false && clock.expired(s, NOW + 10000) === true, 'expiry flips exactly at the deadline');
check(clock.remaining(s, NOW + 4000) === 6000, 'remaining counts down from the deadline');

// THE regression this guard exists for: an unrelated state write must never restart
// the clock. A second player's buzz press bumps the rev; the racing window must not
// silently get a fresh 10 seconds because of it.
const restamped = clock.stamp({ ...s, host: { line: 'nice buzz' } }, SHOW, NOW + 5000);
check(restamped.timer.endsAt === NOW + 10000, 'a same-window re-stamp KEEPS the original deadline');
check(clock.stamp({ ...s, phase: 'over' }, SHOW, NOW + 1).timer === undefined, 'a closed window clears the clock');

let paused = clock.pause(s, NOW + 3000);
check(clock.expired(paused, NOW + 999999) === false, 'a paused clock never lapses');
check(clock.remaining(paused, NOW + 999999) === 7000, 'a paused clock holds the time that was left');
check(clock.remaining(clock.resume(paused, NOW + 60000), NOW + 60000) === 7000, 'resuming restores the remaining time, not the wall clock');
check(clock.remaining(clock.addTime(s, 30000), NOW) === 40000, 'the host can extend the window');
check(clock.expired(clock.expire(s, NOW), NOW) === true, 'the host can force the window to lapse now');
check(clock.stamp({ phase: 'race' }, {}, NOW).timer === undefined, 'a show with no declared windows never gets a clock');

// ── Family Feud windows ─────────────────────────────────────────────────────
const opened = feud.ingestGenerated(feud.initialState({}, [], NOW), SURVEY, NOW).state;
check(feud.windowFor(opened).kind === 'buzz', 'an open face-off is a buzz window');
const buzzed = feud.reduce(opened, { type: 'buzz', serial: opened.buzz.serial }, A1, NOW).state;
check(feud.windowFor(buzzed).kind === 'answer' && feud.windowFor(buzzed).seatId === 'a1', 'a locked face-off puts the buzzed podium on the clock');
const inPlay = feud.applyJudgement(buzzed, { matchIndex: 0 }, A1, NOW).state;
check(feud.windowFor(inPlay).kind === 'answer' && feud.windowFor(inPlay).seatId === null, 'play is a team answer window, not a seat one');
check(feud.windowFor({ ...inPlay, phase: 'round-win' }) === null, 'nothing is on the clock between rounds');

// ── Family Feud lapses ──────────────────────────────────────────────────────
// Nobody buzzed: the show must hand the board over rather than sit there.
const deadBuzz = feud.onTimeout(opened, { kind: 'buzz' }, NOW, { seats: SEATS });
check(deadBuzz.ok && deadBuzz.state.phase === 'play' && deadBuzz.state.board.control === 'A', 'a dead face-off hands the board to the trailing team');
check(deadBuzz.state.buzz === undefined, 'the dead buzzer is cleared, not left open');
const behind = { ...opened, scores: { A: 100, B: 0 } };
check(feud.onTimeout(behind, { kind: 'buzz' }, NOW, {}).state.board.control === 'B', 'the TRAILING team gets the board, not always A');

// A lapsed answer must land on exactly the board a played miss lands on — that is
// what keeps a timeout from inventing a state the rest of the show cannot handle.
const missed = feud.applyJudgement(inPlay, { matchIndex: -1 }, A1, NOW);
const lapsed = feud.onTimeout(inPlay, { kind: 'answer', seatId: null }, NOW, { seats: SEATS });
check(lapsed.ok && lapsed.state.board.strikes === missed.state.board.strikes, 'a lapsed answer is a strike, exactly like a wrong one');
check(lapsed.state.phase === missed.state.phase, 'a lapsed answer leaves the same phase a wrong answer does');
let threeStrikes = inPlay;
for (let i = 0; i < 3; i++) threeStrikes = feud.onTimeout(threeStrikes, { kind: 'answer', seatId: null }, NOW, { seats: SEATS }).state;
check(threeStrikes.phase === 'steal' && threeStrikes.board.steal.team === 'B', 'three lapsed answers open the steal, same as three strikes');
const stealLapse = feud.onTimeout(threeStrikes, { kind: 'answer', seatId: null }, NOW, { seats: SEATS });
check(stealLapse.state.phase === 'round-win' && stealLapse.state.board.winner === 'A', 'a lapsed steal keeps the bank with the control team');
check(feud.windowFor(stealLapse.state) === null, 'the round-win board has no clock left running');

const faceoffLapse = feud.onTimeout(buzzed, { kind: 'answer', seatId: 'a1' }, NOW, { seats: SEATS });
check(faceoffLapse.ok && faceoffLapse.state.board.faceoff.stage === 'second', 'a lapsed face-off answer hands the buzzer to the other team');
check(faceoffLapse.state.board.faceoff.awaitingTeam === 'B' && faceoffLapse.state.buzz.open === true, 'the second face-off buzzer opens for the awaiting team');

const interviewing = { ...inPlay, interview: { active: true, seatId: 'a1', status: 'asked', question: 'q', at: NOW } };
check(feud.windowFor(interviewing).kind === 'interview', 'an unanswered interview is on the clock');
check(feud.onTimeout(interviewing, { kind: 'interview' }, NOW, {}).state.interview === undefined, 'a lapsed interview closes itself');

// ── Jeopardy windows and lapses (deliberately unlike Feud's) ─────────────────
// The Daily Double lands at random, so locate clues rather than assuming a slot —
// a fixed [0][0] passes nine runs in ten and then fails for no reason.
function findClue(state, wantDaily) {
  const cats = state.board.categories;
  for (let c = 0; c < cats.length; c++) {
    for (let r = 0; r < cats[c].clues.length; r++) {
      if (!!cats[c].clues[r].isDaily === wantDaily) return { cat: c, row: r, value: cats[c].clues[r].value };
    }
  }
  throw new Error('no ' + (wantDaily ? 'daily' : 'plain') + ' clue on the generated board');
}

const jBoard = jeopardy.ingestGenerated(jeopardy.initialState({}, [], NOW), BOARD, NOW).state;
check(jeopardy.windowFor(jBoard) === null, 'an idle Jeopardy board is not on the clock');
const spot = findClue(jBoard, false);
const picked = jeopardy.reduce(jBoard, { type: 'pick', cat: spot.cat, row: spot.row }, A1, NOW).state;
check(jeopardy.windowFor(picked).kind === 'buzz', 'a live clue opens a ring-in window');
const noTakers = jeopardy.onTimeout(picked, { kind: 'buzz' }, NOW, { seats: SEATS });
check(noTakers.ok && noTakers.state.phase === 'board' && noTakers.state.board.categories[spot.cat].clues[spot.row].used === true, 'a clue nobody rings in on is retired, not left live');
check(noTakers.state.scores.a1 === undefined, 'nobody is charged for a clue nobody rang in on');

const rung = jeopardy.reduce(picked, { type: 'buzz', serial: picked.buzz.serial }, A1, NOW).state;
check(jeopardy.windowFor(rung).seatId === 'a1', 'the player who rang in is the one on the clock');
const silent = jeopardy.onTimeout(rung, { kind: 'answer', seatId: 'a1' }, NOW, { seats: SEATS });
check(silent.ok && silent.state.scores.a1 === -spot.value, 'a silent responder is charged exactly like a wrong one');
check(silent.state.phase === 'clue', 'the clue re-opens for everyone else after a lapse');

const dailySpot = findClue(jBoard, true);
const daily = jeopardy.reduce(jBoard, { type: 'pick', cat: dailySpot.cat, row: dailySpot.row }, A1, NOW).state;
check(daily.phase === 'daily-wager' && jeopardy.windowFor(daily).kind === 'wager', 'a Daily Double wager is on the clock');
const autoWager = jeopardy.onTimeout(daily, { kind: 'wager', seatId: 'a1' }, NOW, { seats: SEATS });
check(autoWager.ok && autoWager.state.phase === 'answer' && autoWager.state.board.wager.amount === dailySpot.value, 'a silent Daily Double locks in at the clue value');

const finalW = { ...jBoard, phase: 'final-wager', scores: { a1: 800, b1: 400 }, board: { ...jBoard.board, final: { category: 'C', clue: 'x', answer: 'y' }, wagers: { a1: 500 }, finalJudged: {} } };
check(jeopardy.windowFor(finalW).kind === 'final-wager', 'final wagering is on the clock');
const lockedWagers = jeopardy.onTimeout(finalW, { kind: 'final-wager' }, NOW, { seats: SEATS });
check(lockedWagers.state.phase === 'final-answer' && lockedWagers.state.board.wagers.b1 === 0, 'a silent finalist is committed at zero, and the final still starts');
const finalLapse = jeopardy.onTimeout(lockedWagers.state, { kind: 'final-answer' }, NOW, { seats: SEATS });
check(finalLapse.state.scores.a1 === 300 && finalLapse.state.scores.b1 === 400, 'silent finalists lose their wagers');
check(finalLapse.state.phase === 'round-win' && finalLapse.state.board.winner === 'b1', 'the game still crowns a champion after a lapsed final');

if (failures) { console.error(`\n✗ ${failures}/${checks} round-clock checks failed`); process.exit(1); }
console.log(`✓ Round clock holds — ${checks} checks green (no beat can hang: buzz, answer, wager, interview, final)`);
