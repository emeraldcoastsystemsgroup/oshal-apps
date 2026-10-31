/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 lane L2: the spider-18's physics routes on the embodied mount.
 *                     |                             | GET /physics/hexapod/mjcf hands out the model the generator builds
 *                     |                             | from the contract for a jump option; POST /physics/hexapod/check
 *                     |                             | sends that model to the engine container, which stands it, walks
 *                     |                             | it on the tripod gait, walks it inverted through the mirror rule,
 *                     |                             | rolls it over and times the recovery, and jumps it — and the route
 *                     |                             | hands back what was measured beside the contract numbers the model
 *                     |                             | was built from. The check runs without blocking the api; an engine
 *                     |                             | that is down is a 503 naming the install command, as the arm's is.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 integration: the plant and the check load the design's computed masses (buildHexapod) instead of the brief's estimates.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: POST /physics/hexapod/certify {file} sends a training report to the engine's gate with the design's continuous torque (the smallest usable joint torque, never a literal); the engine replays the policy and the gait through the fall and torque limits, rolls a walk policy over, and writes the certificate beside the policy; the route remembers it for the owner and answers the gate's named refusals with their own status.
 */

import type { Request, Response, Router } from 'express';
import { EngineFailure } from './engine/physics/bridge-client';
import { ACTUATOR_ORDER, hexapodFitById, SPIDER_18, type HexapodFit, type JumpOption } from './engine/design/hexapod-spec';
import { buildHexapod } from './engine/design/hexapod-design';

/** The design's computed link masses (ADR-202 brief 1.2: the design's figures supersede the brief's at integration). */
const masses = buildHexapod('spider-18').masses;
import { hexapodMjcf, hexapodPlant, jumpOptionById } from './engine/physics/hexapod-mjcf';

/** How many seeded resets each measurement may be asked for in one check. */
export const HEXAPOD_CHECK_SEEDS = { min: 1, max: 5, fallback: 1 };
/** The check simulates about thirty seconds of walking, rolling and jumping per seed: seconds of wall time, not milliseconds. */
export const HEXAPOD_CHECK_TIMEOUT_MS = 300000;

/** @description One model the engine is asked to check: which jump option it was generated with, and the XML. */
export interface HexapodCheckModel { jump: JumpOption; mjcf: string }

/** @description What the route sends the engine: the models and how many seeded resets per measurement. */
export interface HexapodCheckInput { models: HexapodCheckModel[]; seeds: number }

/** @description What the engine measured for one model (embodied_hexapod.hexapod_check): every number is the simulation's. */
export interface HexapodModelCheck {
  jump: JumpOption;
  hasSpring: boolean;
  stance: { settledHeightM: number | null; standHeightM: number; settled: boolean; peakTorqueNm: number | null };
  walk: { command: { vx: number; vy: number; yawRate: number }; measured: Record<string, number | null>; trackingErrorMps: number | null; costOfTransport: number | null; falls: number; distanceM: number | null }[];
  inverted: { command: Record<string, number>; vxMps: number | null; trackingErrorMps: number | null; falls: number; recover: { detectS: number | null; recoverS: number | null; recovered: number; falls: number } };
  hop: { jump: JumpOption; hopHeightM: number | null; ballisticRiseM: number | null; bodyPeakM: number | null; airborneS: number | null; landedUpright: number; springStoredJBeforeRelease: number | null };
  verdict: { standsAtStandHeight: boolean; walksForward: boolean; invertedWalksForward: boolean; recoversFromFlip: boolean; leavesTheFloor: boolean };
}

/** @description The engine's answer to a check. */
export interface HexapodCheckReport { task: string; seeds: number; models: HexapodModelCheck[]; wallSeconds: number; reportFiles?: string[] }

/** The gate replays the policy and the gait on the evaluation seeds and rolls a walk policy over: tens of seconds of simulation. */
export const HEXAPOD_CERTIFY_TIMEOUT_MS = 300000;

/** @description One refusal the gate lists: the episode (its seed), the step or the actuator, whether it was the roll, and why. */
export interface HexapodRefusal { episode: number; step?: number; actuator?: string; roll?: boolean; reason: string }

