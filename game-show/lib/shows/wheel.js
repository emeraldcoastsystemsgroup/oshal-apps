/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 10:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Wheel of Fortune — the third show, and the first turn-based one (no buzzer race): a spin resolved server-side, consonants earned per spin, bought vowels, and a solve that rides the shared /answer judge rail with a free local exact-match short-circuit. Deliberately unlike Feud (teams/strikes) and Jeopardy (ring-in/wagers) to keep proving the Show interface is general.
 * 2026-07-26 09:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | npcMove — the Wheel NPC brain: on its turn it spins, calls consonants from the puzzle the server holds (skill decides hit rate and letter quality), buys a vowel when flush, and solves once enough of the board is up (sharp solves early, wild hangs on). No LLM; the solve rides the existing {correct} judge shape.
 */

'use strict';

const director = require('../director');
const interview = require('../interview');

const ID = 'wheel';
const DEFAULT_ROUNDS = 3;
const VOWELS = 'AEIOU';
const VOWEL_COST = 250;
const MIN_SOLVE_AWARD = 500;

/**
 * @description The 17 physical wheel segments, picked uniformly per spin. 14 dollar
 * values plus two BANKRUPT slots and one LOSE-A-TURN — the classic risk curve: most
 * spins pay, but every spin can erase the round bank, which is what makes spinning
 * again (instead of solving cheap) an actual decision.
 */
const SEGMENTS = Object.freeze([
  100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 650, 700, 800, 900,
  'bankrupt', 'bankrupt', 'lose-turn',
]);

/** @description The unique A-Z letters a puzzle contains (used for the auto-solve check and full reveals). */
function lettersOf(puzzle) {
  const seen = [];
  String(puzzle || '').split('').forEach((ch) => { if (/[A-Z]/.test(ch) && seen.indexOf(ch) < 0) seen.push(ch); });
  return seen;
}

/** @description How many times a letter appears in the puzzle (what a spin pays per hit). */
function countLetter(puzzle, letter) {
  return String(puzzle || '').split('').filter((ch) => ch === letter).length;
}

/** @description Whether every letter of the puzzle has been called — the board solved itself. */
function allLettersGuessed(puzzle, guessed) {
  return lettersOf(puzzle).every((letter) => guessed.indexOf(letter) >= 0);
}

/** @description The puzzle as the audience sees it: called letters and punctuation shown, the rest underscores. */
function maskPuzzle(board) {
  const guessed = (board && board.guessed) || [];
  return String((board && board.puzzle) || '').split('')
    .map((ch) => (!/[A-Z]/.test(ch) || guessed.indexOf(ch) >= 0 ? ch : '_')).join('');
}

/** @description A seat's current round bank (unbanked winnings that die on BANKRUPT). */
function bankOf(board, seatId) { return Number(((board || {}).banks || {})[seatId]) || 0; }

/**
 * @description The seat the turn passes to after `afterSeatId`. Wheel is round-robin
 * (no buzzer decides who is next), so the order must be deterministic on every
 * surface: non-host seats sorted by seatId, wrapping. With no seats known the turn
 * falls open (null) and the next actor claims it — never a dead board.
 * @param {string} afterSeatId - The seat giving up the turn.
 * @param {object[]} seats - ctx.seats from the engine.
 * @returns {?string} The next seat id, or null when no player seats are known.
 */
function nextControl(afterSeatId, seats) {
  const ids = (seats || []).filter((s) => s.role !== 'host')
    .map((s) => String(s.seatId || s.seat_id)).sort();
  if (!ids.length) return null;
  const i = ids.indexOf(String(afterSeatId));
  return i < 0 ? ids[0] : ids[(i + 1) % ids.length];
}

/** @description A seat's display name out of ctx.seats, for host-facing event lines. */
function seatName(seats, seatId) {
  const seat = (seats || []).filter((s) => (s.seatId || s.seat_id) === seatId)[0];
  return seat ? (seat.display_name || seat.name || 'Player') : 'Player';
}

