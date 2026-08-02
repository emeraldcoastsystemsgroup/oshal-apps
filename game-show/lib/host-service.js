/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:18:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Host orchestration: dispatch the accountable host bot to generate surveys, judge guesses, run the interview beat, and deliver spoken lines. The slow LLM call runs OUTSIDE the room lock; its result is applied inside mutate() re-validated against the locked state. Host-bot cost attributes to the room owner (they run the show).
 * 2026-07-24 11:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog burn-down: (1) local pre-judge — an exact text/alias match rules WITHOUT spending an LLM call (shows opt in via show.localJudge), which also makes a deterministic browser playthrough possible; (2) manual content — the host may type their own survey/board (mode 'manual'), a real game-night feature that doubles as the no-LLM test rail; (3) host-bot task ids now embed the roomId so chat_tasks answers "what did THIS game cost" (backlog #15) via cost().
 * 2026-07-31 22:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #4 — the show no longer opens in silence: the FIRST round start (round 0 → 1) auto-dispatches the host's 'intro' spoken line, fire-and-forget so the ▶ response never waits on a second LLM call. The line lands via the normal host-caption path, so the speaker-lease surface voices it with the opening titles and everyone else gets the caption (caption-only is the built-in fallback when TTS is unavailable). Later rounds never re-narrate the open. Guarded in tests/host-guards.test.js.
 */

'use strict';

const crypto = require('crypto');
const { parsedJson } = require('./route-helpers');
const registry = require('./shows/show-registry');
const interview = require('./interview');
const director = require('./director');

const HOST_AGENT_ID = '6a5e0000-0000-0000-0000-000000000001';

/** @description Extract the first balanced JSON object from a fenced or raw model reply. */
function extractJson(text) {
  const source = String(text || '');
  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : source;
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < body.length; i++) {
    const char = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)); } catch (_error) { return null; }
    }
  }
  return null;
}

// A spoken line is read aloud and shown in a one-line caption bar. Models happily
// answer a "spoken" mode with headings, tables, bullets and emoji, so the shape is
// ENFORCED here rather than trusted to the prompt (live testing returned a full
// markdown document for the outro). Belt AND braces: constraint + sanitizer.
const SPOKEN_CONSTRAINT = '\n\nAnswer with ONE or TWO short sentences of plain spoken words only — under 40 words total. '
  + 'No markdown, no headings, no tables, no bullet or numbered lists, no emoji, no stage directions, no score recaps.';

/**
 * @description Reduce a model reply to a single plain spoken line.
 * @param {string} raw - The model's response.
 * @param {number} max - Hard character cap for the caption/TTS.
 * @returns {string} Plain text, markdown stripped, cut on a sentence boundary.
 */
