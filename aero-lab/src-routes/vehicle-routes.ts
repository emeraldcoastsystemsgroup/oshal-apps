/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S4 — the vehicle record's routes, mounted at
 *                     |                             | /api/aero-lab/vehicles behind the manifest's requiresAuth and
 *                     |                             | owner-scoped inside: list the caller's vehicles with their
 *                     |                             | stage computed on read; the kinds with their limit rows and
 *                     |                             | the force models' declared envelopes; a model held to its
 *                     |                             | envelope in a named medium (422 by name, an undeclared model
 *                     |                             | fails closed); seed the Floater from the committed reference
 *                     |                             | design as vehicle + evaluation 1 (idempotent); one record with
 *                     |                             | its stage, budget check and evaluations — an evaluation that
 *                     |                             | cannot name its medium and engine is WITHHELD by name, never
 *                     |                             | listed as a result (D5); and a design-vector change, after
 *                     |                             | which the stage reads concept until re-evaluated (D2).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | D5 closed at the seed. The manifest version is a REAL
 *                     |                             | version or null — never the placeholder 'unknown', which
 *                     |                             | was being persisted as evaluation 1's fingerprint and
 *                     |                             | then listed; the engine hash is taken over a non-empty
 *                     |                             | vendored tree or is null (a hash over zero files names no
 *                     |                             | engine); POST /floater/seed answers 503 run_unfingerprinted
 *                     |                             | naming what is missing and inserts nothing, the refusal
 *                     |                             | embodied makes for the same condition. publishEvaluation
 *                     |                             | withholds a stored row whose fingerprint is not a real
 *                     |                             | version and a 64-hex engine hash.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { engineBuildFiles, engineBuildHash } from './engine-build-hash';
import { FLOATER_KIND, FABRICABLE_SENTENCE, STAGES, firstEvaluation, floaterSeed, loadReferenceDesign, stageOf, type EvaluationLike, type StageView } from './floater-record';
import { FORCE_MODEL_ENVELOPES_SCHEMA, MEDIA_KNOWN, MediumRefusal, listEnvelopes, requireModelValidIn } from './force-model-envelopes';
import {
  findVehicleByName, getVehicle, insertEvaluation, insertVehicle, listEvaluations, listVehicles, updateDesignVector,
  type EvaluationRow, type Pool, type VehicleRow,
} from './vehicle-store';

