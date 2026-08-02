/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 03:24:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for Whammy!: the third show's mechanics are server-side randomness, so random outcomes are LOCATED by looping fresh states until both faces of the coin are observed — never asserted at a slot. Pins the lazy spin grant, the turn/claim rule, whammy bank-zeroing, the four-whammy knockout, cash-spin refunds, pass-to-the-leader, both timeout auto-presses, and the no-judging contract. Plain `node tests/whammy.test.js`.
 */

'use strict';

const whammy = require('../lib/shows/whammy');
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
const CAP = 400;   // 1-in-6 whammy odds: P(miss 400 straight) ≈ 10^-32 — a loop this long locates both outcomes

function panelsOf(n, kind, value) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ label: 'Panel ' + i, value: value || 500, kind: kind || 'cash' });
  return rows;
}

/** Build a live 'lights' state through the real generate path, then patch it. */
function lights(patch, panels) {
  const base = whammy.ingestGenerated(whammy.initialState({}, SEATS, NOW), { panels: panels || panelsOf(12) }, NOW).state;
  patch = patch || {};
  return { ...base, ...(patch.top || {}), scores: patch.scores || base.scores, board: { ...base.board, ...(patch.board || {}) } };
}

/** Keep pressing on FRESH copies of a state until pred(result) holds, or give up at CAP. */
function pressUntil(makeState, actor, pred) {
  for (let i = 0; i < CAP; i++) {
    const result = whammy.reduce(makeState(), { type: 'pressYourLuck' }, actor, NOW, CTX);
    if (pred(result)) return result;
  }
  return null;
}

// ── Interface + opening shape ────────────────────────────────────────────────
check(registry.validateShow(whammy) === whammy, 'whammy satisfies the full Show interface (validateShow)');
check(whammy.teams === false && whammy.minPlayers === 2 && whammy.maxPlayers === 6, 'individual play, 2-6 players');

let s0 = whammy.initialState({}, SEATS, NOW);
check(s0.showId === 'whammy' && s0.phase === 'lobby' && s0.round === 0, 'opens in the lobby');
check(Array.isArray(s0.board.panels) && s0.board.panels.length === 0, 'the board opens with no panels');
check(s0.board.control === null && s0.board.lastStop === null && s0.board.winner === null, 'no control, no stop, no winner yet');
check(s0.board.spinsPerPlayer === 5 && Object.keys(s0.board.spinsLeft).length === 0, 'spin ledger opens EMPTY — allotments are lazy');
check(Object.keys(s0.scores).length === 0 && Object.keys(s0.board.whammies).length === 0, 'no banks, no whammies yet');
check(whammy.canGenerate(s0) === true, 'the host may build the board in the lobby');

// ── Generation + ingest validation ───────────────────────────────────────────
check(whammy.generatePrompt(s0).indexOf('json') >= 0 && whammy.generatePrompt(s0).indexOf('12') >= 0, 'generate prompt asks for one json block of 12 panels');
check(whammy.ingestGenerated(s0, { panels: panelsOf(7) }, NOW).ok === false, 'fewer than 8 usable panels is rejected');
check(whammy.ingestGenerated(s0, {}, NOW).ok === false, 'a missing panels array is rejected');

const junky = panelsOf(8).concat([
  { label: '', value: 500, kind: 'cash' },            // empty label — dropped
  { label: 'Too rich', value: 30000, kind: 'cash' },  // over the cap — dropped
  { label: 'Free hug', value: 0, kind: 'prize' },     // non-positive — dropped
]);
const junkIn = whammy.ingestGenerated(s0, { panels: junky }, NOW);
check(junkIn.ok && junkIn.state.board.panels.length === 8, 'unusable panels are dropped, not board-fatal');

const weird = whammy.ingestGenerated(s0, { panels: panelsOf(8).concat([{ label: 'Mystery', value: 700, kind: 'confetti' }]) }, NOW);
check(weird.ok && weird.state.board.panels[8].kind === 'cash', 'an unknown kind coerces to plain cash');