function spokenText(raw, max = 320) {
  let text = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/[*_~`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut).trim();
}

/** @description Friendly message for a show's canAnswer rejection reason. */
function gateMessage(reason) {
  return {
    BUZZ_FIRST: 'Buzz in before you answer.',
    NOT_YOUR_BUZZ: 'The player who buzzed answers this one.',
    NOT_YOUR_TEAM: "It's the other team's board right now.",
    NOT_STEAL_TEAM: 'Only the stealing team can answer the steal.',
    NOT_ANSWER_PHASE: "It's not time to answer yet.",
    NOT_YOUR_TURN: "It's not your turn.",
    NOT_IN_THE_FINAL: 'Only players with money are in the final.',
    ALREADY_ANSWERED: 'You already gave your answer.',
    GUESS_YOUR_SPIN: 'Call a consonant for your spin first.',
  }[reason] || "You can't answer right now.";
}

/** @description Read the room's current game state and revision. */
async function readState(deps, roomId) {
  const result = await deps.pool.query('SELECT state, rev FROM gameshow_state WHERE room_id=$1', [roomId]);
  return result.rowCount ? { state: parsedJson(result.rows[0].state, {}), rev: Number(result.rows[0].rev) } : null;
}

/** @description The recent survey questions already played, so the host avoids repeats. */
async function usedQuestions(deps, roomId) {
  const result = await deps.pool.query(
    "SELECT content FROM gameshow_events WHERE room_id=$1 AND kind='milestone' ORDER BY seq DESC LIMIT 12", [roomId]
  );
  return result.rows.map((row) => (String(row.content).match(/Round \d+:\s*(.+)/) || [])[1]).filter(Boolean);
}

/**
 * @description Invoke the accountable host bot; cost attributes to the room owner.
 *   The task id embeds the roomId so chat_tasks can answer "what did THIS game
 *   cost" (see cost()) while userSub keeps the spend on the room owner's tab.
 */
async function invokeHost(deps, ownerSub, roomId, prompt) {
  if (!deps.orchestrator) return '';
  try {
    const result = await deps.orchestrator.processMessage(`game-show-${roomId}-${crypto.randomUUID()}`, prompt, {
      agenticMode: true, autoApprove: false, source: 'game-show', agentId: HOST_AGENT_ID, userSub: ownerSub,
    });
    return String((result && result.response) || '').trim();
  } catch (_error) {
    return '';
  }
}

/**
 * @description Generate this round's content and open play (host only). When the
 *   host supplies their own content (`manual` — a real game-night feature: play
 *   YOUR questions), the LLM is skipped entirely; the json still goes through the
 *   show's ingestGenerated validation, so hand-typed garbage is rejected the same
 *   way model garbage is.
 */
async function startRound(deps, sub, roomId, manual) {
  const room = await deps.room.access(sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host can start a round.' };
  const show = registry.get(room.show_id);
  const snap = await readState(deps, roomId);
  if (!snap) return { ok: false, status: 409, error: 'No game state.' };
  // Each SHOW decides when content may be built — never hard-code one show's phases here.
  if (show.canGenerate && !show.canGenerate(snap.state)) return { ok: false, status: 409, error: 'A round is already in play.' };
  const json = (manual && typeof manual === 'object') ? manual
    : extractJson(await invokeHost(deps, room.user_sub, roomId, show.generatePrompt(snap.state, { usedQuestions: await usedQuestions(deps, roomId) })));
  if (!json) return { ok: false, status: 502, error: 'The host is warming up — try starting the round again.' };
  const applied = await deps.room.mutate(roomId, sub, async ({ state }) => {
    if (show.canGenerate && !show.canGenerate(state)) return { ok: false, status: 409, error: 'A round is already in play.' };
    const result = show.ingestGenerated(state, json, Date.now());
    if (!result.ok) return { ok: false, status: 502, error: 'That survey did not come through — try again.' };
    return { ok: true, state: result.state, events: result.event ? [result.event] : [], host: result.host };
  }, { ownerOnly: true });
  if (applied.ok) {
    await deps.room.setStatus(sub, roomId, 'live').catch(() => {});
    // The show OPEN (round 0 → 1, backlog #4): auto-narrate it. Fire-and-forget —
    // the ▶ response must never wait on a second LLM round-trip; the line lands
    // through the normal host-caption path, so the speaker surface voices it with
    // the opening titles and every other device shows the caption. Later rounds
    // (round already > 0 before this start) never re-narrate the open.
    if (!(Number(snap.state.round) || 0)) {
      Promise.resolve(spoken(deps, sub, roomId, 'intro', {})).catch(() => {});
    }
  }
  return applied;
}

/** @description Judge one contestant guess and apply it to the board. */
async function judge(deps, sub, roomId, body) {
  const room = await deps.room.access(sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  const show = registry.get(room.show_id);
  const [seats, snap] = await Promise.all([deps.room.seatsOf(roomId), readState(deps, roomId)]);
  const resolved = deps.room.resolveActor(seats, room, sub, body.actorSeatId);
  if (resolved.error) return { ok: false, status: 403, error: resolved.error };
  const gate = show.canAnswer ? show.canAnswer(snap.state, resolved.actor) : { ok: true };
  if (!gate.ok) return { ok: false, status: 409, error: gateMessage(gate.reason) };
  const guess = String(body.guess || '').slice(0, 120);
  if (!guess.trim()) return { ok: false, status: 400, error: 'Say your answer first.' };
  // Each show defines its own judge shape (Feud {matchIndex}, Jeopardy {correct}); the
  // engine only guarantees a parsed object and lets applyJudgement reject garbage.
  // An exact text/alias hit rules LOCALLY first — no LLM spend for an obviously
  // right answer, and a deterministic rail for the automated browser playthrough.
  const local = typeof show.localJudge === 'function' ? show.localJudge(snap.state, guess) : null;
  const judgeJson = local || extractJson(await invokeHost(deps, room.user_sub, roomId, show.judgePrompt(snap.state, guess)));
  if (!judgeJson) return { ok: false, status: 502, error: 'The host did not catch that — say it again.' };
  const applied = await deps.room.mutate(roomId, sub, async ({ state, seats: locked, room: lockedRoom }) => {
    const re = deps.room.resolveActor(locked, lockedRoom, sub, body.actorSeatId);
    if (re.error) return { ok: false, status: 403, error: re.error };
    const g = show.canAnswer ? show.canAnswer(state, re.actor) : { ok: true };
    if (!g.ok) return { ok: false, status: 409, error: gateMessage(g.reason) };
    const result = show.applyJudgement(state, judgeJson, re.actor, Date.now(), { seats: locked });
    if (!result.ok) return { ok: false, status: 409, error: result.error || 'That answer cannot be applied now.' };
    return { ok: true, state: result.state, events: result.event ? [result.event] : [], host: result.host, outcome: judgeJson };
  });
  if (applied.ok) applied.guess = guess;
  return applied;
}

/** @description Deliver one spoken host line for the current board and post it as the caption. */
async function spoken(deps, sub, roomId, mode, payload) {
  const room = await deps.room.access(sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  const show = registry.get(room.show_id);
  const snap = await readState(deps, roomId);
  const line = spokenText(await invokeHost(deps, room.user_sub, roomId, show.spokenPrompt(mode, snap.state, payload || {}, {}) + SPOKEN_CONSTRAINT));
  if (!line) return { ok: false, status: 502, unavailable: true, error: 'The host is catching their breath.' };
  const applied = await deps.room.mutate(roomId, sub, async ({ state }) => ({
    ok: true, state: { ...state, host: { line, mode, at: Date.now() } }, events: [{ kind: 'host', content: line }],
  }));
  applied.line = line;
  return applied;
}

/** @description Ask the seated contestant a real interview question (host only). */
async function interviewAsk(deps, sub, roomId, body) {
  const room = await deps.room.access(sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host runs the interview.' };
  const show = registry.get(room.show_id);
  const seat = (await deps.room.seatsOf(roomId)).find((s) => s.seat_id === String(body.seatId));
  if (!seat) return { ok: false, status: 404, error: 'No such podium.' };
  const snap = await readState(deps, roomId);
  const line = spokenText(await invokeHost(deps, room.user_sub, roomId, show.spokenPrompt('interview', snap.state, { name: seat.display_name }, {}) + SPOKEN_CONSTRAINT));
  if (!line) return { ok: false, status: 502, error: 'The host is catching their breath.' };
  const applied = await deps.room.mutate(roomId, sub, async ({ state }) => {
    let next = interview.ask(state, seat.seat_id, line, Date.now());
    next = director.cut(next, 'interview', seat.seat_id, Date.now());
    return { ok: true, state: { ...next, host: { line, mode: 'interview', at: Date.now() } }, events: [{ kind: 'interview', content: `Q for ${seat.display_name}: ${line}` }] };
  }, { ownerOnly: true });
  applied.line = line;
  return applied;
}

/** @description React to the contestant's interview answer (host only). */
async function interviewReact(deps, sub, roomId) {
  const room = await deps.room.access(sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host runs the interview.' };
  const show = registry.get(room.show_id);
  const snap = await readState(deps, roomId);
  const iv = snap.state.interview;
  if (!iv || iv.status !== 'answered') return { ok: false, status: 409, error: 'No answered interview to react to.' };
  const seat = (await deps.room.seatsOf(roomId)).find((s) => s.seat_id === iv.seatId);
  const line = spokenText(await invokeHost(deps, room.user_sub, roomId, show.spokenPrompt('interview', snap.state, { react: true, name: seat ? seat.display_name : '', answer: iv.answer }, {}) + SPOKEN_CONSTRAINT));
  if (!line) return { ok: false, status: 502, error: 'The host is catching their breath.' };
  const applied = await deps.room.mutate(roomId, sub, async ({ state }) => ({
    ok: true, state: { ...interview.react(state, line, Date.now()), host: { line, mode: 'interview', at: Date.now() } }, events: [{ kind: 'interview', content: `Host: ${line}` }],
  }), { ownerOnly: true });
  applied.line = line;
  return applied;
}

/** @description Advance the show: next round, or crown the winners when the game is over. */
async function continueShow(deps, sub, roomId) {
  const room = await deps.room.access(sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host can advance the show.' };
  const show = registry.get(room.show_id);
  const snap = await readState(deps, roomId);
  if (!(show.isGameOver && show.isGameOver(snap.state))) return startRound(deps, sub, roomId);
  const line = spokenText(await invokeHost(deps, room.user_sub, roomId, show.spokenPrompt('outro', snap.state, {}, {}) + SPOKEN_CONSTRAINT));
  const applied = await deps.room.mutate(roomId, sub, async ({ state }) => {
    const reduced = show.reduce(state, { type: 'finish' }, {}, Date.now());
    const next = line ? { ...(reduced.state || state), host: { line, mode: 'outro', at: Date.now() } } : (reduced.state || state);
    return { ok: true, state: next, events: line ? [{ kind: 'host', content: line }] : [] };
  }, { ownerOnly: true });
  await deps.room.setStatus(sub, roomId, 'ended').catch(() => {});
  applied.line = line; applied.gameOver = true;
  return applied;
}

/**
 * @description What this room's show has cost so far, from chat_tasks (the canonical
 *   $-cost store — never log estimates). Owner-only: the spend is theirs.
 */
async function cost(deps, sub, roomId) {
  const room = await deps.room.access(sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host sees the tab.' };
  const result = await deps.pool.query(
    'SELECT COALESCE(SUM(total_cost),0) AS spend, COUNT(*)::int AS calls FROM chat_tasks WHERE task_id LIKE $1',
    [`game-show-${roomId}-%`]
  );
  const row = result.rows[0] || {};
  return { ok: true, spend: Number(row.spend) || 0, calls: Number(row.calls) || 0, currency: 'USD' };
}

/** @description Route one /host request to its handler by mode. */
async function run(deps, sub, roomId, mode, payload) {
  switch (mode) {
    case 'start':
    case 'generate': return startRound(deps, sub, roomId);
    case 'manual': return startRound(deps, sub, roomId, payload && payload.content);
    case 'continue': return continueShow(deps, sub, roomId);
    case 'interview-ask': return interviewAsk(deps, sub, roomId, payload || {});
    case 'interview-react': return interviewReact(deps, sub, roomId);
    case 'intro': case 'banter': case 'reveal': case 'strike':
    case 'steal': case 'recap': case 'outro':
      return spoken(deps, sub, roomId, mode, payload || {});
    default: return { ok: false, status: 400, error: 'Unknown host mode.' };
  }
}

/**
 * @description Bind host orchestration to its dependencies.
 * @param {object} deps - { pool, orchestrator, room (roomService), logger }.
 * @returns {object} Host service methods consumed by the router.
 */
function createHostService(deps) {
  return {
    run: (sub, roomId, mode, payload) => run(deps, sub, roomId, mode, payload),
    judge: (sub, roomId, body) => judge(deps, sub, roomId, body),
    cost: (sub, roomId) => cost(deps, sub, roomId),
  };
}

module.exports = { createHostService, extractJson, spokenText, SPOKEN_CONSTRAINT };
