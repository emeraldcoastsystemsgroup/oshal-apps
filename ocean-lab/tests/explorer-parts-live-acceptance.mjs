#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 automated acceptance, for AFTER ocean-lab 1.3.0 is installed: the parts walk over
 *                     |                             | the REAL routes as the operator automation identity (OSHAL_VERIFY_OPERATOR_PAT, read BY NAME,
 *                     |                             | never printed). It seeds ONE uniquely tagged explorer, sizes it in seawater, and requires the
 *                     |                             | parts model's eleven watertight parts, the displacement budget OPEN by name on the committed rows
 *                     |                             | and the stage refusing parts-complete by name. Then "Open in CAD Studio" for real: every part's
 *                     |                             | exact body is POSTed to /api/cad-studio/models and must build through the OCCT kernel with EVERY
 *                     |                             | feature accepted and a valid solid, its volume within 0.5 % of the lab's own (a hull's enclosed
 *                     |                             | volume, the tether's cylinder) and a foil's mass within 0.5 % of the lab's estimate. The design
 *                     |                             | document is read. It deletes every CAD model and the vehicle it created and proves each delete;
 *                     |                             | an incomplete cleanup is a failure. CAD Studio answering 404 (not installed) makes the verdict
 *                     |                             | `degraded` with every ocean-lab step still proven. It prints one RESULT line, and it is driven,
 *                     |                             | unchanged, against the loopback router by tests/vehicle-parts-routes.spec.ts.
 *
 * Usage (inside the api container, or from the host with a base URL):
 *   OSHAL_VERIFY_BASE_URL=http://localhost:35457 node ocean-lab/tests/explorer-parts-live-acceptance.mjs
 * The PAT comes from OSHAL_VERIFY_OPERATOR_PAT, or from the file OSHAL_VERIFY_ENV_FILE names.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bearerApi, readOperatorPat } from './explorer-live-acceptance.mjs';

/** The Test Lab case id this proof reports under. */
export const CASE_ID = 'ocean-lab:explorer-parts-live-acceptance';
/** How far CAD Studio's OCCT volume or mass may sit from the lab's own figure. */
export const TOLERANCE = 0.005;

/** @description Fail the proof with what was seen. */
function expect(ok, detail, evidence) {
  if (!ok) { const error = new Error(detail); error.evidence = evidence; throw error; }
}

/** @description The lab's own figure a built part is compared against: a hull's or the tether's volume, a foil's mass. */
function expectedFigure(part) {
  if (part.make !== 'printed') return { kind: 'volumeMm3', value: part.displacedTotalMm3 / part.qty };
  if (part.id === 'float' || part.id === 'sub-body') return { kind: 'volumeMm3', value: part.displacedTotalMm3 };
  return { kind: 'massG', value: part.massEachKg * 1000 };
}

/**
 * @description Post one part's exact body to CAD Studio and check the build; returns the model id to clean up.
 * @returns {Promise<{modelId: string|null, notInstalled: boolean, note: string}>} What happened.
 */
async function buildInCadStudio(api, url, part, created) {
  const one = await api('GET', `${url}/parts/${part.id}`);
  expect(one.status === 200 && one.json.cadStudio?.source?.portableObject?.schema === 'oshal.portable-object/1', `GET parts/${part.id} answered ${one.status} without a body carrying its portable object`, {});
  const posted = await api('POST', '/api/cad-studio/models', one.json.cadStudio);
  if (posted.status === 404) return { modelId: null, notInstalled: true, note: 'CAD Studio is not installed (404)' };
  const model = posted.json.model;
  if (model?.model_id) created.push(model.model_id);
  expect(posted.status === 201 && posted.json.build?.ok === true, `CAD Studio did not build ${part.id}: ${posted.status} ${JSON.stringify(posted.json.build || posted.json.error || {})}`, {});
  const refused = (model.feature_status || []).filter((s) => !s.ok);
  expect(refused.length === 0, `CAD Studio refused ${part.id} feature(s): ${JSON.stringify(refused)}`, {});
  expect(model.report?.valid === true, `CAD Studio's solid for ${part.id} is not valid`, {});
  const want = expectedFigure(part);
  const got = Number(model.report[want.kind]);
  expect(Math.abs(got - want.value) <= TOLERANCE * want.value, `${part.id}: CAD Studio's ${want.kind} ${got} is not within ${TOLERANCE * 100} % of the lab's ${want.value.toFixed(3)}`, {});
  return { modelId: model.model_id, notInstalled: false, note: `${part.id} ${want.kind} ${got.toFixed(1)} vs ${want.value.toFixed(1)}` };
}

