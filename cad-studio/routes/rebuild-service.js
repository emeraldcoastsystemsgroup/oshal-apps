"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SETTINGS = exports.EXPORT_VIEWS = void 0;
exports.rebuildTag = rebuildTag;
exports.cancelRebuild = cancelRebuild;
exports.withModelLock = withModelLock;
exports.storeMeshBase = storeMeshBase;
exports.rebuildModel = rebuildModel;
exports.buildStatus = buildStatus;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const logger_1 = require("@/shared/logger");
const engine_client_1 = require("./engine-client");
const data_dir_1 = require("./data-dir");
const model_store_1 = require("./model-store");
const feature_contract_1 = require("./feature-contract");
const logger = (0, logger_1.createChildLogger)({ module: 'cad-studio-rebuild' });
exports.EXPORT_VIEWS = ['front', 'top', 'right', 'iso'];
exports.DEFAULT_SETTINGS = Object.freeze({ densityGcm3: 1.24, stlToleranceMm: 0.05, featureBudgetMs: 60_000 });
const MESH_FILE = 'base.stl';
const locks = new Map();
/** Each running rebuild (engine round-trip AND its revision or failure record), by tag. */
const active = new Map();
/** @description The engine-request tag of one owner's model: only that owner's routes can form it. */
function rebuildTag(sub, modelId) {
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
async function cancelRebuild(deps, sub, modelId) {
    const tag = rebuildTag(sub, modelId);
    const running = active.get(tag);
    const stage = deps.engine.cancel(tag, 'cancelled by the owner');
    if (stage && running)
        await running.catch(() => undefined);
    logger.info({ modelId, stage }, 'rebuild cancel requested');
    return stage;
}
/** @description Run `fn` after any in-flight rebuild of the same model finishes. */
function withModelLock(modelId, fn) {
    const previous = locks.get(modelId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    locks.set(modelId, next.catch(() => undefined));
    return next;
}
/** @description Persist an uploaded mesh as the model's base file; the stored base only references it. */
function storeMeshBase(dataRoot, sub, modelId, stl) {
    const dir = (0, data_dir_1.ensureDir)((0, data_dir_1.modelDir)(dataRoot, sub, modelId));
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, MESH_FILE), stl);
    return { kind: 'mesh', file: MESH_FILE, bytes: stl.length, sha256: (0, node_crypto_1.createHash)('sha256').update(stl).digest('hex') };
}
/** @description The base as the engine needs it (a mesh reference becomes the file's base64). */
function engineBase(deps, model) {
    const base = model.base;
    if (base.kind !== 'mesh')
        return base;
    const file = node_path_1.default.join((0, data_dir_1.modelDir)(deps.dataRoot, model.owner_sub, model.model_id), MESH_FILE);
    if (!node_fs_1.default.existsSync(file))
        throw new engine_client_1.EngineFailure('refused', 'the mesh base file is missing; upload the STL again');
    return { kind: 'mesh', stl: node_fs_1.default.readFileSync(file).toString('base64') };
}
function settingsOf(model) {
    const s = model.settings || {};
    const density = Number(s.densityGcm3), tol = Number(s.stlToleranceMm), budget = Number(s.featureBudgetMs);
    const budgetOk = Number.isInteger(budget) && budget >= feature_contract_1.FEATURE_BUDGET_MS.min && budget <= feature_contract_1.FEATURE_BUDGET_MS.max;
    return { densityGcm3: Number.isFinite(density) && density > 0 ? density : exports.DEFAULT_SETTINGS.densityGcm3, stlToleranceMm: Number.isFinite(tol) && tol > 0 ? tol : exports.DEFAULT_SETTINGS.stlToleranceMm, featureBudgetMs: budgetOk ? budget : exports.DEFAULT_SETTINGS.featureBudgetMs };
}
function writeExports(dir, result) {
    (0, data_dir_1.ensureDir)(dir);
    // Not named `exports`: under CommonJS that would shadow the module object every top-level
    // export (EXPORT_VIEWS included) is read through.
    const files = result.exports || {};
    if (files.step)
        node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'step'), files.step, 'utf8');
    if (files.stl)
        node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'stl'), Buffer.from(files.stl, 'base64'));
    for (const view of exports.EXPORT_VIEWS) {
        const svg = files.svg?.[view];
        if (svg)
            node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, `svg-${view}`), svg, 'utf8');
    }
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'report'), JSON.stringify({ report: result.report, features: result.features, ms: result.ms }, null, 2), 'utf8');
}
/**
 * @description Rebuild a model: engine round-trip, exports to the next revision dir, revision row.
 * @param deps - Pool, engine, data root.
 * @param model - The model as stored (its features are the list to build).
 * @returns The updated row and the outcome (the row is the last good state on failure).
 */
function rebuildModel(deps, model) {
    return withModelLock(model.model_id, () => {
        // Registered for the whole run, so a cancel waits until the failure is recorded.
        const tag = rebuildTag(model.owner_sub, model.model_id);
        const run = runRebuild(deps, model, tag);
        active.set(tag, run);
        return run.finally(() => { if (active.get(tag) === run)
            active.delete(tag); });
    });
}
/** One rebuild inside the model lock: engine round-trip, exports, revision row — or the failure. */
async function runRebuild(deps, model, tag) {
    const started = Date.now();
    const sub = model.owner_sub;
    try {
        const settings = settingsOf(model);
        const result = await deps.engine.request('rebuild', {
            base: engineBase(deps, model), features: model.features, exports: ['step', 'stl', 'svg'], views: [...exports.EXPORT_VIEWS], ...settings,
        }, deps.timeoutMs, tag);
        const nextRevision = model.revision + 1;
        writeExports((0, data_dir_1.revisionDir)(deps.dataRoot, sub, model.model_id, nextRevision), result);
        const ms = Date.now() - started;
        const row = await (0, model_store_1.recordBuild)(deps.pool, sub, model.model_id, { features: model.features, report: result.report, featureStatus: result.features, engineBuild: deps.engineBuild, ms });
        if (!row)
            throw new engine_client_1.EngineFailure('engine_error', 'the model vanished during the rebuild');
        if (row.revision !== nextRevision)
            logger.warn({ modelId: model.model_id, expected: nextRevision, actual: row.revision }, 'revision drifted under the lock');
        logger.info({ modelId: model.model_id, revision: row.revision, ms, features: model.features.length }, 'model rebuilt');
        return { model: row, build: { ok: true, ms } };
    }
    catch (error) {
        const failure = error instanceof engine_client_1.EngineFailure ? error : new engine_client_1.EngineFailure('engine_error', error instanceof Error ? error.message : String(error));
        logger.error({ err: error, modelId: model.model_id, code: failure.code }, 'model rebuild failed');
        const row = (await (0, model_store_1.recordFailure)(deps.pool, sub, model.model_id, `${failure.code}: ${failure.reason || failure.message}`)) ?? model;
        return { model: row, build: { ok: false, code: failure.code, error: failure.message, reason: failure.reason, ms: Date.now() - started } };
    }
}
/** @description Map a build outcome to the HTTP status the routes answer with. */
function buildStatus(build) {
    if (build.ok)
        return 200;
    switch (build.code) {
        case 'capability_unavailable':
        case 'engine_busy':
        case 'engine_timeout': return 503;
        case 'refused': return 422;
        case 'cancelled': return 409;
        default: return 500;
    }
}
//# sourceMappingURL=rebuild-service.js.map