/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 02:18:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Generalized round clock: a show-agnostic deadline primitive so no beat can hang forever. Shows DECLARE their windows (windowFor) and what a lapse MEANS (onTimeout); the engine only keeps time. Deadlines live in the state and expire lazily under the room lock — there is no scheduler.
 */

'use strict';

/**
 * WHY THIS IS AN ENGINE PRIMITIVE, NOT A PER-SHOW FEATURE
 *
 * Every show has windows that can dead-end: nobody buzzes, the player who won the
 * floor walks away, a wager is never entered. That failure is identical in every
 * show, so the timing lives here — beside the buzzer and the director — and the
 * SHOW supplies only the two things the engine cannot know:
 *
 *   show.windowFor(state)                  -> { kind, ms, seatId?, note? } | null
 *   show.onTimeout(state, timer, now, ctx) -> Reduced
 *
 * The engine never hard-codes a phase name (that was the Feud-shaped mistake show #2
 * flushed out of `canGenerate`). It asks the show what window is open, stamps the
 * deadline, and hands the lapse back to the show to interpret.
 *
 * NO SCHEDULER. There is no cron, no setTimeout, no background worker in this
 * package. `endsAt` is written into the state and expiry is applied lazily inside
 * the room lock the next time ANY surface polls (see roomService.tick). Two clients
 * racing the same expiry is safe: the second one re-checks under the lock, finds the
 * window already resolved, and no-ops. A room nobody is watching simply waits —
 * which is correct, because a game with no viewers has nothing to move along.
 *
 * state.timer = { kind, key, endsAt, ms, seatId, note, pausedAt }
 *   - kind    : show-declared window type ('buzz' | 'answer' | 'wager' | 'interview' | ...)
 *   - key     : identity of THIS window; a re-stamp with the same key keeps the
 *               original deadline, so an unrelated state write (a second player's
 *               buzz press, a host caption) never silently restarts the clock
 *   - endsAt  : server epoch ms the window lapses
 *   - seatId  : the podium on the clock, when the window belongs to one player
 *   - pausedAt: set while the host has the game paused; endsAt shifts on resume
 */

/** @description Identity of the currently-open window — a change here means a NEW clock. */
function windowKey(state, window) {
  const buzzSerial = state && state.buzz ? Number(state.buzz.serial) || 0 : 0;
  const interviewAt = state && state.interview ? Number(state.interview.at) || 0 : 0;
  return [
    window.kind, window.seatId || '', state.phase || '', state.round || 0,
    buzzSerial, interviewAt,
  ].join('|');
}

/**
 * @description Reconcile state.timer with the window the show says is open right now.
 * @param {object} state - Game state after a mutation.
 * @param {object} show - The registered show module (may omit windowFor).
 * @param {number} now - Server time in ms.
 * @returns {object} State with timer set, kept, or cleared.
 */
function stamp(state, show, now = Date.now()) {
  if (!state) return state;
  const window = show && typeof show.windowFor === 'function' ? show.windowFor(state) : null;
  if (!window || !Number(window.ms)) return clear(state);
  const key = windowKey(state, window);
  const current = state.timer;
  if (current && current.key === key) return state;   // same window — never restart the clock
  return {
    ...state,
    timer: {
      kind: String(window.kind || 'window'),
      key,
      ms: Math.max(1000, Math.round(Number(window.ms))),
      endsAt: Number(now) + Math.max(1000, Math.round(Number(window.ms))),
      seatId: window.seatId ? String(window.seatId) : null,
      note: window.note ? String(window.note).slice(0, 80) : '',
      pausedAt: null,
    },
  };
}

/** @description Remove any running clock. */
function clear(state) {
  if (!state || !state.timer) return state;
  const next = { ...state };
  delete next.timer;
  return next;
}

/** @description Whether the running window has lapsed (a paused clock never lapses). */
function expired(state, now = Date.now()) {
  const timer = state && state.timer;
  if (!timer || timer.pausedAt) return false;
  return Number(now) >= Number(timer.endsAt);
}

/** @description Milliseconds left on the clock, or null when none is running. */
function remaining(state, now = Date.now()) {
  const timer = state && state.timer;
  if (!timer) return null;
  if (timer.pausedAt) return Math.max(0, Number(timer.endsAt) - Number(timer.pausedAt));
  return Math.max(0, Number(timer.endsAt) - Number(now));
}

/** @description Give the current window more time (host override). */
function addTime(state, ms) {
  const timer = state && state.timer;
  if (!timer) return state;
  const extra = Math.max(1000, Math.min(Math.round(Number(ms) || 0), 300000));
  return { ...state, timer: { ...timer, endsAt: Number(timer.endsAt) + extra } };
}

/** @description Freeze the clock where it stands (host override). */
function pause(state, now = Date.now()) {
  const timer = state && state.timer;
  if (!timer || timer.pausedAt) return state;
  return { ...state, timer: { ...timer, pausedAt: Number(now) } };
}

/** @description Resume a paused clock, preserving the time that was left on it. */
function resume(state, now = Date.now()) {
  const timer = state && state.timer;
  if (!timer || !timer.pausedAt) return state;
  const shift = Number(now) - Number(timer.pausedAt);
  return { ...state, timer: { ...timer, pausedAt: null, endsAt: Number(timer.endsAt) + shift } };
}

/** @description Force the running window to lapse on the next tick (host "move it along"). */
function expire(state, now = Date.now()) {
  const timer = state && state.timer;
  if (!timer) return state;
  return { ...state, timer: { ...timer, pausedAt: null, endsAt: Number(now) - 1 } };
}

module.exports = { stamp, clear, expired, remaining, addTime, pause, resume, expire, windowKey };
