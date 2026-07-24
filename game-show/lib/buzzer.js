/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:22:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Generalized buzzer: a show-agnostic buzz-in round living in the game state. Every show arms/opens/locks the same buzzer; the server decides the first press by write order.
 */

'use strict';

/**
 * The buzzer is a first-class engine primitive, not a per-show feature. It lives at
 * state.buzz and is reused by every show (Family Feud face-off, Jeopardy ring-in,
 * Whammy stop, ...). AUTHORITATIVE ORDERING: each press is a separate optimistic
 * state write (bumping the room rev); the DB serializes those writes, so whichever
 * press commits first with lockedBy still null wins the lock. This module only
 * records that fact — it never trusts a client-supplied timestamp for ordering.
 *
 * Shape of state.buzz:
 *   { open, serial, prompt, lockedBy, order: [{ seatId, at }], eligible }
 *   - open      : true while presses are accepted
 *   - serial    : incremented each time the buzzer is armed (dedupes stale presses)
 *   - prompt     : short caption for the surface ("Buzz in to answer!")
 *   - lockedBy   : seatId of the first valid press, or null
 *   - order      : every valid press in arrival order (for "who was 2nd/3rd")
 *   - eligible   : array of seatIds allowed to press, or null for anyone seated
 */

/** @description Arm a fresh buzz round (closed until open()). Returns a new state. */
function arm(state, { prompt = 'Buzz in!', eligible = null } = {}) {
  const prev = state && state.buzz ? Number(state.buzz.serial) || 0 : 0;
  return {
    ...state,
    buzz: {
      open: false,
      serial: prev + 1,
      prompt: String(prompt).slice(0, 120),
      lockedBy: null,
      order: [],
      eligible: Array.isArray(eligible) ? eligible.map(String) : null,
    },
  };
}

/** @description Open an armed buzzer so presses are accepted. */
function open(state, now = Date.now()) {
  if (!state || !state.buzz) return state;
  return { ...state, buzz: { ...state.buzz, open: true, armedAt: Number(now) } };
}

/** @description Whether a seat is allowed to press the current buzzer. */
function eligibleToPress(buzz, seatId) {
  if (!buzz || !buzz.open) return false;
  if (!buzz.eligible) return true;
  return buzz.eligible.includes(String(seatId));
}

/**
 * @description Record one buzzer press. First valid press acquires the lock.
 * @param {object} state - Current game state.
 * @param {string} seatId - Seat pressing the buzzer.
 * @param {number} now - Server receive time in ms (advisory; not used for ordering).
 * @param {number} serial - Client's view of buzz.serial, to reject stale presses.
 * @returns {{ok:boolean, state?:object, locked?:boolean, position?:number, reason?:string}}
 */
function press(state, seatId, now = Date.now(), serial = null) {
  const buzz = state && state.buzz;
  if (!buzz || !buzz.open) return { ok: false, reason: 'BUZZER_CLOSED' };
  if (serial !== null && Number(serial) !== Number(buzz.serial)) return { ok: false, reason: 'BUZZER_STALE' };
  if (!eligibleToPress(buzz, seatId)) return { ok: false, reason: 'NOT_ELIGIBLE' };
  const id = String(seatId);
  if (buzz.order.some((entry) => entry.seatId === id)) {
    return { ok: true, state, locked: buzz.lockedBy === id, position: buzz.order.findIndex((e) => e.seatId === id) + 1, already: true };
  }
  const order = buzz.order.concat({ seatId: id, at: Number(now) });
  const lockedBy = buzz.lockedBy || id;
  const next = { ...state, buzz: { ...buzz, order, lockedBy } };
  return { ok: true, state: next, locked: lockedBy === id, position: order.length };
}

/** @description Close the buzzer to new presses while keeping the recorded order. */
function close(state) {
  if (!state || !state.buzz) return state;
  return { ...state, buzz: { ...state.buzz, open: false } };
}

/** @description Remove the buzzer entirely (between beats that have no ring-in). */
function clear(state) {
  if (!state) return state;
  const next = { ...state };
  delete next.buzz;
  return next;
}

/** @description The seat that won the current/last buzz, or null. */
function winner(state) {
  return state && state.buzz ? state.buzz.lockedBy || null : null;
}

module.exports = { arm, open, press, close, clear, winner, eligibleToPress };
