/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the model API the surface, the concierge's
 *                     |                             | tools and any MCP client all drive: models (create with a
 *                     |                             | base, list, read, rename, delete), the feature list (add,
 *                     |                             | update, remove, move, replace), rebuild, restore a revision
 *                     |                             | (undo), artifacts (STEP, STL, SVG views, report) and a mesh
 *                     |                             | base upload. Every write validates against the feature
 *                     |                             | contract first and then rebuilds through the engine, answering
 *                     |                             | with the model AND the build outcome so an iterating caller
 *                     |                             | sees a refused feature or a stalled engine in the same reply.
 */

import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import { ContractError, validateBase, validateFeature, validateFeatureList, type CadFeature } from './feature-contract';
import { ARTIFACT_TYPES, artifactPath, isArtifactKey, modelDir, requireUuid, revisionDir, type ArtifactKey } from './data-dir';
import { createModel, deleteModel, getModel, getRevision, listModels, listRevisions, updateModel, type ModelRow, type QueryablePool } from './model-store';
import { buildStatus, rebuildModel, storeMeshBase, type BuildOutcome, type RebuildDeps } from './rebuild-service';

const logger = createChildLogger({ module: 'cad-studio-model-routes' });
export const UPLOAD_LIMITS = Object.freeze({ meshBytes: 64 * 1024 * 1024 });
const BASE = '/api/cad-studio';

/** @description What the model router needs from its host. */
export interface ModelRouteDeps extends RebuildDeps {
  pool: QueryablePool;
  callerSub: (req: Request) => string | null;
}

type ModelRequest = Request & { cadSub?: string; cadModel?: ModelRow };

/** @description The model as the API returns it (a mesh base never carries its bytes). */
export function publicModel(model: ModelRow): Record<string, unknown> {
  const base = model.base.kind === 'mesh' ? { kind: 'mesh', bytes: model.base.bytes, sha256: model.base.sha256 } : model.base;
  const artifacts = model.revision > 0 ? Object.fromEntries(['step', 'stl', 'svg-front', 'svg-top', 'svg-right', 'svg-iso', 'report'].map((k) => [k, `${BASE}/models/${model.model_id}/artifacts/${k}?revision=${model.revision}`])) : {};
  return { ...model, base, artifacts };
}

function refuse(res: Response, error: unknown): boolean {
  if (error instanceof ContractError) { res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message }); return true; }
  if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_id', message: error.message }); return true; }
  return false;
}

function answer(res: Response, model: ModelRow, build: BuildOutcome, extra: Record<string, unknown> = {}): void {
  res.status(buildStatus(build)).json({ model: publicModel(model), build, ...extra });
}

function title(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text || fallback;
}

/** Parse a feature body: either `{feature: {...}}` or the feature fields at the top level (tool calls). */
function featureBody(body: Record<string, unknown>): unknown {
  if (body.feature && typeof body.feature === 'object') return body.feature;
  const { modelId: _m, featureId: _f, ...rest } = body;
  return rest;
}

/**
 * @description Build the model router (mounted under the package's oidc mount).
 * @param deps - Pool, engine, data root, caller resolver.
 * @returns The router.
 */
