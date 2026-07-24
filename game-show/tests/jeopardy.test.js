/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 02:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Plays a COMPLETE Jeopardy game through the shared Show interface — board pick, ring-in, correct/wrong scoring with re-buzz, Daily Double wager, board exhaustion, and Final Jeopardy wagering — proving a second show plugs into the engine with no engine changes. Plain `node tests/jeopardy.test.js`.
 */

'use strict';

const jeopardy = require('../lib/shows/jeopardy');
const feud = require('../lib/shows/family-feud');
const registry = require('../lib/shows/show-registry');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 1000;
const P1 = { seatId: 'p1', name: 'Ana', team: null };
const P2 = { seatId: 'p2', name: 'Bo', team: null };
const SEATS = [
  { seatId: 'p1', display_name: 'Ana', role: 'player' },
  { seatId: 'p2', display_name: 'Bo', role: 'player' },
];
const CTX = { seats: SEATS };

function makeBoard(nCats) {
  const categories = [];
  for (let c = 0; c < nCats; c++) {
    const clues = [];
    for (let r = 0; r < 5; r++) clues.push({ clue: 'C' + c + 'R' + r + ' clue', answer: 'ans' + c + r });
    categories.push({ title: 'Cat' + c, clues: clues });
  }
  return { categories: categories };
}
const find = (board, pred) => {
  for (let c = 0; c < board.categories.length; c++) {
    for (let r = 0; r < 5; r++) if (pred(board.categories[c].clues[r])) return { cat: c, row: r };
  }
  return null;
};

// ── Both shows registered, engine untouched ──────────────────────────────────
check(registry.has('jeopardy') && registry.has('family-feud'), 'both shows are registered');
check(registry.list().length === 2, 'catalog lists two shows');
check(registry.get('jeopardy').teams === false && registry.get('family-feud').teams === true, 'one show is individual, one is teamed');

// ── Opening + generation ─────────────────────────────────────────────────────
let s = jeopardy.initialState({}, SEATS, NOW);
check(s.phase === 'lobby' && Object.keys(s.scores).length === 0, 'jeopardy opens in the lobby with no scores');
check(jeopardy.canGenerate(s) === true, 'host may build the board in the lobby');

let gen = jeopardy.ingestGenerated(s, makeBoard(2), NOW);
check(gen.ok && gen.state.phase === 'board' && gen.state.round === 1, 'a valid board opens round 1');
check(gen.state.board.categories.length === 2 && gen.state.board.categories[0].clues.length === 5, 'board is 2 categories x 5 clues');
check(gen.state.board.categories[0].clues[4].value === 1000, 'row values ladder to $1000');
check(jeopardy.canGenerate(gen.state) === false, 'host may NOT rebuild mid-board');
check(jeopardy.ingestGenerated(s, { categories: [] }, NOW).ok === false, 'an empty board is rejected');

const dailies = gen.state.board.categories.reduce((n, c) => n + c.clues.filter((q) => q.isDaily).length, 0);
check(dailies === 1, 'exactly one Daily Double is placed');

// ── Pick → ring in → correct ─────────────────────────────────────────────────
const plain = find(gen.state.board, (q) => !q.isDaily);
let picked = jeopardy.reduce(gen.state, { type: 'pick', cat: plain.cat, row: plain.row }, P1, NOW, CTX);
check(picked.ok && picked.state.phase === 'clue' && picked.state.buzz.open === true, 'picking a clue opens the shared buzzer');
check(picked.state.shot.type === 'buzzer-race', 'the shared director cuts to the buzzer race');

let buzzed = jeopardy.reduce(picked.state, { type: 'buzz', serial: picked.state.buzz.serial }, P1, NOW, CTX);
check(buzzed.ok && buzzed.state.phase === 'answer' && buzzed.state.buzz.lockedBy === 'p1', 'first ring-in locks the response');
check(jeopardy.canAnswer(buzzed.state, P1).ok === true && jeopardy.canAnswer(buzzed.state, P2).ok === false, 'only the player who rang in may respond');
check(jeopardy.applyJudgement(buzzed.state, { matchIndex: 0 }, P1, NOW, CTX).ok === false, 'a Feud-shaped ruling is rejected by jeopardy');

const clueValue = gen.state.board.categories[plain.cat].clues[plain.row].value;
let right = jeopardy.applyJudgement(buzzed.state, { correct: true }, P1, NOW, CTX);
check(right.ok && right.state.scores.p1 === clueValue, 'a correct response adds the clue value');
check(right.state.phase === 'board' && right.state.board.control === 'p1', 'the winner takes control of the board');
check(right.state.board.categories[plain.cat].clues[plain.row].used === true, 'the clue is marked played');

