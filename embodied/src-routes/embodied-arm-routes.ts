/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printed arm's routes on the embodied mount:
 *                     |                             | the design (every number from the parts model), its document, one
 *                     |                             | part as a CAD Studio program, the MuJoCo model generated from the
 *                     |                             | same design, and the physics check — the engine container holds
 *                     |                             | the payload in each joint's worst pose and runs the taught
 *                     |                             | pick-and-place, and the route hands back what it measured beside
 *                     |                             | what the design expected. The check runs without blocking the api.
 */

import type { Request, Response, Router } from 'express';
import { armDesignMarkdown, ARM_FITS, armFitById, armMjcf, armPlant, buildArm, type ArmDesign, type ArmFit } from './engine';

/** How many scenes the taught pick-and-place may be asked for in one check. */
export const ARM_CHECK_SEEDS = { min: 1, max: 5, fallback: 3 };
/** The check holds six poses and runs a few episodes: seconds, not milliseconds. */
export const ARM_CHECK_TIMEOUT_MS = 120000;

/** @description What the engine container answers for an arm check. */
export interface ArmCheckReport {
  task: string;
  baseline: string;
  payloadKg: number;
  seeds: number;
  holds: { joint: string; designNm: number; measuredNm: number | null; usableNm: number; poseBlocked: boolean; agreesWithDesign: boolean; withinContinuous: boolean }[];
  run: { successRate: number; meanSeconds: number; peakTorqueNm: number[]; meanTorqueNm: number[]; episodes: Record<string, unknown>[] };
  dutyOfContinuous: number[];
  verdict: { holdsItsPayload: boolean; physicsAgreesWithDesign: boolean; taskSucceeds: boolean; withinDutyCycle: boolean };
  wallSeconds: number;
}

/** @description What the arm routes need from the mount around them. */
export interface ArmRouteDeps {
  /** The caller's identity, or null when the mount already answered. */
  withSub: (req: Request, res: Response) => string | null;
  /** Run a check in the engine container (the route never runs physics itself). */
  checkArm: (input: { mjcf: string; worst: number[][]; designNm: number[]; usableNm: number[]; speeds: number[]; payloadKg: number; seeds: number }) => Promise<ArmCheckReport>;
  /** Turn an engine failure into the 503 the rest of the tile uses. */
  physicsFailure: (error: unknown) => { status: number; body: Record<string, unknown> };
}

const fitOf = (req: Request): ArmFit | null => armFitById(typeof req.query.fit === 'string' ? req.query.fit : 'desk-6');

/** @description The design as the tile shows it: the fit, the joints, the parts, the budgets — never the CAD programs' bulk. */
function designView(d: ArmDesign): Record<string, unknown> {
  return {
    fit: { id: d.fit.id, label: d.fit.label, layout: d.fit.layout, payloadKg: d.fit.payloadKg, servo: d.fit.servo },
    joints: d.joints.map((j) => ({ joint: j.joint, name: j.name, gravityNm: j.gravityNm, inertialNm: j.inertialNm, requiredNm: j.requiredNm, worstQ: j.worstQ, drive: j.drive })),
    parts: d.parts.map((p) => ({ id: p.id, name: p.name, qty: p.qty, material: p.material, printNotes: p.printNotes, massEachG: p.massEachG, link: p.link, features: p.cad.features.length, base: p.cad.base })),
    bought: d.bought, spec: d.spec, linkMassesKg: d.linkMassesKg, massBudget: d.massBudget, reachM: d.reachM,
    repeatability: d.repeatability, servoCount: d.servoCount, approxUsd: d.approxUsd, undersized: d.undersized, printRules: d.printRules,
  };
}

/**
 * @description Mount the arm's routes on the embodied router.
 * @param router - The package's router. @param deps - Identity, the engine check and the failure shape.
 */
export function registerArmRoutes(router: Router, deps: ArmRouteDeps): void {
  const fits = Object.keys(ARM_FITS);

  router.get('/build/arm', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { res.status(400).json({ error: 'unknown_fit', fits }); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ simulated: true, generated: true, ...designView(buildArm(fit)) });
  });

  router.get('/build/arm/design.md', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { res.status(400).json({ error: 'unknown_fit', fits }); return; }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(armDesignMarkdown(fit));
  });

  router.get('/build/arm/parts/:partId', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { res.status(400).json({ error: 'unknown_fit', fits }); return; }
    const part = buildArm(fit).parts.find((p) => p.id === req.params.partId);
    if (!part) { res.status(404).json({ error: 'unknown_part' }); return; }
    res.json({ fit, part: { id: part.id, name: part.name, qty: part.qty, material: part.material, massEachG: part.massEachG }, cadStudio: { title: `${part.name} — ${fit}`, base: part.cad.base, features: part.cad.features, source: { package: 'embodied', fit, partId: part.id, qty: part.qty, material: part.material } } });
  });

  router.get('/physics/arm/mjcf', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { res.status(400).json({ error: 'unknown_fit', fits }); return; }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(armMjcf(fit));
  });

  router.post('/physics/arm/check', async (req: Request, res: Response) => {
    const sub = deps.withSub(req, res); if (!sub) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fit = armFitById(typeof body.fit === 'string' ? body.fit : 'desk-6');
    if (!fit) { res.status(400).json({ error: 'unknown_fit', fits }); return; }
    const asked = Number(body.seeds);
    const seeds = Number.isFinite(asked) ? Math.round(asked) : ARM_CHECK_SEEDS.fallback;
    if (seeds < ARM_CHECK_SEEDS.min || seeds > ARM_CHECK_SEEDS.max) { res.status(400).json({ error: 'bad_seeds', message: `seeds must be between ${ARM_CHECK_SEEDS.min} and ${ARM_CHECK_SEEDS.max}` }); return; }
    const design = buildArm(fit);
    const plant = armPlant(fit);
    try {
      const report = await deps.checkArm({
        mjcf: armMjcf(fit), worst: plant.worst.map((w) => w.q), designNm: plant.worst.map((w) => w.nm),
        usableNm: plant.joints.map((j) => j.usableNm), speeds: design.spec.joints.map((j) => j.maxSpeed), payloadKg: design.fit.payloadKg, seeds,
      });
      res.json({ simulated: true, fit, payloadKg: design.fit.payloadKg, joints: design.joints.map((j) => ({ joint: j.joint, name: j.name, requiredNm: j.requiredNm, drive: j.drive?.cfg.label ?? null, usableNm: j.drive?.output.usableNm ?? null })), report });
    } catch (error) {
      const { status, body: failure } = deps.physicsFailure(error);
      res.status(status).json(failure);
    }
  });
}
