/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:34:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Family Feud — the reference show. Buzz-driven face-off, play with strikes, a one-guess steal, round multipliers, and the prompt/ingest pairs the host bot uses to generate surveys and judge guesses. Pure and server-authoritative.
 * 2026-07-22 02:26:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Declare the timed windows (windowFor) and what a lapse means (onTimeout) so no beat hangs forever — a dead buzzer hands the board to the trailing team, a dead answer routes through the existing judged-miss path. Add show-specific host overrides for stuck-game recovery (re-open buzzer, force-reveal, clear strike, set control, skip round).
 * 2026-07-24 12:15:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Fast Money endgame (backlog #6, delegated to feud-fast-money.js so this file stays inside the size limits) and localJudge (exact text/alias hits rule without an LLM call — the aliases were generated for exactly this).
 * 2026-07-25 22:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | npcMove — the Feud NPC brain for one-person game night: buzz the face-off, answer from the board the server already holds (skill decides hit rate and whether it takes the top answer), miss with a spoken wrong guess. No LLM; flows through the existing judge shape.
 * 2026-07-26 09:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Fast Money delegates to the fastMoney npcMove like every other fm-* beat — an NPC picked for the endgame now actually plays it.
 */

'use strict';

const buzzer = require('../buzzer');
const director = require('../director');
const interview = require('../interview');
const fastMoney = require('./feud-fast-money');

const ID = 'family-feud';
const STRIKE_LIMIT = 3;
const DEFAULT_ROUNDS = 3;

/** @description How many survey answers this round wants (warm-up is a touch bigger). */
function answersForRound(round) { return round <= 1 ? 7 : 6; }
/** @description Feud round multiplier: round 1 x1, round 2 x2, round 3 x3. */
function multiplierForRound(round) { return Math.max(1, Math.min(3, round)); }
/** @description The opposing team letter. */
function otherTeam(team) { return team === 'A' ? 'B' : 'A'; }

/** @description Index of the single highest-scoring answer (survey "number one"). */
function topIndex(answers) {
  let best = -1, bestPts = -1;
  answers.forEach((answer, i) => { if (Number(answer.points) > bestPts) { bestPts = Number(answer.points); best = i; } });
  return best;
}

/** @description Whether every answer on the board is now revealed. */
function allRevealed(answers) { return answers.length > 0 && answers.every((answer) => answer.revealed); }

/** @description Reveal one answer, crediting the team that found it. */
function revealAt(board, idx, team) {
  const answers = board.answers.map((answer, i) => i === idx ? { ...answer, revealed: true, by: team || answer.by || null } : answer);
  return { ...board, answers };
}

/** @description Sum the points of every revealed answer (the round bank before multiplier). */
function sumRevealed(answers) {
  return answers.filter((answer) => answer.revealed).reduce((total, answer) => total + (Number(answer.points) || 0), 0);
}

/** @description Build the opening game-state envelope for a fresh Family Feud room. */
function initialState(room, seats, now = Date.now()) {
  return {
    showId: ID, phase: 'lobby', round: 0,
    board: {
      question: '', answers: [], strikes: 0, control: null, bank: 0, multiplier: 1,
      faceoff: null, steal: null, stolen: false, winner: null, roundsTotal: DEFAULT_ROUNDS,
    },
    scores: { A: 0, B: 0 },
    host: { line: '', mode: '', at: Number(now) },
    shot: { type: 'lobby', focus: null, serial: 0, at: Number(now) },
    serial: 0,
  };
}

/** @description The host may only build a survey between rounds, never mid-round. */
function canGenerate(state) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.canGenerate(state);
  return ['faceoff', 'play', 'steal'].indexOf(state.phase) < 0;
}