// ── Control is enforced; a wrong response re-opens the buzzer ────────────────
const plain2 = find(right.state.board, (q) => !q.isDaily && !q.used);
check(jeopardy.reduce(right.state, { type: 'pick', cat: plain2.cat, row: plain2.row }, P2, NOW, CTX).ok === false, 'a player without control cannot pick');
let picked2 = jeopardy.reduce(right.state, { type: 'pick', cat: plain2.cat, row: plain2.row }, P1, NOW, CTX);
let buzz2 = jeopardy.reduce(picked2.state, { type: 'buzz', serial: picked2.state.buzz.serial }, P2, NOW, CTX);
const value2 = right.state.board.categories[plain2.cat].clues[plain2.row].value;
let wrong = jeopardy.applyJudgement(buzz2.state, { correct: false }, P2, NOW, CTX);
check(wrong.ok && wrong.state.scores.p2 === -value2, 'a wrong response subtracts the clue value');
check(wrong.state.phase === 'clue' && wrong.state.buzz.open === true, 'the buzzer re-opens for everyone else');
check(wrong.state.board.missed.indexOf('p2') >= 0, 'the misser is recorded');
check(jeopardy.reduce(wrong.state, { type: 'buzz', serial: wrong.state.buzz.serial }, P2, NOW, CTX).ok === false, 'a player who already missed cannot ring in again');
let buzz3 = jeopardy.reduce(wrong.state, { type: 'buzz', serial: wrong.state.buzz.serial }, P1, NOW, CTX);
check(buzz3.ok && buzz3.state.phase === 'answer', 'the other player can still ring in');

// ── Play the whole board out (Daily Double included) ─────────────────────────
let cur = jeopardy.applyJudgement(buzz3.state, { correct: true }, P1, NOW, CTX).state;
let guard = 0;
while (cur.phase !== 'final-setup' && guard++ < 40) {
  if (cur.phase === 'board') {
    const next = find(cur.board, (q) => !q.used);
    if (!next) break;
    cur = jeopardy.reduce(cur, { type: 'pick', cat: next.cat, row: next.row }, P1, NOW, CTX).state;
  } else if (cur.phase === 'daily-wager') {
    const w = jeopardy.reduce(cur, { type: 'wager', amount: 400 }, P1, NOW, CTX);
    check(w.ok && w.state.phase === 'answer' && w.state.board.wager.amount === 400, 'a Daily Double wager sends the picker straight to the response');
    cur = w.state;
  } else if (cur.phase === 'clue') {
    cur = jeopardy.reduce(cur, { type: 'buzz', serial: cur.buzz.serial }, P1, NOW, CTX).state;
  } else if (cur.phase === 'answer') {
    cur = jeopardy.applyJudgement(cur, { correct: true }, P1, NOW, CTX).state;
  } else break;
}
check(cur.phase === 'final-setup', 'exhausting the board moves the game to Final Jeopardy setup');
check(jeopardy.canGenerate(cur) === true, 'the host may build the final clue');

// ── Final Jeopardy: wager, answer, crown ─────────────────────────────────────
let finalGen = jeopardy.ingestGenerated(cur, { final: { category: 'History', clue: 'This year', answer: '1969' } }, NOW);
check(finalGen.ok && finalGen.state.phase === 'final-wager', 'the final clue opens wagering');

const p1Score = finalGen.state.scores.p1;
let w1 = jeopardy.reduce(finalGen.state, { type: 'finalWager', amount: 999999 }, P1, NOW, CTX);
check(w1.ok && w1.state.board.wagers.p1 === p1Score, 'a final wager is capped at the player\'s score');
// p2 finished in the red, so p1 is the only solvent contender — wagering closes at once.
check(w1.state.phase === 'final-answer', 'wagering completes once every solvent contender has wagered');
check(jeopardy.reduce(finalGen.state, { type: 'finalWager', amount: 10 }, P2, NOW, CTX).ok === false, 'a player with no money is not in the final');

// Two solvent contenders: wagering must stay OPEN until both are in.
const twoUp = { ...finalGen.state, scores: { p1: 800, p2: 500 } };
const firstWager = jeopardy.reduce(twoUp, { type: 'finalWager', amount: 300 }, P1, NOW, CTX);
check(firstWager.ok && firstWager.state.phase === 'final-wager', 'wagering stays open while a contender has not wagered');
const secondWager = jeopardy.reduce(firstWager.state, { type: 'finalWager', amount: 500 }, P2, NOW, CTX);
check(secondWager.ok && secondWager.state.phase === 'final-answer', 'the last wager opens the final answers');

let ready = w1.state;
check(jeopardy.canAnswer(ready, P1).ok === true, 'the wagering contender may answer the final');
let done = jeopardy.applyJudgement(ready, { correct: true }, P1, NOW, CTX);
check(done.ok && done.state.scores.p1 === p1Score * 2, 'a correct final doubles the wagering contender');
check(done.state.phase === 'round-win' && done.state.board.winner === 'p1', 'the champion is crowned');
check(jeopardy.isGameOver(done.state) === true, 'the game reports over');

const sb = jeopardy.scoreboard(done.state, SEATS);
check(sb[0].seatId === 'p1' && sb[0].score > sb[1].score, 'scoreboard ranks individuals by score');

// ── Feud still holds after the interface generalization ──────────────────────
check(feud.canGenerate({ phase: 'lobby' }) === true && feud.canGenerate({ phase: 'play' }) === false, 'feud gates generation on its own phases');
check(feud.applyJudgement({ phase: 'play', board: {} }, {}, {}, NOW).ok === false, 'feud rejects a ruling with no matchIndex');

if (failures) { console.error(`\n✗ ${failures}/${checks} jeopardy checks failed`); process.exit(1); }
console.log(`✓ Jeopardy plugs into the same engine — ${checks} checks green (board, ring-in, re-buzz, Daily Double, final wagering)`);
