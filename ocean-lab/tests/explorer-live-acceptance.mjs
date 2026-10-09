#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 automated acceptance, for AFTER ocean-lab 1.2.0 is installed: the operator's
 *                     |                             | own walk through the Explorer, driven over the REAL routes as the operator automation identity
 *                     |                             | (OSHAL_VERIFY_OPERATOR_PAT, read BY NAME and never printed). It creates ONE uniquely tagged
 *                     |                             | explorer from the committed seed, evaluates it in seawater (stage `sized`), changes the stop angle
 *                     |                             | (stage drops to `concept`), evaluates again and requires the sea-state table and the year to MOVE,
 *                     |                             | asks for air and requires the refusal by its own name with nothing recorded, fetches the embodied
 *                     |                             | hull drop and records it as a run carrying its medium id and fingerprints, then deletes exactly
 *                     |                             | what it created and proves the delete (404). An incomplete cleanup is a failure. It prints one
 *                     |                             | RESULT line. It is also driven, unchanged, against the loopback router by
 *                     |                             | tests/vehicle-routes.spec.ts, so the script is proven before any box runs it.
 *
 * Usage (inside the api container, or from the host with a base URL):
 *   OSHAL_VERIFY_BASE_URL=http://localhost:35457 node ocean-lab/tests/explorer-live-acceptance.mjs
 * The PAT comes from OSHAL_VERIFY_OPERATOR_PAT, or from the file OSHAL_VERIFY_ENV_FILE names (its
 * OSHAL_VERIFY_OPERATOR_PAT= line), and is sent only as a bearer header.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The Test Lab case id this proof reports under. */
export const CASE_ID = 'ocean-lab:explorer-live-acceptance';
const PAT_ENV = 'OSHAL_VERIFY_OPERATOR_PAT';

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
    process.stderr.write(`OSHAL_VERIFY_ENV_FILE is not readable (${error && error.code ? error.code : 'error'}); no token taken from it
`);
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
      method, redirect: 'manual', signal: AbortSignal.timeout(60_000),
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

/** @description Evaluate and return the newest recorded run and the stage. */
async function evaluate(api, url, mediumId) {
  const r = await api('POST', `${url}/evaluate`, { mediumId });
  return { status: r.status, json: r.json, run: r.json.recorded && r.json.recorded.run, stage: r.json.stage && r.json.stage.stage };
}

/**
 * @description The walk itself, against a live or loopback api. Creates one tagged explorer and always deletes it.
 * @param {{api: Function, tag?: string}} opts The caller and a unique tag.
 * @returns {Promise<{caseId: string, state: 'pass'|'fail', detail: string, evidence: object}>} The verdict.
 */
export async function runExplorerAcceptance({ api, tag = randomUUID().slice(0, 8) }) {
  const evidence = { tag };
  let url = null;
  try {
    const kinds = await api('GET', '/api/ocean-lab/vehicles/kinds');
    expect(kinds.status === 200 && kinds.json.kinds?.[0]?.limits?.length === 8, `GET /vehicles/kinds answered ${kinds.status} without the explorer kind's eight limits`, { status: kinds.status });
    const seeded = await api('POST', '/api/ocean-lab/vehicles/explorer/seed', { name: `Explorer acceptance ${tag}` });
    expect(seeded.status === 201 && seeded.json.stage?.stage === 'concept', `seed answered ${seeded.status} at stage ${seeded.json.stage?.stage}`, { status: seeded.status });
    url = `/api/ocean-lab/vehicles/${seeded.json.vehicle.vehicleId}`;
    evidence.vehicleId = seeded.json.vehicle.vehicleId;
    await walk(api, url, seeded.json.vehicle.designVector, evidence);
    return { caseId: CASE_ID, state: 'pass', detail: 'seeded at concept, sized in seawater, dropped on a stop-angle change, re-sized with a moved table, refused air by name, recorded the embodied hull drop, and cleaned up', evidence };
  } catch (error) {
    Object.assign(evidence, error && error.evidence);
    return { caseId: CASE_ID, state: 'fail', detail: error instanceof Error ? error.message : String(error), evidence };
  } finally {
    if (url) evidence.cleanup = await cleanUp(api, url);
  }
}