/** @description Whether the whole game has been decided (all rounds played out). */
function isGameOver(state) {
  if (state.phase === 'fm-reveal') return true;               // Fast Money played out
  if (fastMoney.isFmPhase(state.phase)) return false;         // Fast Money in progress
  return (Number(state.round) || 0) >= (state.board.roundsTotal || DEFAULT_ROUNDS)
    && ['round-win', 'scoreboard', 'outro'].includes(state.phase);
}

/** @description Prompt the host bot to generate this round's survey as one json block. */
function generatePrompt(state, ctx = {}) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.generatePrompt(state, ctx);
  const round = (Number(state.round) || 0) + 1;
  const count = answersForRound(round);
  const used = (ctx.usedQuestions || []).slice(-12).map((q) => `- ${q}`).join('\n') || '- (none yet)';
  return [
    `MODE: generate. Round ${round} of ${state.board.roundsTotal}. Difficulty: ${round === 1 ? 'warm-up' : 'standard'}.`,
    `Create ONE fresh Family-Feud-style survey question with its top ${count} answers ranked most-to-least popular.`,
    `Points are whole numbers summing to about 100. Give a few lowercase aliases per answer so honest guesses count.`,
    `Do NOT reuse any of these already-played questions:\n${used}`,
    `Reply with ONE json block only: {"question":"...","answers":[{"text":"...","points":34,"aliases":["..."]}, ...]}.`,
  ].join('\n\n');
}

/** @description Normalize and rank host-generated answers. */
function normalizeAnswers(list, count) {
  const rows = (Array.isArray(list) ? list : [])
    .filter((answer) => answer && answer.text)
    .slice(0, count)
    .map((answer) => ({
      text: String(answer.text).trim().slice(0, 60),
      points: Math.max(0, Math.round(Number(answer.points) || 0)),
      aliases: (Array.isArray(answer.aliases) ? answer.aliases : []).map((s) => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 6),
      revealed: false, by: null,
    }));
  return rows.sort((a, b) => b.points - a.points);
}

/** @description Merge a generated survey into the board and open the face-off buzzer. */
function ingestGenerated(state, json, now = Date.now()) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.ingestGenerated(state, json, now);
  const round = (Number(state.round) || 0) + 1;
  const question = String((json && json.question) || '').trim().slice(0, 200);
  const answers = normalizeAnswers(json && json.answers, answersForRound(round));
  if (!question || answers.length < 3) return { ok: false, error: 'BAD_SURVEY' };
  const board = {
    ...state.board, question, answers, strikes: 0, control: null, bank: 0, stolen: false, winner: null,
    multiplier: multiplierForRound(round), steal: null,
    faceoff: { stage: 'first', firstSeat: null, firstTeam: null, firstPoints: null, secondSeat: null, secondTeam: null, secondPoints: null, awaitingTeam: null },
  };
  let next = { ...state, round, phase: 'faceoff', board };
  next = buzzer.open(buzzer.arm(next, { prompt: 'Face-off! First to buzz answers.' }), now);
  next = director.cut(next, 'buzzer-race', null, now);
  return {
    ok: true, state: next,
    event: { kind: 'milestone', content: `Round ${round}: ${question}` },
    host: { mode: 'banter', payload: { question } },
  };
}

/** @description Handle a buzzer press, capturing the face-off buzz-in when it locks. */
function reduceBuzz(state, action, actor, now) {
  const faceoff = state.phase === 'faceoff' ? (state.board.faceoff || {}) : null;
  if (faceoff && faceoff.stage === 'second' && faceoff.awaitingTeam && actor.team !== faceoff.awaitingTeam) {
    return { ok: false, error: 'NOT_FACEOFF_TEAM' };
  }
  const result = buzzer.press(state, actor.seatId, now, action.serial);
  if (!result.ok) return { ok: false, error: result.reason };
  let next = result.state;
  if (result.locked && next.phase === 'faceoff') {
    const current = next.board.faceoff || {};
    const patch = current.stage === 'second'
      ? { secondSeat: actor.seatId, secondTeam: actor.team }
      : { firstSeat: actor.seatId, firstTeam: actor.team };
    next = buzzer.close({ ...next, board: { ...next.board, faceoff: { ...current, ...patch } } });
    next = director.cut(next, 'podium-closeup', actor.seatId, now);
    return { ok: true, state: next, cue: { answer: actor.seatId }, host: { mode: 'banter', payload: { buzzed: actor.name } } };
  }
  return { ok: true, state: next };
}

