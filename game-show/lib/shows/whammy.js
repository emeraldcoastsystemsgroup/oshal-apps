/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 03:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Whammy! (Press Your Luck) — the third show, and deliberately unlike both predecessors: no typed answers to judge at all (the judge pair is a polite no-op), turn-based instead of buzz-based, and server-side randomness as the core mechanic. Spins are granted LAZILY on a player's first press because ingestGenerated never sees the seats. Reuses the shared director/interview unchanged.
 * 2026-07-26 09:25:00 | roger.murphy@emeraldcoastsystemsgroup.com  | npcMove — the Whammy NPC brain: press when it's your board (claiming an open one), and pass the remaining spins to the leader when leading with a bank to protect (sharp passes like a strategist, wild presses through everything). Pure reducer actions; the stop stays server-side randomness.
 */

'use strict';

const director = require('../director');
const interview = require('../interview');

const ID = 'whammy';
const SPINS_PER_PLAYER = 5;
const WHAMMY_ODDS = 1 / 6;
const WHAMMY_LIMIT = 4;
const MIN_PANELS = 8;
const MAX_PANELS = 12;
const MAX_VALUE = 25000;
const KINDS = ['cash', 'cash-spin', 'prize'];

/** @description Seat ids in seating order, host excluded — this IS the turn rotation, so it must come from ctx.seats (the DB order), never from the scores object whose key order depends on who pressed first. */
function playerIds(seats) {
  return (seats || []).filter(function (s) { return s.role !== 'host'; })
    .map(function (s) { return s.seatId || s.seat_id; });
}

/** @description Spins a seat has left. An ABSENT key means the player has never pressed, which counts as a FULL allotment — spins are granted lazily because ingestGenerated is never handed the seats, so nobody can be pre-funded at round start. */
function spinsOf(board, seatId) {
  const left = (board.spinsLeft || {})[seatId];
  return left === undefined ? (Number(board.spinsPerPlayer) || SPINS_PER_PLAYER) : (Number(left) || 0);
}

/** @description The seat id with the highest bank (ties go to key order), or null when nobody has banked. */
function richest(scores) {
  let best = null;
  Object.keys(scores || {}).forEach(function (id) {
    if (best === null || (Number(scores[id]) || 0) > (Number(scores[best]) || 0)) best = id;
  });
  return best;
}

/** @description Build the opening Whammy! state. Individual banks (like Jeopardy), plus per-seat spin and whammy ledgers that fill in lazily as players press. */
function initialState(room, seats, now = Date.now()) {
  return {
    showId: ID, phase: 'lobby', round: 0,
    board: {
      panels: [], control: null, spinsLeft: {}, whammies: {},
      lastStop: null, winner: null, spinsPerPlayer: SPINS_PER_PLAYER,
    },
    scores: {},
    host: { line: '', mode: '', at: Number(now) },
    shot: { type: 'lobby', focus: null, serial: 0, at: Number(now) },
    serial: 0,
  };
}

/** @description The host may only build the prize board before the lights start — regenerating mid-round would silently re-value every future stop. */
function canGenerate(state) { return state.phase === 'lobby'; }

/** @description The game is decided once the round has been played out (or finished off). */
function isGameOver(state) { return ['round-win', 'outro'].indexOf(state.phase) >= 0; }

/**
 * @description Prompt the host bot for the prize board as ONE json block. The mix
 *   (mostly cash, a few cash-plus-spin, a few named prizes) is spelled out because
 *   the board IS the game — there is no question content to lean on.
 * @param {object} state - Current game state (unused; the board is round-agnostic).
 * @param {object} ctx - Engine context (unused; no question history to avoid).
 * @returns {string} The generation prompt.
 */
function generatePrompt(state, ctx = {}) {
  return [
    'MODE: generate. Build the Whammy! prize board: exactly ' + MAX_PANELS + ' panels.',
    'Mostly cash panels worth $300-$2000, in whole hundreds or fifties (kind "cash").',
    'Include 2-3 panels of kind "cash-spin" — cash PLUS a free spin — and 2-3 of kind "prize": a fun named prize with a dollar value (e.g. "Neon flamingo lamp" worth $850).',
    'Keep every label short, fun, and family-safe.',
    'Reply with ONE json block only: {"panels":[{"label":"...","value":750,"kind":"cash"}, ...]}.',
  ].join('\n\n');
}