/** @description The ocean-lab half of the walk: sized, eleven parts, the budget OPEN and the stage refusing by name. */
async function partsWalk(api, url, evidence) {
  const sized = await api('POST', `${url}/evaluate`, { mediumId: 'seawater' });
  expect(sized.status === 201 && sized.json.stage?.stage === 'sized', `evaluate answered ${sized.status} at ${sized.json.stage?.stage}`, {});
  const parts = await api('GET', `${url}/parts`);
  expect(parts.status === 200 && parts.json.watertightParts === 11, `GET parts answered ${parts.status} with ${parts.json.watertightParts} watertight parts`, {});
  expect(parts.json.budget?.status === 'open' && /no published mass/.test(parts.json.budget.unknowns.join(' ')), `the budget is ${parts.json.budget?.status}, not OPEN on the unpublished masses`, {});
  const blocked = parts.json.stage.blockedBy.join(' ');
  expect(parts.json.stage.stage === 'sized' && /parts model is incomplete/.test(blocked) && /displacement budget is OPEN/.test(blocked), 'the stage did not refuse parts-complete by name', { blockedBy: parts.json.stage.blockedBy });
  evidence.budget = parts.json.budget.status;
  const md = await api('GET', `${url}/design.md`);
  expect(md.status === 200 && /^# Explorer parts acceptance \S+ — design/.test(md.json.unparsed || ''), `design.md answered ${md.status} without the record's generated document`, {});
  return [...parts.json.printed, ...parts.json.bought].filter((p) => p.opensInCadStudio);
}

/**
 * @description The walk, against a live or loopback api. Creates one tagged explorer and its CAD models, and always deletes them.
 * @param {{api: Function, tag?: string}} opts The caller and a unique tag.
 * @returns {Promise<{caseId: string, state: 'pass'|'degraded'|'fail', detail: string, evidence: object}>} The verdict.
 */
export async function runExplorerPartsAcceptance({ api, tag = randomUUID().slice(0, 8) }) {
  const evidence = { tag, built: [] };
  const created = []; let url = null;
  try {
    const seeded = await api('POST', '/api/ocean-lab/vehicles/explorer/seed', { name: `Explorer parts acceptance ${tag}` });
    expect(seeded.status === 201, `seed answered ${seeded.status}`, {});
    url = `/api/ocean-lab/vehicles/${seeded.json.vehicle.vehicleId}`;
    const bodies = await partsWalk(api, url, evidence);
    expect(bodies.length === 6, `${bodies.length} parts open in CAD Studio, not 6`, {});
    for (const part of bodies) {
      const built = await buildInCadStudio(api, url, part, created);
      if (built.notInstalled) return { caseId: CASE_ID, state: 'degraded', detail: 'the parts model, the OPEN budget and the refusal are proven; CAD Studio is not installed (POST /api/cad-studio/models answered 404), so no part was built', evidence };
      evidence.built.push(built.note);
    }
    return { caseId: CASE_ID, state: 'pass', detail: 'sized, eleven watertight parts, the budget OPEN on unpublished masses and parts-complete refused by name; every part built in CAD Studio with every feature accepted, a valid solid and its volume or mass within 0.5 %; cleaned up', evidence };
  } catch (error) {
    Object.assign(evidence, error && error.evidence);
    return { caseId: CASE_ID, state: 'fail', detail: error instanceof Error ? error.message : String(error), evidence };
  } finally {
    evidence.cleanup = await cleanUp(api, url, created);
  }
}

/** @description Delete every CAD model and the vehicle the walk created and prove each is gone. @returns {Promise<string>} 'deleted', or why not. */
async function cleanUp(api, url, created) {
  const left = [];
  for (const id of created) {
    const del = await api('DELETE', `/api/cad-studio/models/${id}`);
    const after = await api('GET', `/api/cad-studio/models/${id}`);
    if (!(del.status === 204 || del.status === 200) || after.status !== 404) left.push(`cad model ${id} (delete ${del.status}, read-back ${after.status})`);
  }
  if (url) {
    const del = await api('DELETE', url);
    const after = await api('GET', url);
    if (del.status !== 204 || after.status !== 404) left.push(`vehicle (delete ${del.status}, read-back ${after.status})`);
  }
  return left.length ? `INCOMPLETE: ${left.join('; ')}` : 'deleted';
}

/** @description Run against a live api and print one RESULT line; an incomplete cleanup is a failure. @returns {Promise<number>} Exit code. */
async function main() {
  const token = readOperatorPat(process.env);
  const base = (process.env.OSHAL_VERIFY_BASE_URL || `http://127.0.0.1:${process.env.PORT || '5000'}`).replace(/\/+$/, '');
  if (!token) {
    process.stdout.write(`RESULT ${JSON.stringify({ caseId: CASE_ID, state: 'unavailable', detail: 'OSHAL_VERIFY_OPERATOR_PAT is neither exported nor in OSHAL_VERIFY_ENV_FILE; nothing was written', evidence: {} })}\n`);
    return 2;
  }
  const verdict = await runExplorerPartsAcceptance({ api: bearerApi(base, token) });
  if (verdict.state !== 'fail' && verdict.evidence.cleanup !== 'deleted') Object.assign(verdict, { state: 'fail', detail: `cleanup ${verdict.evidence.cleanup}` });
  process.stdout.write(`RESULT ${JSON.stringify(verdict)}\n`);
  return verdict.state === 'pass' ? 0 : verdict.state === 'degraded' ? 3 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stdout.write(`RESULT ${JSON.stringify({ caseId: CASE_ID, state: 'fail', detail: `the proof crashed: ${error instanceof Error ? error.message : String(error)}`, evidence: {} })}\n`);
    process.exitCode = 1;
  });
}
