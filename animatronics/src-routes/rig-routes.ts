/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rig API the surface, the concierge's
 *                     |                             | tools and any MCP client drive: rigs (from a template or from
 *                     |                             | numbers; list, read, change, delete), the pose and scenario
 *                     |                             | libraries (one entry per call, deletion refused while
 *                     |                             | referenced), REHEARSE (compile + rate-limited servo sim +
 *                     |                             | supply budget → report and frames, no side effect but the
 *                     |                             | log), the authority rail — ARM needs `confirm: true` (428
 *                     |                             | without) and a supply the budget accepts; PLAY, LOOK-AT and
 *                     |                             | JOG answer 409 until armed; DISARM is always allowed and is
 *                     |                             | the e-stop — and the command log. Every answer that moves the
 *                     |                             | prop carries the exact protocol lines the browser streams to
 *                     |                             | the controller, so the server, not the page, owns the pulses.
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { ContractError, axisMap, validateRig, type RigSpec } from './engine/rig-contract';
import { BEHAVIOUR_ID, assertAcyclic, validatePose, validatePoses, validateScenario, validateScenarios, type Library, type Pose, type Scenario, type Step } from './engine/scenario';
import { compileSteps, neutralPose, type Compiled } from './engine/compile';
import { rehearse, type Rehearsal } from './engine/servo-sim';
import { budgetPower, type PowerReport } from './engine/power';
import { lookAt } from './engine/look-at';
import { encodeEstop, encodeFrame, encodeHello, encodeLimits, frameLines } from './engine/protocol';
import type { ServoRow } from './engine/catalog';
import { findTemplate, type RigTemplate } from './engine/templates';
import { capabilityManifestFor } from './engine/kind';
import { createRig, deleteRig, getRig, listRigs, listRuns, recordRun, updateRig, type QueryablePool, type RigRow, type RunKind } from './rig-store';

const logger = createChildLogger({ module: 'animatronics-rig-routes' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @description What the rig router needs from its host. */
export interface RigRouteDeps { pool: QueryablePool; callerSub: (req: Request) => string | null; catalog: Map<string, ServoRow>; templates: RigTemplate[] }

type RigRequest = Request & { propSub?: string; propRig?: RigRow };

/** @description A full rehearsal: compiled stream, servo sim, supply budget, one report. */
export interface RehearsalBundle { compiled: Compiled; sim: Rehearsal; power: PowerReport; report: Record<string, unknown>; frames: Record<string, unknown> }

function refuse(res: Response, error: unknown): boolean {
  if (error instanceof ContractError) { res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message }); return true; }
  if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_id', message: error.message }); return true; }
  return false;
}
function requireUuid(value: unknown): string {
  const text = String(value ?? '').toLowerCase();
  if (!UUID.test(text)) throw new RangeError('Expected a UUID');
  return text;
}
function behaviourId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !BEHAVIOUR_ID.test(value)) throw new ContractError(`${field} must be an upper-case name like LOOK_LEFT`, field);
  return value;
}
function title(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text || fallback;
}
const lib = (row: RigRow): Library => ({ poses: row.poses, scenarios: row.scenarios });

/** @description The strongest servo's stall torque on a rig, from the catalog. */
export function stallOf(rig: RigSpec, catalog: Map<string, ServoRow>): number {
  return rig.channels.reduce((m, c) => Math.max(m, catalog.get(c.model)?.stallKgCm ?? 0), 0);
}

/** @description The rig as the API returns it (axis keys and the capability manifest attached). */
export function publicRig(row: RigRow, catalog: Map<string, ServoRow>): Record<string, unknown> {
  return { ...row, axes: [...axisMap(row.rig).keys()], manifest: capabilityManifestFor(`prop-${row.rig_id.slice(0, 8)}`, row.rig, stallOf(row.rig, catalog)) };
}

/**
 * @description Compile, rehearse and budget one set of steps from a start pose.
 * @param row - The rig row.
 * @param catalog - Servo rows.
 * @param steps - Validated steps.
 * @param start - The pose the stream starts from.
 * @returns The bundle.
 */