/** @description Normalize generated panels: unknown kinds coerce to plain cash (a mislabeled panel should cost value, not reject the board), garbage values are dropped, and the board caps at the classic 12. */
function normalizePanels(list) {
  return (Array.isArray(list) ? list : [])
    .map(function (panel) {
      return {
        label: String((panel && panel.label) || '').trim().slice(0, 60),
        value: Math.round(Number(panel && panel.value)),
        kind: KINDS.indexOf(panel && panel.kind) >= 0 ? panel.kind : 'cash',
      };
    })
    .filter(function (panel) { return panel.label && Number.isFinite(panel.value) && panel.value > 0 && panel.value <= MAX_VALUE; })
    .slice(0, MAX_PANELS);
}

/**
 * @description Merge the generated prize board and start the lights. Control opens
 *   NULL — the first press claims the turn — and the spin ledgers reset empty so
 *   every seated player's allotment materializes on their first press.
 * @param {object} state - Current game state.
 * @param {object} json - Parsed host-bot output ({panels: [...]}).
 * @param {number} now - Server time in ms.
 * @returns {object} Reduced result.
 */
function ingestGenerated(state, json, now = Date.now()) {
  const panels = normalizePanels(json && json.panels);
  if (panels.length < MIN_PANELS) return { ok: false, error: 'BAD_BOARD' };
  const next = {
    ...state, round: (Number(state.round) || 0) + 1, phase: 'lights',
    board: { ...state.board, panels, control: null, spinsLeft: {}, whammies: {}, lastStop: null, winner: null },
  };
  return {
    ok: true, state: director.cut(next, 'board', null, now),
    event: { kind: 'milestone', content: 'Round ' + next.round + ': ' + panels.length + ' panels are lit — press your luck!' },
    host: { mode: 'banter', payload: { panels: panels.length, spins: Number(state.board.spinsPerPlayer) || SPINS_PER_PLAYER } },
  };
}

/** @description Everybody is out of spins: crown the biggest bank. Round-level twin of finishGame — skipRound and the natural exhaustion path both land here so there is exactly one way a round ends. */
function endRound(state, now) {
  const best = richest(state.scores);
  const next = { ...state, phase: 'round-win', board: { ...state.board, winner: best } };
  return {
    ok: true, state: director.cut(next, 'celebration', best, now),
    event: { kind: 'milestone', content: 'All spins are spent — the biggest bank takes the round' },
    host: { mode: 'reveal', payload: { winner: best } },
  };
}

/** @description Hand the turn to the next seat (seating order, wrapping) that can still spin — an absent ledger key counts as a full allotment. When NO such seat exists everyone is done and the round ends; this function is the only place that decides that, so press and pass cannot disagree about "over". */
function passControl(state, fromSeatId, ctx, now) {
  const ids = playerIds(ctx && ctx.seats);
  const start = Math.max(0, ids.indexOf(fromSeatId));
  for (let step = 1; step <= ids.length; step++) {
    const id = ids[(start + step) % ids.length];
    if (id !== fromSeatId && spinsOf(state.board, id) > 0) {
      const next = { ...state, board: { ...state.board, control: id } };
      return {
        ok: true, state: director.cut(next, 'podium-closeup', id, now),
        event: { kind: 'milestone', content: 'The board moves on — next player is up' },
      };
    }
  }
  return endRound(state, now);
}

/** @description Land on the Whammy: the bank goes to zero (that is the whole show), the whammy count rises, and a fourth whammy zeroes the spins too — that player is OUT. */
function landWhammy(state, actor, now) {
  const board = state.board;
  const whammies = { ...board.whammies };
  whammies[actor.seatId] = (Number(whammies[actor.seatId]) || 0) + 1;
  const out = whammies[actor.seatId] >= WHAMMY_LIMIT;
  const spinsLeft = { ...board.spinsLeft };
  if (out) spinsLeft[actor.seatId] = 0;
  const scores = { ...state.scores };
  scores[actor.seatId] = 0;
  const lastStop = { seatId: actor.seatId, panelIndex: null, kind: 'whammy', label: 'WHAMMY', value: 0 };
  const next = { ...state, scores, board: { ...board, whammies, spinsLeft, lastStop } };
  return {
    state: director.cut(next, 'podium-closeup', actor.seatId, now),
    event: { kind: 'strike', content: (actor.name || 'Player') + ' hit a WHAMMY!' + (out ? ' Four whammies — they are out!' : '') },
    host: { mode: 'strike', payload: { whammy: true, name: actor.name || 'Player', out } },
  };
}

