/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:28:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Show registry + the Show interface every game plugs into. The engine (room, seats, presence, buzzer, director, interview, sync, host, TTS) is show-agnostic; a show is one module implementing this contract. Family Feud is the reference show.
 */

'use strict';

const familyFeud = require('./family-feud');
const jeopardy = require('./jeopardy');
const wheel = require('./wheel');
const whammy = require('./whammy');

/**
 * THE SHOW INTERFACE (what makes this modular — "so wheel of fortune and whammy all
 * follow the same suite"). A show is a plain object with these members. The engine
 * calls them; nothing else in the engine knows the rules of any particular game.
 *
 * @typedef {object} Show
 * @property {string} id            Stable id used in gameshow_rooms.show_id + ?show=.
 * @property {string} title         Display title ("Family Feud").
 * @property {string} tagline       One-line pitch for the show picker.
 * @property {boolean} teams        True for two-team formats, false for free-for-all.
 * @property {number} minPlayers    Minimum seated players to start.
 * @property {number} maxPlayers    Maximum seated players.
 *
 * @property {(room:object, seats:object[], now:number) => object} initialState
 *   Build the opening game-state envelope for a fresh room.
 *
 * @property {(state:object, action:object, actor:object, now:number, ctx:object) => Reduced} reduce
 *   Pure, server-authoritative mechanics that do NOT need the LLM (buzz handling,
 *   phase advances, next round, interview transitions). `actor` = { seatId, isHost,
 *   team }. `ctx` carries { seats } for shows with per-player mechanics (Jeopardy's
 *   Final wagers need to know who is still solvent); team shows ignore it.
 *   Returns { ok, state?, error?, event?, host?, cue? }.
 *
 * @property {(state:object, ctx:object) => string} generatePrompt
 *   Prompt asking the host bot for the round's content as ONE json block.
 * @property {(state:object, json:object, now:number) => Reduced} ingestGenerated
 *   Merge the parsed generated content into the board and advance the phase.
 *
 * @property {(state:object, guess:string, ctx:object) => string} judgePrompt
 *   Prompt asking the host bot to judge one contestant guess as ONE json block.
 * @property {(state:object, guess:string) => ?object} [localJudge]
 *   OPTIONAL pre-judge: return the show's own judge-JSON shape for a guess that
 *   can be ruled WITHOUT the LLM (an exact text/alias match), or null to fall
 *   through to judgePrompt. Rule locally only when certain — never rule a miss
 *   locally, because leniency ("kitty" for "cat") is exactly what the LLM is for.
 *   This is also the deterministic rail the automated browser playthrough rides.
 * @property {(state:object, judge:object, actor:object, now:number, ctx:object) => Reduced} applyJudgement
 *   Apply the judged guess (reveal / strike / steal / face-off resolution). Same
 *   `ctx` as reduce. MUST validate the judge object's shape and return
 *   { ok:false } on garbage — the engine only guarantees it is parsed JSON.
 *
 * @property {(mode:string, state:object, payload:object, ctx:object) => string} spokenPrompt
 *   Prompt for a spoken host line (intro/banter/reveal/strike/steal/interview/recap/outro).
 *
 * @property {(state:object, seats:object[]) => Array<{name:string,team:?string,score:number}>} scoreboard
 *   Current standings for the surface.
 *
 * OPTIONAL members (the engine uses them when present, never assumes them):
 * @property {(state:object) => boolean} [canGenerate]
 *   Whether the host may build content right now. Without it the engine cannot know
 *   which phases are "mid-round" for THIS show — Family Feud blocks on faceoff/play/
 *   steal, Jeopardy blocks mid-board. Never hard-code one show's phases in the engine.
 * @property {(state:object, actor:object) => {ok:boolean, reason?:string}} [canAnswer]
 *   Gate an answer BEFORE an LLM judge call is spent.
 * @property {(state:object) => boolean} [isGameOver]
 *   Whether the whole game is decided.
 *
 * @property {(state:object) => ?{kind:string, ms:number, seatId:?string, note:?string}} [windowFor]
 *   Which timed window is open right now, or null when nothing is on the clock.
 *   The engine (lib/clock.js) keeps the time; only the SHOW knows that "faceoff with
 *   an open buzzer" is a 20-second race and "play" is a 25-second answer window.
 *   Without it a show simply never times out.
 * @property {(state:object, timer:object, now:number, ctx:object) => Reduced} [onTimeout]
 *   What a lapsed window MEANS. Required for any show that declares windowFor —
 *   a clock with no consequence is worse than no clock. Prefer routing the lapse
 *   through the show's EXISTING appliers (a Feud answer window that lapses is just
 *   applyJudgement with a miss) so a timeout can never dead-end differently than a
 *   played beat. `ctx` carries { seats }.
 * @property {(state:object, action:object, ctx:object, now:number) => Reduced} [override]
 *   Show-specific host recovery for a stuck game (force-reveal, skip the clue,
 *   re-open the buzzer, hand control over). The engine handles the show-agnostic
 *   overrides itself (see lib/host-override.js) and delegates the rest here.
 *   Owner-only — the router enforces that before calling.
 *
 * NOTE on judging: each show defines its OWN judge JSON shape (Feud returns
 * {matchIndex}, Jeopardy returns {correct}). The engine only guarantees it hands
 * applyJudgement a parsed object — the SHOW validates the shape and rejects garbage.
 *
 * Reduced = { ok:boolean, state?:object, error?:string, event?:{kind,content}, host?:{mode,payload}, cue?:object }
 */

/** @description The required members every registered show must provide. */
const REQUIRED = [
  'id', 'title', 'teams', 'initialState', 'reduce', 'generatePrompt',
  'ingestGenerated', 'judgePrompt', 'applyJudgement', 'spokenPrompt', 'scoreboard',
];

/** @description Throw if a show module is missing a required member (helps modular authors). */
function validateShow(show) {
  if (!show || typeof show !== 'object') throw new Error('show must be an object');
  const missing = REQUIRED.filter((key) => show[key] === undefined || show[key] === null);
  if (missing.length) throw new Error(`show "${show && show.id}" is missing: ${missing.join(', ')}`);
  return show;
}

const registry = new Map();

/** @description Register one show module under its id. */
function register(show) {
  validateShow(show);
  registry.set(show.id, show);
  return show;
}

/** @description Look up a show module by id, or null. */
function get(id) {
  return registry.get(String(id || '')) || null;
}

/** @description Whether a show id is registered. */
function has(id) {
  return registry.has(String(id || ''));
}

/** @description Compact catalog for the show picker. */
function list() {
  return Array.from(registry.values()).map((show) => ({
    id: show.id, title: show.title, tagline: show.tagline || '',
    teams: !!show.teams, minPlayers: show.minPlayers || 2, maxPlayers: show.maxPlayers || 10,
  }));
}

// Register the shows shipped in this package. Adding a game is one register() call.
register(familyFeud);
register(jeopardy);
register(wheel);
register(whammy);

module.exports = { register, get, has, list, validateShow, REQUIRED };
