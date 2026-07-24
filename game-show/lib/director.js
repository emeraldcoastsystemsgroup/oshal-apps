/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:23:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Cutaway director: the broadcast surface is not static. A "shot" is data in the game state; this picks the semantic shot per phase and the surface composites the real player presence tiles into it (huddle, audience pan, celebration dance).
 */

'use strict';

/**
 * The director decides WHAT the big screen is looking at — the semantic "shot" —
 * and the TV surface decides how to render it (compositing the live podium presence
 * tiles into a huddle, sweeping the camera across the audience, throwing confetti).
 * Shots are data so they are modular: add a shot type here + a renderer on the TV
 * surface, no engine changes.
 *
 * state.shot = { type, focus, serial, at }
 *   - type : one of SHOTS
 *   - focus: a seatId, a team ('A'|'B'), or null (whole stage)
 */

/** @description Every shot the director can call and the broadcast surface can render. */
const SHOTS = Object.freeze([
  'lobby',            // pre-game: podiums filling in
  'board',            // the survey board front and center
  'buzzer-race',      // tight on the two podiums about to buzz
  'podium-closeup',   // one contestant answering / reacting
  'team-huddle',      // a team leaning in to confer
  'audience-pan',     // camera sweeps the crowd/players
  'celebration',      // confetti + winners dancing
  'interview',        // host chatting with a contestant
  'scoreboard',       // the running score
]);

/** @description Default shot for a phase when the show does not call one explicitly. */
const PHASE_SHOT = Object.freeze({
  lobby: 'lobby',
  intro: 'audience-pan',
  'round-start': 'board',
  faceoff: 'buzzer-race',
  play: 'board',
  answer: 'podium-closeup',
  reveal: 'board',
  strike: 'podium-closeup',
  steal: 'team-huddle',
  interview: 'interview',
  'round-win': 'celebration',
  scoreboard: 'scoreboard',
  outro: 'celebration',
});

/**
 * @description Cut the big screen to a specific shot. Returns a new state.
 * @param {object} state - Current game state.
 * @param {string} type - A member of SHOTS (unknown types fall back to 'board').
 * @param {string|null} focus - Seat id, team letter, or null for the whole stage.
 * @param {number} now - Server time in ms.
 * @returns {object} New state with state.shot advanced.
 */
function cut(state, type, focus = null, now = Date.now()) {
  const safeType = SHOTS.includes(type) ? type : 'board';
  const prev = state && state.shot ? Number(state.shot.serial) || 0 : 0;
  return { ...state, shot: { type: safeType, focus: focus == null ? null : String(focus), serial: prev + 1, at: Number(now) } };
}

/** @description The natural shot for a phase (before any explicit override). */
function shotForPhase(phase) {
  return PHASE_SHOT[String(phase)] || 'board';
}

/**
 * @description Cut to the natural shot for the state's current phase.
 * @param {object} state - Current game state (reads state.phase).
 * @param {string|null} focus - Optional focus seat/team.
 * @param {number} now - Server time in ms.
 * @returns {object} New state.
 */
function autoCut(state, focus = null, now = Date.now()) {
  return cut(state, shotForPhase(state && state.phase), focus, now);
}

module.exports = { SHOTS, cut, autoCut, shotForPhase };