/** @description Land on a prize panel, chosen uniformly server-side: cash and prizes bank their value, cash-spin also refunds the spin just spent (that is the free spin). */
function landPanel(state, actor, now) {
  const board = state.board;
  const panelIndex = Math.floor(Math.random() * board.panels.length);
  const panel = board.panels[panelIndex];
  const scores = { ...state.scores };
  scores[actor.seatId] = (Number(scores[actor.seatId]) || 0) + panel.value;
  const spinsLeft = { ...board.spinsLeft };
  if (panel.kind === 'cash-spin') spinsLeft[actor.seatId] = (Number(spinsLeft[actor.seatId]) || 0) + 1;
  const lastStop = { seatId: actor.seatId, panelIndex, kind: 'panel', label: panel.label, value: panel.value };
  const next = { ...state, scores, board: { ...board, spinsLeft, lastStop } };
  return {
    state: director.cut(next, 'board', actor.seatId, now),
    event: { kind: 'reveal', content: (actor.name || 'Player') + ' stops on ' + panel.label + ' — $' + panel.value + (panel.kind === 'cash-spin' ? ' and a free spin!' : '') },
    host: { mode: 'reveal', payload: { label: panel.label, value: panel.value, kind: panel.kind, name: actor.name || 'Player' } },
  };
}

/** @description Settle the turn after a stop: while the presser still has spins the turn does NOT auto-pass — choosing to press again is the show's whole tension. Only an empty ledger hands the board on (or ends the round). The stop's own event/host beat is kept because it is what the room just watched; a round-end swaps in the reveal-the-winner host line. */
function settleTurn(landed, actor, now, ctx) {
  const state = landed.state;
  if (spinsOf(state.board, actor.seatId) > 0) {
    return { ok: true, state, event: landed.event, host: landed.host };
  }
  const passed = passControl(state, actor.seatId, ctx, now);
  return { ...passed, event: landed.event, host: passed.state.phase === 'round-win' ? passed.host : landed.host };
}

/**
 * @description One press of the big red button. Turn rule: a set control locks the
 *   board to that seat; a NULL control means the first press claims it. The spin
 *   allotment is granted lazily here (absent ledger key) because ingestGenerated
 *   never sees the seats. The stop itself is SERVER-side Math.random — 1-in-6 is
 *   the Whammy — so no client can aim.
 * @param {object} state - Current game state.
 * @param {object} actor - { seatId, name } pressing.
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats } for the turn rotation.
 * @returns {object} Reduced result.
 */
function reducePress(state, actor, now, ctx) {
  if (state.phase !== 'lights') return { ok: false, error: 'NOT_LIGHTS_PHASE' };
  const board = state.board;
  if (board.control && board.control !== actor.seatId) return { ok: false, error: 'NOT_YOUR_TURN' };
  const had = spinsOf(board, actor.seatId);
  if (had <= 0) return { ok: false, error: 'NO_SPINS_LEFT' };
  const spinsLeft = { ...board.spinsLeft };
  spinsLeft[actor.seatId] = had - 1;
  const claimed = { ...state, board: { ...board, control: actor.seatId, spinsLeft } };
  const landed = Math.random() < WHAMMY_ODDS ? landWhammy(claimed, actor, now) : landPanel(claimed, actor, now);
  return settleTurn(landed, actor, now, ctx);
}

/** @description The highest-banked opponent who can still spin — classic Press Your Luck: passed spins go to the LEADER, who must use them. Ties go to seat order (the ids arrive in seating order and only a strictly bigger bank displaces). */
function leadingOpponent(state, seatId, ctx) {
  const ids = playerIds(ctx && ctx.seats).filter(function (id) { return id !== seatId && spinsOf(state.board, id) > 0; });
  let best = null;
  ids.forEach(function (id) {
    if (best === null || (Number(state.scores[id]) || 0) > (Number(state.scores[best]) || 0)) best = id;
  });
  return best;
}