/** @description Pure, non-LLM mechanics: buzzing, interview answers, phase moves. */
function reduce(state, action, actor = {}, now = Date.now(), ctx = {}) {
  switch (action && action.type) {
    case 'buzz':
      return reduceBuzz(state, action, actor, now);
    case 'startFastMoney': {
      // Only once the main game is decided — Fast Money replaces the outro, it
      // never interrupts a round.
      if (!isGameOver(state) || fastMoney.isFmPhase(state.phase)) return { ok: false, error: 'NOT_FAST_MONEY_TIME' };
      return fastMoney.start(state, action, actor, now, ctx);
    }
    case 'answerInterview': {
      const result = interview.answer(state, actor.seatId, action.text, now);
      return result.ok ? { ok: true, state: result.state, cue: { interviewReact: true } } : { ok: false, error: result.reason };
    }
    case 'endInterview':
      return { ok: true, state: interview.end(state) };
    case 'showScores':
      return { ok: true, state: director.cut({ ...state, phase: 'scoreboard' }, 'scoreboard', null, now) };
    case 'finish':
      return { ok: true, state: director.cut({ ...state, phase: 'outro' }, 'celebration', null, now), host: { mode: 'outro', payload: {} } };
    default:
      return { ok: false, error: 'UNKNOWN_ACTION' };
  }
}

/** @description Gate whether an actor may submit an answer right now (before spending an LLM call). */
function canAnswer(state, actor = {}) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.canAnswer(state, actor);
  const board = state.board;
  if (state.phase === 'faceoff') {
    const faceoff = board.faceoff || {};
    const seat = faceoff.stage === 'second' ? faceoff.secondSeat : faceoff.firstSeat;
    if (!seat) return { ok: false, reason: 'BUZZ_FIRST' };
    return seat === actor.seatId ? { ok: true } : { ok: false, reason: 'NOT_YOUR_BUZZ' };
  }
  if (state.phase === 'play') {
    return actor.team && actor.team === board.control ? { ok: true } : { ok: false, reason: 'NOT_YOUR_TEAM' };
  }
  if (state.phase === 'steal') {
    return actor.team && board.steal && actor.team === board.steal.team ? { ok: true } : { ok: false, reason: 'NOT_STEAL_TEAM' };
  }
  return { ok: false, reason: 'NOT_ANSWER_PHASE' };
}

/** @description Normalize a guess for exact text/alias comparison. */
function normGuess(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @description Rule an exact text/alias hit without spending an LLM call. Never
 *   rules a miss locally — leniency is what the LLM judge is for.
 */
function localJudge(state, guess) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.localJudge(state, guess);
  if (['faceoff', 'play', 'steal'].indexOf(state.phase) < 0) return null;
  const g = normGuess(guess);
  if (!g) return null;
  const idx = (state.board.answers || []).findIndex(
    (a) => normGuess(a.text) === g || (a.aliases || []).indexOf(g) >= 0
  );
  return idx >= 0 ? { matchIndex: idx, canonical: state.board.answers[idx].text, reason: 'exact match' } : null;
}

/** @description Prompt the host bot to judge one contestant guess as one json block. */
function judgePrompt(state, guess, ctx = {}) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.judgePrompt(state, guess);
  const answers = state.board.answers
    .map((answer, i) => `  [${i}] ${answer.text} (aliases: ${(answer.aliases || []).join(', ') || 'none'})`)
    .join('\n');
  return [
    `MODE: judge. Hidden survey answers for "${state.board.question}":`,
    answers,
    `Contestant guessed: "${String(guess || '').slice(0, 120)}"`,
    `Which single answer does it match? Judge by meaning — generously but honestly.`,
    `Reply with ONE json block only: {"matchIndex": <0-based index or -1>, "canonical": "<answer text or ''>", "reason": "<short>"}.`,
  ].join('\n');
}