/** @description A replay's measurements: the task's facets as a report aggregates them, the control steps checked, the refusals and the torque. */
export type HexapodReplay = Record<string, unknown> & { checked: number; refused: HexapodRefusal[]; refusedCount: number; torque: { rmsMaxNm: number; rmsMaxActuator: string; peakNm: number } };

/**
 * @description The certificate the engine writes beside a policy (engine/tasks/hexapod_certify.py). `ok` is the safety
 * verdict alone -- no fall, every actuator's RMS torque over an episode under the design's continuous torque and its
 * peak under the stall, a walk policy's roll survived -- bound to the policy file's sha256 and the engine build;
 * `policyBeatsBaseline` is re-measured beside it, never folded in.
 */
export interface HexapodCertificate {
  task: 'hexapod-certify'; seed: number | null; reportFile: string; policyFile: string; policySha256: string; buildHash: string; mode: string; jump: JumpOption;
  certifiedTask: 'walk' | 'inverted'; evalSeeds: number[]; limits: { continuousNm: number; stallNm: number }; unit: string; checked: number; refused: HexapodRefusal[]; refusedCount: number; ok: boolean;
  baseline: HexapodReplay; policy: HexapodReplay; verdict: Record<string, boolean>; policyBeatsBaseline: boolean; roll: HexapodReplay | null; certifiedAt: string; wallSeconds: number;
}

/** @description What the route sends the gate: the training report to certify and the design's continuous torque. */
export interface HexapodCertifyInput { file: string; continuousNm: number }

/** @description What the hexapod physics routes need from the mount around them. */
export interface HexapodPhysicsRouteDeps {
  /** The caller's identity, or null when the mount already answered. */
  withSub: (req: Request, res: Response) => string | null;
  /** Run the check in the engine container (the route never runs physics itself). */
  checkHexapod: (input: HexapodCheckInput) => Promise<HexapodCheckReport>;
  /** Run the certification gate in the engine container. */
  certifyHexapod: (input: HexapodCertifyInput) => Promise<HexapodCertificate>;
  /** Remember a certificate for this owner (the same map the drone's gate fills: GET /physics/reports shows it). */
  rememberCertified?: (sub: string, policyFile: string, certificate: HexapodCertificate) => void;
  /** Turn an engine failure into the 503 the rest of the tile uses. */
  physicsFailure: (error: unknown) => { status: number; body: Record<string, unknown> };
}

const FITS: HexapodFit[] = ['spider-18'];

/** @description The fit a query or a body names; `spider-18` when absent. */
function fitOf(value: unknown): HexapodFit | null {
  return hexapodFitById(typeof value === 'string' ? value : undefined);
}

/** @description The contract numbers the model was built from, so the answer says what a measurement is measured against. */
function contractView(jump: JumpOption): Record<string, unknown> {
  const p = hexapodPlant(SPIDER_18, masses);
  return {
    actuators: ACTUATOR_ORDER, standHeightM: p.standHeightM, allUpKg: Number(p.allUpKg.toFixed(6)), servo: { rowId: SPIDER_18.servoRowId, stallNm: p.servo.stallNm, noLoadRadS: p.servo.noLoadRadS },
    jump, spring: jump === 'latched-spring' ? { stiffnessNPerM: p.spring.stiffnessNPerM, strokeM: p.spring.strokeM, storedJ: p.spring.storedJ } : null,
  };
}

/** @description The design's continuous torque: the smallest usable torque over the joint types (one servo row, so one number), what the gate holds an episode's RMS torque to. */
export function continuousTorqueNm(): number {
  return Math.min(...buildHexapod('spider-18').joints.map((j) => j.usableNm));
}

/** A training report is named `hexapod-<task>…json`, never pathed. */
const REPORT_NAME = /^hexapod-[A-Za-z0-9_.-]+\.json$/;
/** How the gate's own refusals answer: a missing report or policy is 404, a report with nothing to certify 422, a bad request 400; anything else is the engine's 503. */
const CERTIFY_REFUSALS: Record<string, number> = { report_not_found: 404, policy_not_found: 404, no_policy: 422, bad_task: 422, bad_request: 400 };

