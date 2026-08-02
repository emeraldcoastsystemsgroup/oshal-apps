/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 10:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for Wheel of Fortune, the third show: turn-based claim/enforcement, the random spin (outcomes LOCATED by sweeping — never asserted at a fixed slot), consonant pay-per-hit, bought vowels, the auto-solve when the last letter falls, the local exact-match judge, the $500 solve floor, timeouts that always leave a playable board, and the host overrides. Plain `node tests/wheel.test.js`.
 */

'use strict';

const wheel = require('../lib/shows/wheel');
const registry = require('../lib/shows/show-registry');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 5000;
const P1 = { seatId: 'p1', name: 'Ana', team: null };
const P2 = { seatId: 'p2', name: 'Bo', team: null };
const P3 = { seatId: 'p3', name: 'Cy', team: null };
const SEATS = [
  { seatId: 'p1', display_name: 'Ana', role: 'player' },
  { seatId: 'p2', display_name: 'Bo', role: 'player' },
  { seatId: 'p3', display_name: 'Cy', role: 'player' },
];
const CTX = { seats: SEATS };
const VALUES = [100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 650, 700, 800, 900];

/** A round-1 'puzzle' board over HELLO WORLD (unique letters H,E,L,O,W,R,D). */
function fresh() {
  return wheel.ingestGenerated(wheel.initialState({}, SEATS, NOW), { category: 'Phrase', puzzle: 'hello world' }, NOW).state;
}
function withBoard(state, patch) { return { ...state, board: { ...state.board, ...patch } }; }

// ── Interface + opening shape ───────────────────────────────────────────────
let validated = false;
try { validated = registry.validateShow(wheel) === wheel; } catch (e) { validated = false; }
check(validated, 'wheel passes the registry required-member validation');
check(wheel.id === 'wheel' && wheel.teams === false, 'wheel is an individual-play show');

const s0 = wheel.initialState({}, SEATS, NOW);
check(s0.phase === 'lobby' && s0.showId === 'wheel' && s0.round === 0, 'opens in the lobby at round 0');
check(s0.board.puzzle === '' && Array.isArray(s0.board.guessed) && s0.board.control === null && s0.board.spin === null, 'the board opens empty with no turn holder');
check(s0.board.roundsTotal === 3 && Object.keys(s0.scores).length === 0 && s0.board.solved === false, 'three rounds, nothing solved, no scores yet');
check(wheel.canGenerate(s0) === true, 'the host may build a puzzle in the lobby');

// ── ingestGenerated validates and uppercases ────────────────────────────────
const gen = wheel.ingestGenerated(s0, { category: 'phrase', puzzle: 'hello world' }, NOW);
check(gen.ok && gen.state.phase === 'puzzle' && gen.state.round === 1, 'a valid puzzle opens round 1');
check(gen.state.board.puzzle === 'HELLO WORLD', 'the puzzle is uppercased');
check(gen.state.board.control === null, 'a fresh game starts with the turn unclaimed');
check(gen.event && gen.event.kind === 'milestone' && gen.event.content.indexOf('Round 1') === 0, 'the milestone names the round and category');
check(wheel.canGenerate(gen.state) === false, 'the host may NOT rebuild mid-puzzle');
check(wheel.ingestGenerated(s0, { category: 'x', puzzle: 'CATCH 22' }, NOW).ok === false, 'digits are rejected');
check(wheel.ingestGenerated(s0, { category: 'x', puzzle: 'A B' }, NOW).ok === false, 'a puzzle with under 4 letters is rejected');
check(wheel.ingestGenerated(s0, { puzzle: 'HELLO WORLD' }, NOW).ok === false, 'a missing category is rejected');
check(wheel.ingestGenerated(s0, { category: 'x', puzzle: '' }, NOW).ok === false, 'an empty puzzle is rejected');
check(wheel.ingestGenerated(s0, { category: 'Song', puzzle: "don't stop" }, NOW).ok === true, 'apostrophes and hyphens are legal puzzle characters');