/** @description Award the bank (times the round multiplier) and reveal the full board. */
function applyRoundWin(state, winnerTeam, now) {
  const board = state.board;
  const award = (board.bank || 0) * (board.multiplier || 1);
  const answers = board.answers.map((answer) => ({ ...answer, revealed: true }));
  const scores = { ...state.scores, [winnerTeam]: (state.scores[winnerTeam] || 0) + award };
  let next = { ...state, phase: 'round-win', scores, board: { ...board, answers, winner: winnerTeam } };
  next = buzzer.clear(next);
  next = director.cut(next, 'celebration', winnerTeam, now);
  return {
    ok: true, state: next,
    event: { kind: 'milestone', content: `Team ${winnerTeam} wins ${award} in round ${state.round}` },
    host: { mode: 'reveal', payload: { winner: winnerTeam, award } },
  };
}

/** @description First face-off answer: top answer wins control outright, else hand to the other team. */
function applyFaceoffFirst(state, judge, actor, now) {
  const board = state.board;
  const idx = Number(judge.matchIndex);
  const matched = idx >= 0 && idx < board.answers.length;
  let next = { ...board, faceoff: { ...board.faceoff, firstPoints: matched ? board.answers[idx].points : 0 } };
  if (matched) next = revealAt(next, idx, actor.team);
  if (matched && idx === topIndex(board.answers)) {
    let state2 = { ...state, phase: 'play', board: { ...next, control: actor.team, bank: sumRevealed(next.answers) } };
    state2 = director.cut(buzzer.clear(state2), 'board', actor.team, now);
    return { ok: true, state: state2, event: { kind: 'reveal', content: `Team ${actor.team} takes control` }, host: { mode: 'reveal', payload: { control: actor.team } } };
  }
  let state2 = { ...state, phase: 'faceoff', board: { ...next, faceoff: { ...next.faceoff, stage: 'second', awaitingTeam: otherTeam(actor.team) } } };
  state2 = director.cut(buzzer.open(buzzer.arm(state2, { prompt: 'Other team — buzz to answer!' }), now), 'buzzer-race', null, now);
  return {
    ok: true, state: state2, host: { mode: 'banter', payload: { faceoff: 'second' } },
    event: { kind: 'reveal', content: matched ? `${board.answers[idx].text} is on the board` : 'A miss on the face-off' },
  };
}

/** @description Second face-off answer: higher-scoring face-off answer earns control (ties go to first buzz). */
function applyFaceoffSecond(state, judge, actor, now) {
  const board = state.board;
  const idx = Number(judge.matchIndex);
  const matched = idx >= 0 && idx < board.answers.length && !board.answers[idx].revealed;
  let next = { ...board, faceoff: { ...board.faceoff, secondPoints: matched ? board.answers[idx].points : 0 } };
  if (matched) next = revealAt(next, idx, actor.team);
  const firstPoints = Number(next.faceoff.firstPoints) || 0;
  const secondPoints = Number(next.faceoff.secondPoints) || 0;
  const control = secondPoints > firstPoints ? actor.team : next.faceoff.firstTeam;
  let state2 = { ...state, phase: 'play', board: { ...next, control, bank: sumRevealed(next.answers) } };
  state2 = director.cut(buzzer.clear(state2), 'board', control, now);
  return { ok: true, state: state2, event: { kind: 'reveal', content: `Team ${control} takes control` }, host: { mode: 'reveal', payload: { control } } };
}

