/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-25 22:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | NPC contestants: AI-played podiums so one person can run a full show. The engine half — skill profiles, deterministic timing/rolls, and the poll-driven actuator (the sync poll IS the tick, same no-scheduler doctrine as the round clock). Shows supply the one thing the engine cannot know: what THIS seat would do right now (show.npcMove). Zero LLM calls — an NPC decides against the board the server already holds.
 * 2026-07-26 09:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Bots stay quiet while an interview is live — the interview window belongs to a human beat, and a turn-based bot (Wheel/Whammy now have brains) would otherwise act straight through it.
 * 2026-10-11 00:00:00 | maintainer@emeraldcoastsystemsgroup.com    | An NPC podium's identity is its seat_key, not its user_sub: it is now the host's gameshow_podiums row (the native kernel admits only the caller as an owner). seatKeyOf(row) reads seat_key and falls back to user_sub for rows written before migration 002; isNpc and dueMove read it; newNpcKey mints the key (newNpcSub stays as its alias).
 * 2026-10-30 22:30:00 | maintainer@emeraldcoastsystemsgroup.com    | People get the first look (Roger could never get a move in): a show's move may carry `hold`, the ms an AI podium waits after the beat opens while a person is seated, and the shows use it for the read before a buzzer, the first move on an unclaimed board, and a teammate's turn. npcMove's ctx carries `humans` (the seats people are playing). An all-AI room never waits.
 */

'use strict';

const crypto = require('crypto');

/**
 * WHY THIS IS AN ENGINE PRIMITIVE, NOT A PER-SHOW FEATURE
 *
 * "One-person game night" is show-agnostic: every show has moments where a seat
 * could act (buzz, answer, pick, wager) and the engine already knows whose moment
 * it is (windowFor / canAnswer). So the engine owns WHO is an NPC, WHEN it acts,
 * and HOW the act is applied — while each show owns WHAT the act is, via an
 * optional `npcMove(state, actor, ctx)` hook (ADR-112: shows are plug-ins).
 * A show without the hook simply has no NPC brain; its NPC podiums idle and the
 * round clock keeps the game moving exactly as it does for an AFK human.
 *
 * NO SCHEDULER and NO LLM. NPC moves are decided deterministically from the
 * locked state (the server already knows the hidden board), so they cost nothing,
 * work under FORCE_LLM_PROVIDER=noop, and are exactly reproducible in tests.
 * The sync poll drives them lazily: a room nobody is watching has NPCs that
 * simply wait, which is correct — a show with no audience has nowhere to be.
 */

/** Skill profiles. `hit` = chance an answer is right; `ring` = chance to ring in
 *  on an open race; `top` = whether a hit takes the best remaining answer;
 *  `delay` = ms range after a window opens before acting; `pace` = minimum ms
 *  between two acts by any NPC (keeps a team of bots from machine-gunning). */
const PROFILES = {
  sharp: { hit: 0.85, ring: 0.85, top: true, delay: [2200, 5000], pace: 2600 },
  casual: { hit: 0.55, ring: 0.55, top: false, delay: [3500, 7500], pace: 3600 },
  wild: { hit: 0.3, ring: 0.4, top: false, delay: [3000, 9000], pace: 4200 },
};

const SKILLS = Object.keys(PROFILES);

/** How long an AI podium leaves an unclaimed board to the person seated at the show, ms. */
const FIRST_MOVE_HOLD_MS = 20000;
/** How long an AI teammate leaves the answer to the person on its team, ms. */
const TEAMMATE_HOLD_MS = 9000;
/** After a miss everyone has already read the prompt, so the buzzer race restarts sooner, ms. */
const REOPENED_HOLD_MS = 2500;
/** The opening titles cover the set this long when a show starts, so that time is nobody's reading time, ms. */
const OPENING_TITLES_MS = 3200;

/** Ready-made stage names per skill, prefixed so every surface reads them as bots. */
const NAMES = {
  sharp: ['Ace', 'Nova', 'Sage', 'Vega', 'Quinn'],
  casual: ['Marty', 'Doris', 'Chip', 'Bev', 'Gus'],
  wild: ['Ziggy', 'Moxie', 'Taco', 'Sparks', 'Bananas'],
};

/** @description The NPC skill encoded in a synthetic seat subject, or null for humans/house seats. */
function skillOf(userSub) {
  const sub = String(userSub || '');
  if (!sub.startsWith('npc:')) return null;
  const skill = sub.split(':')[1];
  return SKILLS.includes(skill) ? skill : null;
}