export function createModelRoutes(deps: ModelRouteDeps): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMITS.meshBytes, files: 1 } });

  router.use((req: ModelRequest, res, next) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    req.cadSub = sub;
    next();
  });

  router.param('modelId', async (req: ModelRequest, res, next, value) => {
    try {
      const model = await getModel(deps.pool, req.cadSub as string, requireUuid(value));
      if (!model) { res.status(404).json({ error: 'model_not_found' }); return; }
      req.cadModel = model;
      next();
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error }, 'Load model failed'); res.status(500).json({ error: 'load_failed' }); }
    }
  });

  router.get('/models', async (req: ModelRequest, res) => {
    try { res.json({ models: (await listModels(deps.pool, req.cadSub as string)).map(publicModel) }); }
    catch (error) { logger.error({ err: error }, 'List models failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.post('/models', async (req: ModelRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const rawBase = body.base ?? { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 20 };
      let base = validateBase(rawBase);
      const features = body.features === undefined ? [] : validateFeatureList(body.features);
      const source = body.source && typeof body.source === 'object' && !Array.isArray(body.source) ? (body.source as Record<string, unknown>) : {};
      const settings = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? (body.settings as Record<string, unknown>) : {};
      const stored = await createModel(deps.pool, req.cadSub as string, { title: title(body.title, 'Untitled part'), base: base.kind === 'mesh' ? { kind: 'mesh' } : base, features, source, settings });
      let model = stored;
      if (base.kind === 'mesh') {
        base = storeMeshBase(deps.dataRoot, req.cadSub as string, stored.model_id, Buffer.from(String(base.stl), 'base64'));
        model = (await updateModel(deps.pool, req.cadSub as string, stored.model_id, { base })) ?? stored;
      }
      const built = await rebuildModel(deps, model);
      res.status(built.build.ok ? 201 : buildStatus(built.build)).json({ model: publicModel(built.model), build: built.build });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error }, 'Create model failed'); res.status(500).json({ error: 'create_failed' }); }
    }
  });

  router.get('/models/:modelId', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try { res.json({ model: publicModel(model), revisions: await listRevisions(deps.pool, req.cadSub as string, model.model_id), engine: deps.engine.status() }); }
    catch (error) { logger.error({ err: error, modelId: model.model_id }, 'Read model failed'); res.status(500).json({ error: 'read_failed' }); }
  });

  router.patch('/models/:modelId', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const patch: { title?: string; base?: ModelRow['base']; settings?: Record<string, unknown> } = {};
      if (body.title !== undefined) patch.title = title(body.title, model.title);
      if (body.base !== undefined) {
        const base = validateBase(body.base);
        patch.base = base.kind === 'mesh' ? storeMeshBase(deps.dataRoot, req.cadSub as string, model.model_id, Buffer.from(String(base.stl), 'base64')) : base;
      }
      if (body.settings !== undefined) { if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) throw new ContractError('settings must be an object', 'settings'); patch.settings = { ...model.settings, ...(body.settings as Record<string, unknown>) }; }
      const updated = (await updateModel(deps.pool, req.cadSub as string, model.model_id, patch)) ?? model;
      if (patch.base === undefined && patch.settings === undefined) { res.json({ model: publicModel(updated), build: { ok: true, ms: 0 } }); return; }
      const built = await rebuildModel(deps, updated);
      answer(res, built.model, built.build);
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Update model failed'); res.status(500).json({ error: 'update_failed' }); }
    }
  });

  router.delete('/models/:modelId', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      await deleteModel(deps.pool, req.cadSub as string, model.model_id);
      fs.rmSync(modelDir(deps.dataRoot, req.cadSub as string, model.model_id), { recursive: true, force: true });
      res.json({ deleted: model.model_id });
    } catch (error) { logger.error({ err: error, modelId: model.model_id }, 'Delete model failed'); res.status(500).json({ error: 'delete_failed' }); }
  });

  /** Replace the feature list, then rebuild. */
  async function applyList(req: ModelRequest, res: Response, features: CadFeature[], extra: Record<string, unknown> = {}): Promise<void> {
    const model = req.cadModel as ModelRow;
    const updated = (await updateModel(deps.pool, req.cadSub as string, model.model_id, { features })) ?? model;
    const built = await rebuildModel(deps, updated);
    answer(res, built.model, built.build, extra);
  }

  router.post('/models/:modelId/features', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      const feature = validateFeature(featureBody((req.body ?? {}) as Record<string, unknown>));
      if (model.features.some((f) => f.id === feature.id)) throw new ContractError(`feature id ${feature.id} already exists`, 'id');
      await applyList(req, res, [...model.features, feature], { feature });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Add feature failed'); res.status(500).json({ error: 'feature_failed' }); }
    }
  });

  router.put('/models/:modelId/features', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      await applyList(req, res, validateFeatureList(body.features));
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Replace features failed'); res.status(500).json({ error: 'feature_failed' }); }
    }
  });

  router.patch('/models/:modelId/features/:featureId', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      const index = model.features.findIndex((f) => f.id === req.params.featureId);
      if (index < 0) { res.status(404).json({ error: 'feature_not_found' }); return; }
      const current = model.features[index];
      const body = featureBody((req.body ?? {}) as Record<string, unknown>) as Record<string, unknown>;
      const merged = { ...current, ...body, params: body.params === undefined ? current.params : (body.params && typeof body.params === 'object' && body.merge !== false ? { ...current.params, ...(body.params as Record<string, unknown>) } : body.params) };
      delete (merged as Record<string, unknown>).merge;
      const feature = validateFeature(merged, current.id);
      const features = model.features.slice();
      features[index] = feature;
      await applyList(req, res, features, { feature });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Update feature failed'); res.status(500).json({ error: 'feature_failed' }); }
    }
  });

  router.delete('/models/:modelId/features/:featureId', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      const features = model.features.filter((f) => f.id !== req.params.featureId);
      if (features.length === model.features.length) { res.status(404).json({ error: 'feature_not_found' }); return; }
      await applyList(req, res, features, { removed: req.params.featureId });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Remove feature failed'); res.status(500).json({ error: 'feature_failed' }); }
    }
  });

  router.post('/models/:modelId/features/:featureId/move', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      const from = model.features.findIndex((f) => f.id === req.params.featureId);
      if (from < 0) { res.status(404).json({ error: 'feature_not_found' }); return; }
      const to = Number(((req.body ?? {}) as Record<string, unknown>).to);
      if (!Number.isInteger(to) || to < 0 || to >= model.features.length) throw new ContractError(`to must be an index 0..${model.features.length - 1}`, 'to');
      const features = model.features.slice();
      const [moved] = features.splice(from, 1);
      features.splice(to, 0, moved);
      await applyList(req, res, features, { moved: moved.id, to });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Move feature failed'); res.status(500).json({ error: 'feature_failed' }); }
    }
  });

  router.post('/models/:modelId/rebuild', async (req: ModelRequest, res) => {
    const built = await rebuildModel(deps, req.cadModel as ModelRow);
    answer(res, built.model, built.build);
  });

  router.post('/models/:modelId/restore', async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      const revision = Number(((req.body ?? {}) as Record<string, unknown>).revision);
      if (!Number.isInteger(revision) || revision < 1) throw new ContractError('revision must be a built revision number', 'revision');
      const row = await getRevision(deps.pool, req.cadSub as string, model.model_id, revision);
      if (!row) { res.status(404).json({ error: 'revision_not_found' }); return; }
      await applyList(req, res, validateFeatureList(row.features), { restoredFrom: revision });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Restore failed'); res.status(500).json({ error: 'restore_failed' }); }
    }
  });

  router.post('/models/:modelId/base/mesh', upload.single('stl'), async (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    try {
      if (!req.file || !req.file.buffer.length) { res.status(400).json({ error: 'no_stl' }); return; }
      const base = storeMeshBase(deps.dataRoot, req.cadSub as string, model.model_id, req.file.buffer);
      const updated = (await updateModel(deps.pool, req.cadSub as string, model.model_id, { base })) ?? model;
      const built = await rebuildModel(deps, updated);
      answer(res, built.model, built.build);
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, modelId: model.model_id }, 'Mesh base upload failed'); res.status(500).json({ error: 'mesh_failed' }); }
    }
  });

  router.get('/models/:modelId/artifacts/:key', (req: ModelRequest, res) => {
    const model = req.cadModel as ModelRow;
    const key = req.params.key;
    if (!isArtifactKey(key)) { res.status(404).json({ error: 'unknown_artifact' }); return; }
    const revision = req.query.revision === undefined ? model.revision : Number(req.query.revision);
    if (!Number.isInteger(revision) || revision < 1 || revision > model.revision) { res.status(404).json({ error: 'revision_not_found' }); return; }
    const file = artifactPath(revisionDir(deps.dataRoot, req.cadSub as string, model.model_id, revision), key as ArtifactKey);
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(ARTIFACT_TYPES[key as ArtifactKey]);
    if (req.query.download !== undefined) res.setHeader('Content-Disposition', `attachment; filename="${model.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'model'}-r${revision}.${key.startsWith('svg') ? 'svg' : key === 'report' ? 'json' : key}"`);
    res.sendFile(file);
  });

  return router;
}
