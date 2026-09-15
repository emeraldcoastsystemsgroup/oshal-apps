"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCreateProjectRoutes = createCreateProjectRoutes;
exports.registerCreateProjectRoutes = registerCreateProjectRoutes;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose private project CRUD, immutable revision history, explicit document export and bounded owner-scoped raster uploads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Mount the personal brand kit routes on this router, before its shared error handler, with the same personal-scope and error guards.
 */
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const node_async_hooks_1 = require("node:async_hooks");
const node_path_1 = require("node:path");
const create_project_types_1 = require("./create-project-types");
const create_project_validation_1 = require("./create-project-validation");
const create_project_store_1 = require("./create-project-store");
const create_project_authorization_1 = require("./create-project-authorization");
const create_project_assets_1 = require("./create-project-assets");
const create_brand_kit_routes_1 = require("./create-brand-kit-routes");
const bodyParser = (0, express_1.json)({ limit: create_project_types_1.PROJECT_LIMITS.documentBytes + 4096, strict: true });
/** Personal projects never accept a caller-selected shared tenant or owner scope. */
function personalOnly(req) {
    if (Object.keys(req.query).some(key => /tenant|owner|issuer|subject/i.test(key))
        || req.header('x-oshal-tenant-id') || req.header('x-tenant-id'))
        throw new create_project_types_1.ProjectError(400, 'project_personal_scope_only');
}
function sendError(res, error) {
    if (res.headersSent)
        return;
    const typed = error instanceof create_project_types_1.ProjectError ? error : null;
    res.status(typed?.status ?? 503).json({ error: typed?.code ?? 'project_service_unavailable' });
}
/** Authorize before decoding request bodies or doing any persistence work. */
function admit(env, action) {
    return (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        Promise.resolve().then(() => { if (typeof env.ctx.pool?.connect !== 'function')
            throw new create_project_types_1.ProjectError(503, 'project_store_unavailable'); personalOnly(req); }).then(() => (0, create_project_authorization_1.requireProjectAccess)(env.ctx, action))
            .then(() => next()).catch(error => sendError(res, error));
    };
}
function handler(env, action, work) {
    return (req, res) => {
        (0, create_project_authorization_1.requireProjectAccess)(env.ctx, action).then(owner => work(req, res, owner)).catch(error => sendError(res, error));
    };
}
function confirm(env, action, owner) {
    return async () => { await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, action, owner); };
}
/** Lists expose metadata only; document and history reads require the current owner's read permission. */
function projectReads(router, env) {
    router.get('/home-summary', admit(env, 'read'), handler(env, 'read', async (_req, res, owner) => {
        const result = await env.store.summary(owner);
        await confirm(env, 'read', owner)();
        res.json({ items: result.projects.map(project => ({ text: project.title, detail: `Layered image · updated ${project.updatedAt}`,
                actions: [{ tool: 'create-editor', query: `project=${project.id}` }] })), metrics: [{ label: 'Image projects', value: String(result.count) }] });
    }));
    router.get('/projects', admit(env, 'read'), handler(env, 'read', async (_req, res, owner) => {
        const projects = await env.store.list(owner);
        await confirm(env, 'read', owner)();
        res.json({ projects });
    }));
    router.get('/projects/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
        const project = await env.store.get(owner, (0, create_project_validation_1.projectId)(req.params.id));
        await confirm(env, 'read', owner)();
        res.json({ project });
    }));
    router.get('/projects/:id/revisions', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
        const revisions = await env.store.revisions(owner, (0, create_project_validation_1.projectId)(req.params.id));
        await confirm(env, 'read', owner)();
        res.json({ revisions });
    }));
    router.get('/projects/:id/revisions/:revision', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
        const number = typeof req.params.revision === 'string' && /^\d+$/.test(req.params.revision) ? Number(req.params.revision) : NaN;
        const project = await env.store.get(owner, (0, create_project_validation_1.projectId)(req.params.id), (0, create_project_validation_1.baseRevision)(number));
        await confirm(env, 'read', owner)();
        res.json({ project });
    }));
    router.get('/projects/:id/export', admit(env, 'export'), handler(env, 'export', async (req, res, owner) => {
        const project = await env.store.get(owner, (0, create_project_validation_1.projectId)(req.params.id));
        await confirm(env, 'export', owner)();
        res.json({ document: project.document });
    }));
}
/** Save/delete reject stale base revisions while holding the exact project row lock. */
function projectWrites(router, env) {
    router.post('/projects', admit(env, 'create'), bodyParser, handler(env, 'create', async (req, res, owner) => {
        const input = (0, create_project_validation_1.projectInput)(req.body, await env.validator);
        const project = await env.store.create(owner, input, confirm(env, 'create', owner));
        res.status(201).json({ project });
    }));
    router.post('/projects/:id/revisions', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
        const input = (0, create_project_validation_1.projectInput)(req.body, await env.validator, true);
        const project = await env.store.save(owner, (0, create_project_validation_1.projectId)(req.params.id), (0, create_project_validation_1.baseRevision)(req.body.baseRevision), input, confirm(env, 'change', owner));
        res.status(201).json({ project });
    }));
    router.delete('/projects/:id', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
        (0, create_project_validation_1.exactFields)(req.body, ['baseRevision']);
        await env.store.delete(owner, (0, create_project_validation_1.projectId)(req.params.id), (0, create_project_validation_1.baseRevision)(req.body.baseRevision), confirm(env, 'delete', owner));
        res.status(204).end();
    }));
}
function projectAssets(router, env) {
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: create_project_types_1.PROJECT_LIMITS.imageBytes, files: 1, fields: 0, parts: 2 } }).single('image');
    const decodeImage = (req, res, next) => upload(req, res, node_async_hooks_1.AsyncResource.bind(next));
    router.post('/project-assets', admit(env, 'upload'), decodeImage, handler(env, 'upload', async (req, res, owner) => {
        if (!req.file)
            throw new create_project_types_1.ProjectError(400, 'project_image_required');
        const asset = await (0, create_project_assets_1.saveProjectImage)(env.dataRoot, env.store, owner, req.file.buffer, confirm(env, 'upload', owner));
        res.status(201).json({ asset });
    }));
    router.get('/project-assets/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
        const bytes = await (0, create_project_assets_1.readProjectImage)(env.dataRoot, env.store, owner, (0, create_project_validation_1.projectId)(req.params.id));
        await confirm(env, 'read', owner)();
        res.set('X-Content-Type-Options', 'nosniff').type('image/png').send(bytes);
    }));
    router.post('/project-assets/cleanup', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
        (0, create_project_validation_1.exactFields)(req.body ?? {}, []);
        const deleted = await env.store.cleanupAssets(owner, id => (0, create_project_assets_1.removeProjectImage)(env.dataRoot, owner, id), confirm(env, 'delete', owner));
        res.json({ deleted });
    }));
}
/** Mount separately from the retained Create static routes; initialization performs no database writes. */
function createCreateProjectRoutes(ctx, options = {}) {
    (0, create_project_authorization_1.registerCreateProjectAuthorization)(ctx);
    const router = (0, express_1.Router)();
    const env = { ctx, store: new create_project_store_1.CreateProjectStore(ctx.pool), dataRoot: options.dataRoot ?? (0, create_project_assets_1.projectAssetRoot)(),
        validator: (0, create_project_validation_1.loadProjectValidator)(ctx.appPackageDir ?? (0, node_path_1.resolve)(__dirname, '..')) };
    router.get('/permissions', admit(env, 'view'), handler(env, 'view', async (_req, res) => { res.json({ permissions: await (0, create_project_authorization_1.projectPermissions)(ctx) }); }));
    projectReads(router, env);
    projectWrites(router, env);
    projectAssets(router, env);
    (0, create_brand_kit_routes_1.registerBrandKitRoutes)(router, { ctx, projects: env.store, dataRoot: env.dataRoot, guards: { personalOnly, sendError } });
    router.use((error, _req, res, _next) => {
        if (error instanceof multer_1.default.MulterError)
            return sendError(res, new create_project_types_1.ProjectError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'invalid_project_upload'));
        if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 413))
            return sendError(res, new create_project_types_1.ProjectError(error.status, 'invalid_project_body'));
        sendError(res, error);
    });
    return router;
}
/** Optional composition helper for an existing package router. */
function registerCreateProjectRoutes(router, ctx) { router.use(createCreateProjectRoutes(ctx)); }
//# sourceMappingURL=create-project-routes.js.map