/** @description A control-team guess: reveal a new answer, or add a strike (three opens the steal). */
function applyPlayGuess(state, judge, actor, now) {
  const board = state.board;
  const idx = Number(judge.matchIndex);
  const isNew = idx >= 0 && idx < board.answers.length && !board.answers[idx].revealed;
  if (isNew) {
    let next = revealAt(board, idx, actor.team);
    next = { ...next, bank: sumRevealed(next.answers) };
    if (allRevealed(next.answers)) return applyRoundWin({ ...state, board: next }, next.control, now);
    const state2 = director.cut({ ...state, board: next }, 'board', next.control, now);
    return { ok: true, state: state2, event: { kind: 'reveal', content: `${board.answers[idx].text} — ${board.answers[idx].points}!` }, host: { mode: 'reveal', payload: { answer: board.answers[idx].text, points: board.answers[idx].points } } };
  }
  if (idx >= 0 && board.answers[idx] && board.answers[idx].revealed) {
    return { ok: true, state, host: { mode: 'banter', payload: { alreadyUp: true } } };
  }
  const strikes = (board.strikes || 0) + 1;
  if (strikes >= STRIKE_LIMIT) {
    const stealTeam = otherTeam(board.control);
    let state2 = { ...state, phase: 'steal', board: { ...board, strikes, steal: { team: stealTeam } } };
    state2 = director.cut(buzzer.clear(state2), 'team-huddle', stealTeam, now);
    return { ok: true, state: state2, event: { kind: 'strike', content: `Strike ${strikes} — steal opens for Team ${stealTeam}` }, host: { mode: 'steal', payload: { stealTeam } } };
  }
  const state2 = director.cut({ ...state, board: { ...board, strikes } }, 'podium-closeup', actor.seatId, now);
  return { ok: true, state: state2, event: { kind: 'strike', content: `Strike ${strikes}` }, host: { mode: 'strike', payload: { strikes } } };
}

/** @description The one steal guess: a fresh answer steals the bank, otherwise the control team keeps it. */
function applySteal(state, judge, actor, now) {
  const board = state.board;
  const idx = Number(judge.matchIndex);
  const stolen = idx >= 0 && idx < board.answers.length && !board.answers[idx].revealed;
  let next = board;
  if (stolen) { next = revealAt(board, idx, actor.team); next = { ...next, bank: sumRevealed(next.answers) }; }
  const winner = stolen ? board.steal.team : board.control;
  return applyRoundWin({ ...state, board: { ...next, stolen } }, winner, now);
}

/** @description Apply a judged guess to whichever answer phase the board is in. */
function applyJudgement(state, judge, actor = {}, now = Date.now(), ctx = {}) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.applyJudgement(state, judge, actor, now);
  const value = judge || {};
  // This show owns its judge shape — reject anything that is not a usable ruling.
  if (!Number.isFinite(Number(value.matchIndex))) return { ok: false, error: 'BAD_RULING' };
  switch (state.phase) {
    case 'faceoff': {
      const faceoff = state.board.faceoff || {};
      return faceoff.stage === 'second' ? applyFaceoffSecond(state, value, actor, now) : applyFaceoffFirst(state, value, actor, now);
    }
    case 'play': return applyPlayGuess(state, value, actor, now);
    case 'steal': return applySteal(state, value, actor, now);
    default: return { ok: false, error: 'NOT_ANSWER_PHASE' };
  }
}

// ── Clock: which window is open, and what a lapse means ─────────────────────
// The engine keeps time (lib/clock.js); the show declares the windows. Every one of
// these lapses routes back through an EXISTING applier, so a timeout can never leave
// the board somewhere a played beat could not.

const WINDOW_MS = { buzz: 20000, answer: 20000, play: 25000, interview: 45000 };

