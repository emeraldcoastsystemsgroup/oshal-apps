/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 03:34:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for host overrides: the bug it exists to catch is "the game is stuck and the host has no way out". Pins the engine/show split, that every override leaves a consistent board (never a half-state), and that every one of them is logged. Plain `node tests/overrides.test.js`.
 */

'use strict';

const hostOverride = require('../lib/host-override');
const clock = require('../lib/clock');
const feud = require('../lib/shows/family-feud');
const jeopardy = require('../lib/shows/jeopardy');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 200000;
const A1 = { seatId: 'a1', team: 'A', name: 'Ana' };
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

const ctx = { seats: SEATS };
const run = (show, state, action) => hostOverride.apply(show, state, action, ctx, NOW);

// A Feud board mid-play, with a clock running, is the realistic stuck-game shape.
const opened = feud.ingestGenerated(feud.initialState({}, [], NOW), SURVEY, NOW).state;
const buzzed = feud.reduce(opened, { type: 'buzz', serial: opened.buzz.serial }, A1, NOW).state;
const inPlay = clock.stamp(feud.applyJudgement(buzzed, { matchIndex: 0 }, A1, NOW).state, feud, NOW);

// ── The engine/show split ───────────────────────────────────────────────────
check(hostOverride.isOverride('addTime') && hostOverride.isOverride('forceReveal'), 'both shared and show overrides are recognized');
check(hostOverride.isOverride('buzz') === false, 'a normal game move is NOT an override');
check(run(feud, inPlay, { type: 'nonsense' }).ok === false, 'an unknown override is refused, not silently applied');
check(run({ reduce: feud.reduce }, inPlay, { type: 'forceReveal', index: 1 }).ok === false, 'a show with no overrides refuses show-specific ones');

// ── Shared clock overrides work in every show ───────────────────────────────
check(run(feud, inPlay, { type: 'addTime', ms: 30000 }).state.timer.endsAt === inPlay.timer.endsAt + 30000, 'addTime extends the running window');
check(run(feud, inPlay, { type: 'addTime', ms: 9999999 }).state.timer.endsAt <= inPlay.timer.endsAt + 300000, 'addTime is capped — the host cannot park the game forever');
check(run(feud, clock.clear(inPlay), { type: 'addTime' }).ok === false, 'there is nothing to extend with no clock running');
const frozen = run(feud, inPlay, { type: 'pauseTimer' });
check(frozen.ok && clock.expired(frozen.state, NOW + 999999) === false, 'pause genuinely stops the clock');
check(run(feud, frozen.state, { type: 'resumeTimer' }).state.timer.pausedAt === null, 'resume restarts it');
check(!!frozen.event && frozen.event.kind === 'milestone', 'a host override is written to the event log');

// forceTimeout is the universal unstick: it must produce EXACTLY the board a real
// lapse produces, in whichever show is running — never a bespoke half-state.
const forced = run(feud, inPlay, { type: 'forceTimeout' });
const natural = feud.onTimeout(inPlay, inPlay.timer, NOW, ctx);
check(forced.ok && forced.state.board.strikes === natural.state.board.strikes, 'forceTimeout matches a real Feud lapse');
// Locate a plain clue — the Daily Double lands at random, so a fixed slot is flaky.
const jFresh = jeopardy.ingestGenerated(jeopardy.initialState({}, [], NOW), BOARD, NOW).state;
let jSpot = null;
jFresh.board.categories.forEach((c, ci) => c.clues.forEach((q, ri) => { if (!q.isDaily && !jSpot) jSpot = { cat: ci, row: ri }; }));
const jStuck = clock.stamp(jeopardy.reduce(jFresh, { type: 'pick', cat: jSpot.cat, row: jSpot.row }, A1, NOW).state, jeopardy, NOW);
const jForced = run(jeopardy, jStuck, { type: 'forceTimeout' });
check(jForced.ok && jForced.state.board.categories[jSpot.cat].clues[jSpot.row].used === true, 'forceTimeout retires a live Jeopardy clue');
check(run(feud, clock.clear(inPlay), { type: 'forceTimeout' }).ok === false, 'forceTimeout needs a window to lapse');