/**
 * @description Build the opening game-state envelope for a fresh Wheel room.
 * @param {object} room - The room row (unused; the shape is per-show).
 * @param {object[]} seats - Seated players at open time.
 * @param {number} now - Server time in ms.
 * @returns {object} The lobby-phase state envelope.
 */
function initialState(room, seats, now = Date.now()) {
  return {
    showId: ID, phase: 'lobby', round: 0,
    board: {
      category: '', puzzle: '', guessed: [], control: null, spin: null,
      banks: {}, solved: false, winner: null, roundsTotal: DEFAULT_ROUNDS,
    },
    scores: {},
    host: { line: '', mode: '', at: Number(now) },
    shot: { type: 'lobby', focus: null, serial: 0, at: Number(now) },
    serial: 0,
  };
}

/** @description The whole game is decided once the last round has been retired. */
function isGameOver(state) {
  return (Number(state.round) || 0) >= ((state.board || {}).roundsTotal || DEFAULT_ROUNDS)
    && ['round-win', 'outro'].indexOf(state.phase) >= 0;
}

/** @description The host may only build a puzzle between rounds, and never once the game is decided. */
function canGenerate(state) {
  return ['lobby', 'round-win'].indexOf(state.phase) >= 0 && !isGameOver(state);
}

/** @description Ask the host bot for one fresh, broadly-guessable puzzle as one json block. */
function generatePrompt(state, ctx = {}) {
  const round = (Number(state.round) || 0) + 1;
  const used = (ctx.usedQuestions || []).slice(-12).map((q) => '- ' + q).join('\n') || '- (none yet)';
  return [
    'MODE: generate. Round ' + round + ' of ' + ((state.board || {}).roundsTotal || DEFAULT_ROUNDS) + '.',
    'Create ONE fresh Wheel-of-Fortune-style puzzle: a common phrase, title, or thing of 2-5 words,',
    'letters and spaces only, broadly guessable — a party crowd, not trivia champions. Give it a short category.',
    'Do NOT reuse any of these already-played puzzles:\n' + used,
    'Reply with ONE json block only: {"category":"...","puzzle":"..."}.',
  ].join('\n\n');
}

/**
 * @description Merge a generated puzzle into the board and open turn-based play.
 * Uppercases and validates (letters/spaces/apostrophes/hyphens, at least 4 letters)
 * because the LLM output is untrusted; a bad puzzle is rejected so the host regenerates.
 * Prior control carries into the new round (the solver keeps the wheel) — a null
 * control simply means the first spin/buy/solve claims it.
 * @param {object} state - Current game state ('lobby' or 'round-win').
 * @param {object} json - Parsed host-bot output {category, puzzle}.
 * @param {number} now - Server time in ms.
 * @returns {object} Reduced result.
 */
