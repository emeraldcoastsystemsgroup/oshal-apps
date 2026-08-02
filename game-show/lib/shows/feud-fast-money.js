/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 12:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Fast Money (backlog #6) — the Feud signature endgame, as its own module so family-feud.js stays under the size limits. Two players from the winning side answer five generated questions against one clock each; duplicate answers score zero; 200 combined points wins the bonus. family-feud.js delegates every fm-* phase here; the engine never sees these phase names (ADR-112 rule 3).
 * 2026-07-26 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | npcMove — an NPC picked for Fast Money actually plays it: answers from the generated board by skill, dodging player 1's answer on the second run (a sharp bot never duplicates; a wild one can). Delegated from family-feud npcMove like every other fm-* beat.
 */

'use strict';

const director = require('../director');

const QUESTIONS = 5;
const TARGET = 200;
const BONUS = 300;                     // team-score bonus for winning Fast Money
const ANSWER_MS = 20000;               // per-question window

/** @description Whether a phase belongs to the Fast Money endgame. */
function isFmPhase(phase) { return typeof phase === 'string' && phase.indexOf('fm-') === 0; }

/** @description Normalize a guess/answer for duplicate + alias comparison. */
function norm(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @description Open Fast Money: the host names the two contestants (pure action —
 *   no LLM). Only sensible once the main game is decided, so the caller (family-feud
 *   reduce) gates on isGameOver before delegating here.
 * @param {object} state - Post-game Feud state.
 * @param {object} action - { seat1, seat2 } podium seat ids.
 * @param {object} actor - Acting seat; must be the host podium.
 * @param {number} now - Server time in ms.
 * @param {object} ctx - { seats } for team lookup.
 * @returns {object} Reduced result opening the fm-setup phase.
 */
function start(state, action, actor, now, ctx = {}) {
  if (actor.role !== 'host') return { ok: false, error: 'HOST_ONLY' };
  const seat1 = String(action.seat1 || ''), seat2 = String(action.seat2 || '');
  if (!seat1 || !seat2 || seat1 === seat2) return { ok: false, error: 'PICK_TWO_PLAYERS' };
  const rows = ctx.seats || [];
  const first = rows.find((s) => (s.seat_id || s.seatId) === seat1);
  const next = {
    ...state,
    phase: 'fm-setup',
    fm: {
      players: [seat1, seat2], team: first ? first.team : null,
      turn: 0, current: 0, questions: [], answers: [[], []], total: 0, won: false,
    },
  };
  return {
    ok: true, state: director.cut(next, 'podium-closeup', seat1, now),
    event: { kind: 'milestone', content: 'Fast Money! Two players, five questions.' },
    host: { mode: 'banter', payload: { fastMoney: true } },
  };
}

/** @description Content may only be built while Fast Money is being set up. */
function canGenerate(state) { return state.phase === 'fm-setup'; }

/** @description Prompt the host bot for the five Fast Money questions as one json block. */
function generatePrompt(state, ctx = {}) {
  const used = (ctx.usedQuestions || []).slice(-12).map((q) => `- ${q}`).join('\n') || '- (none yet)';
  return [
    `MODE: generate. FAST MONEY — the Family Feud bonus round.`,
    `Create ${QUESTIONS} fresh quick-fire survey questions. Each has its top 5 answers ranked most-to-least popular, points summing to about 100 per question. Give a few lowercase aliases per answer.`,
    `Do NOT reuse any of these already-played questions:\n${used}`,
    `Reply with ONE json block only: {"questions":[{"question":"...","answers":[{"text":"...","points":34,"aliases":["..."]}, ...]}, ...]}.`,
  ].join('\n\n');
}

/** @description Normalize one generated Fast Money question. */
function normalizeQuestion(raw) {
  const answers = (Array.isArray(raw && raw.answers) ? raw.answers : [])
    .filter((a) => a && a.text)
    .slice(0, 5)
    .map((a) => ({
      text: String(a.text).trim().slice(0, 60),
      points: Math.max(0, Math.round(Number(a.points) || 0)),
      aliases: (Array.isArray(a.aliases) ? a.aliases : []).map((s) => norm(s)).filter(Boolean).slice(0, 6),
    }))
    .sort((a, b) => b.points - a.points);
  return { question: String((raw && raw.question) || '').trim().slice(0, 200), answers };
}

/** @description Merge the generated question set and put player 1 on the clock. */
function ingestGenerated(state, json, now = Date.now()) {
  const questions = (Array.isArray(json && json.questions) ? json.questions : [])
    .map(normalizeQuestion)
    .filter((q) => q.question && q.answers.length >= 3)
    .slice(0, QUESTIONS);
  if (questions.length < QUESTIONS) return { ok: false, error: 'BAD_FAST_MONEY' };
  const next = { ...state, phase: 'fm-play', fm: { ...state.fm, questions, turn: 0, current: 0, answers: [[], []] } };
  return {
    ok: true, state: director.cut(next, 'podium-closeup', state.fm.players[0], now),
    event: { kind: 'milestone', content: 'Fast Money is on the board' },
    host: { mode: 'banter', payload: { fastMoney: 'go' } },
  };
}

/** @description Only the player on the clock answers Fast Money. */
function canAnswer(state, actor = {}) {
  if (state.phase !== 'fm-play') return { ok: false, reason: 'NOT_ANSWER_PHASE' };
  const fm = state.fm || {};
  return actor.seatId === fm.players[fm.turn] ? { ok: true } : { ok: false, reason: 'NOT_YOUR_BUZZ' };
}

/** @description The current question, or null once the run is complete. */
function currentQuestion(state) {
  const fm = state.fm || {};
  return (fm.questions || [])[fm.current] || null;
}

/** @description Prompt the host bot to judge one Fast Money guess (duplicates score zero). */
function judgePrompt(state, guess) {
  const fm = state.fm;
  const q = currentQuestion(state);
  const answers = q.answers.map((a, i) => `  [${i}] ${a.text} (aliases: ${a.aliases.join(', ') || 'none'})`).join('\n');
  const prior = fm.turn === 1
    ? (fm.answers[0][fm.current] ? `\nPlayer 1 already said: "${fm.answers[0][fm.current].text}" — the SAME answer is a duplicate and scores zero.` : '')
    : '';
  return [
    `MODE: judge. FAST MONEY. Hidden survey answers for "${q.question}":`,
    answers,
    `Contestant guessed: "${String(guess || '').slice(0, 120)}"${prior}`,
    `Which single answer does it match? Judge by meaning — generously but honestly.`,
    `Reply with ONE json block only: {"matchIndex": <0-based index or -1>, "duplicate": true|false, "canonical": "<answer text or ''>"}.`,
  ].join('\n');
}

/** @description Rule an exact text/alias hit (or an exact duplicate) without the LLM. */
function localJudge(state, guess) {
  const q = currentQuestion(state);
  if (!q) return null;
  const fm = state.fm;
  const g = norm(guess);
  if (!g) return null;
  if (fm.turn === 1) {
    const prior = fm.answers[0][fm.current];
    if (prior && norm(prior.text) === g) return { matchIndex: -1, duplicate: true, canonical: prior.text };
  }
  const idx = q.answers.findIndex((a) => norm(a.text) === g || a.aliases.indexOf(g) >= 0);
  return idx >= 0 ? { matchIndex: idx, duplicate: false, canonical: q.answers[idx].text } : null;
}

/** @description Both runs are in: total the board and decide the bonus. */
function finishRun(state, now) {
  const fm = state.fm;
  const total = fm.answers.flat().reduce((sum, a) => sum + (a ? a.points : 0), 0);
  const won = total >= TARGET;
  const scores = won && fm.team ? { ...state.scores, [fm.team]: (state.scores[fm.team] || 0) + BONUS } : state.scores;
  const next = { ...state, phase: 'fm-reveal', scores, fm: { ...fm, total, won } };
  return {
    ok: true, state: director.cut(next, 'celebration', fm.team, now),
    event: { kind: 'milestone', content: won ? `FAST MONEY WON — ${total} points!` : `Fast Money: ${total} points` },
    host: { mode: 'reveal', payload: { fastMoneyTotal: total, won } },
  };
}

/**
 * @description Apply a judged Fast Money guess: record it, advance the run, and
 *   hand the clock to player 2 (or the reveal) when a run completes.
 */
function applyJudgement(state, judge, actor = {}, now = Date.now()) {
  if (!Number.isFinite(Number(judge && judge.matchIndex))) return { ok: false, error: 'BAD_RULING' };
  const fm = state.fm;
  const q = currentQuestion(state);
  if (!q) return { ok: false, error: 'NOT_ANSWER_PHASE' };
  const idx = Number(judge.matchIndex);
  const duplicate = !!judge.duplicate;
  const matched = !duplicate && idx >= 0 && idx < q.answers.length;
  const entry = {
    text: matched ? q.answers[idx].text : String(judge.canonical || '').slice(0, 60) || '—',
    points: matched ? q.answers[idx].points : 0,
    duplicate,
  };
  const answers = fm.answers.map((run, i) => (i === fm.turn ? run.concat(entry) : run));
  let next = { ...state, fm: { ...fm, answers } };
  const lastOfRun = fm.current + 1 >= QUESTIONS;
  if (!lastOfRun) {
    next = { ...next, fm: { ...next.fm, current: fm.current + 1 } };
  } else if (fm.turn === 0) {
    next = { ...next, fm: { ...next.fm, turn: 1, current: 0 } };
    next = director.cut(next, 'podium-closeup', fm.players[1], now);
    return {
      ok: true, state: next,
      event: { kind: 'milestone', content: 'Player two steps up for Fast Money' },
      host: { mode: 'banter', payload: { fastMoney: 'handoff' } },
    };
  } else {
    return finishRun(next, now);
  }
  const beat = entry.duplicate ? 'Duplicate — zero' : (matched ? `${entry.text} — ${entry.points}` : 'Not on the board');
  return { ok: true, state: next, event: { kind: 'reveal', content: `Fast Money: ${beat}` } };
}

/** Plausibly-wrong guesses for an NPC miss — the zero still needs a spoken line. */
const NPC_MISSES = ['umm... a hat?', 'my cousin Larry', 'soup', 'the weekend', 'jazz hands', 'more soup'];

/**
 * @description The move an NPC on the Fast Money clock would make, or null. Answers
 *   come from the generated board by skill; on the second run the prior player's
 *   answer to the same question is dodged (a sharp bot never duplicates).
 * @param {object} state - Current game state (fm-play).
 * @param {object} actor - { seatId, name } for the NPC seat.
 * @param {object} ctx - { profile, roll } from the engine (deterministic).
 * @returns {{guess:string, judgement:object}|null}
 */
function npcMove(state, actor, ctx = {}) {
  if (!canAnswer(state, actor).ok) return null;
  const prof = ctx.profile || {};
  const q = currentQuestion(state);
  if (!q) return null;
  const fm = state.fm;
  const prior = fm.turn === 1 ? fm.answers[0][fm.current] : null;
  const open = q.answers
    .map((answer, i) => ({ answer, i }))
    .filter((x) => !prior || norm(x.answer.text) !== norm(prior.text));
  if (ctx.roll('hit') < (prof.hit || 0.5) && open.length) {
    const pick = prof.top ? open[0] : open[Math.floor(ctx.roll('pick') * open.length)];
    return { guess: pick.answer.text, judgement: { matchIndex: pick.i, duplicate: false, canonical: pick.answer.text } };
  }
  const miss = NPC_MISSES[Math.floor(ctx.roll('miss') * NPC_MISSES.length)];
  return { guess: miss, judgement: { matchIndex: -1, duplicate: false, canonical: '' } };
}

/**
 * @description Fast Money windows: one per question so a silent contestant never
 *   stalls the run. The window key changes with turn+question (encoded in kind)
 *   because clock.windowKey cannot see fm.current.
 */
function windowFor(state) {
  if (state.phase !== 'fm-play') return null;
  const fm = state.fm || {};
  return {
    kind: `fm-${fm.turn}-${fm.current}`, ms: ANSWER_MS,
    seatId: fm.players[fm.turn] || null, note: `Fast Money Q${fm.current + 1}`,
  };
}

/** @description A lapsed Fast Money question records a zero and moves on. */
function onTimeout(state, timer, now = Date.now()) {
  if (!isFmPhase(state.phase)) return { ok: false, error: 'UNKNOWN_WINDOW' };
  const fm = state.fm || {};
  const result = applyJudgement(state, { matchIndex: -1, duplicate: false, canonical: '' }, { seatId: fm.players[fm.turn] }, now);
  if (!result.ok) return result;
  return { ...result, event: { kind: 'strike', content: 'Fast Money: out of time' } };
}

module.exports = {
  QUESTIONS, TARGET, BONUS,
  isFmPhase, start, canGenerate, generatePrompt, ingestGenerated,
  canAnswer, judgePrompt, localJudge, applyJudgement, windowFor, onTimeout, npcMove,
};