/**
 * @description Pass the rest of your spins. They GO somewhere — to the leading
 *   opponent, who has to use them (that is the strategic knife of the real show,
 *   simplified honestly to "leader by bank"). With nobody able to receive them,
 *   passing collapses to declining: spins to zero and the same end-of-round check
 *   a spent press runs.
 * @param {object} state - Current game state.
 * @param {object} actor - { seatId, name } passing.
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats } for the rotation and the leader search.
 * @returns {object} Reduced result.
 */
function reducePassSpins(state, actor, now, ctx) {
  if (state.phase !== 'lights') return { ok: false, error: 'NOT_LIGHTS_PHASE' };
  const board = state.board;
  if (!board.control || board.control !== actor.seatId) return { ok: false, error: 'NOT_YOUR_TURN' };
  const mine = spinsOf(board, actor.seatId);
  if (mine <= 0) return { ok: false, error: 'NO_SPINS_LEFT' };
  const leader = leadingOpponent(state, actor.seatId, ctx);
  const spinsLeft = { ...board.spinsLeft };
  spinsLeft[actor.seatId] = 0;
  if (!leader) return passControl({ ...state, board: { ...board, spinsLeft } }, actor.seatId, ctx, now);
  spinsLeft[leader] = spinsOf(board, leader) + mine;
  const next = { ...state, board: { ...board, spinsLeft, control: leader } };
  return {
    ok: true, state: director.cut(next, 'podium-closeup', leader, now),
    event: { kind: 'milestone', content: (actor.name || 'Player') + ' passes ' + mine + ' spin' + (mine === 1 ? '' : 's') + ' to the leader — who has to use them' },
    host: { mode: 'banter', payload: { passed: mine, to: leader, name: actor.name || 'Player' } },
  };
}

/** @description Crown the biggest bank and roll credits — the 'finish' action's landing (game-level twin of endRound; this one goes to the outro). */
function finishGame(state, now) {
  const best = richest(state.scores);
  const next = { ...state, phase: 'outro', board: { ...state.board, winner: best } };
  return { ok: true, state: director.cut(next, 'celebration', best, now), host: { mode: 'outro', payload: { winner: best } } };
}

/**
 * @description Pure, non-LLM mechanics. Everything in Whammy! is pure mechanics —
 *   there is no judged answer path at all, so this reducer IS the whole game.
 * @param {object} state - Current game state.
 * @param {object} action - { type, ... } from a surface.
 * @param {object} actor - { seatId, name, team } acting.
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats } for the turn rotation (per-player mechanics).
 * @returns {object} Reduced result.
 */
function reduce(state, action, actor = {}, now = Date.now(), ctx = {}) {
  switch (action && action.type) {
    case 'pressYourLuck': return reducePress(state, actor, now, ctx);
    case 'passSpins': return reducePassSpins(state, actor, now, ctx);
    case 'answerInterview': {
      const result = interview.answer(state, actor.seatId, action.text, now);
      return result.ok ? { ok: true, state: result.state, cue: { interviewReact: true } } : { ok: false, error: result.reason };
    }
    case 'endInterview': return { ok: true, state: interview.end(state) };
    case 'showScores': return { ok: true, state: director.cut({ ...state, phase: 'scoreboard' }, 'scoreboard', null, now) };
    case 'finish': return finishGame(state, now);
    default: return { ok: false, error: 'UNKNOWN_ACTION' };
  }
}

/** @description Whammy! has no typed answers, ever — refusing here keeps the engine from spending an LLM judge call on a guess that can mean nothing. */
function canAnswer(state, actor = {}) { return { ok: false, reason: 'NOT_ANSWER_PHASE' }; }

/** @description Required by the Show interface even though nothing is ever judged — the honest prompt says so, so a stray judge call cannot invent a ruling. */
function judgePrompt(state, guess, ctx = {}) {
  return 'MODE: judge. Whammy! has no answers to judge — every stop is decided by the server\'s own randomness. Reply with ONE json block only: {"correct": false, "reason": "nothing to judge"}.';
}

/** @description The judge pair of canAnswer: any ruling that somehow arrives is rejected, because no phase of this show can absorb one. */
function applyJudgement(state, judge, actor = {}, now = Date.now(), ctx = {}) {
  return { ok: false, error: 'NOT_ANSWER_PHASE' };
}

// ── Clock: which window is open, and what a lapse means ─────────────────────
// A turn-based show has exactly two racing windows: "it is YOUR board" and "it is
// NOBODY'S board". The second one matters — without it a round where nobody dares
// the first press would sit unlit forever.