const carried = wheel.ingestGenerated(withBoard({ ...fresh(), phase: 'round-win' }, { control: 'p2', banks: { p2: 700 }, guessed: ['L'] }),
  { category: 'Next', puzzle: 'FOUR MORE WORDS' }, NOW);
check(carried.ok && carried.state.round === 2 && carried.state.board.control === 'p2', 'the prior turn holder keeps the wheel into the next round');
check(Object.keys(carried.state.board.banks).length === 0 && carried.state.board.guessed.length === 0, 'banks and called letters reset each round');

// ── Turn claim + enforcement ────────────────────────────────────────────────
const claimed = wheel.reduce(fresh(), { type: 'spin' }, P1, NOW, CTX);
check(claimed.ok === true && claimed.state.board.control !== null, 'the first spin claims the open turn');
const intruder = claimed.state.board.control === 'p1' ? P2 : P1;
check(wheel.reduce(claimed.state, { type: 'spin' }, intruder, NOW, CTX).error === 'NOT_YOUR_TURN', 'a seat without the wheel cannot spin');
check(wheel.reduce({ ...fresh(), phase: 'lobby' }, { type: 'spin' }, P1, NOW, CTX).ok === false, 'no spinning outside the puzzle phase');
check(wheel.reduce(fresh(), { type: 'juggle' }, P1, NOW, CTX).error === 'UNKNOWN_ACTION', 'an unknown action is rejected');

// ── The spin is random: LOCATE every outcome by sweeping, never assert a slot ─
let sawValue = false, sawBankrupt = false, sawLoseTurn = false, unknownOutcome = false;
for (let i = 0; i < 800 && !(sawValue && sawBankrupt && sawLoseTurn); i++) {
  const base = withBoard(fresh(), { control: 'p1', banks: { p1: 100 } });
  const spun = wheel.reduce(base, { type: 'spin' }, P1, NOW, CTX);
  if (!spun.ok) { unknownOutcome = true; break; }
  const b = spun.state.board;
  if (b.spin && VALUES.indexOf(b.spin.value) >= 0 && b.control === 'p1') sawValue = true;
  else if (b.spin === null && b.control === 'p2' && b.banks.p1 === 0) sawBankrupt = true;
  else if (b.spin === null && b.control === 'p2' && b.banks.p1 === 100) sawLoseTurn = true;
  else { unknownOutcome = true; break; }
}
check(!unknownOutcome, 'every spin resolves to a known segment shape');
check(sawValue, 'value segments land and hold for the consonant call, keeping the turn');
check(sawBankrupt, 'BANKRUPT zeroes the round bank and passes the turn');
check(sawLoseTurn, 'LOSE-A-TURN passes the turn but keeps the bank');

const pending = withBoard(fresh(), { control: 'p1', spin: { value: 300 }, banks: { p1: 0 } });
check(wheel.reduce(pending, { type: 'spin' }, P1, NOW, CTX).error === 'ALREADY_SPUN', 'no re-spin over an unresolved spin');

// ── guessLetter: pays per occurrence, deterministic via a forced spin state ──
const hit = wheel.reduce(pending, { type: 'guessLetter', letter: 'l' }, P1, NOW, CTX);
check(hit.ok && hit.state.board.banks.p1 === 900, 'three L\'s at $300 pay $900');
check(hit.state.board.guessed.indexOf('L') >= 0 && hit.state.board.spin === null, 'the letter is recorded and the spin consumed');
check(hit.state.board.control === 'p1' && hit.state.phase === 'puzzle', 'a hit keeps the turn');
check(wheel.reduce(pending, { type: 'guessLetter', letter: 'E' }, P1, NOW, CTX).error === 'VOWELS_ARE_BOUGHT', 'vowels cannot be called against a spin');
check(wheel.reduce(withBoard(hit.state, { spin: { value: 200 } }), { type: 'guessLetter', letter: 'L' }, P1, NOW, CTX).error === 'ALREADY_GUESSED', 'a repeated letter is rejected');
check(wheel.reduce(pending, { type: 'guessLetter', letter: '3' }, P1, NOW, CTX).ok === false, 'a non-letter is rejected');
check(wheel.reduce(pending, { type: 'guessLetter', letter: 'T' }, P2, NOW, CTX).error === 'NOT_YOUR_TURN', 'only the spinner may call the consonant');
check(wheel.reduce(withBoard(fresh(), { control: 'p1' }), { type: 'guessLetter', letter: 'T' }, P1, NOW, CTX).error === 'SPIN_FIRST', 'a consonant call needs a spin behind it');