/** @description The timed window open right now, or null when nothing is on the clock. */
function windowFor(state) {
  const iv = state.interview;
  if (iv && iv.active && iv.status === 'asked') return { kind: 'interview', ms: WINDOW_MS.interview, seatId: iv.seatId, note: 'Answering the host' };
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.windowFor(state);
  const board = state.board || {};
  if (state.phase === 'faceoff') {
    const faceoff = board.faceoff || {};
    const buzzed = faceoff.stage === 'second' ? faceoff.secondSeat : faceoff.firstSeat;
    if (buzzed) return { kind: 'answer', ms: WINDOW_MS.answer, seatId: buzzed, note: 'Face-off answer' };
    if (state.buzz && state.buzz.open) return { kind: 'buzz', ms: WINDOW_MS.buzz, seatId: null, note: 'Buzz in' };
    return null;
  }
  if (state.phase === 'play') return { kind: 'answer', ms: WINDOW_MS.play, seatId: null, note: `Team ${board.control} answering` };
  if (state.phase === 'steal') return { kind: 'answer', ms: WINDOW_MS.answer, seatId: null, note: `Team ${board.steal && board.steal.team} stealing` };
  return null;
}

/** @description Build the actor a lapsed answer window should be charged to. */
function timeoutActor(state, timer, seats) {
  const board = state.board || {};
  if (timer.seatId) {
    const seat = (seats || []).find((s) => (s.seatId || s.seat_id) === timer.seatId);
    return { seatId: timer.seatId, team: seat ? seat.team : null, name: seat ? (seat.display_name || seat.name) : 'The podium' };
  }
  const team = state.phase === 'steal' ? (board.steal && board.steal.team) : board.control;
  return { seatId: null, team: team || null, name: team ? `Team ${team}` : 'The team' };
}

/** @description Nobody buzzed the face-off: hand the board over rather than stall the show. */
function timeoutFaceoffBuzz(state, now) {
  const board = state.board || {};
  const faceoff = board.faceoff || {};
  // Second face-off: the awaiting team let it go, so the first buzzer keeps control.
  // Opening face-off: nobody wanted it — the trailing team takes the board (ties to A).
  const control = faceoff.stage === 'second' && faceoff.firstTeam
    ? faceoff.firstTeam
    : ((state.scores.B || 0) < (state.scores.A || 0) ? 'B' : 'A');
  const next = { ...state, phase: 'play', board: { ...board, control, bank: sumRevealed(board.answers) } };
  return {
    ok: true, state: director.cut(buzzer.clear(next), 'board', control, now),
    event: { kind: 'milestone', content: `No buzz — Team ${control} takes the board` },
    host: { mode: 'banter', payload: { control, timedOut: true } },
  };
}

/** @description Apply a lapsed window: a dead buzzer hands over, a dead answer is a miss. */
function onTimeout(state, timer, now = Date.now(), ctx = {}) {
  if (!timer) return { ok: false, error: 'NO_TIMER' };
  if (String(timer.kind).indexOf('fm-') === 0) return fastMoney.onTimeout(state, timer, now);
  if (timer.kind === 'interview') {
    return { ok: true, state: interview.end(state), event: { kind: 'interview', content: 'The interview timed out' } };
  }
  if (timer.kind === 'buzz') return timeoutFaceoffBuzz(state, now);
  if (timer.kind === 'answer') {
    // A lapsed answer IS a miss — reuse the judged-miss path so strikes, the steal,
    // and the round-win all behave exactly as they do when a player answers wrong.
    const result = applyJudgement(state, { matchIndex: -1 }, timeoutActor(state, timer, ctx.seats), now);
    if (!result.ok) return result;
    return { ...result, event: { kind: 'strike', content: 'Out of time' } };
  }
  return { ok: false, error: 'UNKNOWN_WINDOW' };
}

// ── Host overrides: unstick a game without leaving the board inconsistent ────

