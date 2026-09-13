"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_LIMITS = void 0;
exports.publicModel = publicModel;
exports.createModelRoutes = createModelRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const logger_1 = require("@/shared/logger");
const feature_contract_1 = require("./feature-contract");
const data_dir_1 = require("./data-dir");
const model_store_1 = require("./model-store");
const rebuild_service_1 = require("./rebuild-service");
const logger = (0, logger_1.createChildLogger)({ module: 'cad-studio-model-routes' });
exports.UPLOAD_LIMITS = Object.freeze({ meshBytes: 64 * 1024 * 1024 });
const BASE = '/api/cad-studio';
/** @description The model as the API returns it (a mesh base never carries its bytes). */
function publicModel(model) {
    const base = model.base.kind === 'mesh' ? { kind: 'mesh', bytes: model.base.bytes, sha256: model.base.sha256 } : model.base;
    const artifacts = model.revision > 0 ? Object.fromEntries(['step', 'stl', 'svg-front', 'svg-top', 'svg-right', 'svg-iso', 'report'].map((k) => [k, `${BASE}/models/${model.model_id}/artifacts/${k}?revision=${model.revision}`])) : {};
    return { ...model, base, artifacts };
}
function refuse(res, error) {
    if (error instanceof feature_contract_1.ContractError) {
        res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message });
        return true;
    }
    if (error instanceof RangeError) {
        res.status(400).json({ error: 'invalid_id', message: error.message });
        return true;
    }
    return false;
}
function answer(res, model, build, extra = {}) {
    res.status((0, rebuild_service_1.buildStatus)(build)).json({ model: publicModel(model), build, ...extra });
}
function title(value, fallback) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return text || fallback;
}
/** Parse a feature body: either `{feature: {...}}` or the feature fields at the top level (tool calls). */
function featureBody(body) {
    if (body.feature && typeof body.feature === 'object')
        return body.feature;
    const { modelId: _m, featureId: _f, ...rest } = body;
    return rest;
}
/**
 * @description Build the model router (mounted under the package's oidc mount).
 * @param deps - Pool, engine, data root, caller resolver.
 * @returns The router.
 */