const miss = wheel.reduce(pending, { type: 'guessLetter', letter: 'Z' }, P1, NOW, CTX);
check(miss.ok && miss.state.board.control === 'p2' && miss.state.board.spin === null, 'a whiffed consonant passes the turn');
check(miss.state.board.banks.p1 === 0 && miss.state.board.guessed.indexOf('Z') >= 0, 'a whiff pays nothing but still burns the letter');

// ── buyVowel: flat $250, keep the turn, reject the broke ────────────────────
const rich = withBoard(fresh(), { control: 'p1', banks: { p1: 900 } });
const bought = wheel.reduce(rich, { type: 'buyVowel', letter: 'o' }, P1, NOW, CTX);
check(bought.ok && bought.state.board.banks.p1 === 650, 'a vowel costs $250 regardless of hits');
check(bought.state.board.guessed.indexOf('O') >= 0 && bought.state.board.control === 'p1', 'the vowel reveals and the turn is kept');
check(wheel.reduce(withBoard(fresh(), { control: 'p1', banks: { p1: 100 } }), { type: 'buyVowel', letter: 'O' }, P1, NOW, CTX).error === 'NOT_ENOUGH', 'a broke player cannot buy a vowel');
check(wheel.reduce(withBoard(rich, { spin: { value: 300 } }), { type: 'buyVowel', letter: 'O' }, P1, NOW, CTX).error === 'GUESS_YOUR_SPIN', 'a pending spin must be called before buying');
check(wheel.reduce(rich, { type: 'buyVowel', letter: 'T' }, P1, NOW, CTX).error === 'NOT_A_VOWEL', 'consonants are spun for, not bought');
check(wheel.reduce(withBoard(rich, { guessed: ['O'] }), { type: 'buyVowel', letter: 'O' }, P1, NOW, CTX).error === 'ALREADY_GUESSED', 'a vowel cannot be bought twice');

// ── Auto-solve: the last letter falling IS a solve, on the round-win path ────
const nearly = withBoard(fresh(), { control: 'p1', guessed: ['H', 'E', 'L', 'O', 'W', 'R'], spin: { value: 200 }, banks: { p1: 1000 } });
const auto = wheel.reduce(nearly, { type: 'guessLetter', letter: 'D' }, P1, NOW, CTX);
check(auto.ok && auto.state.phase === 'round-win' && auto.state.board.solved === true, 'revealing the last letter auto-solves the puzzle');
check(auto.state.board.winner === 'p1' && auto.state.scores.p1 === 1200, 'the auto-solve banks the round money including the paying letter');

const vowelNearly = withBoard(fresh(), { control: 'p1', guessed: ['H', 'L', 'O', 'W', 'R', 'D'], banks: { p1: 300 } });
const vowelAuto = wheel.reduce(vowelNearly, { type: 'buyVowel', letter: 'E' }, P1, NOW, CTX);
check(vowelAuto.ok && vowelAuto.state.phase === 'round-win' && vowelAuto.state.scores.p1 === 500, 'an auto-solve off a bought vowel still floors at $500');

// ── canAnswer gates the solve before an LLM call is spent ───────────────────
const turnState = withBoard(fresh(), { control: 'p1' });
check(wheel.canAnswer(turnState, P1).ok === true && wheel.canAnswer(turnState, P2).ok === false, 'only the wheel holder may try to solve');
check(wheel.canAnswer(withBoard(turnState, { spin: { value: 300 } }), P1).ok === false, 'an uncalled spin blocks the solve');
check(wheel.canAnswer(fresh(), P2).ok === true, 'an unclaimed turn lets anyone try the solve');
check(wheel.canAnswer({ ...turnState, phase: 'round-win' }, P1).ok === false, 'no solving between rounds');

