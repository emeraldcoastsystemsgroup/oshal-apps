"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REGION_EDIT_COST_AGENT_ID = void 0;
exports.regionEditSettings = regionEditSettings;
exports.loadRegionModule = loadRegionModule;
exports.regionInstruction = regionInstruction;
exports.acceptedInput = acceptedInput;
exports.registerRegionEditRoutes = registerRegionEditRoutes;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Selected-region regeneration behind the separately named project.generate permission: validate the request against the exact source revision with the same selection module the browser runs, generate through the media-generation kernel skill with the region crop as the one anchor, composite only inside the region, and keep the result as a candidate the person accepts (optimistic on the revision they hold), rejects or cancels. Spend is captured in the canonical ledger; manual editing never reaches this path.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Advertise cost-consent v1 and validate optional per-request cost-class caps before storage work. Enforce the cap on the actual post-queue provider immediately before generation; omitted caps preserve legacy behavior.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Accept the operator-only antigravity-cli rail (operator decision 2026-10-02, core ADR-130 amendment: the render bot's own harness picks the storyboard image rail). The provider must report itself available for this person before generation (the kernel's CLI rails are available only to the deployment operator in demo mode), and a person the resolver has no provider for gets region_edit_provider_unavailable on the edit and configured:false on the provider report, never another provider and never a 500. codex-cli stays refused by name; project.generate is still checked first.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.16.0: a picture from a sentence (POST /generated-images, behind project.generate): saved as a layer of a new or named project, finished inside the request, local provider only, a daily ceiling counted from the person's saved images.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.20.1: image spend is attributed to create-editor (992feff6-bda5-4d30-a075-22fd6f4aa9ee), the concierge Create declares since its chatBot moved off general-bot. The constant still named the platform general-bot's core registry id a0...0099, which Create neither declares nor imports (scripts/check-store-bots.mjs PENDING). Attribution only: the native image provider reports no cost, so no spend row is written there, and generation, permissions and the cost cap are unchanged.
 */
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
const logger_1 = require("@/shared/logger");
const video_generation_1 = require("@/features/video-generation");
const create_project_types_1 = require("./create-project-types");
const create_project_validation_1 = require("./create-project-validation");
const create_project_authorization_1 = require("./create-project-authorization");
const create_project_assets_1 = require("./create-project-assets");
const create_region_edit_store_1 = require("./create-region-edit-store");
const create_region_edit_composite_1 = require("./create-region-edit-composite");
const logger = (0, logger_1.createChildLogger)({ module: 'create-region-edit-routes' });
/** Image spend is attributed to the concierge Create declares (chatBot: create-editor, bots[] in oshal-app.yaml) and to the person. */
exports.REGION_EDIT_COST_AGENT_ID = '992feff6-bda5-4d30-a075-22fd6f4aa9ee';
const bodyParser = (0, express_1.json)({ limit: 262144, strict: true });
const IMAGE_PROMPT_CHARS = 1000;
/** Inside the kernel's 60 second package call. */
const IMAGE_REQUEST_MS = 55000;
const DEFAULT_DEPENDENCIES = {
    resolveProvider: options => (0, video_generation_1.resolveStoryboardImageProvider)(options),
    recordCost: (pool, event) => (0, video_generation_1.recordStoryboardImageCost)(pool, event),
};
function bounded(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
/**
 * @description Operator-tunable ceilings, read once when the router is built.
 * @param env - Process environment.
 * @returns Daily requests per person, concurrent provider calls per process and the provider deadline.
 */
function regionEditSettings(env = process.env) {
    return { dailyCap: bounded(env.CREATE_REGION_EDIT_DAILY_CAP, 25, 1, 1000), concurrency: bounded(env.CREATE_REGION_EDIT_MAX_CONCURRENT, 2, 1, 16),
        timeoutMs: bounded(env.CREATE_REGION_EDIT_TIMEOUT_MS, 120000, 10000, 600000), imageDailyCap: bounded(env.CREATE_IMAGE_DAILY_CAP, 25, 1, 1000) };
}
/** A process-wide bound on concurrent provider calls, shared by every person. */
class Slots {
    limit;
    active = 0;
    waiting = [];
    constructor(limit) {
        this.limit = limit;
    }
    async acquire() {
        if (this.active < this.limit) {
            this.active++;
            return;
        }
        await new Promise(done => this.waiting.push(done));
    }
    release() { const next = this.waiting.shift(); if (next)
        next();
    else
        this.active--; }
}
/**
 * @description Capture the installed region-selection module once, keyed by its bytes like the project validator.
 * @param packageDir - Installed package root.
 * @returns The browser's own validateSelection and resolveSelection.
 */
function loadRegionModule(packageDir) {
    const file = (0, node_path_1.resolve)(packageDir, 'tools/editor/region-select.mjs');
    const url = (0, node_url_1.pathToFileURL)(file);
    url.searchParams.set('revision', (0, node_crypto_1.createHash)('sha256').update((0, node_fs_1.readFileSync)(file)).digest('hex'));
    return import(url.href);
}
/**
 * @description One instruction: 1 to 1000 characters after trimming, no control characters other than line breaks and tabs.
 * @param value - Candidate instruction.
 * @returns The trimmed instruction.
 */
function regionInstruction(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
        throw new create_project_types_1.ProjectError(400, 'invalid_region_instruction');
    return text;
}
/**
 * @description The child document an accepted candidate becomes: the current revision with only the target layer's image replaced.
 * @param current - Current revision title and document. @param edit - Ready region edit. @param validate - Shared model validator.
 * @returns Title and validated reference-mode document; a replaced or deleted target is 409 stale, a locked one 409 locked.
 */
function acceptedInput(current, edit, validate) {
    const document = current.document;
    const layer = document.layers.find(item => item.id === edit.layerId), image = layer && document.images[String(layer.assetId)];
    if (!layer || layer.type !== 'image' || image?.src !== create_project_types_1.PROJECT_ASSET_PREFIX + edit.sourceAssetId || !edit.resultAsset)
        throw new create_project_types_1.ProjectError(409, 'region_edit_stale');
    if (layer.locked)
        throw new create_project_types_1.ProjectError(409, 'region_edit_layer_locked');
    let key = `region-${edit.id.slice(0, 8)}`;
    for (let suffix = 2; Object.hasOwn(document.images, key); suffix++)
        key = `region-${edit.id.slice(0, 8)}-${suffix}`;
    const images = { ...document.images, [key]: { src: edit.resultAsset.src, width: edit.resultAsset.width, height: edit.resultAsset.height } };
    const layers = document.layers.map(item => item.id === layer.id ? { ...item, assetId: key } : item);
    if (!layers.some(item => item.type === 'image' && item.assetId === layer.assetId))
        delete images[String(layer.assetId)];
    return { title: current.title, document: (0, create_project_validation_1.validateDocument)({ ...document, layers, images }, validate) };
}
function admit(env, action) {
    return (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        Promise.resolve().then(() => {
            if (typeof env.ctx.pool?.connect !== 'function')
                throw new create_project_types_1.ProjectError(503, 'project_store_unavailable');
            env.guards.personalOnly(req);
        }).then(() => (0, create_project_authorization_1.requireProjectAccess)(env.ctx, action)).then(() => next()).catch(error => env.guards.sendError(res, error));
    };
}
function handler(env, action, work) {
    return (req, res) => { (0, create_project_authorization_1.requireProjectAccess)(env.ctx, action).then(owner => work(req, res, owner)).catch(error => env.guards.sendError(res, error)); };
}
function confirm(env, action, owner) {
    return async () => { await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, action, owner); };
}
/** An omitted cap retains legacy semantics; a supplied cap must be one exact known class. */
function regionCostCap(body) {
    if (!Object.hasOwn(body, 'maxCostClass'))
        return undefined;
    if (body.maxCostClass !== 'free' && body.maxCostClass !== 'paid')
        throw new create_project_types_1.ProjectError(400, 'invalid_region_cost_cap');
    return body.maxCostClass;
}
/** Validate the body with no database work, then resolve the selection against the exact stored source revision. */
async function regionRequest(env, id, body, owner) {
    (0, create_project_validation_1.exactFields)(body, ['sourceRevision', 'selection', 'instruction', 'maxCostClass']);
    const maxCostClass = regionCostCap(body);
    const sourceRevision = (0, create_project_validation_1.baseRevision)(body.sourceRevision), instruction = regionInstruction(body.instruction), module = await env.region;
    let selection;
    try {
        selection = module.validateSelection(body.selection);
    }
    catch {
        throw new create_project_types_1.ProjectError(400, 'invalid_region_selection');
    }
    const source = await env.projects.get(owner, id, sourceRevision);
    let assetKey;
    try {
        assetKey = module.resolveSelection(source.document, selection).layer.assetId;
    }
    catch {
        throw new create_project_types_1.ProjectError(409, 'region_selection_stale');
    }
    const image = source.document.images[assetKey];
    return { maxCostClass, request: { projectId: id, sourceRevision, layerId: selection.layerId,
            sourceAssetId: (0, create_project_validation_1.projectId)(image.src.slice(create_project_types_1.PROJECT_ASSET_PREFIX.length)), selection, instruction } };
}
function withTimeout(work, milliseconds) {
    let timer;
    const deadline = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new create_project_types_1.ProjectError(504, 'region_edit_provider_timeout')), milliseconds); });
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
async function generate(provider, prompt, anchor) {
    if (provider.generateWithMeta)
        return provider.generateWithMeta(prompt, anchor);
    return { image: await provider.generate(prompt, anchor), costUsd: null, model: `${provider.id}-default` };
}
/** Capped work cannot reach an unknown cost class or escalate from free to paid. No provider fallback is permitted. */
function enforceCostCap(provider, maxCostClass) {
    if (maxCostClass === undefined)
        return;
    if ((provider.costClass !== 'free' && provider.costClass !== 'paid') || (maxCostClass === 'free' && provider.costClass !== 'free')) {
        throw new create_project_types_1.ProjectError(409, 'region_edit_cost_cap_exceeded');
    }
}
/** This person's provider, or null when the resolver has none for them (for example a CLI rail that serves only the operator). Never a fallback. */
async function resolveFor(env, owner) {
    try {
        return await env.deps.resolveProvider({ userSub: owner.sub });
    }
    catch (error) {
        logger.error({ err: error }, 'no image provider is configured for this person; region editing is unavailable to them');
        return null;
    }
}
/** The command-line codex transport is refused by name; any other provider serves only when it reports itself available for this person. */
async function servesRegionEdits(provider) {
    return provider.id !== 'codex-cli' && await provider.available();
}
/** Provider answer to candidate: re-check permission and cost cap before the call, capture spend, composite, then attach only if still wanted. */
async function produceCandidate(env, owner, edit, allowed, maxCostClass) {
    const started = Date.now(), source = await (0, create_project_assets_1.readProjectImage)(env.dataRoot, env.projects, owner, edit.sourceAssetId);
    const anchor = await (0, create_region_edit_composite_1.regionAnchor)(source, (0, create_region_edit_composite_1.regionCropBox)(edit.selection)), provider = await resolveFor(env, owner);
    if (!provider || !(await servesRegionEdits(provider)))
        throw new create_project_types_1.ProjectError(503, 'region_edit_provider_unavailable');
    await allowed();
    enforceCostCap(provider, maxCostClass);
    const answer = await withTimeout(generate(provider, (0, create_region_edit_composite_1.regionPrompt)(edit.instruction), anchor), env.settings.timeoutMs);
    if (typeof answer.costUsd === 'number' && answer.costUsd > 0) {
        await env.deps.recordCost(env.ctx.pool, { taskId: `create-region-edit-${edit.id}`, agentId: exports.REGION_EDIT_COST_AGENT_ID, ownerSub: owner.sub,
            providerId: `image-provider:${provider.id}`, model: answer.model, costUsd: answer.costUsd, durationMs: Date.now() - started });
    }
    await allowed();
    const composite = await (0, create_region_edit_composite_1.compositeRegion)(source, edit.selection, answer.image);
    const asset = await (0, create_project_assets_1.saveProjectImage)(env.dataRoot, env.projects, owner, composite.png, allowed);
    const attached = await env.edits.complete(owner, edit.projectId, edit.id, { asset, provider: provider.id, model: answer.model, costUsd: answer.costUsd }, allowed);
    logger.info({ editId: edit.id, provider: provider.id, model: answer.model, costUsd: answer.costUsd, attached, changedPixels: composite.changedPixels,
        durationMs: Date.now() - started }, attached ? 'region edit candidate ready' : 'region edit finished after it was cancelled; candidate discarded');
}
/** Background half of a request: bounded by the process-wide slots; every failure is recorded and nothing touches the project. */
async function runRegionEdit(env, owner, edit, maxCostClass) {
    await env.slots.acquire();
    try {
        await produceCandidate(env, owner, edit, confirm(env, 'generate', owner), maxCostClass);
    }
    catch (error) {
        const code = error instanceof create_project_types_1.ProjectError ? error.code : 'region_edit_provider_failed';
        logger.error({ err: error, editId: edit.id, code }, 'region edit failed; the project keeps its last accepted revision');
        await env.edits.fail(owner, edit.projectId, edit.id, code).catch(failure => logger.error({ err: failure, editId: edit.id }, 'region edit failure could not be recorded'));
    }
    finally {
        env.slots.release();
    }
}
function requestRoutes(router, env) {
    router.post('/projects/:id/region-edits', admit(env, 'generate'), bodyParser, handler(env, 'generate', async (req, res, owner) => {
        const { request, maxCostClass } = await regionRequest(env, (0, create_project_validation_1.projectId)(req.params.id), req.body, owner);
        const edit = await env.edits.create(owner, request, env.settings.dailyCap, confirm(env, 'generate', owner));
        logger.info({ editId: edit.id, projectId: edit.projectId, sourceRevision: edit.sourceRevision, kind: edit.selection.kind }, 'region edit requested');
        void runRegionEdit(env, owner, edit, maxCostClass);
        res.status(202).json({ edit });
    }));
    router.get('/projects/:id/region-edits/:edit', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
        const edit = await env.edits.get(owner, (0, create_project_validation_1.projectId)(req.params.id), (0, create_project_validation_1.projectId)(req.params.edit));
        await confirm(env, 'read', owner)();
        res.json({ edit });
    }));
    router.get('/region-edit-provider', admit(env, 'generate'), handler(env, 'generate', async (_req, res, owner) => {
        const provider = await resolveFor(env, owner), usable = provider ? await servesRegionEdits(provider) : false;
        await confirm(env, 'generate', owner)();
        res.json({ configured: usable, provider: provider?.id ?? null, costClass: provider?.costClass ?? null, dailyCap: env.settings.dailyCap, costConsentVersion: 1,
            ...(usable ? {} : { reason: 'region_edit_provider_unavailable' }) });
    }));
}
/** Only a sentence, a title for a new project and, to add to one, the project. */
function imageRequest(body) {
    (0, create_project_validation_1.exactFields)(body, ['prompt', 'title', 'id']);
    const value = body;
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt || prompt.length > IMAGE_PROMPT_CHARS)
        throw new create_project_types_1.ProjectError(400, 'invalid_image_prompt');
    if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120))
        throw new create_project_types_1.ProjectError(400, 'invalid_project_title');
    return { prompt, title: typeof value.title === 'string' ? value.title.trim() : prompt.slice(0, 60).trim(), id: value.id === undefined ? null : (0, create_project_validation_1.projectId)(value.id) };
}
/** The project's document with the picture as a new top layer, centred and scaled to fit the canvas. */
function withImageLayer(document, asset) {
    const current = document;
    const key = `generated-${asset.id.slice(0, 8)}`, scale = Math.min(1, current.width / asset.width, current.height / asset.height);
    const w = Math.round(asset.width * scale), h = Math.round(asset.height * scale);
    const layer = { id: key, type: 'image', name: 'Generated image', assetId: key, x: Math.round((current.width - w) / 2), y: Math.round((current.height - h) / 2), w, h };
    return { ...document, layers: [...current.layers, layer], images: { ...current.images, [key]: { src: asset.src, width: asset.width, height: asset.height } } };
}
/** The generator sleeps when idle and answers that it is starting; the person already approved this, so keep asking inside the request's time. */
async function pictureOnceAwake(provider, prompt, budgetMs, retryMs) {
    const deadline = Date.now() + budgetMs;
    for (;;) {
        try {
            return await withTimeout(generate(provider, prompt, null), Math.max(1, deadline - Date.now()));
        }
        catch (error) {
            const waking = error instanceof Error && /starting|still be loading/i.test(error.message);
            if (!waking || Date.now() + retryMs >= deadline)
                throw error;
            await new Promise(resolve => setTimeout(resolve, retryMs));
        }
    }
}
/** Make and keep the picture. The native kernel ends the package process when a request answers and allows it 60 seconds,
 *  so this finishes inside the request; a generator still waking answers in its own words, and only a free provider serves. */