const fat = whammy.ingestGenerated(s0, { panels: panelsOf(20) }, NOW);
check(fat.ok && fat.state.board.panels.length === 12, 'the board caps at 12 panels');
check(fat.state.phase === 'lights' && fat.state.board.control === null, 'a good board starts the lights with the turn unclaimed');
check(fat.state.round === 1 && fat.state.shot.type === 'board', 'round 1 opens on the board shot');
check(fat.event && fat.event.kind === 'milestone', 'ingest announces a milestone');
check(whammy.canGenerate(fat.state) === false, 'the host may NOT rebuild once the lights are on');

// ── First press: claim + lazy grant; turn rule ───────────────────────────────
const fresh = lights();
const first = whammy.reduce(fresh, { type: 'pressYourLuck' }, P1, NOW, CTX);
check(first.ok && first.state.board.control === 'p1', 'the first press claims the unclaimed board');
check(first.state.board.spinsLeft.p1 === 4, 'the lazy grant funds 5 spins and the press consumes one (all-cash board: no refund possible)');
check(whammy.reduce(first.state, { type: 'pressYourLuck' }, P2, NOW, CTX).ok === false
  && whammy.reduce(first.state, { type: 'pressYourLuck' }, P2, NOW, CTX).error === 'NOT_YOUR_TURN', 'another seat pressing a claimed board is NOT_YOUR_TURN');
check(whammy.reduce(fresh, { type: 'pressYourLuck' }, P1, 0, CTX).ok, 'ctx.seats-driven press works from the generate path');
check(whammy.reduce({ ...fresh, phase: 'lobby' }, { type: 'pressYourLuck' }, P1, NOW, CTX).ok === false, 'no pressing before the lights');
check(whammy.reduce(fresh, { type: 'noSuchThing' }, P1, NOW, CTX).error === 'UNKNOWN_ACTION', 'unknown actions are rejected');

// ── Locate BOTH random outcomes (never assert a slot) ────────────────────────
const sawWhammy = pressUntil(() => lights(), P1, (r) => r.ok && r.state.board.lastStop.kind === 'whammy');
check(!!sawWhammy, 'a whammy stop is observed within ' + CAP + ' fresh presses');
if (sawWhammy) {
  check(sawWhammy.state.scores.p1 === 0, 'a whammy zeroes the bank');
  check(sawWhammy.state.board.whammies.p1 === 1, 'a whammy increments the whammy count');
  check(sawWhammy.state.board.spinsLeft.p1 === 4, 'a whammy still consumes the spin (no refund)');
  check(sawWhammy.state.shot.type === 'podium-closeup' && sawWhammy.state.shot.focus === 'p1', 'the director cuts to the victim');
  check(/WHAMMY/.test(sawWhammy.event.content), 'the event yells WHAMMY');
}

const sawCash = pressUntil(() => lights({ scores: { p1: 100 } }), P1, (r) => r.ok && r.state.board.lastStop.kind === 'panel');
check(!!sawCash, 'a cash stop is observed within ' + CAP + ' fresh presses');
if (sawCash) {
  check(sawCash.state.scores.p1 === 600, 'a cash panel adds its value to the bank');
  check(sawCash.state.board.lastStop.panelIndex >= 0 && sawCash.state.board.lastStop.label === sawCash.state.board.panels[sawCash.state.board.lastStop.panelIndex].label, 'lastStop records the actual panel hit');
  check(sawCash.state.board.control === 'p1', 'the turn does NOT auto-pass while spins remain — pressing on is the tension');
}

// ── Whammy #4 is a knockout ──────────────────────────────────────────────────
const fourth = pressUntil(
  () => lights({ scores: { p1: 900 }, board: { control: 'p1', whammies: { p1: 3 }, spinsLeft: { p1: 5 } } }),
  P1, (r) => r.ok && r.state.board.lastStop.kind === 'whammy');