const logger = createChildLogger({ module: 'aero-lab-vehicle-routes' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The largest design vector a person may post, bytes of JSON. */
const MAX_VECTOR_BYTES = 64 * 1024;

/** @description The signed-in caller, the way the framework stamps a request (oidc sub or oid, or the trusted service sub). @param req - The request. @returns The sub, or null. */
export function callerSub(req: Request): string | null {
  const r = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}

/** A real version string, the shape a manifest's `version:` carries: semver core with an optional pre-release or build tag. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** A sha256 in hex — the only shape an engine build hash takes. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The one plain top-level scalar a package may read of its own manifest without a YAML runtime: a REAL version, or null. Never a placeholder — a placeholder would be persisted as a fingerprint (D5). */
function manifestVersion(packageDir: string): string | null {
  try {
    const source = fs.readFileSync(path.join(packageDir, 'oshal-app.yaml'), 'utf8');
    const match = /^version:\s*([^#\r\n]+)/m.exec(source);
    const version = String(match?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (VERSION.test(version)) return version;
    logger.error({ packageDir, version: version || null }, 'package manifest carries no real version — no evaluation can be fingerprinted (ADR-160 D5)');
    return null;
  } catch (err) {
    logger.error({ err, stack: (err as Error).stack, packageDir }, 'package manifest unreadable — no evaluation can be fingerprinted (ADR-160 D5)');
    return null;
  }
}

/** The vendored engine tree's build hash, or null when there is no tree to hash: a hash over zero files names no engine. */
function engineTreeHash(engineDir: string): string | null {
  try {
    if (engineBuildFiles(engineDir).length === 0) {
      logger.error({ engineDir }, 'engine tree absent or empty — no evaluation can be fingerprinted (ADR-160 D5)');
      return null;
    }
    return engineBuildHash(engineDir);
  } catch (err) {
    logger.error({ err, stack: (err as Error).stack, engineDir }, 'engine tree unreadable — no evaluation can be fingerprinted (ADR-160 D5)');
    return null;
  }
}

/** @description What the seed stamps on evaluation 1, read at request time and never invented. Whatever cannot be read is NAMED in `missing`, and the seed then produces nothing (D5). */
function engineSnapshot(packageDir: string): { snapshot: { packageVersion: string; engineBuildHash: string } | null; missing: string[] } {
  const packageVersion = manifestVersion(packageDir);
  const hash = engineTreeHash(path.join(packageDir, 'engine'));
  const missing = [...(packageVersion ? [] : ['packageVersion']), ...(hash ? [] : ['engineBuildHash'])];
  return { snapshot: packageVersion && hash ? { packageVersion, engineBuildHash: hash } : null, missing };
}

/** @description An evaluation as the record publishes it, or the reason it is withheld (D5). A fingerprint that is not a real version and a real engine hash is no fingerprint. */
function publishEvaluation(row: EvaluationRow): { displayable: true; evaluation: Record<string, unknown> } | { displayable: false; withheld: Record<string, unknown> } {
  const missing: string[] = [];
  if (!row.medium_id) missing.push('mediumId');
  const fp = row.engine_fingerprints ?? {};
  if (typeof fp.packageVersion !== 'string' || !VERSION.test(fp.packageVersion)) missing.push('engineFingerprints.packageVersion');
  if (typeof fp.engineBuildHash !== 'string' || !SHA256_HEX.test(fp.engineBuildHash)) missing.push('engineFingerprints.engineBuildHash');
  if (typeof fp.generator !== 'string' || !fp.generator) missing.push('engineFingerprints.generator');
  if (missing.length) {
    return { displayable: false, withheld: { evaluationId: row.evaluation_id, sequence: row.sequence, missing, because: 'a run result without its medium id and engine fingerprints is not displayed (ADR-160 D5)' } };
  }
  return {
    displayable: true,
    evaluation: { evaluationId: row.evaluation_id, sequence: row.sequence, mediumId: row.medium_id, vectorFingerprint: row.vector_fingerprint, engineFingerprints: row.engine_fingerprints, result: row.result, createdAt: row.created_at },
  };
}

/** A stored evaluation in the shape the stage function reads. */
const asEvaluationLike = (row: EvaluationRow): EvaluationLike => ({ sequence: row.sequence, mediumId: row.medium_id, vectorFingerprint: row.vector_fingerprint, result: row.result });

/** @description A vehicle as the record publishes it, with the stage computed on this read. */
function publishVehicle(row: VehicleRow, evaluations: EvaluationRow[]): { vehicle: Record<string, unknown>; stage: StageView } {
  const stage = stageOf(FLOATER_KIND, row.design_vector, evaluations.map(asEvaluationLike));
  return {
    vehicle: { vehicleId: row.vehicle_id, kind: row.kind, name: row.name, designVector: row.design_vector, provenance: row.provenance, createdAt: row.created_at, updatedAt: row.updated_at },
    stage,
  };
}

/** @description Send a named medium refusal as 422 (or 400 for a medium this lab does not know). */
function sendRefusal(res: Response, error: unknown): boolean {
  if (!(error instanceof MediumRefusal)) return false;
  res.status(error.code === 'unknown_medium' ? 400 : 422).json(error.toJSON());
  return true;
}

/**
 * @description Build the /api/aero-lab/vehicles router. Accepts either the bare AppContext (how the
 * manifest mounter invokes a factory with requiresContext) or a {ctx} wrapper. Auth is the manifest's
 * `requiresAuth: true` on the whole mount; every handler additionally reads the caller and 401s
 * without one, and every query is owner-scoped on top of the migration's FORCEd owner RLS.
 * @param arg - The AppContext, or {ctx}.
 * @returns The router.
 */
export function createAeroVehicleRoutes(arg: AppContext | { ctx: AppContext }): Router {
  const ctx = ('ctx' in arg && arg.ctx && typeof arg.ctx === 'object' && 'pool' in (arg.ctx as object) ? arg.ctx : arg) as AppContext;
  const pool: Pool = ctx.pool;
  const packageDir = ctx.appPackageDir ?? process.env.OSHAL_APP_PACKAGE_DIR ?? path.resolve(__dirname, '..');
  const router = Router();

  const withSub = (req: Request, res: Response): string | null => {
    const sub = callerSub(req);
    if (!sub) res.status(401).json({ error: 'not_authenticated' });
    return sub;
  };

  router.get('/', (req: Request, res: Response) => {
    const sub = withSub(req, res); if (!sub) return;
    const started = Date.now();
    void (async (): Promise<void> => {
      try {
        const rows = await listVehicles(pool, sub);
        const vehicles = [];
        for (const row of rows) vehicles.push(publishVehicle(row, await listEvaluations(pool, sub, row.vehicle_id)));
        logger.info({ count: vehicles.length, durationMs: Date.now() - started }, 'GET /vehicles done');
        res.json({ vehicles, stages: STAGES, fabricable: FABRICABLE_SENTENCE });
      } catch (err) {
        logger.error({ err, stack: (err as Error).stack }, 'GET /vehicles failed');
        res.status(500).json({ error: 'vehicles unavailable' });
      }
    })();
  });

  router.get('/kinds', (req: Request, res: Response) => {
    if (!withSub(req, res)) return;
    res.json({ kinds: [FLOATER_KIND], stages: STAGES, fabricable: FABRICABLE_SENTENCE, forceModels: { schema: FORCE_MODEL_ENVELOPES_SCHEMA, mediaKnown: MEDIA_KNOWN, models: listEnvelopes(), undeclared: 'fails closed: valid in the default medium only, refused by name elsewhere' } });
  });

  /** GET /force-models/:model/in/:medium — the envelope check, by name. An undeclared model fails closed. */
  router.get('/force-models/:model/in/:medium', (req: Request, res: Response) => {
    if (!withSub(req, res)) return;
    const model = String(req.params.model).slice(0, 64);
    const medium = String(req.params.medium).slice(0, 32);
    try {
      const envelope = requireModelValidIn(model, medium);
      res.json({ model, medium, valid: true, envelope });
    } catch (error) {
      if (sendRefusal(res, error)) { logger.info({ model, medium, refusal: (error as MediumRefusal).refusal }, 'force model refused by name'); return; }
      logger.error({ err: error, stack: (error as Error).stack }, 'force-model check failed');
      res.status(500).json({ error: 'force-model check failed' });
    }
  });

  /** POST /floater/seed — the Floater from the committed reference design: the vehicle and evaluation 1. Idempotent per owner. */
  router.post('/floater/seed', (req: Request, res: Response) => {
    const sub = withSub(req, res); if (!sub) return;
    const started = Date.now();
    void (async (): Promise<void> => {
      try {
        const existing = await findVehicleByName(pool, sub, FLOATER_KIND.id, 'Floater');
        if (existing) {
          const evaluations = await listEvaluations(pool, sub, existing.vehicle_id);
          res.status(200).json({ ...publishVehicle(existing, evaluations), evaluations: evaluations.map(publishEvaluation), seeded: false });
          return;
        }
        const engine = engineSnapshot(packageDir);
        if (!engine.snapshot) {
          logger.error({ missing: engine.missing, durationMs: Date.now() - started }, 'POST /vehicles/floater/seed refused — the package cannot name its engine, so no evaluation is produced (ADR-160 D5)');
          res.status(503).json({ error: 'run_unfingerprinted', missing: engine.missing, message: 'this package cannot name its own version or engine tree, so evaluation 1 would carry no engine fingerprint; nothing is seeded rather than a result nothing may display (ADR-160 D5)' });
          return;
        }
        const ref = loadReferenceDesign(packageDir);
        const seed = floaterSeed(ref);
        const vehicle = await insertVehicle(pool, sub, seed.kind, seed.name, seed.designVector, seed.provenance);
        const draft = firstEvaluation(ref, seed, engine.snapshot);
        const evaluation = await insertEvaluation(pool, sub, vehicle.vehicle_id, { ...draft, engineFingerprints: { ...draft.engineFingerprints } });
        logger.info({ vehicleId: vehicle.vehicle_id, budget: (draft.result.budget as { status: string }).status, durationMs: Date.now() - started }, 'POST /vehicles/floater/seed done');
        res.status(201).json({ ...publishVehicle(vehicle, [evaluation]), evaluations: [publishEvaluation(evaluation)], seeded: true });
      } catch (err) {
        logger.error({ err, stack: (err as Error).stack }, 'POST /vehicles/floater/seed failed');
        res.status(500).json({ error: 'the Floater could not be seeded from the reference design', reason: (err as Error).message });
      }
    })();
  });

  router.get('/:id', (req: Request, res: Response) => {
    const sub = withSub(req, res); if (!sub) return;
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ error: 'vehicle_not_found' }); return; }
    void (async (): Promise<void> => {
      try {
        const row = await getVehicle(pool, sub, id);
        if (!row) { res.status(404).json({ error: 'vehicle_not_found' }); return; }
        const evaluations = await listEvaluations(pool, sub, id);
        const published = evaluations.map(publishEvaluation);
        res.json({
          ...publishVehicle(row, evaluations),
          kind: FLOATER_KIND,
          evaluations: published.filter((e) => e.displayable).map((e) => (e as { evaluation: Record<string, unknown> }).evaluation),
          withheld: published.filter((e) => !e.displayable).map((e) => (e as { withheld: Record<string, unknown> }).withheld),
        });
      } catch (err) {
        logger.error({ err, stack: (err as Error).stack, id }, 'GET /vehicles/:id failed');
        res.status(500).json({ error: 'vehicle unavailable' });
      }
    })();
  });

  /** PATCH /:id/design {designVector} — replace the authored part. The stage drops to concept until re-evaluated (D2). */
  router.patch('/:id/design', (req: Request, res: Response) => {
    const sub = withSub(req, res); if (!sub) return;
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ error: 'vehicle_not_found' }); return; }
    const vector = (req.body || {}).designVector;
    if (!vector || typeof vector !== 'object' || Array.isArray(vector) || Object.keys(vector).length === 0) {
      res.status(400).json({ error: 'designVector (non-empty object) is required' });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(vector), 'utf8') > MAX_VECTOR_BYTES) { res.status(413).json({ error: `designVector exceeds ${MAX_VECTOR_BYTES} bytes` }); return; }
    void (async (): Promise<void> => {
      try {
        const row = await updateDesignVector(pool, sub, id, vector as Record<string, unknown>);
        if (!row) { res.status(404).json({ error: 'vehicle_not_found' }); return; }
        const evaluations = await listEvaluations(pool, sub, id);
        logger.info({ id }, 'PATCH /vehicles/:id/design done — the stage recomputes on the next read');
        res.json(publishVehicle(row, evaluations));
      } catch (err) {
        logger.error({ err, stack: (err as Error).stack, id }, 'PATCH /vehicles/:id/design failed');
        res.status(500).json({ error: 'design vector not updated' });
      }
    })();
  });

  return router;
}