// ── localJudge: free exact match, everything else defers to the LLM ─────────
check(wheel.localJudge(fresh(), 'hello world').correct === true, 'an exact solve is judged locally with no LLM spend');
check(wheel.localJudge(fresh(), '  Hello,   WORLD! ').correct === true, 'punctuation and spacing never block a local match');
check(wheel.localJudge(fresh(), 'hello word') === null, 'a near miss falls through to the lenient LLM judge');
check(wheel.localJudge(fresh(), '') === null, 'an empty guess is never a local match');

// ── applyJudgement: the solve ruling ────────────────────────────────────────
const solveState = withBoard(fresh(), { control: 'p1', banks: { p1: 300 } });
const won = wheel.applyJudgement(solveState, { correct: true }, P1, NOW, CTX);
check(won.ok && won.state.phase === 'round-win' && won.state.board.winner === 'p1', 'a correct solve wins the round');
check(won.state.scores.p1 === 500, 'a thin-bank solve is floored at $500');
check(['H', 'E', 'L', 'O', 'W', 'R', 'D'].every((l) => won.state.board.guessed.indexOf(l) >= 0), 'the solved board reveals every letter');
check(wheel.windowFor(won.state) === null, 'a solved round leaves no clock running');
const bigWin = wheel.applyJudgement(withBoard(fresh(), { control: 'p1', banks: { p1: 900 } }), { correct: true }, P1, NOW, CTX);
check(bigWin.state.scores.p1 === 900, 'a fat bank banks in full on a solve');
const missSolve = wheel.applyJudgement(solveState, { correct: false }, P1, NOW, CTX);
check(missSolve.ok && missSolve.state.phase === 'puzzle' && missSolve.state.board.control === 'p2', 'a wrong solve passes the wheel and play continues');
check(wheel.applyJudgement(solveState, { correct: 'yes' }, P1, NOW, CTX).error === 'BAD_RULING', 'a garbage ruling is rejected');
check(wheel.applyJudgement(solveState, { matchIndex: 0 }, P1, NOW, CTX).error === 'BAD_RULING', 'a Feud-shaped ruling is rejected');

// ── windowFor: the right window per phase ───────────────────────────────────
const spinWindow = wheel.windowFor(withBoard(fresh(), { control: 'p1', spin: { value: 300 } }));
check(spinWindow.kind === 'answer' && spinWindow.seatId === 'p1', 'an unresolved spin puts the consonant call on the clock');
const turnWindow = wheel.windowFor(withBoard(fresh(), { control: 'p1' }));
check(turnWindow.kind === 'turn' && turnWindow.seatId === 'p1', 'the wheel holder is on the turn clock');
check(wheel.windowFor(fresh()) === null, 'an unclaimed turn has no clock — the first mover claims it');
const interviewing = { ...fresh(), interview: { active: true, seatId: 'p2', status: 'asked', question: 'q', at: NOW } };
check(wheel.windowFor(interviewing).kind === 'interview', 'an open interview is on the clock');
check(wheel.windowFor({ ...fresh(), phase: 'round-win' }) === null, 'nothing is on the clock between rounds');

// ── onTimeout: every lapse leaves a board the normal reducers handle ────────
const spunOut = wheel.onTimeout(withBoard(fresh(), { control: 'p1', spin: { value: 300 } }), { kind: 'answer', seatId: 'p1' }, NOW, CTX);
check(spunOut.ok && spunOut.state.board.spin === null && spunOut.state.board.control === 'p2', 'an uncalled consonant lapses like a miss: spin dies, turn passes');
check(spunOut.state.phase === 'puzzle', 'the puzzle stays live after a lapse');
check(wheel.reduce(spunOut.state, { type: 'spin' }, P2, NOW, CTX).ok === true, 'the next player can act on the post-timeout board');
const idleOut = wheel.onTimeout(withBoard(fresh(), { control: 'p2' }), { kind: 'turn', seatId: 'p2' }, NOW, CTX);
check(idleOut.ok && idleOut.state.board.control === 'p3', 'an idle turn passes to the next seat in order');
check(wheel.onTimeout(interviewing, { kind: 'interview' }, NOW, CTX).state.interview === undefined, 'a lapsed interview closes itself');
check(wheel.onTimeout(fresh(), { kind: 'martian' }, NOW, CTX).ok === false, 'an unknown window is rejected');