/**
 * @description POST /physics/hexapod/certify {file}: the gate, in the container, with the design's limit; the certificate is remembered for the owner.
 * @param router - The package's router. @param deps - Identity, the gate and the failure shape.
 */
function registerHexapodCertifyRoute(router: Router, deps: HexapodPhysicsRouteDeps): void {
  router.post('/physics/hexapod/certify', async (req: Request, res: Response) => {
    const sub = deps.withSub(req, res); if (!sub) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const file = typeof body.file === 'string' ? body.file.trim() : '';
    if (!file) { res.status(400).json({ error: 'file_required', message: 'the hexapod training report to certify (from GET /physics/reports)' }); return; }
    if (!REPORT_NAME.test(file)) { res.status(400).json({ error: 'bad_file', message: 'a report is named hexapod-<task>…json, never pathed', file }); return; }
    try {
      const certificate = await deps.certifyHexapod({ file, continuousNm: continuousTorqueNm() });
      deps.rememberCertified?.(sub, certificate.policyFile, certificate);
      res.json({ file, policyFile: certificate.policyFile, beatsBaseline: certificate.policyBeatsBaseline, limits: certificate.limits, certification: certificate });
    } catch (error) {
      const refusal = error instanceof EngineFailure ? error.refusal : undefined;
      const status = refusal ? CERTIFY_REFUSALS[refusal] : undefined;
      if (refusal && status) { res.status(status).json({ error: refusal, message: (error as EngineFailure).reason ?? (error as Error).message, file }); return; }
      const failure = deps.physicsFailure(error);
      res.status(failure.status).json(failure.body);
    }
  });
}

/** @description The seeds a body asks for, or null when outside the allowed band. */
function seedsOf(body: Record<string, unknown>): number | null {
  const asked = body.seeds === undefined ? HEXAPOD_CHECK_SEEDS.fallback : Number(body.seeds);
  const seeds = Number.isFinite(asked) ? Math.round(asked) : NaN;
  return seeds >= HEXAPOD_CHECK_SEEDS.min && seeds <= HEXAPOD_CHECK_SEEDS.max ? seeds : null;
}

/**
 * @description Mount the spider-18's physics routes on the embodied router.
 * @param router - The package's router. @param deps - Identity, the engine check and the failure shape.
 */
export function registerHexapodPhysicsRoutes(router: Router, deps: HexapodPhysicsRouteDeps): void {
  router.get('/physics/hexapod/mjcf', (req: Request, res: Response) => {
    if (!deps.withSub(req, res)) return;
    const fit = fitOf(req.query.fit);
    if (!fit) { res.status(400).json({ error: 'unknown_fit', fits: FITS }); return; }
    const jump = jumpOptionById(req.query.jump);
    if (!jump) { res.status(400).json({ error: 'unknown_jump', jumps: SPIDER_18.jumpOptions }); return; }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(hexapodMjcf(SPIDER_18, masses, { jump }));
  });

  router.post('/physics/hexapod/check', async (req: Request, res: Response) => {
    const sub = deps.withSub(req, res); if (!sub) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fit = fitOf(body.fit);
    if (!fit) { res.status(400).json({ error: 'unknown_fit', fits: FITS }); return; }
    const jump = jumpOptionById(body.jump);
    if (!jump) { res.status(400).json({ error: 'unknown_jump', jumps: SPIDER_18.jumpOptions }); return; }
    const seeds = seedsOf(body);
    if (seeds === null) { res.status(400).json({ error: 'bad_seeds', message: `seeds must be between ${HEXAPOD_CHECK_SEEDS.min} and ${HEXAPOD_CHECK_SEEDS.max}` }); return; }
    try {
      const report = await deps.checkHexapod({ models: [{ jump, mjcf: hexapodMjcf(SPIDER_18, masses, { jump }) }], seeds });
      res.json({ simulated: true, fit, jump, seeds, contract: contractView(jump), report });
    } catch (error) {
      const { status, body: failure } = deps.physicsFailure(error);
      res.status(status).json(failure);
    }
  });
  registerHexapodCertifyRoute(router, deps);
}
