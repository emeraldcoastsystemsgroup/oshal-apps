#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-141 D7 automated live acceptance, for AFTER career-hunter 1.26.0 is installed: the story review
 *                     |                             | walked over the REAL routes as the operator automation identity (OSHAL_VERIFY_OPERATOR_PAT, read BY
 *                     |                             | NAME and never printed). It follows the Strengthen card (GET /stories, then POST /stories/answer for
 *                     |                             | the role the review asks about, until none is left) with answers carrying this run's Test Lab mark;
 *                     |                             | requires readiness to report "N of N roles have a story" and the master resume document to show
 *                     |                             | each marked story under the bullet it supports; while the stories exist, generates one tailored
 *                     |                             | packet on an untouched posting through POST /jobs/:id/generate (the Career bot rail) and requires
 *                     |                             | its application.json to cite at least one story; then removes the packet (DELETE /jobs/:id/packet)
 *                     |                             | and exactly the marked stories (DELETE /stories/test-lab/:tag) and reads both back. An incomplete
 *                     |                             | cleanup is a failure. It prints one RESULT line. tests/stories-live-acceptance.test.mjs drives it,
 *                     |                             | unchanged, against a loopback api that keeps the routes' contracts.
 *
 * Usage (from the host or inside the api container, with a base URL):
 *   OSHAL_VERIFY_BASE_URL=http://localhost:35457 node career-hunter/tests/stories-live-acceptance.mjs
 * The PAT comes from OSHAL_VERIFY_OPERATOR_PAT, or from the file OSHAL_VERIFY_ENV_FILE names (its
 * OSHAL_VERIFY_OPERATOR_PAT= line), and is sent only as a bearer header.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The Test Lab case id this proof reports under. */
export const CASE_ID = 'career-hunter:stories-live-acceptance';
const PAT_ENV = 'OSHAL_VERIFY_OPERATOR_PAT';
const API = '/api/career-hunter';
/** The status a posting holds before anyone works it (the column default): the only postings the packet step may borrow. */
const UNWORKED = 'new';

/**
 * @description The mark a run's answers start with; the engine's stories.test_lab_mark builds the same.
 * @param {string} tag The run's tag. @returns {string} The mark.
 */
export const markFor = (tag) => `[oshal-test-lab:${tag}]`;

/**
 * @description The operator PAT, BY NAME: the environment first, then the env file's line. Never printed.
 * @param {NodeJS.ProcessEnv} env The environment. @returns {string} The token, or ''.
 */