check(!!fourth, 'a fourth whammy is observed within ' + CAP + ' presses');
if (fourth) {
  check(fourth.state.board.whammies.p1 === 4 && fourth.state.board.spinsLeft.p1 === 0, 'four whammies zero the spins — that player is OUT');
  check(fourth.state.board.control === 'p2', 'the knockout hands the turn to the next seat in order');
  check(fourth.state.scores.p1 === 0, 'the fourth whammy still torches the bank');
}

// ── Cash-spin refunds the spin ───────────────────────────────────────────────
const spinPanels = panelsOf(12, 'cash-spin', 400);
const refunded = pressUntil(() => lights({}, spinPanels), P1, (r) => r.ok && r.state.board.lastStop.kind === 'panel');
check(!!refunded, 'a cash-spin stop is observed within ' + CAP + ' presses');
if (refunded) {
  check(refunded.state.board.spinsLeft.p1 === 5, 'cash-spin refunds the spin just spent (5 granted, 1 consumed, 1 back)');
  check(refunded.state.scores.p1 === 400, 'cash-spin still banks its cash');
}

// ── Exhausted spins pass the turn; all-exhausted ends the round ──────────────
const lastSpin = whammy.reduce(lights({ board: { control: 'p1', spinsLeft: { p1: 1 } } }), { type: 'pressYourLuck' }, P1, NOW, CTX);
check(lastSpin.ok && lastSpin.state.board.spinsLeft.p1 === 0, 'the last spin is consumed whichever way it lands (all-cash board: whammy and cash both spend it)');
check(lastSpin.state.board.control === 'p2', 'spending the last spin passes the turn to the next seat with spins');

const finale = pressUntil(
  () => lights({ scores: { p1: 100, p2: 50 }, board: { control: 'p1', spinsLeft: { p1: 1, p2: 0, p3: 0 } } }),
  P1, (r) => r.ok && r.state.board.lastStop.kind === 'panel');
check(!!finale, 'the round-ending cash press is observed within ' + CAP + ' presses');
if (finale) {
  check(finale.state.phase === 'round-win', 'when no seat has spins left the round is over');
  check(finale.state.board.winner === 'p1', 'the biggest bank wins the round');
  check(whammy.isGameOver(finale.state) === true, 'round-win reports game over');
}
check(whammy.isGameOver(lights()) === false, 'the lights are not game over');

// ── Rejections: NO_SPINS_LEFT / passSpins guards ─────────────────────────────
const broke = lights({ board: { control: 'p1', spinsLeft: { p1: 0 } } });
check(whammy.reduce(broke, { type: 'pressYourLuck' }, P1, NOW, CTX).error === 'NO_SPINS_LEFT', 'a present-but-zero ledger cannot press');
check(whammy.reduce(broke, { type: 'passSpins' }, P1, NOW, CTX).error === 'NO_SPINS_LEFT', 'nor pass spins it does not have');
check(whammy.reduce(lights({ board: { control: 'p1' } }), { type: 'passSpins' }, P2, NOW, CTX).error === 'NOT_YOUR_TURN', 'only the control seat may pass');
check(whammy.reduce(lights(), { type: 'passSpins' }, P1, NOW, CTX).error === 'NOT_YOUR_TURN', 'an unclaimed board cannot be passed — press first');

// ── passSpins: to the leading opponent, who must use them ────────────────────
const passState = lights({ scores: { p2: 500, p3: 900 }, board: { control: 'p1', spinsLeft: { p1: 3, p2: 2, p3: 1 } } });
const passed = whammy.reduce(passState, { type: 'passSpins' }, P1, NOW, CTX);
check(passed.ok && passed.state.board.spinsLeft.p1 === 0, 'passing zeroes the passer');
check(passed.state.board.spinsLeft.p3 === 4, 'the LEADING opponent receives the spins (1 + 3)');
check(passed.state.board.control === 'p3', 'and the turn moves to them — they must use them');

