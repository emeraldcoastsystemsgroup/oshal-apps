/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0 (T76): the instruction writer's job. Each tick asks the kernel for at most one discovered program version (application_profiles.claim), has the package's own tool-free bot write the instruction text once, checks the text, and publishes it (application_profiles.publish) or reports why it could not be used (application_profiles.fail). One request, one bot turn and no second try in a tick, so a tick fits the kernel's 60-second package call. A refused claim is answered as an error with the kernel's words. An answer that fails the check is reported as it is; it is never repaired or padded.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0, before any delivery: the package carries no authorization catalog (the native kernel gives an application's service no named role, so a catalog refused the job's activation), so the route factory no longer needs ctx.authorization and registers no resource adapter. The mount stays service-only, and the kernel alone decides who may claim, publish and report.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0, before any delivery: the answer is checked with the request's bridge and program as well, so a declared verb the bridge does not list for the program is reported as invalid-output without a publication attempt.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: the answer is also held to the words measured for its program on its platform and bridge (pack.acceptanceProblem), so a text that lacks a required word or holds a forbidden one is reported as invalid-output without a publication attempt. A published text is never written again, so it is held to them before it is offered.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1, Lane A3's blue proof: the second run's refusal was recorded nowhere and the first run's bot turn outlived the kernel's 60-second package call, so nothing was reported. A failure report now carries one line saying why (detail: the check's words, the kernel's refusal of a publication, the bot rail's refusal), which the kernel keeps on the row and shows the computer's owner; the writer gives up on its bot at BOT_DEADLINE_MS (48 s) and reports timeout itself; a kernel that does not take detail yet ("a failure is exactly id, claim and reason") gets the same report without it.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.1.2: when the package's own check refuses the bot's answer, the bot is asked once more in the same run with the refusal's own words (pack.retryText), only when the first turn used at most a third of the writer's deadline, so two turns fit the kernel's 60-second package call (production's turns took 11.0 to 12.2 s; blue's Gemini turns about 60 s, so blue is asked once). A bot rail refusal and a publication the kernel refuses are not asked about again.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pack = require('../lib/instruction-pack.js');

/** The package's own writer bot, by its declared name. */
export const WRITER = 'instruction-writer';
/** The most output one writing turn may produce. */
export const MAX_OUTPUT_TOKENS = 2000;
const CLAIM = 'application_profiles.claim';
const PUBLISH = 'application_profiles.publish';
const FAIL = 'application_profiles.fail';
const MAX_WORDS = 500;
/** How long the writer waits for its bot: the kernel ends a package call at 60 s, and the report must fit before it. */
export const BOT_DEADLINE_MS = 48000;
/** How a kernel without the detail field refuses one. */
const NO_DETAIL = /exactly id, claim and reason/;

/**
 * @description An error answer of the tick.
 * @param {number} status The HTTP status. @param {string} error A stable code. @param {string} message What happened, in words.
 * @returns {{status: number, body: {error: string, message: string}}} The answer.
 */
function refusal(status, error, message) {
  return { status, body: { error, message: String(message).slice(0, MAX_WORDS) } };
}

/**
 * @description An error answer that carries the kernel's own words. A capability that is not linked and a refusal
 *   answer 403, something unavailable 503, anything else 502.
 * @param {string} error A stable code for the step that was refused. @param {unknown} cause What the kernel rejected with.
 * @returns {{status: number, body: {error: string, message: string}}} The answer.
 */
function kernelRefusal(error, cause) {
  const words = String(cause && cause.message ? cause.message : cause);
  if (cause && cause.code === 'instruction_request_invalid') return refusal(502, 'request_unusable', words);
  if (/^refused:/.test(words) || /is not linked for this package/.test(words)) return refusal(403, error, words);
  if (/^unavailable:/.test(words)) return refusal(503, error, words);
  return refusal(502, error, words);
}

/**
 * @description Report that a claimed version's text was not written, with one line saying why. A kernel that does not
 *   take the line yet gets the report without it; any other refusal of the report reaches the caller.
 * @param {object} ctx The package context. @param {object} request The claimed request.
 * @param {string} reason One of the kernel's reasons. @param {unknown} [words] Why, as an Error or a string.
 * @returns {Promise<string>} 'failed'.
 */
async function reportFailure(ctx, request, reason, words) {
  const report = { id: request.id, claim: request.claim, reason };
  const detail = pack.detailOf(words);
  if (detail === null) {
    await ctx.intent(FAIL, report);
    return 'failed';
  }
  try {
    await ctx.intent(FAIL, { ...report, detail });
  } catch (refused) {
    if (!NO_DETAIL.test(String(refused && refused.message ? refused.message : refused))) throw refused;
    await ctx.intent(FAIL, report);
  }
  return 'failed';
}

/**
 * @description The bot's answer, or a refusal once `ms` have passed. The turn itself is left to end on its own.
 * @param {Promise<object>} turn The bot turn. @param {number} ms The deadline. @returns {Promise<object>} The answer.
 */
function withinDeadline(turn, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the bot did not answer within the writer's ${ms / 1000} s deadline`)), ms);
  });
  return Promise.race([turn, late]).finally(() => clearTimeout(timer));
}

/**
 * @description Offer checked text for publication. The kernel's own check decides: when it refuses this text, the
 *   text is reported as unusable; when the claim itself is no longer good that report is refused too, and the
 *   kernel's first words reach the caller.
 * @param {object} ctx The package context. @param {object} request The claimed request. @param {string} body The checked text.
 * @returns {Promise<string>} 'published' or 'failed'.
 */
