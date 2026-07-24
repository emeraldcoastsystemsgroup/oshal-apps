/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 02:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Host override plane: the show-agnostic half of stuck-game recovery (clock control, force the window to lapse, end the game) with delegation to the show for anything that touches its own rules. Owner-only; every override lands in the event log so the room can see the host stepped in.
 */

'use strict';

const clock = require('./clock');

/**
 * TWO KINDS OF OVERRIDE, AND WHY THE SPLIT MATTERS
 *
 * Shared (here): pausing, extending, or lapsing the clock, and ending the game.
 * These work identically in every show and — critically — they work even for a show
 * that implements nothing optional. `forceTimeout` is the universal unstick: it
 * routes through the show's own onTimeout, so the host's "move it along" produces
 * exactly the board a real lapse would, never a bespoke half-state.
 *
 * Show-specific (delegated to show.override): force-reveal, skip the clue, re-open
 * the buzzer, hand control over. These need the show's rules, so the engine refuses
 * to guess at them.
 *
 * A host override is not a cheat code — it is the fire exit. Every one of them
 * writes a milestone event, because a game that silently rearranges itself is worse
 * than a game that is stuck.
 */

/** @description Override types the engine owns outright, in every show. */
const SHARED = ['addTime', 'pauseTimer', 'resumeTimer', 'forceTimeout', 'endGame'];

/** @description Whether an action is any kind of host override (shared or show-specific). */
function isOverride(type) {
  return SHARED.includes(type) || ['reopenBuzzer', 'forceReveal', 'skipClue', 'skipRound', 'clearStrike', 'setControl'].includes(type);
}

/** @description Extend or freeze the clock — nothing about the game itself moves. */
function applyClockAction(state, action, now) {
  switch (action.type) {
    case 'addTime': {
      if (!state.timer) return { ok: false, error: 'NO_TIMER' };
      const ms = Math.max(1000, Math.min(Math.round(Number(action.ms) || 30000), 300000));
      return { ok: true, state: clock.addTime(state, ms), event: { kind: 'milestone', content: `Host added ${Math.round(ms / 1000)}s` } };
    }
    case 'pauseTimer':
      if (!state.timer) return { ok: false, error: 'NO_TIMER' };
      return { ok: true, state: clock.pause(state, now), event: { kind: 'milestone', content: 'Host paused the clock' } };
    case 'resumeTimer':
      if (!state.timer) return { ok: false, error: 'NO_TIMER' };
      return { ok: true, state: clock.resume(state, now), event: { kind: 'milestone', content: 'Host resumed the clock' } };
    default:
      return { ok: false, error: 'UNKNOWN_OVERRIDE' };
  }
}

/**
 * @description Apply one host override, engine-first then delegating to the show.
 * @param {object} show - The registered show module.
 * @param {object} state - Locked game state.
 * @param {object} action - { type, ...args } from the host desk.
 * @param {object} ctx - { seats }.
 * @param {number} now - Server time in ms.
 * @returns {{ok:boolean, state?:object, error?:string, event?:object, host?:object, cue?:object}}
 */
function apply(show, state, action, ctx = {}, now = Date.now()) {
  const type = action && action.type;
  if (!isOverride(type)) return { ok: false, error: 'UNKNOWN_OVERRIDE' };

  if (['addTime', 'pauseTimer', 'resumeTimer'].includes(type)) return applyClockAction(state, action, now);

  if (type === 'forceTimeout') {
    // The universal unstick: produce exactly the board a real lapse would produce.
    if (!state.timer) return { ok: false, error: 'NO_TIMER' };
    if (!show || typeof show.onTimeout !== 'function') return { ok: true, state: clock.clear(state) };
    const result = show.onTimeout(state, state.timer, now, ctx);
    if (!result.ok) return result;
    return { ...result, event: result.event || { kind: 'milestone', content: 'Host moved it along' } };
  }

  if (type === 'endGame') {
    // Route through the show's own finish beat so the winner is decided by its rules.
    const result = show.reduce(state, { type: 'finish' }, {}, now, ctx);
    if (!result.ok) return result;
    return { ...result, event: { kind: 'milestone', content: 'Host ended the game' } };
  }

  if (typeof show.override !== 'function') return { ok: false, error: 'SHOW_HAS_NO_OVERRIDES' };
  return show.override(state, action, ctx, now);
}

module.exports = { apply, isOverride, SHARED };