// ── Host overrides ──────────────────────────────────────────────────────────
const given = wheel.override(withBoard(fresh(), { control: 'p1', spin: { value: 300 } }), { type: 'setControl', seatId: 'p3' }, CTX, NOW);
check(given.ok && given.state.board.control === 'p3' && given.state.board.spin === null, 'setControl hands the wheel over and clears the stuck spin');
const revealed = wheel.override(withBoard(fresh(), { control: 'p1', banks: { p1: 800 } }), { type: 'revealPuzzle' }, CTX, NOW);
check(revealed.ok && revealed.state.phase === 'round-win' && revealed.state.board.winner === null, 'revealPuzzle retires the round with NO winner');
check(revealed.state.board.solved === true && revealed.state.scores.p1 === undefined, 'a host reveal pays nobody');
check(wheel.override(fresh(), { type: 'skipRound' }, CTX, NOW).state.phase === 'round-win', 'skipRound retires the puzzle the same way');
check(wheel.override(fresh(), { type: 'summonWhammy' }, CTX, NOW).error === 'UNKNOWN_OVERRIDE', 'an unknown override is rejected');

// ── Game over + scoreboard ──────────────────────────────────────────────────
check(wheel.isGameOver({ round: 3, phase: 'round-win', board: { roundsTotal: 3 } }) === true, 'the game ends after the final round-win');
check(wheel.isGameOver({ round: 2, phase: 'round-win', board: { roundsTotal: 3 } }) === false, 'a mid-game round-win does not end it');
check(wheel.isGameOver({ round: 3, phase: 'puzzle', board: { roundsTotal: 3 } }) === false, 'a live final puzzle is not over');
check(wheel.canGenerate({ round: 3, phase: 'round-win', board: { roundsTotal: 3 } }) === false, 'no fresh puzzle once the game is decided');

const sbState = withBoard({ ...fresh(), scores: { p1: 1000, p2: 2000 } }, { banks: { p1: 1500 } });
const sb = wheel.scoreboard(sbState, SEATS);
check(sb[0].seatId === 'p1' && sb[0].score === 2500, 'standings add the live round bank on top of banked totals');
check(sb[0].bank === 1500 && sb[1].bank === 0, 'each row carries its round bank');
check(sb.length === 3 && sb[1].seatId === 'p2' && sb[2].score === 0, 'sorted descending with hosts excluded');

// ── Prompts: the host never reads the answer aloud mid-round ────────────────
check(wheel.generatePrompt(s0, { usedQuestions: ['OLD ONE'] }).indexOf('OLD ONE') >= 0, 'generation avoids already-played puzzles');
check(wheel.judgePrompt(fresh(), 'a guess').indexOf('HELLO WORLD') >= 0, 'the judge sees the full puzzle');
check(wheel.spokenPrompt('banter', withBoard(fresh(), { guessed: ['L'] })).indexOf('HELLO') < 0, 'banter never leaks the unmasked puzzle');
check(wheel.spokenPrompt('reveal', withBoard(fresh(), { guessed: ['L'] })).indexOf('WORLD') < 0, 'reveal lines never leak the unmasked puzzle');
check(wheel.spokenPrompt('outro', won.state).indexOf('HELLO WORLD') >= 0, 'the outro may name the puzzle once it is solved');

if (failures) { console.error(`\n✗ ${failures}/${checks} wheel checks failed`); process.exit(1); }
console.log(`✓ Wheel of Fortune plugs into the same engine — ${checks} checks green (turn claim, spin segments, letters, vowels, auto-solve, judge, clock, overrides)`);