export function rehearsalFor(row: RigRow, catalog: Map<string, ServoRow>, steps: Step[], start: Pose): RehearsalBundle {
  const compiled = compileSteps(row.rig, lib(row), steps, start);
  const sim = rehearse(row.rig, compiled);
  const power = budgetPower(row.rig, catalog, compiled);
  const ok = sim.verdict.ok && power.verdict !== 'refuse';
  const reasons = [...sim.verdict.reasons, ...power.reasons];
  const summary = ok ? `ok — ${compiled.durationMs} ms, ${compiled.angles.length} frames, peak ${power.peakMovingA} A of ${row.rig.supply.amps} A` : `refused — ${reasons[0] ?? 'see reasons'}`;
  const report = { durationMs: compiled.durationMs, frames: compiled.angles.length, channels: sim.channels, power, end: compiled.end, verdict: { ok, followed: sim.verdict.followed, settled: sim.verdict.settled, power: power.verdict, reasons, summary } };
  const frames = { frameMs: compiled.frameMs, channelIds: compiled.channelIds, outputs: compiled.outputs, axisIndex: compiled.axisIndex, angles: compiled.angles, pulses: compiled.pulses, actual: sim.actual };
  return { compiled, sim, power, report, frames };
}

/** Steps from a request body: a scenario name, inline steps, a pose, or axes. */
function stepsFrom(body: Record<string, unknown>, row: RigRow): { steps: Step[]; scenario: string | null } {
  if (body.scenario !== undefined) {
    const name = behaviourId(body.scenario, 'scenario');
    if (!row.scenarios[name]) throw new ContractError(`scenario ${name} is not in this rig's library`, 'scenario');
    return { steps: [{ kind: 'run', scenario: name }], scenario: name };
  }
  if (body.steps !== undefined) return { steps: validateScenario({ steps: body.steps }, row.rig, lib(row), 'steps').steps, scenario: null };
  const ms = body.ms === undefined ? 400 : Number(body.ms);
  if (body.pose !== undefined) { const name = behaviourId(body.pose, 'pose'); if (!row.poses[name]) throw new ContractError(`pose ${name} is not in this rig's library`, 'pose'); return { steps: validateScenario({ steps: [{ kind: 'move', pose: name, ms }] }, row.rig, lib(row), 'pose').steps, scenario: null }; }
  if (body.axes !== undefined) return { steps: validateScenario({ steps: [{ kind: 'move', axes: body.axes, ms }] }, row.rig, lib(row), 'axes').steps, scenario: null };
  throw new ContractError('give a scenario, steps, a pose or axes', 'scenario');
}

/** The lines that bring a controller up: hello, every channel's clamps, the neutral frame. */
export function armLines(rig: RigSpec, pose: Pose): string[] {
  const compiled = compileSteps(rig, { poses: {}, scenarios: {} }, [], pose);
  return [encodeHello(), ...rig.channels.map((c) => encodeLimits(c.channel, c.minUs, c.maxUs)), encodeFrame(0, rig.channels.map((c, i) => [c.channel, compiled.pulses[0][i]]))];
}

/**
 * @description Build the rig router (mounted under the package's oidc mount).
 * @param deps - Pool, caller resolver, catalog, templates.
 * @returns The router.
 */
