/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:24:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Interview beat: a generalized host<->player exchange. The host asks a real question, the seated human actually answers (typed or spoken), and the host reacts. Reused by every show.
 */

'use strict';

/**
 * A generalized "the host chats with a contestant" beat, held at state.interview.
 * It is show-agnostic: any show can open an interview between rounds. The human at
 * the named podium (or the host) is the only one who may answer — authorization is
 * enforced by the caller against the seat's user_sub.
 *
 * state.interview = { active, seatId, question, answer, status, at }
 *   status: 'asked' (host asked, waiting) -> 'answered' (player replied) -> 'reacted' (host replied)
 */

/** @description Open an interview: the host asks the seated contestant a question. */
function ask(state, seatId, question, now = Date.now()) {
  return {
    ...state,
    interview: {
      active: true,
      seatId: String(seatId),
      question: String(question || '').slice(0, 400),
      answer: '',
      status: 'asked',
      at: Number(now),
    },
  };
}

/** @description Whether a seat may answer the current interview. */
function canAnswer(state, seatId) {
  const iv = state && state.interview;
  return !!(iv && iv.active && iv.status === 'asked' && iv.seatId === String(seatId));
}

/** @description Record the contestant's real answer. Returns {ok, state?, reason?}. */
function answer(state, seatId, text, now = Date.now()) {
  if (!canAnswer(state, seatId)) return { ok: false, reason: 'NO_ACTIVE_INTERVIEW' };
  const clean = String(text || '').trim().slice(0, 600);
  if (!clean) return { ok: false, reason: 'EMPTY_ANSWER' };
  return {
    ok: true,
    state: { ...state, interview: { ...state.interview, answer: clean, status: 'answered', answeredAt: Number(now) } },
  };
}

/** @description Store the host's reaction to the contestant's answer. */
function react(state, reaction, now = Date.now()) {
  const iv = state && state.interview;
  if (!iv || !iv.active) return state;
  return { ...state, interview: { ...iv, reaction: String(reaction || '').slice(0, 400), status: 'reacted', reactedAt: Number(now) } };
}

/** @description Close the interview beat. */
function end(state) {
  if (!state) return state;
  const next = { ...state };
  delete next.interview;
  return next;
}

module.exports = { ask, canAnswer, answer, react, end };