function createModelRoutes(deps) {
    const router = (0, express_1.Router)();
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: exports.UPLOAD_LIMITS.meshBytes, files: 1 } });
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        req.cadSub = sub;
        next();
    });
    router.param('modelId', async (req, res, next, value) => {
        try {
            const model = await (0, model_store_1.getModel)(deps.pool, req.cadSub, (0, data_dir_1.requireUuid)(value));
            if (!model) {
                res.status(404).json({ error: 'model_not_found' });
                return;
            }
            req.cadModel = model;
            next();
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Load model failed');
                res.status(500).json({ error: 'load_failed' });
            }
        }
    });
    router.get('/models', async (req, res) => {
        try {
            res.json({ models: (await (0, model_store_1.listModels)(deps.pool, req.cadSub)).map(publicModel) });
        }
        catch (error) {
            logger.error({ err: error }, 'List models failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
    router.post('/models', async (req, res) => {
        const body = (req.body ?? {});
        try {
            const rawBase = body.base ?? { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 20 };
            let base = (0, feature_contract_1.validateBase)(rawBase);
            const features = body.features === undefined ? [] : (0, feature_contract_1.validateFeatureList)(body.features);
            const source = body.source && typeof body.source === 'object' && !Array.isArray(body.source) ? body.source : {};
            const settings = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : {};
            const stored = await (0, model_store_1.createModel)(deps.pool, req.cadSub, { title: title(body.title, 'Untitled part'), base: base.kind === 'mesh' ? { kind: 'mesh' } : base, features, source, settings });
            let model = stored;
            if (base.kind === 'mesh') {
                base = (0, rebuild_service_1.storeMeshBase)(deps.dataRoot, req.cadSub, stored.model_id, Buffer.from(String(base.stl), 'base64'));
                model = (await (0, model_store_1.updateModel)(deps.pool, req.cadSub, stored.model_id, { base })) ?? stored;
            }
            const built = await (0, rebuild_service_1.rebuildModel)(deps, model);
            res.status(built.build.ok ? 201 : (0, rebuild_service_1.buildStatus)(built.build)).json({ model: publicModel(built.model), build: built.build });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Create model failed');
                res.status(500).json({ error: 'create_failed' });
            }
        }
    });
    router.get('/models/:modelId', async (req, res) => {
        const model = req.cadModel;
        try {
            res.json({ model: publicModel(model), revisions: await (0, model_store_1.listRevisions)(deps.pool, req.cadSub, model.model_id), engine: deps.engine.status() });
        }
        catch (error) {
            logger.error({ err: error, modelId: model.model_id }, 'Read model failed');
            res.status(500).json({ error: 'read_failed' });
        }
    });
    router.patch('/models/:modelId', async (req, res) => {
        const model = req.cadModel;
        const body = (req.body ?? {});
        try {
            const patch = {};
            if (body.title !== undefined)
                patch.title = title(body.title, model.title);
            if (body.base !== undefined) {
                const base = (0, feature_contract_1.validateBase)(body.base);
                patch.base = base.kind === 'mesh' ? (0, rebuild_service_1.storeMeshBase)(deps.dataRoot, req.cadSub, model.model_id, Buffer.from(String(base.stl), 'base64')) : base;
            }
            if (body.settings !== undefined) {
                if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings))
                    throw new feature_contract_1.ContractError('settings must be an object', 'settings');
                patch.settings = { ...model.settings, ...body.settings };
            }
            const updated = (await (0, model_store_1.updateModel)(deps.pool, req.cadSub, model.model_id, patch)) ?? model;
            if (patch.base === undefined && patch.settings === undefined) {
                res.json({ model: publicModel(updated), build: { ok: true, ms: 0 } });
                return;
            }
            const built = await (0, rebuild_service_1.rebuildModel)(deps, updated);
            answer(res, built.model, built.build);
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Update model failed');
                res.status(500).json({ error: 'update_failed' });
            }
        }
    });
    router.delete('/models/:modelId', async (req, res) => {
        const model = req.cadModel;
        try {
            await (0, model_store_1.deleteModel)(deps.pool, req.cadSub, model.model_id);
            node_fs_1.default.rmSync((0, data_dir_1.modelDir)(deps.dataRoot, req.cadSub, model.model_id), { recursive: true, force: true });
            res.json({ deleted: model.model_id });
        }
        catch (error) {
            logger.error({ err: error, modelId: model.model_id }, 'Delete model failed');
            res.status(500).json({ error: 'delete_failed' });
        }
    });
    /** Replace the feature list, then rebuild. */
    async function applyList(req, res, features, extra = {}) {
        const model = req.cadModel;
        const updated = (await (0, model_store_1.updateModel)(deps.pool, req.cadSub, model.model_id, { features })) ?? model;
        const built = await (0, rebuild_service_1.rebuildModel)(deps, updated);
        answer(res, built.model, built.build, extra);
    }
    router.post('/models/:modelId/features', async (req, res) => {
        const model = req.cadModel;
        try {
            const feature = (0, feature_contract_1.validateFeature)(featureBody((req.body ?? {})));
            if (model.features.some((f) => f.id === feature.id))
                throw new feature_contract_1.ContractError(`feature id ${feature.id} already exists`, 'id');
            await applyList(req, res, [...model.features, feature], { feature });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Add feature failed');
                res.status(500).json({ error: 'feature_failed' });
            }
        }
    });
    router.put('/models/:modelId/features', async (req, res) => {
        const model = req.cadModel;
        try {
            const body = (req.body ?? {});
            await applyList(req, res, (0, feature_contract_1.validateFeatureList)(body.features));
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Replace features failed');
                res.status(500).json({ error: 'feature_failed' });
            }
        }
    });
    router.patch('/models/:modelId/features/:featureId', async (req, res) => {
        const model = req.cadModel;
        try {
            const index = model.features.findIndex((f) => f.id === req.params.featureId);
            if (index < 0) {
                res.status(404).json({ error: 'feature_not_found' });
                return;
            }
            const current = model.features[index];
            const body = featureBody((req.body ?? {}));
            const merged = { ...current, ...body, params: body.params === undefined ? current.params : (body.params && typeof body.params === 'object' && body.merge !== false ? { ...current.params, ...body.params } : body.params) };
            delete merged.merge;
            const feature = (0, feature_contract_1.validateFeature)(merged, current.id);
            const features = model.features.slice();
            features[index] = feature;
            await applyList(req, res, features, { feature });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Update feature failed');
                res.status(500).json({ error: 'feature_failed' });
            }
        }
    });
    router.delete('/models/:modelId/features/:featureId', async (req, res) => {
        const model = req.cadModel;
        try {
            const features = model.features.filter((f) => f.id !== req.params.featureId);
            if (features.length === model.features.length) {
                res.status(404).json({ error: 'feature_not_found' });
                return;
            }
            await applyList(req, res, features, { removed: req.params.featureId });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Remove feature failed');
                res.status(500).json({ error: 'feature_failed' });
            }
        }
    });
    router.post('/models/:modelId/features/:featureId/move', async (req, res) => {
        const model = req.cadModel;
        try {
            const from = model.features.findIndex((f) => f.id === req.params.featureId);
            if (from < 0) {
                res.status(404).json({ error: 'feature_not_found' });
                return;
            }
            const to = Number((req.body ?? {}).to);
            if (!Number.isInteger(to) || to < 0 || to >= model.features.length)
                throw new feature_contract_1.ContractError(`to must be an index 0..${model.features.length - 1}`, 'to');
            const features = model.features.slice();
            const [moved] = features.splice(from, 1);
            features.splice(to, 0, moved);
            await applyList(req, res, features, { moved: moved.id, to });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Move feature failed');
                res.status(500).json({ error: 'feature_failed' });
            }
        }
    });
    router.post('/models/:modelId/rebuild', async (req, res) => {
        const built = await (0, rebuild_service_1.rebuildModel)(deps, req.cadModel);
        answer(res, built.model, built.build);
    });
    router.post('/models/:modelId/restore', async (req, res) => {
        const model = req.cadModel;
        try {
            const revision = Number((req.body ?? {}).revision);
            if (!Number.isInteger(revision) || revision < 1)
                throw new feature_contract_1.ContractError('revision must be a built revision number', 'revision');
            const row = await (0, model_store_1.getRevision)(deps.pool, req.cadSub, model.model_id, revision);
            if (!row) {
                res.status(404).json({ error: 'revision_not_found' });
                return;
            }
            await applyList(req, res, (0, feature_contract_1.validateFeatureList)(row.features), { restoredFrom: revision });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Restore failed');
                res.status(500).json({ error: 'restore_failed' });
            }
        }
    });
    router.post('/models/:modelId/base/mesh', upload.single('stl'), async (req, res) => {
        const model = req.cadModel;
        try {
            if (!req.file || !req.file.buffer.length) {
                res.status(400).json({ error: 'no_stl' });
                return;
            }
            const base = (0, rebuild_service_1.storeMeshBase)(deps.dataRoot, req.cadSub, model.model_id, req.file.buffer);
            const updated = (await (0, model_store_1.updateModel)(deps.pool, req.cadSub, model.model_id, { base })) ?? model;
            const built = await (0, rebuild_service_1.rebuildModel)(deps, updated);
            answer(res, built.model, built.build);
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, modelId: model.model_id }, 'Mesh base upload failed');
                res.status(500).json({ error: 'mesh_failed' });
            }
        }
    });
    router.get('/models/:modelId/artifacts/:key', (req, res) => {
        const model = req.cadModel;
        const key = req.params.key;
        if (!(0, data_dir_1.isArtifactKey)(key)) {
            res.status(404).json({ error: 'unknown_artifact' });
            return;
        }
        const revision = req.query.revision === undefined ? model.revision : Number(req.query.revision);
        if (!Number.isInteger(revision) || revision < 1 || revision > model.revision) {
            res.status(404).json({ error: 'revision_not_found' });
            return;
        }
        const file = (0, data_dir_1.artifactPath)((0, data_dir_1.revisionDir)(deps.dataRoot, req.cadSub, model.model_id, revision), key);
        if (!node_fs_1.default.existsSync(file)) {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.type(data_dir_1.ARTIFACT_TYPES[key]);
        if (req.query.download !== undefined)
            res.setHeader('Content-Disposition', `attachment; filename="${model.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'model'}-r${revision}.${key.startsWith('svg') ? 'svg' : key === 'report' ? 'json' : key}"`);
        res.sendFile(file);
    });
    return router;
}
//# sourceMappingURL=model-routes.js.map