/** @description Re-open the face-off buzzer after a bad race (host override). */
function overrideReopenBuzzer(state, now) {
  const board = state.board || {};
  const faceoff = board.faceoff || {};
  const stage = faceoff.stage === 'second' ? 'second' : 'first';
  const cleared = stage === 'second'
    ? { ...faceoff, secondSeat: null, secondTeam: null, secondPoints: null }
    : { ...faceoff, firstSeat: null, firstTeam: null, firstPoints: null };
  const reset = { ...state, phase: 'faceoff', board: { ...board, faceoff: cleared } };
  const opened = buzzer.open(buzzer.arm(reset, { prompt: 'Buzzer re-opened — go!' }), now);
  return { ok: true, state: director.cut(opened, 'buzzer-race', null, now), event: { kind: 'milestone', content: 'Host re-opened the buzzer' } };
}

/** @description Reveal one answer the host judges already earned (host override). */
function overrideForceReveal(state, action, now) {
  const board = state.board || {};
  const idx = Number(action.index);
  if (!Number.isFinite(idx) || !board.answers[idx]) return { ok: false, error: 'NO_SUCH_ANSWER' };
  if (board.answers[idx].revealed) return { ok: false, error: 'ALREADY_REVEALED' };
  let next = revealAt(board, idx, board.control);
  next = { ...next, bank: sumRevealed(next.answers) };
  if (allRevealed(next.answers) && board.control) return applyRoundWin({ ...state, board: next }, board.control, now);
  return {
    ok: true, state: director.cut({ ...state, board: next }, 'board', next.control, now),
    event: { kind: 'reveal', content: `Host revealed ${board.answers[idx].text}` },
  };
}

/** @description Show-specific host recovery actions. */
function override(state, action, ctx = {}, now = Date.now()) {
  const board = state.board || {};
  switch (action && action.type) {
    case 'reopenBuzzer':
      return overrideReopenBuzzer(state, now);
    case 'forceReveal':
      return overrideForceReveal(state, action, now);
    case 'clearStrike': {
      const strikes = Math.max(0, (board.strikes || 0) - 1);
      return { ok: true, state: { ...state, board: { ...board, strikes } }, event: { kind: 'milestone', content: 'Host cleared a strike' } };
    }
    case 'setControl': {
      if (!['A', 'B'].includes(action.team)) return { ok: false, error: 'BAD_TEAM' };
      const next = { ...state, phase: state.phase === 'faceoff' ? 'play' : state.phase, board: { ...board, control: action.team } };
      return { ok: true, state: director.cut(buzzer.clear(next), 'board', action.team, now), event: { kind: 'milestone', content: `Host gave the board to Team ${action.team}` } };
    }
    case 'skipRound': {
      if (!board.control) return { ok: false, error: 'NO_CONTROL_TEAM' };
      return applyRoundWin(state, board.control, now);
    }
    default:
      return { ok: false, error: 'UNKNOWN_OVERRIDE' };
  }
}

// ── NPC brain: what would this seat do right now? (engine half in lib/npc.js) ─
// Decisions are made against the board the server already holds — no LLM. A hit
// returns the show's own judge shape ({matchIndex}) so the act flows through
// applyJudgement exactly like a human's judged answer.

/** Plausibly-wrong guesses for an NPC miss — the strike path needs a spoken line. */
const NPC_MISSES = [
  'a rubber duck', 'my uncle Steve', 'cheese?', 'the moon', 'a bigger boat',
  'socks', 'karaoke', 'a nap', 'pizza rolls', 'good vibes',
];

/**
 * @description The move an NPC podium would make right now, or null.
 * @param {object} state - Current game state.
 * @param {object} actor - { seatId, team, name } for the NPC seat.
 * @param {object} ctx - { profile, roll } from the engine (deterministic).
 * @returns {{action:object}|{guess:string, judgement:object}|null}
 */
