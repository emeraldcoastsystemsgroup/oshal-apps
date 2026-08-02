/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 02:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Jeopardy — the second show, proving the Show interface is general. Deliberately unlike Family Feud: individual (not team) scoring, a category board with control-based picking, a Daily Double wager, re-buzz after a wrong response, and Final Jeopardy wagering. Reuses the shared buzzer/director unchanged.
 * 2026-07-22 02:34:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Declare Jeopardy's own timed windows (ring-in, response, Daily Double wager, final wager, final response) and what each lapse means, plus show-specific host overrides. Deliberately unlike Feud's windows — proof the engine keeps time without knowing any show's phase names.
 * 2026-07-24 12:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Double Jeopardy (backlog #7): retiring the round-1 board opens 'round-break' instead of the final; the round-2 board generates at doubled values with TWO Daily Doubles; the final follows round 2. Plus localJudge — an exact answer match (with the "what is" phrasing stripped) rules correct without an LLM call.
 * 2026-07-25 22:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | npcMove — the Jeopardy NPC brain: pick an open clue when holding control, ring in by skill, respond in question form from the clue the server holds, and wager sanely on Daily Doubles and the final. No LLM; flows through the existing {correct} judge shape.
 */

'use strict';

const buzzer = require('../buzzer');
const director = require('../director');
const interview = require('../interview');

const ID = 'jeopardy';
const CATEGORIES = 6;
const ROWS = 5;
const BASE = 200;
const MIN_WAGER = 5;

const ROUNDS = 2;                      // Jeopardy, then Double Jeopardy, then the final

/** @description Dollar value for a clue row (0-based), doubled in round 2. */
function valueForRow(row, mult = 1) { return (row + 1) * BASE * mult; }

/** @description Value multiplier for the round ABOUT to be built (state.round is pre-increment). */
function nextRoundMult(state) { return (Number(state.round) || 0) >= 1 ? 2 : 1; }

/** @description Value multiplier for the round being PLAYED right now. */
function playedRoundMult(state) { return (Number(state.round) || 0) >= 2 ? 2 : 1; }

/** @description Where a retired board goes: Double Jeopardy after round 1, the final after round 2. */
function phaseAfterBoard(state) { return (Number(state.round) || 0) >= ROUNDS ? 'final-setup' : 'round-break'; }

/** @description A player's current score, defaulting to zero. */
function scoreOf(state, seatId) { return Number((state.scores || {})[seatId]) || 0; }

/** @description The clue at the active pick, or null. */
function activeClue(board) {
  if (!board.pick) return null;
  var category = (board.categories || [])[board.pick.cat];
  return category ? (category.clues || [])[board.pick.row] || null : null;
}

/** @description Every clue on the board has been played. */
function boardExhausted(board) {
  return (board.categories || []).every(function (c) { return (c.clues || []).every(function (q) { return q.used; }); });
}

/** @description Replace the active clue with a patched copy (pure). */
function patchClue(board, patch) {
  var categories = board.categories.map(function (category, ci) {
    if (ci !== board.pick.cat) return category;
    return { ...category, clues: category.clues.map(function (clue, ri) { return ri === board.pick.row ? { ...clue, ...patch } : clue; }) };
  });
  return { ...board, categories: categories };
}

/** @description Build the opening Jeopardy state (scores are per seat, not per team). */
function initialState(room, seats, now = Date.now()) {
  return {
    showId: ID, phase: 'lobby', round: 0,
    board: {
      categories: [], pick: null, control: null, missed: [], wager: null,
      final: null, wagers: {}, finalJudged: {}, winner: null,
    },
    scores: {},
    host: { line: '', mode: '', at: Number(now) },
    shot: { type: 'lobby', focus: null, serial: 0, at: Number(now) },
    serial: 0,
  };
}

/** @description The host may only build content between boards or when the final is due. */
function canGenerate(state) { return ['lobby', 'round-break', 'final-setup'].indexOf(state.phase) >= 0; }

/** @description The whole game is decided once the final has been played out. */
function isGameOver(state) { return ['round-win', 'outro'].indexOf(state.phase) >= 0; }

/** @description Ask the host bot for either the category board or the final clue. */
function generatePrompt(state, ctx = {}) {
  if (state.phase === 'final-setup') {
    return [
      'MODE: generate. Build the FINAL JEOPARDY clue.',
      'Reply with ONE json block only: {"final":{"category":"...","clue":"...","answer":"..."}}.',
      'The clue is a statement (contestants respond with a question); the answer is the short fact itself.',
    ].join('\n\n');
  }
  var used = (ctx.usedQuestions || []).slice(-8).map(function (q) { return '- ' + q; }).join('\n') || '- (none yet)';
  var double = state.phase === 'round-break';
  return [
    'MODE: generate. Build a ' + (double ? 'DOUBLE JEOPARDY' : 'Jeopardy') + ' board: exactly ' + CATEGORIES + ' categories, each with exactly ' + ROWS + ' clues, easiest first.'
      + (double ? ' Noticeably harder than a first-round board — the money is doubled.' : ''),
    'Each clue is a statement of fact; the answer is the short subject (contestants phrase it as a question).',
    'Keep it broadly knowable — trivia night, not a doctorate. Avoid these already-used categories:\n' + used,
    'Reply with ONE json block only: {"categories":[{"title":"...","clues":[{"clue":"...","answer":"..."}, ...]}, ...]}.',
  ].join('\n\n');
}

/** @description Normalize one generated category into exactly ROWS valued clues. */
function normalizeCategory(raw, mult) {
  var clues = (Array.isArray(raw && raw.clues) ? raw.clues : [])
    .filter(function (c) { return c && c.clue && c.answer; })
    .slice(0, ROWS)
    .map(function (c, row) {
      return { clue: String(c.clue).slice(0, 300), answer: String(c.answer).slice(0, 120), value: valueForRow(row, mult || 1), used: false, isDaily: false };
    });
  return { title: String((raw && raw.title) || 'Category').slice(0, 40), clues: clues };
}

/** @description Merge generated content: the board (with one Daily Double) or the final clue. */
function ingestGenerated(state, json, now = Date.now()) {
  if (state.phase === 'final-setup') {
    var final = json && json.final;
    if (!final || !final.clue || !final.answer) return { ok: false, error: 'BAD_FINAL' };
    var withFinal = {
      ...state, phase: 'final-wager',
      board: { ...state.board, final: { category: String(final.category || 'Final').slice(0, 60), clue: String(final.clue).slice(0, 300), answer: String(final.answer).slice(0, 120) }, wagers: {}, finalJudged: {} },
    };
    return { ok: true, state: director.cut(withFinal, 'scoreboard', null, now), event: { kind: 'milestone', content: 'Final Jeopardy: ' + withFinal.board.final.category }, host: { mode: 'banter', payload: { final: true } } };
  }
  var mult = nextRoundMult(state);
  var categories = (Array.isArray(json && json.categories) ? json.categories : []).slice(0, CATEGORIES)
    .map(function (raw) { return normalizeCategory(raw, mult); })
    .filter(function (c) { return c.clues.length === ROWS; });
  if (categories.length < 2) return { ok: false, error: 'BAD_BOARD' };
  // One Daily Double on the first board, two (in distinct cells) on Double Jeopardy.
  var dailies = {};
  while (Object.keys(dailies).length < Math.min(mult, categories.length * ROWS)) {
    dailies[Math.floor(Math.random() * categories.length) + ':' + Math.floor(Math.random() * ROWS)] = true;
  }
  categories = categories.map(function (category, ci) {
    return { ...category, clues: category.clues.map(function (c, r) { return dailies[ci + ':' + r] ? { ...c, isDaily: true } : c; }) };
  });
  var next = {
    ...state, round: (Number(state.round) || 0) + 1, phase: 'board',
    board: { ...state.board, categories: categories, pick: null, control: state.board.control || null, missed: [], wager: null, winner: null },
  };
  return {
    ok: true, state: director.cut(buzzer.clear(next), 'board', null, now),
    event: { kind: 'milestone', content: 'Round ' + next.round + (mult > 1 ? ' (Double Jeopardy)' : '') + ': ' + categories.map(function (c) { return c.title; }).join(' | ') },
    host: { mode: 'banter', payload: { categories: categories.map(function (c) { return c.title; }), double: mult > 1 } },
  };
}

/** @description Seats still allowed to ring in on the current clue. */
function eligibleSeats(state, seats) {
  var missed = state.board.missed || [];
  return (seats || []).filter(function (s) { return s.role !== 'host' && missed.indexOf(s.seatId || s.seat_id) < 0; });
}

/** @description Pick a clue off the board (control player, or anyone when control is open). */
function reducePick(state, action, actor, now) {
  if (state.phase !== 'board') return { ok: false, error: 'NOT_BOARD_PHASE' };
  var control = state.board.control;
  if (control && control !== actor.seatId) return { ok: false, error: 'NOT_YOUR_PICK' };
  var cat = Number(action.cat), row = Number(action.row);
  var category = (state.board.categories || [])[cat];
  var clue = category && (category.clues || [])[row];
  if (!clue) return { ok: false, error: 'NO_SUCH_CLUE' };
  if (clue.used) return { ok: false, error: 'CLUE_ALREADY_PLAYED' };
  var board = { ...state.board, pick: { cat: cat, row: row }, missed: [], wager: null };
  if (clue.isDaily) {
    var daily = { ...state, phase: 'daily-wager', board: { ...board, wager: { seatId: actor.seatId, amount: null } } };
    return { ok: true, state: director.cut(buzzer.clear(daily), 'podium-closeup', actor.seatId, now), event: { kind: 'reveal', content: 'Daily Double!' }, host: { mode: 'banter', payload: { daily: true, name: actor.name } } };
  }
  var opened = buzzer.open(buzzer.arm({ ...state, phase: 'clue', board: board }, { prompt: 'Ring in!' }), now);
  return { ok: true, state: director.cut(opened, 'buzzer-race', null, now), event: { kind: 'reveal', content: category.title + ' for $' + clue.value }, host: { mode: 'banter', payload: { clue: clue.clue } } };
}

/** @description Ring in on the open clue; the first valid press wins the response. */
function reduceBuzz(state, action, actor, now) {
  if (state.phase !== 'clue') return { ok: false, error: 'BUZZER_CLOSED' };
  if ((state.board.missed || []).indexOf(actor.seatId) >= 0) return { ok: false, error: 'ALREADY_MISSED' };
  var result = buzzer.press(state, actor.seatId, now, action.serial);
  if (!result.ok) return { ok: false, error: result.reason };
  if (!result.locked) return { ok: true, state: result.state };
  var answering = buzzer.close({ ...result.state, phase: 'answer' });
  return { ok: true, state: director.cut(answering, 'podium-closeup', actor.seatId, now), cue: { answer: actor.seatId } };
}

/** @description Lock in a Daily Double wager, then the picker alone responds. */
function reduceWager(state, action, actor, now) {
  if (state.phase !== 'daily-wager') return { ok: false, error: 'NOT_WAGER_PHASE' };
  var wager = state.board.wager || {};
  if (wager.seatId !== actor.seatId) return { ok: false, error: 'NOT_YOUR_WAGER' };
  var ceiling = Math.max(scoreOf(state, actor.seatId), ROWS * BASE * playedRoundMult(state));
  var amount = Math.max(MIN_WAGER, Math.min(Math.round(Number(action.amount) || 0), ceiling));
  var next = { ...state, phase: 'answer', board: { ...state.board, wager: { ...wager, amount: amount } } };
  return { ok: true, state: director.cut(next, 'podium-closeup', actor.seatId, now), event: { kind: 'reveal', content: (actor.name || 'Player') + ' wagers $' + amount } };
}

/** @description Record a Final Jeopardy wager; when everyone has wagered, answers open. */
function reduceFinalWager(state, action, actor, now, seats) {
  if (state.phase !== 'final-wager') return { ok: false, error: 'NOT_FINAL_WAGER' };
  var score = scoreOf(state, actor.seatId);
  if (score <= 0) return { ok: false, error: 'NOT_IN_THE_FINAL' };
  var amount = Math.max(0, Math.min(Math.round(Number(action.amount) || 0), score));
  var wagers = { ...(state.board.wagers || {}) };
  wagers[actor.seatId] = amount;
  var contenders = finalContenders(state, seats);
  var allIn = contenders.every(function (id) { return wagers[id] !== undefined; });
  var next = { ...state, phase: allIn ? 'final-answer' : 'final-wager', board: { ...state.board, wagers: wagers } };
  return { ok: true, state: director.cut(next, allIn ? 'podium-closeup' : 'scoreboard', null, now) };
}

/** @description Seat ids with a positive score — the only players in the final. */
function finalContenders(state, seats) {
  return (seats || []).filter(function (s) { return s.role !== 'host'; })
    .map(function (s) { return s.seatId || s.seat_id; })
    .filter(function (id) { return scoreOf(state, id) > 0; });
}

/** @description Pure, non-LLM mechanics. */
function reduce(state, action, actor = {}, now = Date.now(), ctx = {}) {
  switch (action && action.type) {
    case 'pick': return reducePick(state, action, actor, now);
    case 'buzz': return reduceBuzz(state, action, actor, now);
    case 'wager': return reduceWager(state, action, actor, now);
    case 'finalWager': return reduceFinalWager(state, action, actor, now, ctx.seats);
    case 'answerInterview': {
      var result = interview.answer(state, actor.seatId, action.text, now);
      return result.ok ? { ok: true, state: result.state, cue: { interviewReact: true } } : { ok: false, error: result.reason };
    }
    case 'endInterview': return { ok: true, state: interview.end(state) };
    case 'showScores': return { ok: true, state: director.cut({ ...state, phase: 'scoreboard' }, 'scoreboard', null, now) };
    case 'finish': return { ok: true, state: director.cut({ ...state, phase: 'outro' }, 'celebration', null, now), host: { mode: 'outro', payload: {} } };
    default: return { ok: false, error: 'UNKNOWN_ACTION' };
  }
}

/** @description Who is entitled to respond right now. */
function canAnswer(state, actor = {}) {
  if (state.phase === 'answer') {
    var wager = state.board.wager;
    var responder = wager && wager.amount != null ? wager.seatId : (state.buzz && state.buzz.lockedBy);
    if (!responder) return { ok: false, reason: 'BUZZ_FIRST' };
    return responder === actor.seatId ? { ok: true } : { ok: false, reason: 'NOT_YOUR_BUZZ' };
  }
  if (state.phase === 'final-answer') {
    if ((state.board.wagers || {})[actor.seatId] === undefined) return { ok: false, reason: 'NOT_IN_THE_FINAL' };
    return (state.board.finalJudged || {})[actor.seatId] ? { ok: false, reason: 'ALREADY_ANSWERED' } : { ok: true };
  }
  return { ok: false, reason: 'NOT_ANSWER_PHASE' };
}

/** @description Normalize a response for exact-match comparison ("What is X?" → "x"). */
function normResponse(text) {
  return String(text || '').toLowerCase()
    .replace(/^\s*(what|who|where|when)\s+(is|are|was|were)\s+/i, '')
    .replace(/^\s*(a|an|the)\s+/i, '')
    .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @description Rule an exactly-right response without an LLM call. Only ever rules
 *   CORRECT — a non-matching response falls through to the lenient LLM judge.
 */
function localJudge(state, guess) {
  var target = state.phase === 'final-answer' ? state.board.final : activeClue(state.board);
  if (!target || !target.answer) return null;
  var g = normResponse(guess);
  return g && g === normResponse(target.answer) ? { correct: true, reason: 'exact match' } : null;
}

/** @description Ask the host bot to rule one response correct or incorrect. */
function judgePrompt(state, guess, ctx = {}) {
  var target = state.phase === 'final-answer' ? state.board.final : activeClue(state.board);
  return [
    'MODE: judge. The clue was: "' + ((target && target.clue) || '') + '"',
    'The correct answer is: "' + ((target && target.answer) || '') + '"',
    'The contestant responded: "' + String(guess || '').slice(0, 160) + '"',
    'Rule it correct if they clearly named the right thing. Accept a missing "what is" phrasing, minor',
    'misspellings, and close pronunciations. Do NOT accept a different subject.',
    'Reply with ONE json block only: {"correct": true|false, "reason": "<short>"}.',
  ].join('\n');
}

/** @description Crown the highest score and end the game. */
function finish(state, now) {
  var best = null;
  Object.keys(state.scores || {}).forEach(function (id) { if (!best || state.scores[id] > state.scores[best]) best = id; });
  var next = { ...state, phase: 'round-win', board: { ...state.board, winner: best } };
  return { ok: true, state: director.cut(buzzer.clear(next), 'celebration', best, now), event: { kind: 'milestone', content: 'Final scores are in' }, host: { mode: 'reveal', payload: { winner: best } } };
}

/** @description Apply a ruling on a board clue: score it, then re-open or move on. */
function applyClueRuling(state, correct, actor, now) {
  var clue = activeClue(state.board);
  if (!clue) return { ok: false, error: 'NO_ACTIVE_CLUE' };
  var wager = state.board.wager;
  var isDaily = !!(wager && wager.amount != null);
  var value = isDaily ? wager.amount : clue.value;
  var scores = { ...state.scores };
  scores[actor.seatId] = scoreOf(state, actor.seatId) + (correct ? value : -value);
  if (correct) {
    var won = { ...state, scores: scores, board: { ...patchClue(state.board, { used: true }), pick: null, control: actor.seatId, missed: [], wager: null } };
    won.phase = boardExhausted(won.board) ? phaseAfterBoard(won) : 'board';
    return { ok: true, state: director.cut(buzzer.clear(won), 'board', actor.seatId, now), event: { kind: 'reveal', content: (actor.name || 'Player') + ' +$' + value }, host: { mode: 'reveal', payload: { correct: true, answer: clue.answer } } };
  }
  var missed = (state.board.missed || []).concat(actor.seatId);
  if (!isDaily && missed.length < 3) {
    var reopened = buzzer.open(buzzer.arm({ ...state, scores: scores, phase: 'clue', board: { ...state.board, missed: missed } }, { prompt: 'Anyone else?' }), now);
    return { ok: true, state: director.cut(reopened, 'buzzer-race', null, now), event: { kind: 'strike', content: (actor.name || 'Player') + ' -$' + value }, host: { mode: 'strike', payload: { correct: false } } };
  }
  var moved = { ...state, scores: scores, board: { ...patchClue(state.board, { used: true }), pick: null, missed: [], wager: null } };
  moved.phase = boardExhausted(moved.board) ? phaseAfterBoard(moved) : 'board';
  return { ok: true, state: director.cut(buzzer.clear(moved), 'board', null, now), event: { kind: 'reveal', content: 'The answer was ' + clue.answer }, host: { mode: 'reveal', payload: { correct: false, answer: clue.answer } } };
}

/** @description Apply a ruling on one player's Final Jeopardy response. */
function applyFinalRuling(state, correct, actor, now, seats) {
  var wagered = Number((state.board.wagers || {})[actor.seatId]) || 0;
  var scores = { ...state.scores };
  scores[actor.seatId] = scoreOf(state, actor.seatId) + (correct ? wagered : -wagered);
  var judged = { ...(state.board.finalJudged || {}) };
  judged[actor.seatId] = true;
  var next = { ...state, scores: scores, board: { ...state.board, finalJudged: judged } };
  var pending = Object.keys(state.board.wagers || {}).filter(function (id) { return !judged[id]; });
  if (pending.length) return { ok: true, state: next, event: { kind: 'reveal', content: (actor.name || 'Player') + (correct ? ' +$' : ' -$') + wagered } };
  return finish(next, now);
}

/** @description Apply the host's ruling to whichever response phase is live. */
function applyJudgement(state, judge, actor = {}, now = Date.now(), ctx = {}) {
  if (!judge || typeof judge.correct !== 'boolean') return { ok: false, error: 'BAD_RULING' };
  if (state.phase === 'answer') return applyClueRuling(state, judge.correct, actor, now);
  if (state.phase === 'final-answer') return applyFinalRuling(state, judge.correct, actor, now, ctx.seats);
  return { ok: false, error: 'NOT_ANSWER_PHASE' };
}

// ── Clock: which window is open, and what a lapse means ─────────────────────
// Jeopardy's windows are deliberately unlike Feud's — a ring-in race, a per-player
// response, two kinds of wager — which is the point: the engine keeps time without
// knowing any of these phase names.

var WINDOW_MS = { buzz: 12000, answer: 15000, daily: 30000, finalWager: 45000, finalAnswer: 45000, interview: 45000 };

/** @description The timed window open right now, or null when nothing is on the clock. */
function windowFor(state) {
  var iv = state.interview;
  if (iv && iv.active && iv.status === 'asked') return { kind: 'interview', ms: WINDOW_MS.interview, seatId: iv.seatId, note: 'Answering the host' };
  var board = state.board || {};
  if (state.phase === 'clue') return { kind: 'buzz', ms: WINDOW_MS.buzz, seatId: null, note: 'Ring in' };
  if (state.phase === 'answer') {
    var wager = board.wager;
    var responder = wager && wager.amount != null ? wager.seatId : (state.buzz && state.buzz.lockedBy);
    return { kind: 'answer', ms: WINDOW_MS.answer, seatId: responder || null, note: 'Responding' };
  }
  if (state.phase === 'daily-wager') return { kind: 'wager', ms: WINDOW_MS.daily, seatId: (board.wager || {}).seatId || null, note: 'Daily Double wager' };
  if (state.phase === 'final-wager') return { kind: 'final-wager', ms: WINDOW_MS.finalWager, seatId: null, note: 'Final wagers' };
  if (state.phase === 'final-answer') return { kind: 'final-answer', ms: WINDOW_MS.finalAnswer, seatId: null, note: 'Final responses' };
  return null;
}

/** @description Resolve a seat id into a judged-response actor. */
function seatActor(seats, seatId) {
  var seat = (seats || []).filter(function (s) { return (s.seatId || s.seat_id) === seatId; })[0];
  return { seatId: seatId, team: null, name: seat ? (seat.display_name || seat.name) : 'The podium' };
}

/** @description Nobody rang in: read the answer out, retire the clue, and move on. */
function timeoutClue(state, now) {
  var clue = activeClue(state.board);
  if (!clue) return { ok: true, state: buzzer.clear(state) };
  var moved = { ...state, board: { ...patchClue(state.board, { used: true }), pick: null, missed: [], wager: null } };
  moved.phase = boardExhausted(moved.board) ? phaseAfterBoard(moved) : 'board';
  return {
    ok: true, state: director.cut(buzzer.clear(moved), 'board', moved.board.control || null, now),
    event: { kind: 'reveal', content: 'No takers — the answer was ' + clue.answer },
    host: { mode: 'reveal', payload: { correct: false, answer: clue.answer, timedOut: true } },
  };
}

/** @description Final wagers lapsed: everyone still silent is committed at zero. */
function timeoutFinalWager(state, now, seats) {
  var wagers = { ...(state.board.wagers || {}) };
  finalContenders(state, seats).forEach(function (id) { if (wagers[id] === undefined) wagers[id] = 0; });
  var next = { ...state, phase: 'final-answer', board: { ...state.board, wagers: wagers } };
  return { ok: true, state: director.cut(next, 'podium-closeup', null, now), event: { kind: 'milestone', content: 'Wagers are locked' } };
}

/** @description Final responses lapsed: every silent contender loses their wager. */
function timeoutFinalAnswer(state, now) {
  var wagers = state.board.wagers || {};
  var judged = { ...(state.board.finalJudged || {}) };
  var scores = { ...state.scores };
  Object.keys(wagers).forEach(function (id) {
    if (judged[id]) return;
    scores[id] = (Number(scores[id]) || 0) - (Number(wagers[id]) || 0);
    judged[id] = true;
  });
  return finish({ ...state, scores: scores, board: { ...state.board, finalJudged: judged } }, now);
}

/** @description Apply a lapsed window, routing through the show's existing appliers. */
function onTimeout(state, timer, now = Date.now(), ctx = {}) {
  if (!timer) return { ok: false, error: 'NO_TIMER' };
  if (timer.kind === 'interview') {
    return { ok: true, state: interview.end(state), event: { kind: 'interview', content: 'The interview timed out' } };
  }
  if (timer.kind === 'buzz') return timeoutClue(state, now);
  if (timer.kind === 'answer') {
    // A lapsed response is simply a wrong response: the re-buzz window, the money,
    // and the board-exhausted check all behave exactly as a played miss does.
    var result = applyClueRuling(state, false, seatActor(ctx.seats, timer.seatId), now);
    if (!result.ok) return timeoutClue(state, now);
    return { ...result, event: { kind: 'strike', content: 'Out of time' } };
  }
  if (timer.kind === 'wager') {
    // A silent Daily Double is wagered at the clue's own value, capped by the score.
    var clue = activeClue(state.board);
    var seatId = (state.board.wager || {}).seatId;
    var ceiling = Math.max(scoreOf(state, seatId), ROWS * BASE * playedRoundMult(state));
    var amount = Math.max(MIN_WAGER, Math.min((clue && clue.value) || BASE, ceiling));
    var wagered = { ...state, phase: 'answer', board: { ...state.board, wager: { seatId: seatId, amount: amount } } };
    return { ok: true, state: director.cut(wagered, 'podium-closeup', seatId, now), event: { kind: 'reveal', content: 'No wager given — locked at $' + amount } };
  }
  if (timer.kind === 'final-wager') return timeoutFinalWager(state, now, ctx.seats);
  if (timer.kind === 'final-answer') return timeoutFinalAnswer(state, now);
  return { ok: false, error: 'UNKNOWN_WINDOW' };
}

// ── Host overrides: unstick a game without leaving the board inconsistent ────

/** @description Re-open the ring-in on the live clue (host override). */
function overrideReopenBuzzer(state, now) {
  if (!state.board.pick) return { ok: false, error: 'NO_LIVE_CLUE' };
  var reset = { ...state, phase: 'clue', board: { ...state.board, missed: [], wager: null } };
  var opened = buzzer.open(buzzer.arm(reset, { prompt: 'Buzzer re-opened — ring in!' }), now);
  return { ok: true, state: director.cut(opened, 'buzzer-race', null, now), event: { kind: 'milestone', content: 'Host re-opened the buzzer' } };
}

/** @description Show-specific host recovery actions. */
function override(state, action, ctx = {}, now = Date.now()) {
  switch (action && action.type) {
    case 'reopenBuzzer':
      return overrideReopenBuzzer(state, now);
    case 'forceReveal':
    case 'skipClue':
      if (!state.board.pick) return { ok: false, error: 'NO_LIVE_CLUE' };
      return timeoutClue(state, now);
    case 'setControl': {
      var seatId = String(action.seatId || '');
      if (!seatId) return { ok: false, error: 'BAD_SEAT' };
      var next = { ...state, phase: state.phase === 'board' ? 'board' : 'board', board: { ...state.board, control: seatId, pick: null, missed: [], wager: null } };
      return { ok: true, state: director.cut(buzzer.clear(next), 'board', seatId, now), event: { kind: 'milestone', content: 'Host gave the board to ' + seatActor(ctx.seats, seatId).name } };
    }
    case 'skipRound': {
      // Jump straight to the final — the board stops mattering the moment it is retired.
      var retired = { ...state, phase: 'final-setup', board: { ...state.board, pick: null, missed: [], wager: null } };
      return { ok: true, state: director.cut(buzzer.clear(retired), 'scoreboard', null, now), event: { kind: 'milestone', content: 'Host closed the board — on to the final' } };
    }
    default:
      return { ok: false, error: 'UNKNOWN_OVERRIDE' };
  }
}

// ── NPC brain: what would this seat do right now? (engine half in lib/npc.js) ─
// Decisions are made against the clue the server already holds — no LLM. A hit
// returns this show's own judge shape ({correct}) so the act flows through
// applyJudgement exactly like a human's judged response.

/** Plausibly-wrong responses for an NPC miss — the strike path needs a spoken line. */
var NPC_MISSES = [
  'What is... pass?', 'Who is Steve?', 'What is the mitochondria?',
  'What is 42?', 'Who are the Beatles?', 'What is Belgium?',
];

/**
 * @description The move an NPC podium would make right now, or null.
 * @param {object} state - Current game state.
 * @param {object} actor - { seatId, team, name } for the NPC seat.
 * @param {object} ctx - { profile, roll } from the engine (deterministic).
 * @returns {{action:object}|{guess:string, judgement:object}|null}
 */
function npcMove(state, actor, ctx = {}) {
  var prof = ctx.profile || {};
  var board = state.board || {};
  if (state.phase === 'board') {
    if (board.control && board.control !== actor.seatId) return null;
    var open = [];
    (board.categories || []).forEach(function (c, ci) {
      (c.clues || []).forEach(function (q, ri) { if (!q.used) open.push({ cat: ci, row: ri }); });
    });
    if (!open.length) return null;
    var pick = open[Math.floor(ctx.roll('pick') * open.length)];
    return { action: { type: 'pick', cat: pick.cat, row: pick.row } };
  }
  if (state.phase === 'clue' && state.buzz && state.buzz.open) {
    if ((board.missed || []).indexOf(actor.seatId) >= 0) return null;
    // A shy roll rings in LATE rather than never — in Jeopardy an unanswered
    // clue just retires, so lateness (not refusal) keeps the humans' head start
    // without freezing a whole stage of bots silent.
    var late = ctx.roll('ring') >= (prof.ring || 0.5);
    return { action: { type: 'buzz', serial: state.buzz.serial }, late: late };
  }
  if (state.phase === 'daily-wager') {
    var wager = board.wager || {};
    if (wager.seatId !== actor.seatId || wager.amount != null) return null;
    var ceiling = Math.max(scoreOf(state, actor.seatId), ROWS * BASE * playedRoundMult(state));
    return { action: { type: 'wager', amount: Math.max(MIN_WAGER, Math.round(ceiling * (0.3 + ctx.roll('wager') * 0.4))) } };
  }
  if (state.phase === 'final-wager') {
    var score = scoreOf(state, actor.seatId);
    if (score <= 0 || (board.wagers || {})[actor.seatId] !== undefined) return null;
    return { action: { type: 'finalWager', amount: Math.round(score * (0.3 + ctx.roll('fw') * 0.5)) } };
  }
  if (!canAnswer(state, actor).ok) return null;
  var target = state.phase === 'final-answer' ? board.final : activeClue(board);
  if (!target || !target.answer) return null;
  if (ctx.roll('hit') < (prof.hit || 0.5)) {
    return { guess: 'What is ' + target.answer + '?', judgement: { correct: true, reason: 'npc' } };
  }
  return { guess: NPC_MISSES[Math.floor(ctx.roll('miss') * NPC_MISSES.length)], judgement: { correct: false, reason: 'npc miss' } };
}

/** @description One-line board context reused across spoken host prompts. */
function boardSummary(state) {
  var clue = activeClue(state.board);
  var left = (state.board.categories || []).reduce(function (n, c) { return n + c.clues.filter(function (q) { return !q.used; }).length; }, 0);
  return 'Phase ' + state.phase + '. ' + (clue ? 'Live clue: "' + clue.clue + '". ' : '') + left + ' clues left.';
}

/** @description Build the prompt for a spoken host line. */
function spokenPrompt(mode, state, payload = {}, ctx = {}) {
  var context = boardSummary(state);
  var who = payload.name ? ' The contestant is ' + payload.name + '.' : '';
  var map = {
    intro: 'MODE: intro. Welcome the room to Jeopardy and read the categories.' + who,
    banter: 'MODE: banter. One quick host line for this moment.' + who + ' ' + context,
    reveal: 'MODE: reveal. React to the ruling just made.' + who + ' ' + context,
    strike: 'MODE: strike. Sell the miss kindly, keep them in it.' + who + ' ' + context,
    steal: 'MODE: banter. Someone else may ring in.' + who + ' ' + context,
    interview: payload.react
      ? 'MODE: interview. React warmly in a sentence or two to what ' + (payload.name || 'the contestant') + ' said: "' + String(payload.answer || '').slice(0, 200) + '".'
      : 'MODE: interview. Ask ' + (payload.name || 'the contestant') + ' one warm question they can actually answer.',
    recap: 'MODE: recap. Where the scores stand and what is at stake. ' + context,
    outro: 'MODE: outro. Crown the champion and send everyone home happy. ' + context,
  };
  return map[mode] || map.banter;
}

/** @description Individual standings, highest first. */
function scoreboard(state, seats = []) {
  return (seats || []).filter(function (s) { return s.role !== 'host'; }).map(function (s) {
    var id = s.seatId || s.seat_id;
    return { seatId: id, name: s.display_name || s.name || 'Player', team: null, score: scoreOf(state, id) };
  }).sort(function (a, b) { return b.score - a.score; });
}

module.exports = {
  id: ID, title: 'Jeopardy', tagline: 'Pick a category, ring in, and answer in the form of a question.',
  teams: false, minPlayers: 2, maxPlayers: 6,
  initialState, reduce, canAnswer, canGenerate, generatePrompt, ingestGenerated,
  judgePrompt, localJudge, applyJudgement, spokenPrompt, scoreboard, isGameOver,
  windowFor, onTimeout, override, npcMove,
};
