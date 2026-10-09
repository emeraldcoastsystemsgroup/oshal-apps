#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The dated live acceptance of the scheduled rebaseline, for AFTER venture-plan 1.5.0 is installed (its catalog adopted, the member role granted to both identities below). It walks the REAL routes and the REAL hourly schedule as two callers whose tokens are read BY NAME and never printed: the operator automation identity (OSHAL_VERIFY_OPERATOR_PAT, a swarm administrator) owns the opted-in ventures, and a second caller (OSHAL_VERIFY_SECOND_PAT) owns a disabled and a dry-run venture. It requires the system activation of rebaseline-policy-tick (performing it only with --activate) and the operator's consent to paid calls (--allow-paid), seeds tagged synthetic ventures and policies, waits for two hourly ticks on one UTC date, and judges the backlog's done-when from the run rows (slot, trigger, integer-micro cost evidence, phase outcomes) and the second caller's measured spend: disabled and dry-run produce no run and no spend, the opted-in venture gets exactly one run per UTC slot, a venture created after the first tick proves the second tick ran, a 1 micro-USD cap stops every later call after the first charge overshoots it, and neither owner can read the other's ventures or runs. Every clause is judged and reported on its own, so one dated run states each verdict. It then deletes exactly the ventures it created and reads the deletion back; an incomplete cleanup is a failure. It leaves the activation in place (activation is the intended state) and prints one RESULT line. tests/rebaseline-live-acceptance.test.js drives it, unchanged, against a loopback api and scheduler double.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The second owner's spend is read again over the baseline window plus every started hour since the baseline was read. Two readings of the same rolling 6-hour window taken one to two and a half hours apart could lose an old charge out of the window while a new one landed, and the no-spend check would pass; the wider second window starts no later than the baseline window did, so a charge the baseline counted cannot age out of it.
 *
 * Usage (from a host that reaches the box; no deploy is needed, it drives the installed package):
 *   OSHAL_VERIFY_BASE_URL=http://127.0.0.1:35457 node venture-plan/tests/rebaseline-live-acceptance.mjs --allow-paid [--activate]
 * Tokens come from OSHAL_VERIFY_OPERATOR_PAT / OSHAL_VERIFY_SECOND_PAT, or from the file OSHAL_VERIFY_ENV_FILE
 * names (their NAME= lines), and are sent only as bearer headers. Exit: 0 pass, 1 fail, 2 not runnable.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The Test Lab case id this proof reports under. */
export const CASE_ID = 'venture-plan:rebaseline-live-acceptance';
const API = '/api/venture';
const SERVICES = '/api/swarm/apps/venture-plan/services';
const SERVICE_ID = 'rebaseline-policy-tick';
const OPERATOR_PAT = 'OSHAL_VERIFY_OPERATOR_PAT';
const SECOND_PAT = 'OSHAL_VERIFY_SECOND_PAT';
/** The per-run authorization ceiling of the opted-in venture: 0.25 USD. */
export const PAID_CAP_MICROS = 250_000;
/** A cap the first measured charge always crosses, so the gate must stop the next call. */
export const TINY_CAP_MICROS = 1;
/** Two hourly ticks must land on one UTC date, so the walk does not start later than this hour. */
export const LATEST_START_HOUR_UTC = 20;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TICK_MINUTE = 7;
/** The baseline window of the second owner's spend reading, in whole hours. */
const SPEND_WINDOW_HOURS = 6;

/**
 * @description The mark every venture this run creates carries in its name and idea.
 * @param {string} tag The run's tag. @returns {string} The mark.
 */
export const markFor = (tag) => `[oshal-test-lab:${tag}]`;

/**
 * @description A token BY NAME: the environment first, then the env file's NAME= line. Never printed.
 * @param {NodeJS.ProcessEnv} env The environment. @param {string} name The variable name. @returns {string} The token, or ''.
 */