const WINDOW_MS = { turn: 20000, claim: 25000, interview: 45000 };

/** @description The timed window open right now. An UNCLAIMED board is on the clock too (seatId null) so the game cannot stall before anyone presses. */
function windowFor(state) {
  const iv = state.interview;
  if (iv && iv.active && iv.status === 'asked') return { kind: 'interview', ms: WINDOW_MS.interview, seatId: iv.seatId, note: 'Answering the host' };
  if (state.phase !== 'lights') return null;
  const control = (state.board || {}).control;
  if (control) return { kind: 'turn', ms: WINDOW_MS.turn, seatId: control, note: 'Press your luck… or pass' };
  return { kind: 'turn', ms: WINDOW_MS.claim, seatId: null, note: 'Who wants the board?' };
}

/** @description Resolve a seat id into a press-shaped actor for timeouts. */
function seatActor(seats, seatId) {
  const seat = (seats || []).filter(function (s) { return (s.seatId || s.seat_id) === seatId; })[0];
  return { seatId, team: null, name: seat ? (seat.display_name || seat.name) : 'The podium' };
}

/**
 * @description Apply a lapsed window. A lapsed TURN is an auto-press routed through
 *   the SAME reducePress a real press uses — including possibly a Whammy, which is
 *   the show's charm — so a timeout can never invent a board a played beat could
 *   not. An unclaimed board goes to the first seated player, whose press claims
 *   control exactly as a voluntary one would. Every branch leaves a state the
 *   reducers can continue from.
 * @param {object} state - Current game state.
 * @param {object} timer - The lapsed state.timer ({kind, seatId, ...}).
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats }.
 * @returns {object} Reduced result.
 */
function onTimeout(state, timer, now = Date.now(), ctx = {}) {
  if (!timer) return { ok: false, error: 'NO_TIMER' };
  if (timer.kind === 'interview') {
    return { ok: true, state: interview.end(state), event: { kind: 'interview', content: 'The interview timed out' } };
  }
  if (timer.kind !== 'turn') return { ok: false, error: 'UNKNOWN_WINDOW' };
  const control = (state.board || {}).control;
  const seatId = control || playerIds(ctx.seats)[0] || null;
  if (!seatId) return endRound(state, now);   // a board with no players cannot wait on anyone
  const pressed = reducePress(state, seatActor(ctx.seats, seatId), now, ctx);
  // A control seat the reducer refuses (e.g. zero spins after an override) must
  // still move: hand the turn on rather than let the clock re-lapse on every poll.
  if (!pressed.ok) return passControl(state, seatId, ctx, now);
  return { ...pressed, event: { kind: 'milestone', content: 'Out of time — the board spins itself! ' + ((pressed.event && pressed.event.content) || '') } };
}

// ── Host overrides: unstick a game without leaving the board inconsistent ────

/** @description Show-specific host recovery: hand the turn to a seat, or end the round now (the biggest bank wins, via the same endRound every natural finish uses). */
function override(state, action, ctx = {}, now = Date.now()) {
  switch (action && action.type) {
    case 'setControl': {
      const seatId = String(action.seatId || '');
      if (!seatId) return { ok: false, error: 'BAD_SEAT' };
      const next = { ...state, board: { ...state.board, control: seatId } };
      return {
        ok: true, state: director.cut(next, 'podium-closeup', seatId, now),
        event: { kind: 'milestone', content: 'Host gave the board to ' + seatActor(ctx.seats, seatId).name },
      };
    }
    case 'skipRound':
      return endRound(state, now);
    default:
      return { ok: false, error: 'UNKNOWN_OVERRIDE' };
  }
}

// ── NPC brain: what would this seat do right now? (engine half in lib/npc.js) ─
// Whammy is pure reducer actions — there is nothing to know and nothing to judge,
// so the brain is strategy only: press, or protect a lead by passing.

/**
 * @description The move an NPC podium would make right now, or null.
 * @param {object} state - Current game state.
 * @param {object} actor - { seatId, name } for the NPC seat.
 * @param {object} ctx - { profile, roll, seats } from the engine (deterministic).
 * @returns {{action:object}|null}
 */