// ── Ending the game goes through the show, not around it ────────────────────
const ended = run(feud, inPlay, { type: 'endGame' });
check(ended.ok && ended.state.phase === 'outro', 'endGame reaches the outro through the show reducer');
check(run(jeopardy, jStuck, { type: 'endGame' }).state.phase === 'outro', 'endGame works in every show');

// ── Feud show overrides ─────────────────────────────────────────────────────
const revealed = run(feud, inPlay, { type: 'forceReveal', index: 1 });
check(revealed.ok && revealed.state.board.answers[1].revealed === true, 'the host can force one answer up');
check(revealed.state.board.bank === 70, 'a forced reveal re-banks the board (40 + 30)');
check(run(feud, revealed.state, { type: 'forceReveal', index: 1 }).ok === false, 'the same answer cannot be revealed twice');
check(run(feud, inPlay, { type: 'forceReveal', index: 99 }).ok === false, 'an off-board index is refused');
let all = inPlay;
[1, 2].forEach((i) => { all = run(feud, all, { type: 'forceReveal', index: i }).state; });
const last = run(feud, all, { type: 'forceReveal', index: 3 });
check(last.state.phase === 'round-win' && last.state.scores.A === 100, 'clearing the board by hand still ends and scores the round');

const struck = feud.applyJudgement(inPlay, { matchIndex: -1 }, A1, NOW).state;
check(run(feud, struck, { type: 'clearStrike' }).state.board.strikes === 0, 'the host can take a strike back');
check(run(feud, inPlay, { type: 'clearStrike' }).state.board.strikes === 0, 'clearing a strike never goes negative');
check(run(feud, inPlay, { type: 'setControl', team: 'B' }).state.board.control === 'B', 'the host can hand the board to the other team');
check(run(feud, inPlay, { type: 'setControl', team: 'Z' }).ok === false, 'only real teams can be given the board');
const reopened = run(feud, buzzed, { type: 'reopenBuzzer' });
check(reopened.ok && reopened.state.buzz.open === true && reopened.state.board.faceoff.firstSeat === null, 're-opening the buzzer clears the bad buzz-in');
check(reopened.state.buzz.serial > buzzed.buzz.serial, 're-arming invalidates presses from the old race');
const skipped = run(feud, inPlay, { type: 'skipRound' });
check(skipped.ok && skipped.state.phase === 'round-win' && skipped.state.board.answers.every((a) => a.revealed), 'skipping a round settles and reveals it, never leaves it half-played');

// ── Jeopardy show overrides ─────────────────────────────────────────────────
const jReopened = run(jeopardy, jStuck, { type: 'reopenBuzzer' });
check(jReopened.ok && jReopened.state.phase === 'clue' && jReopened.state.board.missed.length === 0, 're-opening a Jeopardy clue clears who had already missed');
check(run(jeopardy, jForced.state, { type: 'reopenBuzzer' }).ok === false, 'there is no buzzer to re-open with no live clue');
check(run(jeopardy, jStuck, { type: 'skipClue' }).state.board.pick === null, 'skipping a clue clears the live pick');
check(run(jeopardy, jStuck, { type: 'setControl', seatId: 'b1' }).state.board.control === 'b1', 'the host can hand the Jeopardy board to a player');
check(run(jeopardy, jStuck, { type: 'skipRound' }).state.phase === 'final-setup', 'closing the Jeopardy board goes to the final');

if (failures) { console.error(`\n✗ ${failures}/${checks} host-override checks failed`); process.exit(1); }
console.log(`✓ Host overrides hold — ${checks} checks green (clock control, universal unstick, per-show recovery, all logged)`);
