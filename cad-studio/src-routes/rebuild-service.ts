/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — one rebuild: expand the stored base (a mesh
 *                     |                             | base is read from disk), send base + list to the engine, write
 *                     |                             | the exports (STEP, STL, four SVG views, report) into the NEXT
 *                     |                             | revision's directory, then record the revision — or record the
 *                     |                             | failure and keep the last good revision. Rebuilds of one model
 *                     |                             | are serialised so two edits cannot interleave a revision.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B5: the per-feature budget (settings.featureBudgetMs,
 *                     |                             | default 60 s) goes to the worker with every rebuild; each
 *                     |                             | rebuild's engine request is tagged by owner + model, and
 *                     |                             | cancelRebuild stops it — the rebuild's own failure path then
 *                     |                             | records the cancel and keeps the last good revision. A
 *                     |                             | cancelled rebuild answers 409.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createChildLogger } from '@/shared/logger';
import { EngineFailure, type EngineClient } from './engine-client';
import { artifactPath, ensureDir, modelDir, revisionDir } from './data-dir';
import { recordBuild, recordFailure, type ModelRow, type QueryablePool } from './model-store';
import { FEATURE_BUDGET_MS, type CadBase } from './feature-contract';

const logger = createChildLogger({ module: 'cad-studio-rebuild' });
export const EXPORT_VIEWS = ['front', 'top', 'right', 'iso'] as const;
export const DEFAULT_SETTINGS = Object.freeze({ densityGcm3: 1.24, stlToleranceMm: 0.05, featureBudgetMs: 60_000 });
const MESH_FILE = 'base.stl';

export interface RebuildDeps { pool: QueryablePool; engine: EngineClient; dataRoot: string; engineBuild: string | null; timeoutMs?: number }

/** @description The outcome the routes report beside the model. */
export interface BuildOutcome { ok: boolean; code?: string; error?: string; reason?: string; ms?: number }

interface EngineResult { report: Record<string, unknown>; features: Array<Record<string, unknown>>; exports?: { step?: string; stl?: string; svg?: Record<string, string> }; ms?: number }

const locks = new Map<string, Promise<unknown>>();
/** Each running rebuild (engine round-trip AND its revision or failure record), by tag. */
const active = new Map<string, Promise<unknown>>();

/** @description The engine-request tag of one owner's model: only that owner's routes can form it. */
export function rebuildTag(sub: string, modelId: string): string {
  return JSON.stringify([sub, modelId]);
}

/**
 * @description Stop the model's running (or queued) rebuild. The rebuild's own failure path
 * records the cancel and keeps the last good revision; this waits for that record.
 * @param deps - The engine the rebuild was sent to.
 * @param sub - Owner.
 * @param modelId - Model.
 * @returns Where the rebuild was stopped, or null when none was running for this model.
 */
export async function cancelRebuild(deps: Pick<RebuildDeps, 'engine'>, sub: string, modelId: string): Promise<'inflight' | 'queued' | null> {
  const tag = rebuildTag(sub, modelId);
  const running = active.get(tag);
  const stage = deps.engine.cancel(tag, 'cancelled by the owner');
  if (stage && running) await running.catch(() => undefined);
  logger.info({ modelId, stage }, 'rebuild cancel requested');
  return stage;
}

