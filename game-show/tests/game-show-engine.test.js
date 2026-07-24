/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Drives the REAL engine modules the live surface will run — the generalized buzzer, the cutaway director, and the Family Feud reducers — through a complete round (generate, face-off, play, strikes, steal, scoring) and pins every rule. Plain `node tests/game-show-engine.test.js` — no framework.
 */

'use strict';

const buzzer = require('../lib/buzzer');
const director = require('../lib/director');
const feud = require('../lib/shows/family-feud');
const registry = require('../lib/shows/show-registry');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 1000;
const SURVEY = {
  question: 'Name a fruit',
  answers: [
    { text: 'Apple', points: 40, aliases: ['apples'] },
    { text: 'Banana', points: 30, aliases: [] },
    { text: 'Orange', points: 20, aliases: [] },
    { text: 'Grape', points: 10, aliases: ['grapes'] },
  ],
};
const A1 = { seatId: 'a1', team: 'A', name: 'Ana' };
const B1 = { seatId: 'b1', team: 'B', name: 'Bo' };

// ── Registry ────────────────────────────────────────────────────────────────
check(registry.has('family-feud'), 'family-feud is registered');
check(registry.get('family-feud') === feud, 'registry returns the feud module');
check(registry.list().some((s) => s.id === 'family-feud' && s.teams === true), 'catalog lists a teamed feud');

// ── Generalized buzzer: server decides the first press ───────────────────────
let bs = buzzer.open(buzzer.arm({}, { prompt: 'go' }), NOW);
check(bs.buzz.open === true && bs.buzz.serial === 1, 'buzzer arms then opens');
let p1 = buzzer.press(bs, 'x', NOW, 1);
check(p1.ok && p1.locked && buzzer.winner(p1.state) === 'x', 'first press acquires the lock');
let p2 = buzzer.press(p1.state, 'y', NOW, 1);
check(p2.ok && !p2.locked && buzzer.winner(p2.state) === 'x', 'a later press does NOT steal the lock');
check(p2.state.buzz.order.length === 2 && p2.state.buzz.order[1].seatId === 'y', 'order records everyone in arrival order');
check(buzzer.press(bs, 'x', NOW, 99).ok === false, 'a stale serial is rejected');
const gated = buzzer.open(buzzer.arm({}, { eligible: ['only'] }), NOW);
check(buzzer.press(gated, 'nope', NOW, 1).ok === false, 'ineligible seat cannot press');
check(buzzer.press(gated, 'only', NOW, 1).ok === true, 'eligible seat can press');

// ── Director: shots are data and advance a serial ────────────────────────────
let ds = director.cut({}, 'celebration', 'A', NOW);
check(ds.shot.type === 'celebration' && ds.shot.focus === 'A' && ds.shot.serial === 1, 'director cuts to a shot');
check(director.cut(ds, 'bogus', null, NOW).shot.type === 'board', 'unknown shot falls back to board');
check(director.autoCut({ phase: 'steal' }, null, NOW).shot.type === 'team-huddle', 'phase steal auto-cuts to a huddle');

// ── Family Feud: opening state ───────────────────────────────────────────────
let s = feud.initialState({}, [], NOW);
check(s.phase === 'lobby' && s.scores.A === 0 && s.scores.B === 0, 'feud opens in the lobby at 0-0');

// ── Generate + open the face-off ─────────────────────────────────────────────
let gen = feud.ingestGenerated(s, SURVEY, NOW);
check(gen.ok && gen.state.phase === 'faceoff' && gen.state.round === 1, 'a valid survey opens round 1 at the face-off');
check(gen.state.board.answers[0].text === 'Apple' && gen.state.board.answers[3].text === 'Grape', 'answers are ranked most-to-least');
check(gen.state.board.multiplier === 1 && gen.state.buzz.open === true, 'round 1 multiplier is 1 and the buzzer is live');
check(feud.ingestGenerated(s, { question: '', answers: [] }, NOW).ok === false, 'an empty survey is rejected');