export function readNamedToken(env, name) {
  const direct = String(env[name] || '').trim();
  if (direct || !env.OSHAL_VERIFY_ENV_FILE) return direct;
  let text = '';
  try {
    text = fs.readFileSync(env.OSHAL_VERIFY_ENV_FILE, 'utf8');
  } catch (error) {
    process.stderr.write(`OSHAL_VERIFY_ENV_FILE is not readable (${error && error.code ? error.code : 'error'}); no token taken from it\n`);
    return '';
  }
  const line = text.split(/\n/).find((row) => new RegExp(`^\\s*${name}=`).test(row));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).replace(/\r$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * @description JSON calls as one token's owner against one base URL.
 * @param {string} base The api origin. @param {string} token The PAT. @param {typeof fetch} fetchImpl The fetch to use.
 * @returns {(method: string, route: string, body?: unknown) => Promise<{status: number, json: any}>} The caller.
 */
export function bearerApi(base, token, fetchImpl = fetch) {
  return async (method, route, body) => {
    const response = await fetchImpl(`${base}${route}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(120_000),
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

/** @description The UTC date of an instant, as the package's slot names it. */
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** @description Who each token belongs to, read from the kernel's PAT whoami. */
async function identities(run) {
  const a = await run.a('GET', '/api/cli-tokens/whoami');
  const b = await run.b('GET', '/api/cli-tokens/whoami');
  expect(a.status === 200 && a.json.sub, `the operator token's whoami answered ${a.status}`, {});
  expect(b.status === 200 && b.json.sub, `the second token's whoami answered ${b.status}`, {});
  if (a.json.sub === b.json.sub) unavailable('both tokens belong to one person; the isolation check needs two owners; nothing was written');
  return { aSub: String(a.json.sub), bSub: String(b.json.sub) };
}

/**
 * @description Read-only preconditions: the hour, both identities able to use the app, and the
 * installed service declaring the catalog's tick permission. Writes nothing.
 */
async function preflight(run) {
  const hour = new Date(run.now()).getUTCHours();
  if (hour > LATEST_START_HOUR_UTC) unavailable(`it is ${hour}:xx UTC; two ticks would straddle the UTC date; start before ${LATEST_START_HOUR_UTC + 1}:00 UTC; nothing was written`);
  Object.assign(run.evidence, await identities(run));
  for (const [who, api] of [['operator', run.a], ['second', run.b]]) {
    const list = await api('GET', `${API}/ventures`);
    if (list.status !== 200) unavailable(`the ${who} identity cannot use Venture Plan (GET /ventures answered ${list.status}); grant it the venture-plan member role; nothing was written`);
  }
  const view = await run.a('GET', SERVICES);
  expect(view.status === 200, `GET ${SERVICES} answered ${view.status}`, { body: view.json });
  const service = (view.json.services || []).find((row) => row.id === SERVICE_ID);
  if (!service || service.proposedRunsAs !== 'system') unavailable(`the installed venture-plan does not declare ${SERVICE_ID} as a system service; nothing was written`);
  const permissions = (service.requires || []).map((row) => row.permission);
  if (permissions.length !== 1 || permissions[0] !== 'venture.rebaseline') {
    unavailable('the installed venture-plan does not require venture.rebaseline: install 1.5.0 (its catalog) first; nothing was written');
  }
  return service;
}

/** @description The system activation: present, or made here only with --activate. A 409 means no catalog is installed. */
async function ensureActivation(run, service) {
  if (service.state === 'active' && service.runsAs === 'system') {
    run.evidence.activation = { state: 'active', activatedAt: service.activatedAt, activatedBy: service.activatedBy, madeHere: false };
    return;
  }
  if (!run.activate) unavailable(`${SERVICE_ID} is ${service.state}${service.suspendedReason ? ` (${service.suspendedReason})` : ''}; a swarm administrator activates it as a system service (or pass --activate); nothing was written`);
  const made = await run.a('POST', `${SERVICES}/${SERVICE_ID}/activate`, { runsAs: 'system' });
  expect(made.status === 200, `activating ${SERVICE_ID} as a system service answered ${made.status} ${made.json.error || ''}`, { body: made.json });
  run.evidence.activation = { state: 'active', activatedAt: made.json.activation?.activatedAt, madeHere: true };
}

/** @description Seeding must not straddle a tick: wait out the minutes around :07. */
async function clearOfTick(run) {
  const minute = new Date(run.now()).getUTCMinutes();
  if (minute >= TICK_MINUTE - 3 && minute < TICK_MINUTE + 3) await run.sleep((TICK_MINUTE + 3 - minute) * MINUTE);
}

/** @description Create one tagged venture as one owner and give it a policy; recorded for cleanup before anything else. */
async function seedVenture(run, owner, label, policy) {
  const api = owner === 'a' ? run.a : run.b;
  const mark = markFor(run.tag);
  const created = await api('POST', `${API}/ventures`, { name: `${mark} ${label}`, idea: `${mark} A synthetic ${label} venture for the scheduled rebaseline acceptance.`, currency: 'USD' });
  expect(created.status === 201 && created.json.venture?.id, `creating ${label} answered ${created.status}`, { body: created.json });
  const id = String(created.json.venture.id);
  run.created.push({ owner, id, label });
  if (policy) {
    const saved = await api('PUT', `${API}/ventures/${id}/rebaseline-policy`, policy);
    expect(saved.status === 200, `saving ${label}'s policy answered ${saved.status}`, { body: saved.json });
  }
  return id;
}

/** @description The scheduled runs of one venture, read as its owner. */
async function scheduledRuns(run, owner, id) {
  const answer = await (owner === 'a' ? run.a : run.b)('GET', `${API}/ventures/${id}/runs`);
  expect(answer.status === 200, `GET runs of ${id} answered ${answer.status}`, { body: answer.json });
  return (answer.json.runs || []).filter((row) => row.triggerKind === 'scheduled');
}

/**
 * @description The owner's spend in the kernel's cost events over the trailing whole hours, read
 * about themself. Core floors and clamps the window to 1..720 hours (budget-routes.ts parseSpendQuery).
 */
async function spend(run, owner, windowHours) {
  const sub = owner === 'a' ? run.evidence.aSub : run.evidence.bSub;
  const answer = await (owner === 'a' ? run.a : run.b)('GET', `/api/budgets/spend?scope=user:${encodeURIComponent(sub)}&windowHours=${windowHours}`);
  expect(answer.status === 200 && typeof answer.json.spendUsd === 'number', `the ${owner} spend read answered ${answer.status}`, { body: answer.json });
  return answer.json.spendUsd;
}

/**
 * @description The window for the second reading: the baseline window plus every started hour since
 * the baseline was read. It therefore starts no later than the baseline window did, so a charge the
 * baseline counted cannot age out of it and hide a new one; a charge just older than the baseline
 * window that it now also covers can only fail the check, never pass it.
 */
function afterWindowHours(run) {
  return SPEND_WINDOW_HOURS + Math.ceil((run.now() - run.spendBaseline.at) / HOUR);
}

/** @description Poll until every venture has a terminal scheduled run, or the deadline passes. */
async function awaitRuns(run, owner, ids, deadline) {
  for (;;) {
    const runs = await Promise.all(ids.map((id) => scheduledRuns(run, owner, id)));
    if (runs.every((rows) => rows.length > 0 && rows.every((row) => row.status !== 'running'))) return runs;
    if (run.now() >= deadline) return runs;
    await run.sleep(run.pollMs);
  }
}

/** @description Seed every venture the walk judges. B owns the non-spending pair; A owns the opted-in pair. */
async function seedAll(run) {
  await clearOfTick(run);
  const nightly = (over) => ({ cadence: 'nightly', weeklyDay: 1, maxCostMicros: PAID_CAP_MICROS, ...over });
  run.ids = {
    disabled: await seedVenture(run, 'b', 'disabled', nightly({ enabled: false, dryRun: false })),
    dryRun: await seedVenture(run, 'b', 'dry-run', nightly({ enabled: true, dryRun: true })),
    paid: await seedVenture(run, 'a', 'opted-in', nightly({ enabled: true, dryRun: false })),
    tiny: await seedVenture(run, 'a', 'one-micro-cap', nightly({ enabled: true, dryRun: false, maxCostMicros: TINY_CAP_MICROS })),
  };
  run.evidence.seededAt = new Date(run.now()).toISOString();
  run.spendBaseline = { b: await spend(run, 'b', SPEND_WINDOW_HOURS), at: run.now() };
  run.evidence.spendBaseline = { b: run.spendBaseline.b, windowHours: SPEND_WINDOW_HOURS, readAt: new Date(run.spendBaseline.at).toISOString() };
}

/** @description The first tick: both opted-in ventures get their run; the late venture then waits for the second tick. */
async function observeTicks(run) {
  const first = await awaitRuns(run, 'a', [run.ids.paid, run.ids.tiny], run.now() + 75 * MINUTE);
  expect(first.every((rows) => rows.length === 1), 'the first tick did not open exactly one run for each opted-in venture',
    { paid: first[0], tiny: first[1] });
  run.firstTick = Date.parse(first[0][0].startedAt);
  run.ids.late = await seedVenture(run, 'a', 'created-after-first-tick', { cadence: 'nightly', weeklyDay: 1, maxCostMicros: PAID_CAP_MICROS, enabled: true, dryRun: false });
  const [late] = await awaitRuns(run, 'a', [run.ids.late], run.firstTick + 75 * MINUTE);
  expect(late.length === 1, 'no second tick opened a run for the venture created after the first tick', { late });
  run.secondTick = Date.parse(late[0].startedAt);
  const [paid, tiny] = await Promise.all([scheduledRuns(run, 'a', run.ids.paid), scheduledRuns(run, 'a', run.ids.tiny)]);
  return { paid, tiny, late };
}

/** @description Judge one opted-in venture's single run: slot, cap, and that its phases spent real, measured money. */
function judgePaid(run, rows, slot) {
  expect(rows.length === 1, `the opted-in venture has ${rows.length} scheduled runs after two ticks, not exactly one`, { rows });
  const [row] = rows;
  expect(row.scheduleSlot === slot && row.costCapMicros === PAID_CAP_MICROS, 'the opted-in run carries the wrong slot or cap', { row });
  const analysts = row.phases.filter((phase) => ['bom', 'market', 'ops'].includes(phase.name));
  expect(analysts.every((phase) => phase.status === 'done'), `the opted-in run's analyst phases did not complete: ${analysts.map((p) => `${p.name}=${p.status}${p.error ? ` (${p.error})` : ''}`).join(', ')}`, { row });
  expect(Number.isSafeInteger(row.costSpentMicros) && row.costSpentMicros > 0 && ['within-cap', 'exhausted'].includes(row.costStatus),
    `the opted-in run stored no positive integer-micro cost (${row.costSpentMicros}, ${row.costStatus})`, { row });
  return { runId: row.id, slot: row.scheduleSlot, startedAt: row.startedAt, costSpentMicros: row.costSpentMicros, costStatus: row.costStatus };
}

/** @description Judge the 1 micro-USD venture: the first charge overshoots and every later analyst call is skipped. */
function judgeTiny(rows, slot) {
  expect(rows.length === 1, `the one-micro-cap venture has ${rows.length} scheduled runs, not exactly one`, { rows });
  const [row] = rows;
  const status = Object.fromEntries(row.phases.map((phase) => [phase.name, phase.status]));
  expect(row.scheduleSlot === slot && row.costStatus === 'overshot' && row.costSpentMicros > TINY_CAP_MICROS,
    `the cost gate did not record an overshoot (${row.costStatus}, ${row.costSpentMicros} of ${row.costCapMicros})`, { row });
  expect(status.bom === 'done' && status.market === 'skipped' && status.ops === 'skipped',
    `after the overshoot the later calls were not stopped: ${JSON.stringify(status)}`, { row });
  return { runId: row.id, costSpentMicros: row.costSpentMicros, costCapMicros: row.costCapMicros, phases: status };
}

/** @description The non-spending pair: no run of any kind, and no new spend for their owner. */
async function judgeNonSpending(run) {
  for (const key of ['disabled', 'dryRun']) {
    const answer = await run.b('GET', `${API}/ventures/${run.ids[key]}/runs`);
    expect(answer.status === 200 && (answer.json.runs || []).length === 0, `the ${key} venture has runs`, { body: answer.json });
  }
  const windowHours = afterWindowHours(run);
  const before = run.spendBaseline.b;
  const after = await spend(run, 'b', windowHours);
  expect(after <= before + 1e-9, `the second owner spent ${after - before} USD across the ticks`, { before, after, windowHours });
  return { disabledRuns: 0, dryRunRuns: 0, secondOwnerSpendDeltaUsd: Math.max(0, after - before), afterWindowHours: windowHours };
}

/** @description Neither owner reads the other's ventures or runs, and neither list shows the other's. */
async function judgeIsolation(run, paidRunId) {
  const refused = [
    await run.a('GET', `${API}/ventures/${run.ids.dryRun}`), await run.a('GET', `${API}/ventures/${run.ids.disabled}/runs`),
    await run.b('GET', `${API}/ventures/${run.ids.paid}`), await run.b('GET', `${API}/runs/${paidRunId}`),
  ];
  expect(refused.every((answer) => answer.status === 404), `a cross-owner read was answered: ${refused.map((answer) => answer.status).join(', ')}`, {});
  const aList = (await run.a('GET', `${API}/ventures`)).json.ventures || [];
  const bList = (await run.b('GET', `${API}/ventures`)).json.ventures || [];
  const aIds = new Set(aList.map((row) => String(row.id)));
  const bIds = new Set(bList.map((row) => String(row.id)));
  expect(!aIds.has(run.ids.dryRun) && !aIds.has(run.ids.disabled) && !bIds.has(run.ids.paid) && !bIds.has(run.ids.tiny),
    'one owner\'s venture list shows the other\'s venture', {});
  return { crossReadsRefused: refused.length };
}

/** @description Wait (bounded) while any run of a venture this walk created is still in flight, so nothing writes after deletion. */
async function settle(run) {
  const deadline = run.now() + 20 * MINUTE;
  for (;;) {
    const answers = await Promise.all(run.created.map((row) => (row.owner === 'a' ? run.a : run.b)('GET', `${API}/ventures/${row.id}/runs`)));
    const running = answers.some((answer) => (answer.json.runs || []).some((row) => row.status === 'running'));
    if (!running || run.now() >= deadline) return;
    await run.sleep(run.pollMs);
  }
}

/** @description Wait for in-flight runs, delete exactly what this run created, and read the deletion back. */
async function cleanup(run) {
  await settle(run);
  const residue = [];
  for (const row of run.created) {
    const api = row.owner === 'a' ? run.a : run.b;
    const removed = await api('DELETE', `${API}/ventures/${row.id}`);
    const after = await api('GET', `${API}/ventures/${row.id}`);
    if (![200, 204].includes(removed.status) || after.status !== 404) residue.push({ ...row, deleteStatus: removed.status, readStatus: after.status });
  }
  return { deleted: run.created.length - residue.length, residue };
}

/** @description The activation is still live after the ticks (a denied tick would have suspended it). */
async function judgeActivation(run) {
  const view = await run.a('GET', SERVICES);
  const after = (view.json.services || []).find((row) => row.id === SERVICE_ID);
  expect(after?.state === 'active', `after the ticks ${SERVICE_ID} is ${after?.state}${after?.suspendedReason ? ` (${after.suspendedReason})` : ''}`, { service: after });
  return { state: after.state };
}

/**
 * @description Judge every clause once the ticks are observed, recording each verdict, so one dated
 * run reports every done-when clause rather than stopping at the first that fails.
 */
async function judgeClauses(run, observed, slot) {
  const clauses = {};
  const judge = async (name, verdict) => {
    try { clauses[name] = { ok: true, ...(await verdict()) }; } catch (error) {
      clauses[name] = { ok: false, detail: error.message, ...(error.evidence ? { evidence: error.evidence } : {}) };
    }
  };
  await judge('oneRunPerSlot', () => judgePaid(run, observed.paid, slot));
  await judge('costGate', () => judgeTiny(observed.tiny, slot));
  await judge('disabledAndDryRun', () => judgeNonSpending(run));
  await judge('isolation', () => judgeIsolation(run, observed.paid[0]?.id ?? 'none'));
  await judge('activation', () => judgeActivation(run));
  run.evidence.clauses = clauses;
  const failed = Object.entries(clauses).filter(([, verdict]) => !verdict.ok);
  expect(failed.length === 0, failed.map(([name, verdict]) => `${name}: ${verdict.detail}`).join(' | '), {});
}

/** @description The judged walk, after the preconditions hold. */
async function walk(run) {
  const service = await preflight(run);
  await ensureActivation(run, service);
  await seedAll(run);
  const slot = `nightly:${utcDate(run.now())}`;
  const observed = await observeTicks(run);
  run.evidence.ticks = { first: new Date(run.firstTick).toISOString(), second: new Date(run.secondTick).toISOString(), slot };
  run.evidence.late = { runId: observed.late[0].id, startedAt: observed.late[0].startedAt };
  await judgeClauses(run, observed, slot);
}

/**
 * @description Run the whole acceptance and return its verdict; never throws.
 * @param {{base: string, operatorToken: string, secondToken: string, activate?: boolean, allowPaid?: boolean,
 *   fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>, pollMs?: number}} options The run.
 * @returns {Promise<{case: string, state: 'pass'|'fail'|'unavailable', detail?: string, tag?: string, evidence: object, cleanup?: object}>} The verdict.
 */
export async function runAcceptance(options) {
  if (!options.operatorToken || !options.secondToken) {
    return { case: CASE_ID, state: 'unavailable', detail: `${OPERATOR_PAT} and ${SECOND_PAT} are both required; nothing was written`, evidence: {} };
  }
  if (!options.allowPaid) {
    return { case: CASE_ID, state: 'unavailable', detail: 'creating a venture runs one paid scoping call and the opted-in runs spend up to their cap: pass --allow-paid; nothing was written', evidence: {} };
  }
  const run = { tag: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`, created: [], evidence: {}, ids: {},
    a: bearerApi(options.base, options.operatorToken, options.fetchImpl), b: bearerApi(options.base, options.secondToken, options.fetchImpl),
    activate: options.activate === true, now: options.now ?? Date.now, pollMs: options.pollMs ?? MINUTE,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))) };
  let verdict;
  try {
    await walk(run);
    verdict = { state: 'pass' };
  } catch (error) {
    verdict = { state: error.unavailable ? 'unavailable' : 'fail', detail: error.message, ...(error.evidence ? { failure: error.evidence } : {}) };
  }
  const cleaned = await cleanup(run);
  if (cleaned.residue.length && verdict.state !== 'fail') verdict = { state: 'fail', detail: 'cleanup left synthetic ventures behind' };
  return { case: CASE_ID, ...verdict, tag: run.tag, evidence: run.evidence, cleanup: cleaned };
}

/** @description Command-line entry: read tokens by name, run, print one RESULT line, exit 0/1/2. */
async function main(argv, env) {
  const result = await runAcceptance({ base: String(env.OSHAL_VERIFY_BASE_URL || 'http://127.0.0.1:35457').replace(/\/$/, ''),
    operatorToken: readNamedToken(env, OPERATOR_PAT), secondToken: readNamedToken(env, SECOND_PAT),
    activate: argv.includes('--activate'), allowPaid: argv.includes('--allow-paid') });
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
  process.exitCode = result.state === 'pass' ? 0 : result.state === 'fail' ? 1 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2), process.env).catch((error) => {
    process.stderr.write(`rebaseline live acceptance crashed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