async function publish(ctx, request, body) {
  try {
    await ctx.intent(PUBLISH, { id: request.id, claim: request.claim, body });
    return 'published';
  } catch (refused) {
    try {
      return await reportFailure(ctx, request, 'invalid-output', refused);
    } catch {
      throw refused;
    }
  }
}

/**
 * @description One bot turn within `ms`: the answer's text, or the error that ended the turn.
 * @param {object} ctx The package context. @param {string} text The request. @param {number} ms What is left of the deadline.
 * @returns {Promise<{body?: string, error?: unknown}>} The text or the error.
 */
async function botTurn(ctx, text, ms) {
  try {
    const answer = await withinDeadline(ctx.executeBot(WRITER, { text, max_output_tokens: MAX_OUTPUT_TOKENS }), ms);
    return { body: pack.bodyOf(answer && answer.response) };
  } catch (error) {
    return { error };
  }
}

/**
 * @description What the package's own checks say about a text: the kernel's rules, the bridge's verbs, the measured words.
 * @param {string} body The text. @param {object} request The claimed request. @returns {string|null} The refusal, or null.
 */
function problemOf(body, request) {
  return pack.checkBody(body, request.contract, request.bridge, request.program) || pack.acceptanceProblem(body, request);
}

/**
 * @description Write one claimed program version: a bot turn and the check, once more with the check's words when the
 *   first turn was quick enough for two to fit the call, then publication or a failure report.
 * @param {object} ctx The package context. @param {object} request One request of the kernel's claim answer.
 * @param {{deadlineMs: number, now: function(): number}} timing The bot deadline and the clock.
 * @returns {Promise<string>} 'published' or 'failed'. @throws {Error} When the request cannot be used or the kernel refuses the report.
 */
async function writeOne(ctx, request, timing) {
  const held = request && typeof request.id === 'string' && request.id && typeof request.claim === 'string' && request.claim;
  if (!held) throw Object.assign(new Error('The claimed request carries no id and claim.'), { code: 'instruction_request_invalid' });
  const text = pack.requestText(request);
  const started = timing.now();
  let turn = await botTurn(ctx, text, timing.deadlineMs);
  if (turn.error) return reportFailure(ctx, request, pack.failureReason(turn.error), turn.error);
  let problem = problemOf(turn.body, request);
  const used = timing.now() - started;
  const again = problem !== null && used <= timing.deadlineMs / 3 ? pack.retryText(text, problem) : null;
  if (again) {
    turn = await botTurn(ctx, again, timing.deadlineMs - used);
    if (turn.error) return reportFailure(ctx, request, pack.failureReason(turn.error), turn.error);
    problem = problemOf(turn.body, request);
  }
  if (problem !== null) return reportFailure(ctx, request, 'invalid-output', problem);
  return publish(ctx, request, turn.body);
}

/**
 * @description One tick of the job write-instructions (the manifest's named handler). It never throws: every
 *   outcome is an answer.
 * @param {object} ctx The package context (ctx.intent and ctx.executeBot are the kernel's rails).
 * @param {{botDeadlineMs?: number, now?: function(): number}} [options] The bot deadline (BOT_DEADLINE_MS unless a test
 *   names a shorter one) and the clock (Date.now unless a test names its own).
 * @returns {Promise<{status: number, body: object}>} 200 with the counts { claimed, published, failed } when the tick
 *   ran, also when there was nothing to claim; an error status with the kernel's words when a step was refused.
 */
export async function runInstructionTick(ctx, options = {}) {
  const deadlineMs = Number.isInteger(options.botDeadlineMs) && options.botDeadlineMs > 0 ? options.botDeadlineMs : BOT_DEADLINE_MS;
  const timing = { deadlineMs, now: typeof options.now === 'function' ? options.now : Date.now };
  if (!ctx || typeof ctx.intent !== 'function' || typeof ctx.executeBot !== 'function') {
    return refusal(503, 'writer_unavailable', 'This installation gives this application no intent rail or no bot rail.');
  }
  let claimed;
  try {
    claimed = await ctx.intent(CLAIM, {});
  } catch (error) {
    return kernelRefusal('claim_refused', error);
  }
  const requests = claimed && Array.isArray(claimed.requests) ? claimed.requests : null;
  if (!requests) return refusal(502, 'claim_unreadable', 'The kernel answered the claim without a list of requests.');
  const counts = { claimed: requests.length, published: 0, failed: 0 };
  if (requests.length === 0) return { status: 200, body: counts };
  try {
    // One request a tick: the kernel hands out at most one, and a second bot turn would not fit the call.
    counts[await writeOne(ctx, requests[0], timing)] += 1;
  } catch (error) {
    return kernelRefusal('report_refused', error);
  }
  return { status: 200, body: counts };
}

/**
 * @description The routes of the instruction writer: POST /write runs one tick and nothing else is served. The
 *   mount is service-only (the manifest's auth: service), and the kernel decides at each intent whether the caller
 *   is this package's own activated service inside a scheduled run; the route holds no admission rule of its own.
 * @param {object} ctx The package context (ctx.intent and ctx.executeBot are the kernel's rails).
 * @returns {object} The router.
 */
export function createProgramInstructionsRoutes(ctx) {
  const { Router } = require('express');
  const router = Router();
  router.post('/write', (_req, res, next) => {
    runInstructionTick(ctx).then((outcome) => res.status(outcome.status).json(outcome.body), next);
  });
  return router;
}