export function createRigRoutes(deps: RigRouteDeps): Router {
  const router = Router();
  const pub = (row: RigRow) => publicRig(row, deps.catalog);

  router.use((req: RigRequest, res, next) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    req.propSub = sub;
    next();
  });

  router.param('rigId', async (req: RigRequest, res, next, value) => {
    try {
      const row = await getRig(deps.pool, req.propSub as string, requireUuid(value));
      if (!row) { res.status(404).json({ error: 'rig_not_found' }); return; }
      req.propRig = row;
      next();
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error }, 'Load rig failed'); res.status(500).json({ error: 'load_failed' }); }
    }
  });

  async function save(req: RigRequest, patch: Parameters<typeof updateRig>[3]): Promise<RigRow> {
    const row = req.propRig as RigRow;
    return (await updateRig(deps.pool, req.propSub as string, row.rig_id, patch)) ?? row;
  }
  async function log(req: RigRequest, kind: RunKind, scenario: string | null, report: Record<string, unknown>, frames: number): Promise<number> {
    return recordRun(deps.pool, req.propSub as string, (req.propRig as RigRow).rig_id, { kind, scenario, report, frames });
  }
  function requireArmed(req: RigRequest, res: Response): boolean {
    if ((req.propRig as RigRow).armed) return true;
    res.status(409).json({ error: 'rig_not_armed', message: 'arm the rig (with the controller connected) before moving it' });
    return false;
  }

  router.get('/rigs', async (req: RigRequest, res) => {
    try { res.json({ rigs: (await listRigs(deps.pool, req.propSub as string)).map(pub) }); }
    catch (error) { logger.error({ err: error }, 'List rigs failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.post('/rigs', async (req: RigRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const template = body.template === undefined ? null : findTemplate(deps.templates, body.template);
      if (body.template !== undefined && !template) throw new ContractError(`unknown template ${JSON.stringify(body.template)}`, 'template');
      if (!template && body.rig === undefined) throw new ContractError('give a template or a rig', 'rig');
      const rig = body.rig === undefined ? (template as RigTemplate).rig : validateRig(body.rig);
      const poses = validatePoses(body.poses ?? template?.poses ?? {}, rig);
      const scenarios = validateScenarios(body.scenarios ?? template?.scenarios ?? {}, rig, poses);
      const row = await createRig(deps.pool, req.propSub as string, { title: title(body.title, template?.title ?? 'Untitled rig'), rig, poses, scenarios, currentPose: neutralPose(rig), source: template ? { kind: 'template', template: template.id } : {} });
      res.status(201).json({ rig: pub(row), power: budgetPower(rig, deps.catalog) });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error }, 'Create rig failed'); res.status(500).json({ error: 'create_failed' }); }
    }
  });

  router.get('/rigs/:rigId', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try { res.json({ rig: pub(row), runs: await listRuns(deps.pool, req.propSub as string, row.rig_id), power: budgetPower(row.rig, deps.catalog) }); }
    catch (error) { logger.error({ err: error, rigId: row.rig_id }, 'Read rig failed'); res.status(500).json({ error: 'read_failed' }); }
  });

  router.patch('/rigs/:rigId', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const rig = body.rig === undefined ? row.rig : validateRig(body.rig);
      const poses = validatePoses(body.poses ?? row.poses, rig);
      const scenarios = validateScenarios(body.scenarios ?? row.scenarios, rig, poses);
      const patch: Parameters<typeof updateRig>[3] = { poses, scenarios };
      if (body.title !== undefined) patch.title = title(body.title, row.title);
      if (body.rig !== undefined) { patch.rig = rig; patch.armed = false; patch.currentPose = neutralPose(rig); }
      const saved = await save(req, patch);
      res.json({ rig: pub(saved), power: budgetPower(saved.rig, deps.catalog), disarmed: body.rig !== undefined && row.armed });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Update rig failed'); res.status(500).json({ error: 'update_failed' }); }
    }
  });

  router.delete('/rigs/:rigId', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try { await deleteRig(deps.pool, req.propSub as string, row.rig_id); res.json({ deleted: row.rig_id }); }
    catch (error) { logger.error({ err: error, rigId: row.rig_id }, 'Delete rig failed'); res.status(500).json({ error: 'delete_failed' }); }
  });

  router.put('/rigs/:rigId/poses/:poseId', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const name = behaviourId(req.params.poseId, 'poseId');
      const pose = validatePose(body.axes ?? body, row.rig, `poses.${name}`);
      const saved = await save(req, { poses: { ...row.poses, [name]: pose } });
      res.json({ rig: pub(saved), pose: { [name]: pose } });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Set pose failed'); res.status(500).json({ error: 'pose_failed' }); }
    }
  });

  router.delete('/rigs/:rigId/poses/:poseId', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try {
      const name = behaviourId(req.params.poseId, 'poseId');
      if (!row.poses[name]) { res.status(404).json({ error: 'pose_not_found' }); return; }
      const poses = { ...row.poses }; delete poses[name];
      try { validateScenarios(row.scenarios, row.rig, poses); } catch (error) { if (error instanceof ContractError) { res.status(409).json({ error: 'pose_in_use', field: error.field, message: error.message }); return; } throw error; }
      res.json({ rig: pub(await save(req, { poses })), deleted: name });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Delete pose failed'); res.status(500).json({ error: 'pose_failed' }); }
    }
  });

  router.put('/rigs/:rigId/scenarios/:scenarioId', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const name = behaviourId(req.params.scenarioId, 'scenarioId');
      const candidate: Record<string, Scenario> = { ...row.scenarios, [name]: { steps: [] } };
      const scenario = validateScenario({ steps: body.steps, ...(body.description !== undefined ? { description: body.description } : {}) }, row.rig, { poses: row.poses, scenarios: candidate }, `scenarios.${name}`);
      candidate[name] = scenario;
      for (const each of Object.keys(candidate)) assertAcyclic(each, candidate, [], `scenarios.${each}`);
      const saved = await save(req, { scenarios: candidate });
      res.json({ rig: pub(saved), scenario: { [name]: scenario } });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Set scenario failed'); res.status(500).json({ error: 'scenario_failed' }); }
    }
  });

  router.delete('/rigs/:rigId/scenarios/:scenarioId', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try {
      const name = behaviourId(req.params.scenarioId, 'scenarioId');
      if (!row.scenarios[name]) { res.status(404).json({ error: 'scenario_not_found' }); return; }
      const scenarios = { ...row.scenarios }; delete scenarios[name];
      try { validateScenarios(scenarios, row.rig, row.poses); } catch (error) { if (error instanceof ContractError) { res.status(409).json({ error: 'scenario_in_use', field: error.field, message: error.message }); return; } throw error; }
      res.json({ rig: pub(await save(req, { scenarios })), deleted: name });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Delete scenario failed'); res.status(500).json({ error: 'scenario_failed' }); }
    }
  });

  router.post('/rigs/:rigId/rehearse', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const { steps, scenario } = stepsFrom(body, row);
      const start = body.start === undefined ? row.current_pose : validatePose(body.start, row.rig, 'start');
      const bundle = rehearsalFor(row, deps.catalog, steps, start);
      const run = await log(req, 'rehearse', scenario, bundle.report, bundle.compiled.angles.length);
      await save(req, { lastReport: bundle.report });
      res.json({ run, report: bundle.report, frames: bundle.frames, lines: frameLines(bundle.compiled.outputs, bundle.compiled.pulses) });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Rehearse failed'); res.status(500).json({ error: 'rehearse_failed' }); }
    }
  });

  router.post('/rigs/:rigId/arm', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try {
      if (!hasExplicitWriteConfirmation(req.body)) { res.status(428).json(confirmationRequiredPayload('animatronics-arm', 'arm the rig and let frames reach the controller')); return; }
      const power = budgetPower(row.rig, deps.catalog);
      if (power.verdict === 'refuse') { res.status(422).json({ error: 'supply_refused', power }); return; }
      const pose = neutralPose(row.rig);
      const saved = await save(req, { armed: true, currentPose: pose });
      await log(req, 'arm', null, { power, pose }, 1);
      res.json({ rig: pub(saved), power, lines: armLines(saved.rig, pose) });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Arm failed'); res.status(500).json({ error: 'arm_failed' }); }
    }
  });

  router.post('/rigs/:rigId/disarm', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try {
      const saved = await save(req, { armed: false });
      await log(req, 'disarm', null, { reason: String((req.body as Record<string, unknown> | undefined)?.reason ?? 'operator').slice(0, 200) }, 0);
      res.json({ rig: pub(saved), lines: [encodeEstop()] });
    } catch (error) { logger.error({ err: error, rigId: row.rig_id }, 'Disarm failed'); res.status(500).json({ error: 'disarm_failed' }); }
  });

  async function drive(req: RigRequest, res: Response, kind: RunKind, steps: Step[], scenario: string | null, extra: Record<string, unknown> = {}): Promise<void> {
    const row = req.propRig as RigRow;
    const bundle = rehearsalFor(row, deps.catalog, steps, row.current_pose);
    if (bundle.power.verdict === 'refuse') { await log(req, kind, scenario, { ...bundle.report, refused: true }, 0); res.status(422).json({ error: `${kind}_refused`, report: bundle.report }); return; }
    const saved = await save(req, { currentPose: bundle.compiled.end, lastReport: bundle.report });
    const run = await log(req, kind, scenario, bundle.report, bundle.compiled.angles.length);
    res.json({ run, rig: pub(saved), report: bundle.report, frames: bundle.frames, lines: frameLines(bundle.compiled.outputs, bundle.compiled.pulses, run * 100_000), ...extra });
  }

  router.post('/rigs/:rigId/play', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try {
      if (!requireArmed(req, res)) return;
      const { steps, scenario } = stepsFrom((req.body ?? {}) as Record<string, unknown>, row);
      await drive(req, res, 'play', steps, scenario);
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Play failed'); res.status(500).json({ error: 'play_failed' }); }
    }
  });

  router.post('/rigs/:rigId/look-at', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const la = lookAt(row.rig, { azDeg: Number(body.azDeg), elDeg: Number(body.elDeg ?? 0) }, { eyeShare: body.eyeShare === undefined ? undefined : Number(body.eyeShare), eyeMs: body.eyeMs === undefined ? undefined : Number(body.eyeMs), neckMs: body.neckMs === undefined ? undefined : Number(body.neckMs) });
      const extra = { lookAt: { pose: la.pose, residualDeg: la.residualDeg, reachable: la.reachable, used: la.used } };
      if (body.rehearse === true) {
        const bundle = rehearsalFor(row, deps.catalog, la.steps, row.current_pose);
        const run = await log(req, 'rehearse', null, { ...bundle.report, lookAt: extra.lookAt }, bundle.compiled.angles.length);
        res.json({ run, report: bundle.report, frames: bundle.frames, lines: frameLines(bundle.compiled.outputs, bundle.compiled.pulses), ...extra });
        return;
      }
      if (!requireArmed(req, res)) return;
      await drive(req, res, 'look-at', la.steps, null, extra);
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Look-at failed'); res.status(500).json({ error: 'look_at_failed' }); }
    }
  });

  router.post('/rigs/:rigId/jog', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      if (!requireArmed(req, res)) return;
      const ms = body.ms === undefined ? 120 : Number(body.ms);
      const steps = validateScenario({ steps: [{ kind: 'move', axes: body.axes, ms, ease: 'out' }] }, row.rig, lib(row), 'axes').steps;
      await drive(req, res, 'jog', steps, null);
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, rigId: row.rig_id }, 'Jog failed'); res.status(500).json({ error: 'jog_failed' }); }
    }
  });

  router.get('/rigs/:rigId/runs', async (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    try { res.json({ runs: await listRuns(deps.pool, req.propSub as string, row.rig_id) }); }
    catch (error) { logger.error({ err: error, rigId: row.rig_id }, 'List runs failed'); res.status(500).json({ error: 'runs_failed' }); }
  });

  router.get('/rigs/:rigId/manifest', (req: RigRequest, res) => {
    const row = req.propRig as RigRow;
    res.json({ manifest: capabilityManifestFor(`prop-${row.rig_id.slice(0, 8)}`, row.rig, stallOf(row.rig, deps.catalog)) });
  });

  return router;
}