export function readOperatorPat(env) {
  const direct = String(env[PAT_ENV] || '').trim();
  if (direct || !env.OSHAL_VERIFY_ENV_FILE) return direct;
  let text = '';
  try {
    text = fs.readFileSync(env.OSHAL_VERIFY_ENV_FILE, 'utf8');
  } catch (error) {
    process.stderr.write(`OSHAL_VERIFY_ENV_FILE is not readable (${error && error.code ? error.code : 'error'}); no token taken from it\n`);
    return '';
  }
  const line = text.split(/\n/).find((row) => new RegExp(`^\\s*${PAT_ENV}=`).test(row));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).replace(/\r$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * @description JSON calls as the PAT's owner against one base URL.
 * @param {string} base The api origin. @param {string} token The PAT. @param {typeof fetch} fetchImpl The fetch to use.
 * @returns {(method: string, route: string, body?: unknown) => Promise<{status: number, json: any}>} The caller.
 */
export function bearerApi(base, token, fetchImpl = fetch) {
  return async (method, route, body) => {
    const response = await fetchImpl(`${base}${route}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(300_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (error) {
      json = { unparsed: text.slice(0, 200), parseError: error instanceof Error ? error.message : String(error) };
    }
    return { status: response.status, json };
  };
}

/** @description Fail the proof with what was seen. */
function expect(ok, detail, evidence) {
  if (!ok) { const error = new Error(detail); error.evidence = evidence; throw error; }
}

/** @description A precondition that is not met: nothing has been written yet, so the verdict is unavailable. */
function unavailable(detail) {
  const error = new Error(detail); error.unavailable = true; throw error;
}

/** @description The stories a role holds that carry this run's mark. */
const markedOn = (role, mark) => (role.stories || []).filter((story) => String(story.answer || '').startsWith(mark));

/**
 * @description The answer this run gives for one role: the role's own lead bullet in the first person,
 * so the engine attaches the story to that bullet, prefixed with the run's mark.
 * @param {object} role One role from GET /stories. @param {string} mark The run's mark. @returns {string} The answer.
 */
export function answerFor(role, mark) {
  const bullet = String((role.bullets || [])[0] || '').trim().replace(/\.$/, '');
  const claim = bullet || `the work I did at ${role.label}`;
  return `${mark} ${claim}. At ${role.label} I did this myself: I scoped it, built it and measured the result that line states.`;
}

/** @description Read-only preconditions: an indexed resume, auto-submit off, one untouched posting. */
async function preflight(api, evidence) {
  const state = await api('GET', `${API}/stories`);
  expect(state.status === 200, `GET /stories answered ${state.status}`, {});
  if (!state.json.total) unavailable('the automation identity has no indexed resume (GET /stories reports 0 roles); nothing was written');
  evidence.roles = state.json.total;
  evidence.withStoryBefore = state.json.withStory;
  const automation = await api('GET', `${API}/automation/state`);
  expect(automation.status === 200, `GET /automation/state answered ${automation.status}`, {});
  if (automation.json.autoSubmit === true) unavailable('Career auto-submit is on for this identity, so a generated packet could be submitted; nothing was written');
  const board = await api('GET', `${API}/jobs?per=60`);
  expect(board.status === 200, `GET /jobs answered ${board.status}`, {});
  const candidate = (board.json.jobs || []).find((job) => job.status === UNWORKED && !job.has_resume && !job.has_cover && !job.generated_at);
  if (!candidate) unavailable('no untouched posting on the first board page to generate a packet for; nothing was written');
  const detail = await api('GET', `${API}/jobs/${candidate.id}`);
  expect(detail.status === 200, `GET /jobs/${candidate.id} answered ${detail.status}`, {});
  evidence.postingId = candidate.id;
  return { postingId: candidate.id, before: jobState(detail.json.job) };
}

/** @description The per-user facts of one posting that a packet changes. */
function jobState(job) {
  return { status: job.status ?? null, generatedAt: job.generated_at ?? null, hasResume: Number(job.has_resume || 0), hasCover: Number(job.has_cover || 0) };
}

/** @description Walk the review as the Strengthen card does, one marked answer per role it asks about. */
async function answerLikeTheCard(api, mark, evidence, created) {
  for (let turn = 0; turn <= evidence.roles; turn += 1) {
    const state = await api('GET', `${API}/stories`);
    expect(state.status === 200, `GET /stories answered ${state.status} on turn ${turn}`, {});
    const next = state.json.next || (turn === 0 ? fewestStories(state.json.roles) : null);
    if (!next) return state.json;
    const role = state.json.roles[next.index];
    const saved = await api('POST', `${API}/stories/answer`, { role: next.index, response: answerFor(role, mark) });
    expect(saved.status === 201 && saved.json.ok === true, `POST /stories/answer for role ${next.index} answered ${saved.status} ${saved.json.error || ''}`, {});
    created.push(next.index);
  }
  expect(false, `the review still asked for a story after ${evidence.roles + 1} answers`, {});
  return null;
}

/** @description Every role already had a story: answer the one with the fewest, so the round trip is still proven. */
function fewestStories(roles) {
  const sorted = [...roles].sort((a, b) => (a.stories || []).length - (b.stories || []).length);
  return sorted.length ? { index: sorted[0].index } : null;
}

/** @description Readiness counts every role, and the master document shows each marked story under its bullet. */
async function checkReadinessAndMaster(api, state, mark, evidence) {
  const ready = await api('GET', `${API}/readiness`);
  const stories = ready.json.stories || {};
  const expected = `${state.total} of ${state.total} roles have a story.`;
  expect(ready.status === 200 && stories.ready === true && stories.detail === expected, `readiness reported ${JSON.stringify(stories)} instead of "${expected}"`, {});
  evidence.readiness = stories.detail;
  const master = await api('GET', `${API}/resume/doc?id=master`);
  expect(master.status === 200, `GET /resume/doc?id=master answered ${master.status}`, {});
  const experience = master.json.resume?.experience || [];
  evidence.markedStories = [];
  for (const role of state.roles) {
    for (const story of markedOn(role, mark)) {
      const shown = (experience[role.index]?.stories || []).find((s) => s.story === story.story && s.bullet === story.bullet);
      const underBullet = !role.bullets.length || (Boolean(story.bullet) && (experience[role.index]?.bullets || []).includes(story.bullet));
      expect(shown && underBullet, `the master document does not show role ${role.index}'s marked story under its bullet`, {});
      evidence.markedStories.push({ role: role.index, weak: story.weak === true, source: story.source });
    }
  }
  expect(evidence.markedStories.length > 0, 'no marked story reached the profile', {});
}

/** @description The newest tailor run this proof started, found by id against the runs listed before it. */
async function tailorRun(api, ctx) {
  const runs = await api('GET', `${API}/runs`);
  return (runs.json.runs || []).find((r) => r.verb === 'tailor' && !ctx.runsBefore.has(r.runId)) || null;
}

/**
 * @description Wait (bounded) until the proof's tailor run has settled; cancel it when it will not.
 * @returns {Promise<object|null>} The settled run, or null when none was ever registered.
 */
async function settleTailor(api, ctx, options, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let run = await tailorRun(api, ctx);
  while (Date.now() < deadline && (!run || run.state === 'running')) {
    await options.sleep(options.pollMs);
    run = await tailorRun(api, ctx);
  }
  if (run && run.state === 'running') {
    await api('POST', `${API}/run/${run.runId}/cancel`, {});
    for (let i = 0; i < 12 && run && run.state === 'running'; i += 1) {
      await options.sleep(options.pollMs);
      run = await tailorRun(api, ctx);
    }
  }
  return run;
}

/** @description Start one packet on the Career bot rail and wait for its engine run to settle. */
async function generatePacket(api, ctx, options) {
  const before = await api('GET', `${API}/runs`);
  expect(before.status === 200, `GET /runs answered ${before.status}`, {});
  ctx.runsBefore = new Set((before.json.runs || []).map((r) => r.runId));
  const started = await api('POST', `${API}/jobs/${ctx.postingId}/generate`, {});
  expect(started.status === 202, `POST /jobs/${ctx.postingId}/generate answered ${started.status} ${started.json.error || ''}`, {});
  ctx.evidence.packetStarted = true;
  const run = await settleTailor(api, ctx, options, options.packetTimeoutMs);
  expect(run, 'no tailor run was registered for the packet', {});
  ctx.evidence.packetRun = { state: run.state, reason: run.reason, railCalls: run.railCalls };
  expect(run.state === 'succeeded', `the tailor run ended ${run.state} (${run.reason})`, {});
}

/** @description The packet's application.json cites at least one story. */
async function checkCitation(api, ctx) {
  const doc = await api('GET', `${API}/resume/doc?id=${ctx.postingId}`);
  expect(doc.status === 200, `GET /resume/doc?id=${ctx.postingId} answered ${doc.status}`, {});
  const cited = doc.json.meta?.storiesCited;
  expect(Array.isArray(cited) && cited.length > 0, 'the generated packet\'s application.json carries no stories_cited', {});
  ctx.evidence.storiesCited = cited.length;
  ctx.evidence.citesMarkedStory = cited.some((c) => ctx.markedTexts.includes(c.story));
}

/**
 * @description Remove what the run created and read it back. The packet waits for its run to settle first.
 * @returns {Promise<string>} 'deleted', or 'INCOMPLETE: ...' naming every part that did not come back.
 */
async function cleanUp(api, ctx, options) {
  const problems = [];
  if (ctx.postingId && ctx.evidence.packetStarted) {
    const run = await settleTailor(api, ctx, options, options.packetTimeoutMs);
    if (run && run.state === 'running') problems.push(`tailor run ${run.runId} would not stop`);
    const removed = await api('DELETE', `${API}/jobs/${ctx.postingId}/packet`);
    if (![200, 404].includes(removed.status)) problems.push(`packet delete ${removed.status}`);
    const doc = await api('GET', `${API}/resume/doc?id=${ctx.postingId}`);
    const job = await api('GET', `${API}/jobs/${ctx.postingId}`);
    if (doc.status !== 404) problems.push(`packet read-back ${doc.status}`);
    if (JSON.stringify(jobState(job.json.job || {})) !== JSON.stringify(ctx.before)) problems.push(`posting ${ctx.postingId} is ${JSON.stringify(jobState(job.json.job || {}))}, was ${JSON.stringify(ctx.before)}`);
  }
  if (ctx.created.length) {
    const removed = await api('DELETE', `${API}/stories/test-lab/${ctx.tag}`);
    if (removed.status !== 200 || removed.json.removed !== ctx.created.length) problems.push(`story delete ${removed.status} removed ${removed.json.removed}, created ${ctx.created.length}`);
  }
  const state = await api('GET', `${API}/stories`);
  const left = (state.json.roles || []).reduce((n, role) => n + markedOn(role, markFor(ctx.tag)).length, 0);
  if (state.status !== 200 || left) problems.push(`stories read-back ${state.status} with ${left} marked left`);
  if (state.status === 200 && ctx.evidence.withStoryBefore !== undefined && state.json.withStory !== ctx.evidence.withStoryBefore) problems.push(`withStory ${state.json.withStory}, was ${ctx.evidence.withStoryBefore}`);
  return problems.length ? `INCOMPLETE: ${problems.join('; ')}` : 'deleted';
}

/**
 * @description The walk itself, against a live or loopback api. Always removes what it created.
 * @param {{api: Function, tag?: string, pollMs?: number, packetTimeoutMs?: number, sleep?: Function}} opts
 * @returns {Promise<{caseId: string, state: 'pass'|'fail'|'unavailable', detail: string, evidence: object}>} The verdict.
 */
export async function runStoriesAcceptance({ api, tag = `accept-${randomUUID().slice(0, 8)}`, ...rest }) {
  const options = { pollMs: 10_000, packetTimeoutMs: 25 * 60_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), ...rest };
  const evidence = { tag };
  const ctx = { tag, evidence, created: [], postingId: null, before: null, runsBefore: new Set(), markedTexts: [] };
  let verdict;
  try {
    await walk(api, ctx, options);
    verdict = { caseId: CASE_ID, state: 'pass', detail: 'answered the review to N of N with marked stories, saw them under their bullets, generated a packet that cites a story, and removed the packet and the marked stories', evidence };
  } catch (error) {
    Object.assign(evidence, error && error.evidence);
    verdict = { caseId: CASE_ID, state: error && error.unavailable ? 'unavailable' : 'fail', detail: error instanceof Error ? error.message : String(error), evidence };
  }
  if (!ctx.postingId) return verdict;
  try {
    evidence.cleanup = await cleanUp(api, ctx, options);
  } catch (error) {
    evidence.cleanup = `INCOMPLETE: the cleanup crashed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (evidence.cleanup === 'deleted') return verdict;
  return { ...verdict, state: 'fail', detail: verdict.state === 'pass' ? `cleanup ${evidence.cleanup}` : `${verdict.detail}; cleanup ${evidence.cleanup}` };
}

/** @description The steps between the preflight and the cleanup. */
async function walk(api, ctx, options) {
  const mark = markFor(ctx.tag);
  Object.assign(ctx, await preflight(api, ctx.evidence));
  const state = await answerLikeTheCard(api, mark, ctx.evidence, ctx.created);
  ctx.evidence.answered = ctx.created.length;
  ctx.markedTexts = state.roles.flatMap((role) => markedOn(role, mark).map((s) => s.story));
  await checkReadinessAndMaster(api, state, mark, ctx.evidence);
  await generatePacket(api, ctx, options);
  await checkCitation(api, ctx);
}

/** @description Run against a live api and print one RESULT line; an incomplete cleanup is a failure. @returns {Promise<number>} Exit code. */
async function main() {
  const token = readOperatorPat(process.env);
  const base = (process.env.OSHAL_VERIFY_BASE_URL || `http://127.0.0.1:${process.env.PORT || '5000'}`).replace(/\/+$/, '');
  if (!token) {
    process.stdout.write(`RESULT ${JSON.stringify({ caseId: CASE_ID, state: 'unavailable', detail: `${PAT_ENV} is neither exported nor in OSHAL_VERIFY_ENV_FILE; nothing was written`, evidence: {} })}\n`);
    return 2;
  }
  const verdict = await runStoriesAcceptance({ api: bearerApi(base, token) });
  process.stdout.write(`RESULT ${JSON.stringify(verdict)}\n`);
  return verdict.state === 'pass' ? 0 : verdict.state === 'unavailable' ? 2 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stdout.write(`RESULT ${JSON.stringify({ caseId: CASE_ID, state: 'fail', detail: `the proof crashed: ${error instanceof Error ? error.message : String(error)}`, evidence: {} })}\n`);
    process.exitCode = 1;
  });
}