function ingestGenerated(state, json, now = Date.now()) {
  const category = String((json && json.category) || '').trim().slice(0, 60);
  const puzzle = String((json && json.puzzle) || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  const letterCount = (puzzle.match(/[A-Z]/g) || []).length;
  if (!category || !/^[A-Z' -]+$/.test(puzzle) || letterCount < 4) return { ok: false, error: 'BAD_PUZZLE' };
  const round = (Number(state.round) || 0) + 1;
  const prior = state.board && typeof state.board.control === 'string' && state.board.control ? state.board.control : null;
  const next = {
    ...state, round, phase: 'puzzle',
    board: {
      ...state.board, category, puzzle, guessed: [], control: prior, spin: null,
      banks: {}, solved: false, winner: null,
    },
  };
  return {
    ok: true, state: director.cut(next, 'board', prior, now),
    event: { kind: 'milestone', content: 'Round ' + round + ': ' + category },
    host: { mode: 'banter', payload: { category } },
  };
}

/** @description Turn enforcement shared by spin/guess/buy: a held wheel belongs to one seat. */
function turnError(board, actor) {
  return board.control && board.control !== actor.seatId ? { ok: false, error: 'NOT_YOUR_TURN' } : null;
}

/**
 * @description Award the round and retire the puzzle. Every winning path (a judged
 * solve, an auto-solve when the last letter falls, a lapsed... none — timeouts pass
 * the turn) routes through here so a win can never land on an inconsistent board.
 * A solve always banks at least $500 — solving must beat sitting on a thin bank.
 * @param {object} state - State whose board.banks reflect the winner's final bank.
 * @param {object} actor - The solving seat { seatId, name }.
 * @param {number} now - Server time in ms.
 * @returns {object} Reduced result in phase 'round-win'.
 */
function applyRoundWin(state, actor, now) {
  const board = state.board;
  const award = Math.max(bankOf(board, actor.seatId), MIN_SOLVE_AWARD);
  const scores = { ...state.scores };
  scores[actor.seatId] = (Number(scores[actor.seatId]) || 0) + award;
  const next = {
    ...state, phase: 'round-win', scores,
    board: { ...board, guessed: lettersOf(board.puzzle), spin: null, solved: true, winner: actor.seatId },
  };
  return {
    ok: true, state: director.cut(next, 'celebration', actor.seatId, now),
    event: { kind: 'milestone', content: (actor.name || 'Player') + ' solves it for $' + award },
    host: { mode: 'reveal', payload: { winner: actor.seatId, award } },
  };
}

/** @description Spin the wheel: resolve one segment server-side (never client-supplied). */
function reduceSpin(state, actor, now, ctx) {
  if (state.phase !== 'puzzle') return { ok: false, error: 'NOT_PUZZLE_PHASE' };
  const board = state.board;
  const denied = turnError(board, actor);
  if (denied) return denied;
  if (board.spin && board.spin.value != null) return { ok: false, error: 'ALREADY_SPUN' };
  const seat = actor.seatId;
  const name = actor.name || 'Player';
  const landed = SEGMENTS[Math.floor(Math.random() * SEGMENTS.length)];
  if (landed === 'bankrupt') {
    const banks = { ...board.banks };
    banks[seat] = 0;
    const passed = { ...state, board: { ...board, banks, spin: null, control: nextControl(seat, ctx.seats) } };
    return {
      ok: true, state: director.cut(passed, 'podium-closeup', seat, now),
      event: { kind: 'strike', content: name + ' hits BANKRUPT' },
      host: { mode: 'strike', payload: { bankrupt: true, name } },
    };
  }
  if (landed === 'lose-turn') {
    const skipped = { ...state, board: { ...board, spin: null, control: nextControl(seat, ctx.seats) } };
    return {
      ok: true, state: director.cut(skipped, 'podium-closeup', seat, now),
      event: { kind: 'strike', content: name + ' loses a turn' },
      host: { mode: 'strike', payload: { loseTurn: true, name } },
    };
  }
  const spun = { ...state, board: { ...board, control: seat, spin: { value: landed } } };
  return {
    ok: true, state: director.cut(spun, 'podium-closeup', seat, now),
    event: { kind: 'reveal', content: name + ' spins $' + landed },
    host: { mode: 'banter', payload: { spun: landed, name } },
  };
}

/** @description Call a consonant against the pending spin: hits pay per occurrence and keep the turn. */
function reduceGuessLetter(state, action, actor, now, ctx) {
  if (state.phase !== 'puzzle') return { ok: false, error: 'NOT_PUZZLE_PHASE' };
  const board = state.board;
  const denied = turnError(board, actor);
  if (denied) return denied;
  if (!board.spin || board.spin.value == null) return { ok: false, error: 'SPIN_FIRST' };
  const letter = String(action.letter || '').toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return { ok: false, error: 'BAD_LETTER' };
  if (VOWELS.indexOf(letter) >= 0) return { ok: false, error: 'VOWELS_ARE_BOUGHT' };
  if (board.guessed.indexOf(letter) >= 0) return { ok: false, error: 'ALREADY_GUESSED' };
  const hits = countLetter(board.puzzle, letter);
  const guessed = board.guessed.concat(letter);
  const name = actor.name || 'Player';
  if (hits > 0) {
    const banks = { ...board.banks };
    banks[actor.seatId] = bankOf(board, actor.seatId) + hits * board.spin.value;
    const next = { ...state, board: { ...board, guessed, banks, spin: null, control: actor.seatId } };
    // Nothing left hidden means the guesser just finished the puzzle — that IS a
    // solve, so it routes through the same round-win path a judged solve takes.
    if (allLettersGuessed(board.puzzle, guessed)) return applyRoundWin(next, actor, now);
    return {
      ok: true, state: director.cut(next, 'board', actor.seatId, now),
      event: { kind: 'reveal', content: hits + ' × ' + letter + ' — $' + (hits * board.spin.value) + ' to ' + name },
      host: { mode: 'reveal', payload: { letter, hits } },
    };
  }
  const missed = { ...state, board: { ...board, guessed, spin: null, control: nextControl(actor.seatId, ctx.seats) } };
  return {
    ok: true, state: director.cut(missed, 'podium-closeup', actor.seatId, now),
    event: { kind: 'strike', content: 'No ' + letter },
    host: { mode: 'strike', payload: { letter, name } },
  };
}

/** @description Buy a vowel for a flat $250 from the round bank — paid whether or not it hits. */
function reduceBuyVowel(state, action, actor, now) {
  if (state.phase !== 'puzzle') return { ok: false, error: 'NOT_PUZZLE_PHASE' };
  const board = state.board;
  const denied = turnError(board, actor);
  if (denied) return denied;
  if (board.spin && board.spin.value != null) return { ok: false, error: 'GUESS_YOUR_SPIN' };
  const letter = String(action.letter || '').toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return { ok: false, error: 'BAD_LETTER' };
  if (VOWELS.indexOf(letter) < 0) return { ok: false, error: 'NOT_A_VOWEL' };
  if (board.guessed.indexOf(letter) >= 0) return { ok: false, error: 'ALREADY_GUESSED' };
  if (bankOf(board, actor.seatId) < VOWEL_COST) return { ok: false, error: 'NOT_ENOUGH' };
  const banks = { ...board.banks };
  banks[actor.seatId] = bankOf(board, actor.seatId) - VOWEL_COST;
  const guessed = board.guessed.concat(letter);
  const hits = countLetter(board.puzzle, letter);
  const next = { ...state, board: { ...board, guessed, banks, control: actor.seatId } };
  if (allLettersGuessed(board.puzzle, guessed)) return applyRoundWin(next, actor, now);
  return {
    ok: true, state: director.cut(next, 'board', actor.seatId, now),
    event: { kind: hits > 0 ? 'reveal' : 'strike', content: hits > 0 ? (hits + ' × ' + letter + ' bought') : ('No ' + letter + ' — $' + VOWEL_COST + ' spent') },
    host: { mode: hits > 0 ? 'reveal' : 'strike', payload: { letter, hits, bought: true } },
  };
}

/**
 * @description Pure, non-LLM mechanics. Turn-enforced (spin/guess/buy belong to the
 * wheel holder; a null control is claimed by the first actor) — the interview and
 * housekeeping actions mirror the other shows verbatim.
 * @param {object} state - Current game state.
 * @param {object} action - { type, ... }.
 * @param {object} actor - { seatId, isHost, team, name }.
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats } for round-robin turn passing.
 * @returns {object} Reduced result.
 */
function reduce(state, action, actor = {}, now = Date.now(), ctx = {}) {
  switch (action && action.type) {
    case 'spin': return reduceSpin(state, actor, now, ctx);
    case 'guessLetter': return reduceGuessLetter(state, action, actor, now, ctx);
    case 'buyVowel': return reduceBuyVowel(state, action, actor, now);
    case 'answerInterview': {
      const result = interview.answer(state, actor.seatId, action.text, now);
      return result.ok ? { ok: true, state: result.state, cue: { interviewReact: true } } : { ok: false, error: result.reason };
    }
    case 'endInterview': return { ok: true, state: interview.end(state) };
    case 'showScores': return { ok: true, state: director.cut({ ...state, phase: 'scoreboard' }, 'scoreboard', null, now) };
    case 'finish': return { ok: true, state: director.cut({ ...state, phase: 'outro' }, 'celebration', null, now), host: { mode: 'outro', payload: {} } };
    default: return { ok: false, error: 'UNKNOWN_ACTION' };
  }
}

/** @description Gate a solve attempt before an LLM judge call is spent: the wheel holder (or anyone, when the turn is open) may solve, but never over an uncalled spin. */
function canAnswer(state, actor = {}) {
  if (state.phase !== 'puzzle') return { ok: false, reason: 'NOT_ANSWER_PHASE' };
  const board = state.board || {};
  if (board.spin && board.spin.value != null) return { ok: false, reason: 'GUESS_YOUR_SPIN' };
  if (board.control && board.control !== actor.seatId) return { ok: false, reason: 'NOT_YOUR_TURN' };
  return { ok: true };
}

/** @description Uppercase, strip everything but letters and spaces, collapse whitespace — both sides of a solve compare on this. */
function normalizeSolve(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @description Free local ruling before the LLM is spent: an exact normalized match
 * is correct with no model call (most solves ARE exact — the letters are on the
 * board). Anything else returns null to fall through to the LLM, which is allowed
 * to be lenient about typos in a way a string compare cannot.
 * @param {object} state - Current game state.
 * @param {string} guess - The contestant's solve attempt.
 * @returns {?{correct:boolean, reason:string}} The judge shape, or null to defer.
 */
function localJudge(state, guess) {
  const want = normalizeSolve((state.board || {}).puzzle);
  const got = normalizeSolve(guess);
  if (want && got && want === got) return { correct: true, reason: 'Exact match' };
  return null;
}

/** @description Ask the host bot to rule one solve attempt as one json block. */
function judgePrompt(state, guess, ctx = {}) {
  const board = state.board || {};
  return [
    'MODE: judge. The category is "' + board.category + '" and the full puzzle is: "' + board.puzzle + '"',
    'The contestant tried to solve with: "' + String(guess || '').slice(0, 160) + '"',
    'Rule it correct ONLY if they named the puzzle. Accept minor typos and spelling slips;',
    'do NOT accept a different phrase or a partial answer.',
    'Reply with ONE json block only: {"correct": true|false, "reason": "<short>"}.',
  ].join('\n');
}

/**
 * @description Apply the ruling on a solve attempt. Validates the judge shape (this
 * show owns {correct:boolean}; the engine only guarantees parsed JSON). Correct
 * banks max(round bank, $500) and retires the round; wrong passes the wheel and
 * play continues on the same puzzle.
 * @param {object} state - Current game state ('puzzle').
 * @param {object} judge - Parsed judge output.
 * @param {object} actor - The solving seat.
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats } for turn passing on a miss.
 * @returns {object} Reduced result.
 */
function applyJudgement(state, judge, actor = {}, now = Date.now(), ctx = {}) {
  if (!judge || typeof judge.correct !== 'boolean') return { ok: false, error: 'BAD_RULING' };
  if (state.phase !== 'puzzle') return { ok: false, error: 'NOT_ANSWER_PHASE' };
  const board = state.board;
  if (judge.correct) {
    // An open turn is claimed by the attempt itself, so the win credits the solver.
    return applyRoundWin({ ...state, board: { ...board, control: board.control || actor.seatId } }, actor, now);
  }
  const passed = { ...state, board: { ...board, spin: null, control: nextControl(actor.seatId, ctx.seats) } };
  return {
    ok: true, state: director.cut(passed, 'podium-closeup', actor.seatId, now),
    event: { kind: 'strike', content: (actor.name || 'Player') + ' misses the solve' },
    host: { mode: 'strike', payload: { solve: true, name: actor.name } },
  };
}

// ── Clock: which window is open, and what a lapse means ─────────────────────
// Wheel has no buzzer race; its hazard is a wheel holder who walks away. Two
// windows cover the whole turn: the consonant call after a spin, and the
// spin/buy/solve decision. An unclaimed turn has NO clock — the first mover
// claims it, and a room where nobody wants the wheel has nothing to time out.

const WINDOW_MS = { turn: 30000, answer: 20000, interview: 45000 };

/** @description The timed window open right now, or null when nothing is on the clock. */
function windowFor(state) {
  const iv = state.interview;
  if (iv && iv.active && iv.status === 'asked') return { kind: 'interview', ms: WINDOW_MS.interview, seatId: iv.seatId, note: 'Answering the host' };
  if (state.phase !== 'puzzle') return null;
  const board = state.board || {};
  if (board.spin && board.spin.value != null) return { kind: 'answer', ms: WINDOW_MS.answer, seatId: board.control || null, note: 'Call a consonant' };
  if (board.control) return { kind: 'turn', ms: WINDOW_MS.turn, seatId: board.control, note: 'Spin, buy, or solve' };
  return null;
}

/**
 * @description Apply a lapsed window. A dead consonant call is exactly a missed
 * letter (spin dies, turn passes) minus the burned letter; a dead turn simply
 * passes the wheel. Both land on a plain in-turn 'puzzle' board the normal
 * reducers already handle — a timeout can never dead-end the round.
 * @param {object} state - Current game state.
 * @param {object} timer - The lapsed state.timer.
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats } for turn passing.
 * @returns {object} Reduced result.
 */
function onTimeout(state, timer, now = Date.now(), ctx = {}) {
  if (!timer) return { ok: false, error: 'NO_TIMER' };
  if (timer.kind === 'interview') {
    return { ok: true, state: interview.end(state), event: { kind: 'interview', content: 'The interview timed out' } };
  }
  if (timer.kind === 'answer' || timer.kind === 'turn') {
    const board = state.board || {};
    const control = nextControl(board.control, ctx.seats);
    const passed = { ...state, board: { ...board, spin: null, control } };
    return {
      ok: true, state: director.cut(passed, 'board', control, now),
      event: { kind: 'strike', content: 'Out of time — the wheel moves on' },
      host: { mode: 'strike', payload: { timedOut: true } },
    };
  }
  return { ok: false, error: 'UNKNOWN_WINDOW' };
}

// ── Host overrides: unstick a game without leaving the board inconsistent ────

/**
 * @description Show-specific host recovery. setControl hands the wheel (and clears
 * a stuck spin so the new holder starts clean); revealPuzzle/skipRound retire the
 * puzzle with NO winner — nobody solved it, so nobody is paid; the banks simply
 * die with the round as they would anyway.
 * @param {object} state - Current game state.
 * @param {object} action - { type, seatId? }.
 * @param {object} ctx - { seats } for name lookups.
 * @param {number} now - Server time in ms.
 * @returns {object} Reduced result.
 */
function override(state, action, ctx = {}, now = Date.now()) {
  const board = state.board || {};
  switch (action && action.type) {
    case 'setControl': {
      const seatId = String(action.seatId || '');
      if (!seatId) return { ok: false, error: 'BAD_SEAT' };
      const next = { ...state, board: { ...board, control: seatId, spin: null } };
      return { ok: true, state: director.cut(next, 'board', seatId, now), event: { kind: 'milestone', content: 'Host gave the wheel to ' + seatName(ctx.seats, seatId) } };
    }
    case 'revealPuzzle':
    case 'skipRound': {
      const retired = {
        ...state, phase: 'round-win',
        board: { ...board, guessed: lettersOf(board.puzzle), spin: null, solved: true, winner: null },
      };
      return { ok: true, state: director.cut(retired, 'board', null, now), event: { kind: 'milestone', content: 'Host revealed the puzzle' } };
    }
    default:
      return { ok: false, error: 'UNKNOWN_OVERRIDE' };
  }
}

// ── NPC brain: what would this seat do right now? (engine half in lib/npc.js) ─
// Decisions are made against the puzzle the server already holds — no LLM. The
// solve rides this show's own judge shape ({correct}) through applyJudgement,
// exactly like a human's judged solve.

/** Consonants in rough English-frequency order — what a miss plausibly calls. */
const COMMON_CONSONANTS = 'RSTLNCDMGHBPFWYVKXJQZ';

/** @description Unguessed consonants that ARE in the puzzle, best-paying first. */
function consonantsInPuzzle(board) {
  return lettersOf(board.puzzle)
    .filter((ch) => VOWELS.indexOf(ch) < 0 && (board.guessed || []).indexOf(ch) < 0)
    .sort((a, b) => countLetter(board.puzzle, b) - countLetter(board.puzzle, a));
}

/**
 * @description The move an NPC podium would make right now, or null.
 * @param {object} state - Current game state.
 * @param {object} actor - { seatId, team, name } for the NPC seat.
 * @param {object} ctx - { profile, roll } from the engine (deterministic).
 * @returns {{action:object}|{guess:string, judgement:object}|null}
 */
function npcMove(state, actor, ctx = {}) {
  if (state.phase !== 'puzzle') return null;
  const prof = ctx.profile || {};
  const board = state.board || {};
  if (board.control && board.control !== actor.seatId) return null;   // not this bot's wheel
  // A pending spin means a consonant is owed before anything else.
  if (board.spin && board.spin.value != null) {
    const paying = consonantsInPuzzle(board);
    if (ctx.roll('hit') < (prof.hit || 0.5) && paying.length) {
      const letter = prof.top ? paying[0] : paying[Math.floor(ctx.roll('pick') * paying.length)];
      return { action: { type: 'guessLetter', letter } };
    }
    const dud = COMMON_CONSONANTS.split('').find((ch) => (board.guessed || []).indexOf(ch) < 0 && lettersOf(board.puzzle).indexOf(ch) < 0);
    const letter = dud || paying[0];
    return letter ? { action: { type: 'guessLetter', letter } } : null;
  }
  // Turn decision: solve once enough of the board is up (a sharp bot solves
  // early, a wildcard hangs on), otherwise buy a vowel when flush, else spin.
  const total = (String(board.puzzle || '').match(/[A-Z]/g) || []).length;
  const revealed = String(board.puzzle || '').split('').filter((ch) => /[A-Z]/.test(ch) && (board.guessed || []).indexOf(ch) >= 0).length;
  const solveAt = 1.05 - (prof.hit || 0.5) * 0.8;   // sharp ≈ .37, casual ≈ .61, wild ≈ .81
  const mustSolve = !consonantsInPuzzle(board).length;   // nothing left to earn on
  if (total && (mustSolve || revealed / total >= solveAt)) {
    return { guess: board.puzzle, judgement: { correct: true, reason: 'npc' } };
  }
  const vowelsLeft = lettersOf(board.puzzle).filter((ch) => VOWELS.indexOf(ch) >= 0 && (board.guessed || []).indexOf(ch) < 0);
  if (vowelsLeft.length && bankOf(board, actor.seatId) >= VOWEL_COST && ctx.roll('vowel') < 0.35) {
    return { action: { type: 'buyVowel', letter: vowelsLeft.sort((a, b) => countLetter(board.puzzle, b) - countLetter(board.puzzle, a))[0] } };
  }
  return { action: { type: 'spin' } };
}

/**
 * @description Board context for spoken host prompts — always the MASKED puzzle.
 * The unmasked answer never enters a mid-round prompt: a host who can see it will
 * eventually read it aloud, which ends the game on a TTS line.
 */
function boardSummary(state) {
  const board = state.board || {};
  const banks = Object.keys(board.banks || {}).map((id) => id + ' $' + board.banks[id]).join(', ') || 'none';
  const totals = Object.keys(state.scores || {}).map((id) => id + ' $' + state.scores[id]).join(', ') || 'none';
  return 'Category "' + (board.category || '?') + '". Puzzle so far: "' + maskPuzzle(board) + '". '
    + 'Letters called: ' + ((board.guessed || []).join(', ') || 'none') + '. Round banks: ' + banks + '. Totals: ' + totals + '.';
}

/** @description Build the prompt for a spoken host line; only the outro/recap may name the puzzle, and only once it is solved. */
function spokenPrompt(mode, state, payload = {}, ctx = {}) {
  const context = boardSummary(state);
  const who = payload.name ? ' The contestant is ' + payload.name + '.' : '';
  const solvedLine = state.board && state.board.solved ? ' The puzzle was "' + state.board.puzzle + '".' : '';
  const map = {
    intro: 'MODE: intro. Welcome the room to Wheel of Fortune, tease the category, and invite the first spin.' + who,
    banter: 'MODE: banter. One quick host line for this moment at the wheel.' + who + ' ' + context,
    reveal: 'MODE: reveal. React to the letters (or the solve) that just landed.' + who + ' ' + context,
    strike: 'MODE: strike. Sell the bad spin or the miss kindly — keep them in it.' + who + ' ' + context,
    steal: 'MODE: banter. The wheel passes — hype the next player up.' + who + ' ' + context,
    interview: payload.react
      ? 'MODE: interview. React warmly in a sentence or two to what ' + (payload.name || 'the contestant') + ' said: "' + String(payload.answer || '').slice(0, 200) + '".'
      : 'MODE: interview. Ask ' + (payload.name || 'the contestant') + ' one warm question they can actually answer.',
    recap: 'MODE: recap. Where the money stands and what is at stake now. ' + context + solvedLine,
    outro: 'MODE: outro. Crown the champion and send everyone home happy. ' + context + solvedLine,
  };
  return map[mode] || map.banter;
}

/**
 * @description Individual standings, highest first. `score` includes the live round
 * bank (that is the number a player actually stands to hold), and `bank` carries
 * the at-risk portion separately so surfaces can show what BANKRUPT would erase.
 * @param {object} state - Current game state.
 * @param {object[]} seats - Seated players.
 * @returns {Array<{seatId:string,name:string,team:null,score:number,bank:number}>}
 */
function scoreboard(state, seats = []) {
  const banks = (state.board || {}).banks || {};
  return (seats || []).filter((s) => s.role !== 'host').map((s) => {
    const id = s.seatId || s.seat_id;
    const bank = Number(banks[id]) || 0;
    return { seatId: id, name: s.display_name || s.name || 'Player', team: null, score: (Number((state.scores || {})[id]) || 0) + bank, bank };
  }).sort((a, b) => b.score - a.score);
}

module.exports = {
  id: ID, title: 'Wheel of Fortune', tagline: 'Spin for cash, call your letters, and solve the puzzle.',
  teams: false, minPlayers: 2, maxPlayers: 6,
  initialState, reduce, canAnswer, canGenerate, generatePrompt, ingestGenerated,
  judgePrompt, localJudge, applyJudgement, spokenPrompt, scoreboard, isGameOver,
  windowFor, onTimeout, override, npcMove,
};