/** @description The steps between the seed and the cleanup. */
async function walk(api, url, vector, evidence) {
  const first = await evaluate(api, url, 'seawater');
  expect(first.status === 201 && first.stage === 'sized' && first.run?.engineFingerprints?.routesBuildHash, `evaluate in seawater answered ${first.status} at ${first.stage}`, { status: first.status });
  evidence.firstKmPerYear = first.run.result.figures.kmPerYear;
  const moved = JSON.parse(JSON.stringify(vector));
  moved.wings.stopAngleDeg = vector.wings.stopAngleDeg + 5;
  const patched = await api('PATCH', `${url}/design`, { designVector: moved });
  expect(patched.status === 200 && patched.json.stage?.stage === 'concept', `the stage did not drop on a vector change (${patched.status}, ${patched.json.stage?.stage})`, {});
  const second = await evaluate(api, url, 'seawater');
  expect(second.status === 201 && second.stage === 'sized', `re-evaluate answered ${second.status} at ${second.stage}`, {});
  evidence.secondKmPerYear = second.run.result.figures.kmPerYear;
  const rowsMoved = second.run.result.seaStates.some((row, i) => row.speedMs !== first.run.result.seaStates[i].speedMs);
  expect(rowsMoved && evidence.secondKmPerYear !== evidence.firstKmPerYear, 'the sea-state table and the year did not move with the stop angle', {});
  const air = await api('POST', `${url}/evaluate`, { mediumId: 'air' });
  expect(air.status === 422 && air.json.refusal === 'medium_property_unavailable: freeSurface', `air answered ${air.status} ${air.json.refusal || ''}`, {});
  const drop = await api('GET', '/api/embodied/physics/hull?medium=air');
  expect(drop.status === 200 && drop.json.schema === 'oshal.run-result/1', `the embodied hull drop answered ${drop.status}`, {});
  const ingested = await api('POST', `${url}/runs`, { run: drop.json });
  expect(ingested.status === 201, `recording the hull drop answered ${ingested.status} ${ingested.json.error || ''}`, {});
  const runs = ingested.json.runs || [];
  expect(runs.length === 3 && runs.some((r) => r.plant === 'embodied:analytic' && r.mediumId === 'air'), `the record lists ${runs.length} runs, not the two evaluations and the hull drop`, {});
  evidence.runs = runs.map((r) => `${r.sequence}:${r.plant}:${r.mediumId}`);
}

/** @description Delete what the walk created and prove it is gone. @returns {Promise<string>} 'deleted', or why not. */
async function cleanUp(api, url) {
  const del = await api('DELETE', url);
  const after = await api('GET', url);
  return del.status === 204 && after.status === 404 ? 'deleted' : `INCOMPLETE: delete ${del.status}, read-back ${after.status}`;
}

/** @description Run against a live api and print one RESULT line; an incomplete cleanup is a failure. @returns {Promise<number>} Exit code. */
async function main() {
  const token = readOperatorPat(process.env);
  const base = (process.env.OSHAL_VERIFY_BASE_URL || `http://127.0.0.1:${process.env.PORT || '5000'}`).replace(/\/+$/, '');
  if (!token) {
    process.stdout.write(`RESULT ${JSON.stringify({ caseId: CASE_ID, state: 'unavailable', detail: `${PAT_ENV} is neither exported nor in OSHAL_VERIFY_ENV_FILE; nothing was written`, evidence: {} })}\n`);
    return 2;
  }
  const verdict = await runExplorerAcceptance({ api: bearerApi(base, token) });
  if (verdict.state === 'pass' && verdict.evidence.cleanup !== 'deleted') Object.assign(verdict, { state: 'fail', detail: `cleanup ${verdict.evidence.cleanup}` });
  process.stdout.write(`RESULT ${JSON.stringify(verdict)}\n`);
  return verdict.state === 'pass' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stdout.write(`RESULT ${JSON.stringify({ caseId: CASE_ID, state: 'fail', detail: `the proof crashed: ${error instanceof Error ? error.message : String(error)}`, evidence: {} })}\n`);
    process.exitCode = 1;
  });
}