/** @description Run `fn` after any in-flight rebuild of the same model finishes. */
export function withModelLock<T>(modelId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(modelId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(modelId, next.catch(() => undefined));
  return next;
}

/** @description Persist an uploaded mesh as the model's base file; the stored base only references it. */
export function storeMeshBase(dataRoot: string, sub: string, modelId: string, stl: Buffer): CadBase {
  const dir = ensureDir(modelDir(dataRoot, sub, modelId));
  fs.writeFileSync(path.join(dir, MESH_FILE), stl);
  return { kind: 'mesh', file: MESH_FILE, bytes: stl.length, sha256: createHash('sha256').update(stl).digest('hex') };
}

/** @description The base as the engine needs it (a mesh reference becomes the file's base64). */
function engineBase(deps: RebuildDeps, model: ModelRow): CadBase {
  const base = model.base;
  if (base.kind !== 'mesh') return base;
  const file = path.join(modelDir(deps.dataRoot, model.owner_sub, model.model_id), MESH_FILE);
  if (!fs.existsSync(file)) throw new EngineFailure('refused', 'the mesh base file is missing; upload the STL again');
  return { kind: 'mesh', stl: fs.readFileSync(file).toString('base64') };
}

function settingsOf(model: ModelRow): { densityGcm3: number; stlToleranceMm: number; featureBudgetMs: number } {
  const s = model.settings || {};
  const density = Number(s.densityGcm3), tol = Number(s.stlToleranceMm), budget = Number(s.featureBudgetMs);
  const budgetOk = Number.isInteger(budget) && budget >= FEATURE_BUDGET_MS.min && budget <= FEATURE_BUDGET_MS.max;
  return { densityGcm3: Number.isFinite(density) && density > 0 ? density : DEFAULT_SETTINGS.densityGcm3, stlToleranceMm: Number.isFinite(tol) && tol > 0 ? tol : DEFAULT_SETTINGS.stlToleranceMm, featureBudgetMs: budgetOk ? budget : DEFAULT_SETTINGS.featureBudgetMs };
}

function writeExports(dir: string, result: EngineResult): void {
  ensureDir(dir);
  // Not named `exports`: under CommonJS that would shadow the module object every top-level
  // export (EXPORT_VIEWS included) is read through.
  const files = result.exports || {};
  if (files.step) fs.writeFileSync(artifactPath(dir, 'step'), files.step, 'utf8');
  if (files.stl) fs.writeFileSync(artifactPath(dir, 'stl'), Buffer.from(files.stl, 'base64'));
  for (const view of EXPORT_VIEWS) {
    const svg = files.svg?.[view];
    if (svg) fs.writeFileSync(artifactPath(dir, `svg-${view}` as 'svg-front'), svg, 'utf8');
  }
  fs.writeFileSync(artifactPath(dir, 'report'), JSON.stringify({ report: result.report, features: result.features, ms: result.ms }, null, 2), 'utf8');
}

/**
 * @description Rebuild a model: engine round-trip, exports to the next revision dir, revision row.
 * @param deps - Pool, engine, data root.
 * @param model - The model as stored (its features are the list to build).
 * @returns The updated row and the outcome (the row is the last good state on failure).
 */
export function rebuildModel(deps: RebuildDeps, model: ModelRow): Promise<{ model: ModelRow; build: BuildOutcome }> {
  return withModelLock(model.model_id, () => {
    // Registered for the whole run, so a cancel waits until the failure is recorded.
    const tag = rebuildTag(model.owner_sub, model.model_id);
    const run = runRebuild(deps, model, tag);
    active.set(tag, run);
    return run.finally(() => { if (active.get(tag) === run) active.delete(tag); });
  });
}

/** One rebuild inside the model lock: engine round-trip, exports, revision row — or the failure. */
async function runRebuild(deps: RebuildDeps, model: ModelRow, tag: string): Promise<{ model: ModelRow; build: BuildOutcome }> {
  const started = Date.now();
  const sub = model.owner_sub;
  try {
    const settings = settingsOf(model);
    const result = await deps.engine.request('rebuild', {
      base: engineBase(deps, model), features: model.features, exports: ['step', 'stl', 'svg'], views: [...EXPORT_VIEWS], ...settings,
    }, deps.timeoutMs, tag) as EngineResult;
    const nextRevision = model.revision + 1;
    writeExports(revisionDir(deps.dataRoot, sub, model.model_id, nextRevision), result);
    const ms = Date.now() - started;
    const row = await recordBuild(deps.pool, sub, model.model_id, { features: model.features, report: result.report, featureStatus: result.features, engineBuild: deps.engineBuild, ms });
    if (!row) throw new EngineFailure('engine_error', 'the model vanished during the rebuild');
    if (row.revision !== nextRevision) logger.warn({ modelId: model.model_id, expected: nextRevision, actual: row.revision }, 'revision drifted under the lock');
    logger.info({ modelId: model.model_id, revision: row.revision, ms, features: model.features.length }, 'model rebuilt');
    return { model: row, build: { ok: true, ms } };
  } catch (error) {
    const failure = error instanceof EngineFailure ? error : new EngineFailure('engine_error', error instanceof Error ? error.message : String(error));
    logger.error({ err: error, modelId: model.model_id, code: failure.code }, 'model rebuild failed');
    const row = (await recordFailure(deps.pool, sub, model.model_id, `${failure.code}: ${failure.reason || failure.message}`)) ?? model;
    return { model: row, build: { ok: false, code: failure.code, error: failure.message, reason: failure.reason, ms: Date.now() - started } };
  }
}

/** @description Map a build outcome to the HTTP status the routes answer with. */
export function buildStatus(build: BuildOutcome): number {
  if (build.ok) return 200;
  switch (build.code) {
    case 'capability_unavailable': case 'engine_busy': case 'engine_timeout': return 503;
    case 'refused': return 422;
    case 'cancelled': return 409;
    default: return 500;
  }
}