/**
 * @description A seat row's podium identity: its seat_key (AI `npc:<skill>:<uuid>` or
 *   house `house:<uuid>`), or for a row written before migration 002 its user_sub.
 */
function seatKeyOf(seatRow) { return String((seatRow && (seatRow.seat_key || seatRow.user_sub)) || ''); }

/** @description Whether a raw seat row is an NPC podium. */
function isNpc(seatRow) { return !!skillOf(seatKeyOf(seatRow)); }

/** @description The behavior profile for a skill (defaults to casual). */
function profile(skill) { return PROFILES[skill] || PROFILES.casual; }

/** @description The seats people are playing: not an AI podium and not a host who only runs the show. */
function humanSeats(seatRows) { return (seatRows || []).filter((s) => !isNpc(s) && s.role !== 'host'); }

/**
 * @description How long the AI holds off an open buzzer so a person can read the prompt: about a
 *   comfortable reading speed for the text, or nothing when no person is seated.
 * @param {string} text - The clue or question on screen.
 * @param {Array} humans - humanSeats for the room.
 * @returns {number} The hold in ms.
 */
function readingHold(text, humans) {
  if (!humans || !humans.length) return 0;
  return Math.max(4000, Math.min(8500, 2500 + 50 * String(text || '').length));
}

/** @description Mint the seat_key for a new NPC podium. */
function newNpcKey(skill) { return `npc:${skill}:${crypto.randomUUID()}`; }
const newNpcSub = newNpcKey;

/**
 * @description Pick a stage name for a new NPC, avoiding names already seated.
 * @param {string} skill - Validated skill key.
 * @param {Array} seatRows - Existing raw seat rows in the room.
 * @returns {string} A display name like "🤖 Nova".
 */
function npcName(skill, seatRows) {
  const taken = new Set((seatRows || []).map((s) => s.display_name));
  const pool = NAMES[skill] || NAMES.casual;
  for (const base of pool) {
    if (!taken.has(`🤖 ${base}`)) return `🤖 ${base}`;
  }
  return `🤖 ${pool[0]} ${(seatRows || []).length + 1}`;
}

/**
 * @description Deterministic [0,1) roll. Seeded from the game state so every poll
 *   computes the SAME decision for the same beat (no re-roll racing), while the
 *   per-act counter (state.npcN) makes each successive act a fresh roll.
 */
function roll(seed) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  return hash.readUInt32BE(0) / 0x100000000;
}

/** @description Build the per-move roll function a show brain receives. */
function rollerFor(state, seatId) {
  const base = [seatId, state.round || 0, state.phase || '', Number(state.npcN) || 0,
    state.buzz ? Number(state.buzz.serial) || 0 : 0].join('|');
  return (tag) => roll(base + '|' + tag);
}

/**
 * @description When this NPC's next act becomes due. Humans get a head start: the
 *   delay counts from when the current window/beat opened, and a room-wide pace
 *   floor keeps successive NPC acts conversational rather than instant. A `late`
 *   move (a shy ring-in) waits most of the window — the live playthrough proved
 *   a hard refusal is a frozen roll, and five frozen-shy bots meant 20 seconds
 *   of dead air until the clock bailed the face-off out. A `hold` is the head start a
 *   show gives a seated person on this beat; it never runs past the window.
 */
function dueAt(state, seat, prof, late, hold) {
  const timer = state.timer;
  const beatAt = timer ? Number(timer.endsAt) - Number(timer.ms)
    : Number(state.shot && state.shot.at) || 0;
  const spread = prof.delay[1] - prof.delay[0];
  let delay = prof.delay[0] + rollerFor(state, seat.seat_id)('delay') * spread;
  // Never engineer an NPC into its own timeout: act within the open window.
  if (timer) delay = Math.min(delay, Number(timer.ms) * 0.6);
  if (late) delay = timer ? Number(timer.ms) * 0.75 : delay + 6000;
  if (hold) delay = Math.max(delay, timer ? Math.min(hold, Number(timer.ms) * 0.8) : hold);
  return Math.max(beatAt + delay, (Number(state.npcAt) || 0) + prof.pace);
}

/** @description Project a raw seat row into the actor shape the shows expect. */
function actorOf(seatRow) {
  return { seatId: seatRow.seat_id, team: seatRow.team, name: seatRow.display_name, role: seatRow.role };
}

