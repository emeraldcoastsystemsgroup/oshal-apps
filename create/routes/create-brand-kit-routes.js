"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBrandModule = loadBrandModule;
exports.registerBrandKitAuthorization = registerBrandKitAuthorization;
exports.requireBrandAccess = requireBrandAccess;
exports.brandRevision = brandRevision;
exports.registerBrandKitRoutes = registerBrandKitRoutes;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Personal brand kit read/save/delete and logo upload behind named brand permissions, validated by the same module the browser runs.
 */
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
const create_project_types_1 = require("./create-project-types");
const create_project_validation_1 = require("./create-project-validation");
const create_project_authorization_1 = require("./create-project-authorization");
const create_project_assets_1 = require("./create-project-assets");
const create_brand_kit_store_1 = require("./create-brand-kit-store");
const bodyParser = (0, express_1.json)({ limit: 16384, strict: true });
/** Capture the installed shared ESM brand module once, keyed by its bytes like the project validator. */
function loadBrandModule(packageDir) {
    const file = (0, node_path_1.resolve)(packageDir, 'tools/editor/brand-kit.mjs');
    const url = (0, node_url_1.pathToFileURL)(file);
    url.searchParams.set('revision', (0, node_crypto_1.createHash)('sha256').update((0, node_fs_1.readFileSync)(file)).digest('hex'));
    return import(url.href);
}
/** Brand kits are personal records: the same own-scope rule as projects, registered as their own resource. */
function registerBrandKitAuthorization(ctx) {
    if (!ctx.authorization)
        throw new Error('Create brand kits require application-authorization');
    ctx.authorization.registerResource('brand', { authorize: async ({ actor, operation, grant }) => actor.isActive && !!actor.issuer && !!actor.sub && grant.scope === 'own' && !operation.tenantId });
}
/** Opening Create plus the named brand permission, re-read before work and again before commit. */
async function requireBrandAccess(ctx, action, expected) {
    const owner = (0, create_project_authorization_1.projectOwner)(ctx);
    if (expected && (owner.issuer !== expected.issuer || owner.sub !== expected.sub))
        throw new create_project_types_1.ProjectError(401, 'project_identity_changed');
    for (const permission of ['project.view', `brand.${action}`]) {
        if (!(await ctx.authorization.authorize({ permission })).allowed)
            throw new create_project_types_1.ProjectError(403, 'brand_permission_denied');
    }
    return owner;
}
async function mayChange(ctx) {
    try {
        await requireBrandAccess(ctx, 'change');
        return true;
    }
    catch {
        return false;
    }
}
/** Accept only the exact integer revision the page read; 0 means "no kit saved yet". */
function brandRevision(value, minimum = 0) {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > create_brand_kit_store_1.BRAND_REVISION_LIMIT)
        throw new create_project_types_1.ProjectError(400, 'invalid_brand_revision');
    return Number(value);
}
function admit(env, action) {
    return (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        Promise.resolve().then(() => {
            if (typeof env.ctx.pool?.connect !== 'function')
                throw new create_project_types_1.ProjectError(503, 'project_store_unavailable');
            env.guards.personalOnly(req);
        }).then(() => requireBrandAccess(env.ctx, action)).then(() => next()).catch(error => env.guards.sendError(res, error));
    };
}
function handler(env, action, work) {
    return (req, res) => { requireBrandAccess(env.ctx, action).then(owner => work(req, res, owner)).catch(error => env.guards.sendError(res, error)); };
}
function confirm(env, action, owner) {
    return async () => { await requireBrandAccess(env.ctx, action, owner); };
}
async function body(env, record, canChange) {
    const module = await env.module;
    return { kit: record?.kit ?? null, revision: record?.revision ?? 0, updatedAt: record?.updatedAt ?? null, canChange,
        words: record ? module.describeBrandKit(record.kit) : null };
}
async function validKit(env, value) {
    const module = await env.module;
    let kit;
    try {
        kit = module.validateBrandKit(value);
    }
    catch {
        throw new create_project_types_1.ProjectError(400, 'invalid_brand_kit');
    }
    const id = module.logoAssetId(kit);
    return { kit, logo: id && kit.logo ? { id: (0, create_project_validation_1.projectId)(id), width: kit.logo.width, height: kit.logo.height } : null };
}
function kitRoutes(router, env) {
    router.get('/brand-kit', admit(env, 'read'), handler(env, 'read', async (_req, res, owner) => {
        const record = await env.store.get(owner), canChange = await mayChange(env.ctx);
        await confirm(env, 'read', owner)();
        res.json(await body(env, record, canChange));
    }));
    router.put('/brand-kit', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
        (0, create_project_validation_1.exactFields)(req.body, ['baseRevision', 'kit']);
        const expected = brandRevision(req.body.baseRevision), { kit, logo } = await validKit(env, req.body.kit);
        const record = await env.store.save(owner, expected, kit, logo, confirm(env, 'change', owner));
        res.json(await body(env, record, true));
    }));
    router.delete('/brand-kit', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
        (0, create_project_validation_1.exactFields)(req.body, ['baseRevision']);
        await env.store.delete(owner, brandRevision(req.body.baseRevision, 1), confirm(env, 'change', owner));
        res.status(204).end();
    }));
}
/** A logo is an ordinary owned Create image: same normalization, quota and exact-owner storage. */
function logoRoute(router, env) {
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: create_project_types_1.PROJECT_LIMITS.imageBytes, files: 1, fields: 0, parts: 2 } }).single('image');
    const decodeImage = (req, res, next) => upload(req, res, node_async_hooks_1.AsyncResource.bind(next));
    router.post('/brand-kit/logo', admit(env, 'change'), decodeImage, handler(env, 'change', async (req, res, owner) => {
        if (!req.file)
            throw new create_project_types_1.ProjectError(400, 'project_image_required');
        const asset = await (0, create_project_assets_1.saveProjectImage)(env.dataRoot, env.projects, owner, req.file.buffer, confirm(env, 'change', owner));
        res.status(201).json({ asset });
    }));
}
/** @description Mount the brand kit on the project router, before its shared error handler.
 * @param router The Create project router.
 * @param options Framework context, the project store, the asset root and the router's guards.
 * @returns void */
function registerBrandKitRoutes(router, options) {
    registerBrandKitAuthorization(options.ctx);
    const env = { ...options, store: new create_brand_kit_store_1.CreateBrandKitStore(options.projects),
        module: loadBrandModule(options.ctx.appPackageDir ?? (0, node_path_1.resolve)(__dirname, '..')) };
    kitRoutes(router, env);
    logoRoute(router, env);
}
//# sourceMappingURL=create-brand-kit-routes.js.map