// A still-in leader beats a richer knocked-out player; lazy (absent) keys can receive.
const lazyPass = whammy.reduce(
  lights({ scores: { p2: 9000, p3: 10 }, board: { control: 'p1', spinsLeft: { p1: 2, p2: 0 } } }),
  { type: 'passSpins' }, P1, NOW, CTX);
check(lazyPass.ok && lazyPass.state.board.control === 'p3' && lazyPass.state.board.spinsLeft.p3 === 7, 'a spent leader cannot receive — the spins go to the still-in opponent (lazy 5 + 2)');

// No eligible opponent at all: passing collapses to declining, and the round ends.
const lonely = whammy.reduce(
  lights({ scores: { p1: 300 }, board: { control: 'p1', spinsLeft: { p1: 2, p2: 0, p3: 0 } } }),
  { type: 'passSpins' }, P1, NOW, CTX);
check(lonely.ok && lonely.state.phase === 'round-win' && lonely.state.board.winner === 'p1', 'passing with nobody to receive ends the round on the same path');

// ── No judging, ever ─────────────────────────────────────────────────────────
check(whammy.canAnswer(lights(), P1).ok === false && whammy.canAnswer(lights(), P1).reason === 'NOT_ANSWER_PHASE', 'canAnswer always refuses — no typed answers exist');
check(whammy.applyJudgement(lights(), { correct: true }, P1, NOW, CTX).ok === false, 'applyJudgement rejects any ruling');
check(typeof whammy.judgePrompt(lights(), 'anything') === 'string' && whammy.judgePrompt(lights(), 'x').indexOf('json') >= 0, 'judgePrompt still returns an honest one-block prompt');

// ── Windows ──────────────────────────────────────────────────────────────────
const claimedW = whammy.windowFor(lights({ board: { control: 'p1' } }));
check(claimedW.kind === 'turn' && claimedW.seatId === 'p1' && claimedW.ms === 20000, 'a claimed board puts the control seat on a 20s turn clock');
const openW = whammy.windowFor(lights());
check(openW.kind === 'turn' && openW.seatId === null && openW.ms === 25000, 'an UNCLAIMED board is on the clock too — the game cannot stall before anyone presses');
const ivState = { ...lights(), interview: { active: true, seatId: 'p2', status: 'asked', question: 'q', at: NOW } };
check(whammy.windowFor(ivState).kind === 'interview', 'an unanswered interview outranks the turn clock');
check(whammy.windowFor({ ...lights(), phase: 'round-win' }) === null, 'nothing is on the clock after the round');

// ── Timeouts: a lapse is exactly a real press ────────────────────────────────
const autoPress = whammy.onTimeout(lights({ board: { control: 'p1' } }, panelsOf(12)), { kind: 'turn', seatId: 'p1' }, NOW, CTX);
check(autoPress.ok && autoPress.state.board.spinsLeft.p1 === 4, 'a lapsed turn auto-presses: one spin consumed through the SAME press logic');
check(autoPress.state.phase === 'lights' && autoPress.state.board.control === 'p1', 'and leaves a playable board (spins remain, turn kept)');
check(/Out of time/.test(autoPress.event.content), 'the timeout event says why the board spun itself');

const claimTimeout = whammy.onTimeout(lights(), { kind: 'turn', seatId: null }, NOW, CTX);
check(claimTimeout.ok && claimTimeout.state.board.control === 'p1', 'an unclaimed-board lapse gives the first seated player the turn (their auto-press claims it)');
check(claimTimeout.state.board.spinsLeft.p1 === 4, 'the claiming auto-press consumed a real spin (all-cash board: no refund)');