async function generatedAsset(env, owner, prompt, allowed) {
    const provider = await resolveFor(env, owner);
    if (!provider || !(await servesRegionEdits(provider)))
        throw new create_project_types_1.ProjectError(503, 'image_provider_unavailable');
    enforceCostCap(provider, 'free');
    if (await env.projects.assetsToday(owner) >= (env.settings.imageDailyCap ?? 25))
        throw new create_project_types_1.ProjectError(429, 'image_daily_cap_reached');
    await allowed();
    await env.slots.acquire();
    try {
        const answer = await pictureOnceAwake(provider, prompt, Math.min(env.settings.timeoutMs, IMAGE_REQUEST_MS), env.settings.imageRetryMs ?? 5000);
        await allowed();
        return await (0, create_project_assets_1.saveProjectImage)(env.dataRoot, env.projects, owner, answer.image, allowed);
    }
    catch (error) {
        if (error instanceof create_project_types_1.ProjectError)
            throw error;
        logger.error({ err: error }, 'image generation failed');
        throw new create_project_types_1.ProjectError(503, 'image_generation_failed', error instanceof Error ? error.message.slice(0, 200) : undefined);
    }
    finally {
        env.slots.release();
    }
}
function imageRoutes(router, env) {
    router.post('/generated-images', admit(env, 'generate'), bodyParser, handler(env, 'generate', async (req, res, owner) => {
        const request = imageRequest(req.body), writes = request.id ? 'change' : 'create';
        const allowed = async () => { await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'generate', owner); await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, writes, owner); };
        await allowed();
        const current = request.id ? await env.projects.get(owner, request.id) : null;
        const validate = await env.validator, asset = await generatedAsset(env, owner, request.prompt, allowed);
        const base = current?.document ?? { version: 1, name: request.title, width: asset.width, height: asset.height, background: 'transparent', layers: [], images: {} };
        const input = { title: current?.title ?? request.title, document: (0, create_project_validation_1.validateDocument)(withImageLayer(base, asset), validate) };
        const project = current ? await env.projects.save(owner, current.id, current.revision, input, allowed) : await env.projects.create(owner, input, allowed);
        logger.info({ projectId: project.id, revision: project.revision }, 'generated image saved as a layer');
        res.status(201).json({ project });
    }));
}
function decisionRoutes(router, env) {
    router.post('/projects/:id/region-edits/:edit/accept', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
        (0, create_project_validation_1.exactFields)(req.body, ['baseRevision']);
        const expected = (0, create_project_validation_1.baseRevision)(req.body.baseRevision), validate = await env.validator;
        const project = await env.edits.accept(owner, (0, create_project_validation_1.projectId)(req.params.id), (0, create_project_validation_1.projectId)(req.params.edit), expected, (current, edit) => acceptedInput(current, edit, validate), confirm(env, 'change', owner));
        logger.info({ editId: req.params.edit, revision: project.revision }, 'region edit accepted as a new revision');
        res.status(201).json({ project });
    }));
    for (const action of ['cancel', 'reject']) {
        router.post(`/projects/:id/region-edits/:edit/${action}`, admit(env, 'generate'), bodyParser, handler(env, 'generate', async (req, res, owner) => {
            (0, create_project_validation_1.exactFields)(req.body ?? {}, []);
            const edit = await env.edits.close(owner, (0, create_project_validation_1.projectId)(req.params.id), (0, create_project_validation_1.projectId)(req.params.edit), action, confirm(env, 'generate', owner));
            res.json({ edit });
        }));
    }
}
/**
 * @description Mount region editing on the Create project router, before its shared error handler.
 * @param router - The Create project router.
 * @param options - Framework context, project store, asset root, the router's guards and validator; tests may name a fixture provider.
 * @returns void
 */
function registerRegionEditRoutes(router, options) {
    const settings = options.settings ?? regionEditSettings();
    const env = { ...options, edits: new create_region_edit_store_1.CreateRegionEditStore(options.projects), settings, slots: new Slots(settings.concurrency),
        deps: options.dependencies ?? DEFAULT_DEPENDENCIES, region: loadRegionModule(options.ctx.appPackageDir ?? (0, node_path_1.resolve)(__dirname, '..')) };
    requestRoutes(router, env);
    imageRoutes(router, env);
    decisionRoutes(router, env);
}
//# sourceMappingURL=create-region-edit-routes.js.map