/**
 * @description The one NPC move that is due right now, or null. Pure — safe to
 *   call unlocked from the poll and again locked inside mutate().
 * @param {object} show - Registered show module (may lack npcMove).
 * @param {object} state - Current game state.
 * @param {Array} seatRows - Raw seat rows.
 * @param {number} now - Server time in ms.
 * @returns {{seatId:string, move:object}|null}
 */
function dueMove(show, state, seatRows, now) {
  if (!show || typeof show.npcMove !== 'function') return null;
  if (!state || state.phase === 'lobby') return null;
  if (state.timer && state.timer.pausedAt) return null;   // a paused game freezes the bots too
  if (state.interview && state.interview.active) return null;   // bots don't talk over the interview
  // Rotate priority by the act counter so one eager bot doesn't hog every beat —
  // on a team the mic passes around, like people actually playing.
  const bots = (seatRows || []).filter((s) => skillOf(seatKeyOf(s)) && s.role !== 'host');
  const humans = humanSeats(seatRows);
  const offset = Number(state.npcN) || 0;
  for (let k = 0; k < bots.length; k++) {
    const seat = bots[(k + offset) % bots.length];
    const skill = skillOf(seatKeyOf(seat));
    const prof = profile(skill);
    const move = show.npcMove(state, actorOf(seat), { skill, profile: prof, roll: rollerFor(state, seat.seat_id), seats: seatRows, humans });
    if (!move) continue;
    if (now < dueAt(state, seat, prof, !!move.late, Number(move.hold) || 0)) continue;
    return { seatId: seat.seat_id, move };
  }
  return null;
}

/**
 * @description Resolve and apply one due NPC move under the room lock. Safe to
 *   call from any polling surface: the move is re-derived against the locked
 *   state, so two clients racing the same beat apply it exactly once and the
 *   loser no-ops — the same doctrine as roomService.tick.
 * @param {object} env - { mutate(roomId, sub, apply), registry }.
 * @param {object} room - The room row (show_id, status).
 * @param {string} sub - The polling caller driving the beat forward.
 * @param {object} state - Unlocked state snapshot (cheap pre-check only).
 * @param {Array} seatRows - Unlocked seat rows (cheap pre-check only).
 * @returns {Promise<{fired:boolean, rev?:number, state?:object}>}
 */
async function drive(env, room, sub, state, seatRows, now = Date.now()) {
  if (!room || room.status === 'ended') return { fired: false };
  const show = env.registry.get(room.show_id);
  const preview = dueMove(show, state, seatRows, now);
  if (!preview) return { fired: false };
  const applied = await env.mutate(room.room_id, sub, async ({ state: locked, seats }) => {
    const due = dueMove(show, locked, seats, Date.now());
    if (!due || due.seatId !== preview.seatId) return { ok: false, status: 409, error: 'NPC move no longer due.' };
    const seat = seats.find((s) => s.seat_id === due.seatId);
    const actor = actorOf(seat);
    let result;
    if (due.move.action) {
      result = show.reduce(locked, due.move.action, actor, Date.now(), { seats });
    } else {
      const gate = show.canAnswer ? show.canAnswer(locked, actor) : { ok: true };
      if (!gate.ok) return { ok: false, status: 409, error: 'NPC may not answer now.' };
      result = show.applyJudgement(locked, due.move.judgement, actor, Date.now(), { seats });
    }
    if (!result || !result.ok) return { ok: false, status: 409, error: result && result.error };
    const next = { ...(result.state || locked), npcAt: Date.now(), npcN: (Number(locked.npcN) || 0) + 1 };
    const events = result.event ? [result.event] : [];
    if (due.move.guess) events.unshift({ kind: 'npc', content: `${actor.name}: “${due.move.guess}”` });
    return { ok: true, state: next, events, host: result.host, cue: result.cue };
  });
  return applied.ok ? { fired: true, rev: applied.rev, state: applied.state } : { fired: false };
}

module.exports = {
  skillOf, seatKeyOf, isNpc, profile, newNpcKey, newNpcSub, npcName, dueMove, drive, SKILLS, PROFILES,
  humanSeats, readingHold, FIRST_MOVE_HOLD_MS, TEAMMATE_HOLD_MS, REOPENED_HOLD_MS, OPENING_TITLES_MS,
};