// ── Flow A: a top-answer face-off wins control outright ──────────────────────
let a = feud.reduce(gen.state, { type: 'buzz', serial: gen.state.buzz.serial }, A1, NOW);
check(a.ok && a.state.board.faceoff.firstSeat === 'a1' && a.state.buzz.open === false, 'first buzz locks the face-off and closes the buzzer');
check(feud.canAnswer(a.state, A1).ok === true && feud.canAnswer(a.state, B1).ok === false, 'only the buzzed-in player may answer');
let aTop = feud.applyJudgement(a.state, { matchIndex: 0 }, A1, NOW); // Apple = number one
check(aTop.ok && aTop.state.phase === 'play' && aTop.state.board.control === 'A', 'the number-one answer takes control immediately');
check(aTop.state.board.bank === 40 && aTop.state.board.answers[0].revealed === true, 'the top answer banks its points');

// ── Flow B: face-off falls to the second team, then play/strikes/steal ───────
let b = feud.reduce(gen.state, { type: 'buzz', serial: gen.state.buzz.serial }, A1, NOW);
let bLow = feud.applyJudgement(b.state, { matchIndex: 1 }, A1, NOW); // Banana (30) — not the top
check(bLow.state.phase === 'faceoff' && bLow.state.board.faceoff.stage === 'second' && bLow.state.board.faceoff.awaitingTeam === 'B', 'a non-top face-off answer hands the buzzer to the other team');
check(bLow.state.board.faceoff.firstPoints === 30 && bLow.state.board.answers[1].revealed === true, 'the first face-off answer is banked and revealed');
check(feud.reduce(bLow.state, { type: 'buzz', serial: bLow.state.buzz.serial }, A1, NOW).ok === false, "the first team can't buzz the second face-off");
let bBuzz2 = feud.reduce(bLow.state, { type: 'buzz', serial: bLow.state.buzz.serial }, B1, NOW);
check(bBuzz2.ok && bBuzz2.state.board.faceoff.secondSeat === 'b1', 'the awaiting team buzzes the second face-off');
let bCtrl = feud.applyJudgement(bBuzz2.state, { matchIndex: 2 }, B1, NOW); // Orange (20) < 30
check(bCtrl.state.phase === 'play' && bCtrl.state.board.control === 'A', 'the higher face-off answer keeps control with team A');
check(bCtrl.state.board.bank === 50, 'both face-off answers (30+20) seed the bank');

let play = feud.applyJudgement(bCtrl.state, { matchIndex: 0 }, A1, NOW); // Apple (40) new
check(play.state.board.bank === 90 && play.state.board.answers[0].revealed === true, 'a control-team guess reveals and banks a new answer');
let strike1 = feud.applyJudgement(play.state, { matchIndex: -1 }, A1, NOW);
let strike2 = feud.applyJudgement(strike1.state, { matchIndex: -1 }, A1, NOW);
check(strike2.state.board.strikes === 2 && strike2.state.phase === 'play', 'two misses are two strikes');
let strike3 = feud.applyJudgement(strike2.state, { matchIndex: -1 }, A1, NOW);
check(strike3.state.phase === 'steal' && strike3.state.board.steal.team === 'B', 'the third strike opens the steal for team B');
check(feud.canAnswer(strike3.state, B1).ok === true && feud.canAnswer(strike3.state, A1).ok === false, 'only the stealing team may steal');
let steal = feud.applyJudgement(strike3.state, { matchIndex: 3 }, B1, NOW); // Grape (10) — steals it
check(steal.state.phase === 'round-win' && steal.state.board.winner === 'B', 'a correct steal wins the round for team B');
check(steal.state.scores.B === 100 && steal.state.board.answers.every((x) => x.revealed), 'the full bank (x1) is awarded and the board is revealed');

// ── A failed steal keeps the bank with the control team ──────────────────────
let missSteal = feud.applyJudgement(strike3.state, { matchIndex: -1 }, B1, NOW);
check(missSteal.state.board.winner === 'A' && missSteal.state.scores.A === 90, 'a failed steal keeps the 90-point bank with team A');

if (failures) { console.error(`\n✗ ${failures}/${checks} game-show engine checks failed`); process.exit(1); }
console.log(`✓ Game Show engine holds — ${checks} checks green (buzzer authority, face-off, play, strikes, steal, scoring)`);