function npcMove(state, actor, ctx = {}) {
  if (fastMoney.isFmPhase(state.phase)) return fastMoney.npcMove(state, actor, ctx);
  const prof = ctx.profile || {};
  if (state.phase === 'faceoff' && state.buzz && state.buzz.open) {
    const faceoff = state.board.faceoff || {};
    if (faceoff.stage === 'second' && faceoff.awaitingTeam && actor.team !== faceoff.awaitingTeam) return null;
    // A shy roll buzzes LATE, never NEVER — a refusal is a frozen roll, and a
    // whole stage of frozen-shy bots is dead air until the clock bails it out.
    const late = ctx.roll('ring') >= (prof.ring || 0.5);
    return { action: { type: 'buzz', serial: state.buzz.serial }, late };
  }
  if (!canAnswer(state, actor).ok) return null;
  const answers = state.board.answers || [];
  const open = answers.map((answer, i) => ({ answer, i })).filter((x) => !x.answer.revealed);
  if (!open.length) return null;
  if (ctx.roll('hit') < (prof.hit || 0.5)) {
    // Answers are stored ranked, so open[0] is the best remaining — a sharp NPC
    // takes it; others land somewhere on the board like a real cousin would.
    const pick = prof.top ? open[0] : open[Math.floor(ctx.roll('pick') * open.length)];
    return { guess: pick.answer.text, judgement: { matchIndex: pick.i, canonical: pick.answer.text, reason: 'npc' } };
  }
  const miss = NPC_MISSES[Math.floor(ctx.roll('miss') * NPC_MISSES.length)];
  return { guess: miss, judgement: { matchIndex: -1, canonical: '', reason: 'npc miss' } };
}

/** @description One-line board context reused across spoken host prompts. */
function boardSummary(state) {
  const board = state.board;
  const revealed = board.answers.filter((answer) => answer.revealed).map((answer) => `${answer.text} (${answer.points})`).join(', ') || 'none yet';
  return `Question: "${board.question}". Revealed: ${revealed}. Strikes: ${board.strikes}. Score A:${state.scores.A} B:${state.scores.B}.`;
}

/** @description Build the prompt for a spoken host line in the requested mode. */
function spokenPrompt(mode, state, payload = {}, ctx = {}) {
  const context = boardSummary(state);
  const who = payload.name ? ` The contestant is ${payload.name}.` : '';
  const map = {
    intro: `MODE: intro. Welcome the room to the show, name the two teams if given, and tease the first question.${who}`,
    banter: `MODE: banter. One quick host line to keep the energy up right now.${who} ${context}`,
    reveal: `MODE: reveal. React warmly to what just landed on the board.${who} ${context}`,
    strike: `MODE: strike. Sell the miss kindly — keep them looking good.${who} ${context}`,
    steal: `MODE: steal. Raise the stakes for the stealing team.${who} ${context}`,
    interview: payload.react
      ? `MODE: interview. React warmly, in one or two sentences, to what ${payload.name || 'the contestant'} just said: "${String(payload.answer || '').slice(0, 200)}".`
      : `MODE: interview. Ask ${payload.name || 'the contestant'} one warm, genuine question they can actually answer.`,
    recap: `MODE: recap. "Previously tonight" — where the score stands and what is at stake now. ${context}`,
    outro: `MODE: outro. Crown the winners and send everyone home happy. ${context}`,
  };
  return map[mode] || map.banter;
}

/** @description Current standings for the surface. */
function scoreboard(state, seats = []) {
  const players = (team) => seats.filter((seat) => seat.team === team && seat.role !== 'host').map((seat) => seat.display_name).filter(Boolean);
  return [
    { name: 'Team A', team: 'A', score: state.scores.A || 0, players: players('A') },
    { name: 'Team B', team: 'B', score: state.scores.B || 0, players: players('B') },
  ];
}

module.exports = {
  id: ID, title: 'Family Feud', tagline: 'Name the top survey answers before three strikes.',
  teams: true, minPlayers: 2, maxPlayers: 10,
  initialState, reduce, canAnswer, canGenerate, generatePrompt, ingestGenerated, judgePrompt,
  localJudge, applyJudgement, spokenPrompt, scoreboard, isGameOver, windowFor, onTimeout, override,
  npcMove,
};
