/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 13:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for Fast Money (backlog #6): the Feud endgame two players run against the clock. Pins the host-only start gate, the five-question generation, the turn gate, duplicate-scores-zero, the player handoff, the 200-point reveal with the team bonus, and that every question is its own timed window (a silent contestant records a zero and the run moves on). Plain `node tests/fast-money.test.js`.
 */

'use strict';

const feud = require('../lib/shows/family-feud');
const fm = require('../lib/shows/feud-fast-money');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 5000;
const HOST = { seatId: 'h1', role: 'host', team: null, name: 'MC' };
const A1 = { seatId: 'a1', role: 'player', team: 'A', name: 'Ana' };
const A2 = { seatId: 'a2', role: 'player', team: 'A', name: 'Al' };
const B1 = { seatId: 'b1', role: 'player', team: 'B', name: 'Bo' };
const SEATS = [
  { seat_id: 'h1', role: 'host', team: null, display_name: 'MC' },
  { seat_id: 'a1', role: 'player', team: 'A', display_name: 'Ana' },
  { seat_id: 'a2', role: 'player', team: 'A', display_name: 'Al' },
  { seat_id: 'b1', role: 'player', team: 'B', display_name: 'Bo' },
];
const CTX = { seats: SEATS };

/** A decided Feud game: all rounds played, Team A ahead. */
function decidedGame() {
  const base = feud.initialState({}, [], NOW);
  return { ...base, round: 3, phase: 'round-win', scores: { A: 240, B: 120 }, board: { ...base.board, winner: 'A' } };
}

function makeQuestions() {
  const questions = [];
  for (let i = 0; i < 5; i++) {
    questions.push({
      question: 'FM question ' + i,
      answers: [
        { text: 'Top' + i, points: 40, aliases: ['topper' + i] },
        { text: 'Mid' + i, points: 30, aliases: [] },
        { text: 'Low' + i, points: 10, aliases: [] },
      ],
    });
  }
  return { questions };
}

// ── The gate: host-only, and only once the game is decided ──────────────────
const decided = decidedGame();
check(feud.isGameOver(decided) === true, 'the fixture game reads as decided');
check(feud.reduce(decided, { type: 'startFastMoney', seat1: 'a1', seat2: 'a2' }, A1, NOW, CTX).ok === false, 'a player cannot start Fast Money');
check(feud.reduce({ ...decided, round: 1, phase: 'play' }, { type: 'startFastMoney', seat1: 'a1', seat2: 'a2' }, HOST, NOW, CTX).ok === false, 'Fast Money cannot interrupt a live round');
check(feud.reduce(decided, { type: 'startFastMoney', seat1: 'a1', seat2: 'a1' }, HOST, NOW, CTX).ok === false, 'the two contestants must be different podiums');

const opened = feud.reduce(decided, { type: 'startFastMoney', seat1: 'a1', seat2: 'a2' }, HOST, NOW, CTX);
check(opened.ok && opened.state.phase === 'fm-setup', 'the host opens Fast Money setup');
check(opened.state.fm.players[0] === 'a1' && opened.state.fm.team === 'A', 'the contestants and their team are recorded');
check(feud.isGameOver(opened.state) === false, 'a game headed into Fast Money is not over yet');
check(feud.reduce(opened.state, { type: 'startFastMoney', seat1: 'a1', seat2: 'a2' }, HOST, NOW, CTX).ok === false, 'Fast Money cannot be started twice');

// ── Generation: five questions or nothing ────────────────────────────────────
check(feud.canGenerate(opened.state) === true, 'content may be built during fm-setup');
check(/FAST MONEY/.test(feud.generatePrompt(opened.state, {})), 'the generate prompt asks for Fast Money questions');
check(feud.ingestGenerated(opened.state, { questions: makeQuestions().questions.slice(0, 3) }, NOW).ok === false, 'fewer than five questions is rejected');

const playing = feud.ingestGenerated(opened.state, makeQuestions(), NOW);
check(playing.ok && playing.state.phase === 'fm-play', 'five good questions start the run');
check(feud.canGenerate(playing.state) === false, 'no rebuilding mid-run');
check(feud.isGameOver(playing.state) === false, 'the run in progress is not game over');

// ── The turn gate and the clock ──────────────────────────────────────────────
check(feud.canAnswer(playing.state, A1).ok === true, 'player one is up first');
check(feud.canAnswer(playing.state, A2).ok === false && feud.canAnswer(playing.state, B1).ok === false, 'nobody else may answer');
const w0 = feud.windowFor(playing.state);
check(w0 && w0.seatId === 'a1' && w0.kind === 'fm-0-0', 'question one is its own timed window on player one');

// ── localJudge: exact + alias hits rule free; misses defer ───────────────────
check(feud.localJudge(playing.state, 'Top0').matchIndex === 0, 'an exact Fast Money answer rules locally');
check(feud.localJudge(playing.state, 'topper0').matchIndex === 0, 'an alias rules locally');
check(feud.localJudge(playing.state, 'nonsense') === null, 'a miss is left to the lenient LLM judge');

// ── Player one's run: five answers, then the handoff ─────────────────────────
let run = playing.state;
for (let q = 0; q < 4; q++) {
  const applied = feud.applyJudgement(run, { matchIndex: 0 }, A1, NOW, CTX);
  check(applied.ok, 'answer ' + (q + 1) + ' applies');
  run = applied.state;
  check(run.fm.current === q + 1 && run.fm.turn === 0, 'the run advances to question ' + (q + 2));
  const w = feud.windowFor(run);
  check(w && w.kind === 'fm-0-' + (q + 1), 'each question is a NEW window (the clock restarts)');
}
const handoff = feud.applyJudgement(run, { matchIndex: 1 }, A1, NOW, CTX);
check(handoff.ok && handoff.state.fm.turn === 1 && handoff.state.fm.current === 0, 'the fifth answer hands the run to player two');
check(feud.canAnswer(handoff.state, A2).ok === true && feud.canAnswer(handoff.state, A1).ok === false, 'only player two answers now');
check(feud.windowFor(handoff.state).seatId === 'a2', 'player two is on the clock');

// ── Duplicates score zero ────────────────────────────────────────────────────
const dup = feud.localJudge(handoff.state, 'Top0');
check(dup && dup.duplicate === true && dup.matchIndex === -1, 'repeating player one\'s answer is a duplicate');
const dupApplied = feud.applyJudgement(handoff.state, dup, A2, NOW, CTX);
check(dupApplied.ok && dupApplied.state.fm.answers[1][0].points === 0, 'a duplicate records zero points');

// ── A silent contestant records a zero and the run moves on ──────────────────
const lapsed = feud.onTimeout(handoff.state, feud.windowFor(handoff.state), NOW, CTX);
check(lapsed.ok && lapsed.state.fm.answers[1][0].points === 0 && lapsed.state.fm.current === 1, 'a lapsed question is a zero, not a hang');

// ── The reveal: totals combine toward 200, the team banks the bonus ──────────
let run2 = handoff.state;
for (let q = 0; q < 5; q++) run2 = feud.applyJudgement(run2, { matchIndex: 0 }, A2, NOW, CTX).state;
check(run2.phase === 'fm-reveal', 'both runs complete opens the reveal');
// P1: 40x4 + 30 = 190; P2: 40x5 = 200 → 390 total, well over 200.
check(run2.fm.total === 390 && run2.fm.won === true, 'the combined total is right and 200+ wins');
check(run2.scores.A === 240 + 300, 'the winning side banks the Fast Money bonus');
check(feud.isGameOver(run2) === true, 'the reveal ends the game (continue → outro)');
check(feud.windowFor(run2) === null, 'nothing is on the clock at the reveal');

// ── A losing run banks nothing ───────────────────────────────────────────────
let lose = handoff.state;
for (let q = 0; q < 5; q++) lose = feud.applyJudgement(lose, { matchIndex: -1, duplicate: false }, A2, NOW, CTX).state;
check(lose.phase === 'fm-reveal' && lose.fm.won === false, 'a short total still reveals, marked lost');
check(lose.scores.A === 240, 'no bonus without 200');

// ── Garbage rulings are rejected ─────────────────────────────────────────────
check(feud.applyJudgement(playing.state, { nonsense: true }, A1, NOW, CTX).ok === false, 'a shapeless ruling is rejected');

if (failures) { console.error(`\n✗ ${failures}/${checks} Fast Money checks failed`); process.exit(1); }
console.log(`✓ Fast Money holds — ${checks} checks green (gate, run, duplicates, handoff, clock-per-question, 200-point bonus)`);