const stuckControl = whammy.onTimeout(lights({ board: { control: 'p1', spinsLeft: { p1: 0 } } }), { kind: 'turn', seatId: 'p1' }, NOW, CTX);
check(stuckControl.ok && stuckControl.state.board.control === 'p2', 'a control seat the reducer refuses (zero spins) is passed over, never wedged');

check(whammy.onTimeout(ivState, { kind: 'interview' }, NOW, CTX).state.interview === undefined, 'a lapsed interview closes itself');
check(whammy.onTimeout(lights(), { kind: 'martian' }, NOW, CTX).ok === false, 'an unknown window kind is refused (engine clears the clock)');

// ── Overrides ────────────────────────────────────────────────────────────────
const handed = whammy.override(lights(), { type: 'setControl', seatId: 'p2' }, CTX, NOW);
check(handed.ok && handed.state.board.control === 'p2', 'setControl hands the turn to the named seat');
check(whammy.override(lights(), { type: 'setControl' }, CTX, NOW).ok === false, 'setControl without a seat is refused');
const skipped = whammy.override(lights({ scores: { p1: 300, p2: 800 } }), { type: 'skipRound' }, CTX, NOW);
check(skipped.ok && skipped.state.phase === 'round-win' && skipped.state.board.winner === 'p2', 'skipRound ends the round now and crowns the biggest bank');
check(whammy.override(lights(), { type: 'flipTable' }, CTX, NOW).error === 'UNKNOWN_OVERRIDE', 'unknown overrides are refused');

// ── Finish, spoken prompts, scoreboard ───────────────────────────────────────
const done = whammy.reduce(lights({ scores: { p1: 100, p2: 900 } }), { type: 'finish' }, P1, NOW, CTX);
check(done.ok && done.state.phase === 'outro' && done.state.board.winner === 'p2', "'finish' crowns the biggest bank and rolls the outro");
check(whammy.isGameOver(done.state) === true, 'the outro reports game over');
check(typeof whammy.spokenPrompt('strike', lights({ scores: { p1: 200 } }), { name: 'Ana' }) === 'string', 'spoken prompts build for every mode');
check(whammy.spokenPrompt('recap', lights({ scores: { p1: 200 } })).indexOf('$200') >= 0, 'the board summary carries the banks');

const sb = whammy.scoreboard(lights({ scores: { p1: 100, p2: 900 }, board: { spinsLeft: { p1: 2 }, whammies: { p2: 1 } } }), SEATS);
check(sb.length === 3 && sb[0].seatId === 'p2' && sb[0].score === 900, 'the scoreboard sorts individuals by bank, biggest first');
check(sb[0].team === null && sb[0].whammies === 1, 'rows are individual and carry the whammy count');
check(sb[0].spins === 5 && sb.filter((r) => r.seatId === 'p1')[0].spins === 2, 'an absent spin key reads as the full lazy allotment; a present one reads literally');

// ── showScores / interview actions mirror the other shows ────────────────────
const scored = whammy.reduce(lights(), { type: 'showScores' }, P1, NOW, CTX);
check(scored.ok && scored.state.phase === 'scoreboard' && scored.state.shot.type === 'scoreboard', 'showScores cuts to the scoreboard');
const ivAns = whammy.reduce(ivState, { type: 'answerInterview', text: 'hi there' }, P2, NOW, CTX);
check(ivAns.ok && ivAns.state.interview.status === 'answered', 'the interviewed seat can answer the host');
check(whammy.reduce(ivState, { type: 'answerInterview', text: 'nope' }, P1, NOW, CTX).ok === false, 'nobody else can');
check(whammy.reduce(ivState, { type: 'endInterview' }, P1, NOW, CTX).state.interview === undefined, 'endInterview closes the beat');

if (failures) { console.error(`\n✗ ${failures}/${checks} whammy checks failed`); process.exit(1); }
console.log(`✓ Whammy! plugs into the same engine — ${checks} checks green (lazy spins, turn claim, whammy knockout, cash-spin refund, pass-to-leader, timeout auto-press, no-judge contract)`);