function npcMove(state, actor, ctx = {}) {
  if (state.phase !== 'lights') return null;
  const prof = ctx.profile || {};
  const board = state.board || {};
  if (board.control && board.control !== actor.seatId) return null;   // not this bot's board
  if (spinsOf(board, actor.seatId) <= 0) return null;                 // nothing left to spend
  // The show's one decision: press on, or hand the leader your risk. A leading
  // bot with money to protect passes by skill (sharp plays the odds, wild never
  // stops pressing); anyone else presses.
  const leading = richest(state.scores) === actor.seatId && (Number(state.scores[actor.seatId]) || 0) > 0;
  const passProb = Math.max(0, ((prof.hit || 0.5) - 0.3) * 0.9);   // sharp ≈ .50, casual ≈ .23, wild 0
  if (leading && leadingOpponent(state, actor.seatId, ctx) && ctx.roll('pass') < passProb) {
    return { action: { type: 'passSpins' } };
  }
  return { action: { type: 'pressYourLuck' } };
}

/** @description One-line board context reused across spoken host prompts: banks, spins, whammy counts, and the last stop — the whole game state in a sentence. */
function boardSummary(state) {
  const board = state.board || {};
  const seats = {};
  Object.keys(state.scores || {}).forEach(function (id) { seats[id] = true; });
  Object.keys(board.spinsLeft || {}).forEach(function (id) { seats[id] = true; });
  const standings = Object.keys(seats).map(function (id) {
    return id + ' $' + (Number(state.scores[id]) || 0) + ' (' + spinsOf(board, id) + ' spins, ' + (Number((board.whammies || {})[id]) || 0) + ' whammies)';
  }).join('; ') || 'nobody has pressed yet';
  const stop = board.lastStop
    ? (board.lastStop.kind === 'whammy' ? 'a WHAMMY' : board.lastStop.label + ' for $' + board.lastStop.value)
    : 'none yet';
  return 'Standings: ' + standings + '. Last stop: ' + stop + '.';
}

/** @description Build the prompt for a spoken host line in the requested mode. */
function spokenPrompt(mode, state, payload = {}, ctx = {}) {
  const context = boardSummary(state);
  const who = payload.name ? ' The contestant is ' + payload.name + '.' : '';
  const map = {
    intro: 'MODE: intro. Welcome the room to Whammy!, explain the one rule — press your luck, dodge the Whammy — and dare somebody to press first.' + who,
    banter: 'MODE: banter. One quick host line to keep the pressure on.' + who + ' ' + context,
    reveal: 'MODE: reveal. Sell what the board just paid out.' + who + ' ' + context,
    strike: 'MODE: strike. The Whammy got them — mourn the bank theatrically, keep them smiling.' + who + ' ' + context,
    steal: 'MODE: banter. Spins just changed hands — raise the stakes for whoever must use them.' + who + ' ' + context,
    interview: payload.react
      ? 'MODE: interview. React warmly in a sentence or two to what ' + (payload.name || 'the contestant') + ' said: "' + String(payload.answer || '').slice(0, 200) + '".'
      : 'MODE: interview. Ask ' + (payload.name || 'the contestant') + ' one warm question they can actually answer.',
    recap: 'MODE: recap. Where the banks stand and who is still daring the board. ' + context,
    outro: 'MODE: outro. Crown the biggest bank and send everyone home happy. ' + context,
  };
  return map[mode] || map.banter;
}

/** @description Individual standings, biggest bank first, carrying the spin and whammy ledgers so the surface can show risk, not just money. An absent spin key reads as the full lazy allotment. */
function scoreboard(state, seats = []) {
  const board = state.board || {};
  return (seats || []).filter(function (s) { return s.role !== 'host'; }).map(function (s) {
    const id = s.seatId || s.seat_id;
    return {
      seatId: id, name: s.display_name || s.name || 'Player', team: null,
      score: Number((state.scores || {})[id]) || 0,
      spins: spinsOf(board, id),
      whammies: Number((board.whammies || {})[id]) || 0,
    };
  }).sort(function (a, b) { return b.score - a.score; });
}

module.exports = {
  id: ID, title: 'Whammy!', tagline: 'Press your luck for big bucks — but dodge the Whammy or lose it all.',
  teams: false, minPlayers: 2, maxPlayers: 6,
  initialState, reduce, canAnswer, canGenerate, generatePrompt, ingestGenerated,
  judgePrompt, applyJudgement, spokenPrompt, scoreboard, isGameOver,
  windowFor, onTimeout, override, npcMove,
};
