"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D1-D6, lane @ds-app: the package's single mounted factory on
 *                     |                             | /api/design-studio. Serves the screen from tools/, publishes
 *                     |                             | /capabilities (the vocabulary, the phase briefs, the examples),
 *                     |                             | proposes a chain from a brief (/plan), and owns the person's
 *                     |                             | projects: create (from a brief or an example), list, read,
 *                     |                             | rename and re-brief, delete, the chain (PUT /phases), bindings
 *                     |                             | (POST /bind), closures (POST /close, refused as missing_evidence
 *                     |                             | without an evidence line AND a revision), the phase brief per
 *                     |                             | kind, and the body contract (GET /body, refused as
 *                     |                             | body_incomplete naming every value no bound read supplies).
 *                     |                             | Never reads another package's routes: stages are read by the
 *                     |                             | page through the person's session (circuit-lab B17).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the print-set routes under a product
 *                     |                             | (print-set-routes.ts) are mounted here with the package's data
 *                     |                             | root (print-set-store.ts: DESIGN_STUDIO_DATA_DIR, else the native
 *                     |                             | lasting directory, else the shared workspace); withProject is
 *                     |                             | exported so they load the owner's project the same way.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the mechanism routes under a product
 *                     |                             | (mechanism-routes.ts) are mounted here; a project read carries
 *                     |                             | its mechanism; an example with a mechanism (the lift) saves it
 *                     |                             | with the task read from the brief's line when it is created.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.withProject = withProject;
exports.createDesignStudioRoutes = createDesignStudioRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const body_contract_1 = require("./body-contract");
const examples_1 = require("./examples");
const mechanism_model_1 = require("./mechanism-model");
const mechanism_routes_1 = require("./mechanism-routes");
const order_routes_1 = require("./order-routes");
const mechanism_store_1 = require("./mechanism-store");
const phase_model_1 = require("./phase-model");
const print_set_routes_1 = require("./print-set-routes");
const print_set_store_1 = require("./print-set-store");
const project_store_1 = require("./project-store");
const surface_files_1 = require("./surface-files");
const logger = (0, logger_1.createChildLogger)({ module: 'design-studio-routes' });
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_CAP = 120;
/** @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub). */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
/** Answer a ModelError with its status, code and field; anything else is the caller's 500. */
function refuse(res, error, what) {
    if (error instanceof phase_model_1.ModelError) {
        res.status(error.status).json({ error: error.code, field: error.field, message: error.message });
        return;
    }
    logger.error({ err: error }, `${what} failed`);
    res.status(500).json({ error: `${what.replace(/\s+/g, '_')}_failed` });
}
/** The project name from a body, or the brief's first words. */
function nameOf(body, fallback) {
    const raw = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    const name = (raw || fallback).slice(0, NAME_CAP);
    if (!name)
        throw new phase_model_1.ModelError('name is required', 'bad_name', 'name');
    return name;
}
/** The phase kind a path names, checked against the vocabulary. */
function kindOf(value) {
    if (!phase_model_1.PHASE_KINDS.includes(value))
        throw new phase_model_1.ModelError(`unknown phase ${value}; the vocabulary is ${phase_model_1.PHASE_KINDS.join(', ')}`, 'unknown_phase', 'phase');
    return value;
}
/** The phase a body names, which must be in the project's chain. */
function phaseInChain(project, value) {
    const kind = kindOf(String(value ?? ''));
    const entry = project.phases.find((p) => p.kind === kind);
    if (!entry)
        throw new phase_model_1.ModelError(`${kind} is not in this project's chain (${project.phases.map((p) => p.kind).join(' -> ')}); set the chain first`, 'phase_not_in_chain', 'phase', 409);
    return entry;
}
/** The full read of a project: the row, the newest binding per phase with the bind count, every closure, the mechanism when one is saved. */
async function projectView(pool, sub, project) {
    const [bindings, closures, mechanism] = await Promise.all([(0, project_store_1.listBindings)(pool, sub, project.id), (0, project_store_1.listClosures)(pool, sub, project.id), (0, mechanism_store_1.getMechanism)(pool, sub, project.id)]);
    const latest = (0, project_store_1.latestBindings)(bindings);
    const binds = Object.fromEntries(Object.entries(latest).map(([k, b]) => [k, { ...b, bindCount: bindings.filter((x) => x.phase === k).length }]));
    return { project, bindings: binds, closures, mechanism: mechanism ? { ...mechanism.mechanism, revision: mechanism.revision, savedAt: mechanism.saved_at } : null };
}
/** Create a project from an example: the brief, the chain and the bindings by name. */
async function createFromExample(pool, sub, body) {
    const example = (0, examples_1.findExample)(body.example);
    if (!example)
        throw new phase_model_1.ModelError(`unknown example ${JSON.stringify(body.example)}; the examples are ${(0, examples_1.listExamples)().map((e) => e.id).join(', ')}`, 'unknown_example', 'example', 404);
    const row = await (0, project_store_1.createProject)(pool, sub, { name: nameOf(body, example.name), brief: example.brief, phases: example.phases });
    for (const phase of example.phases) {
        const artifact = example.bindings[phase.kind];
        if (artifact)
            await (0, project_store_1.bindArtifact)(pool, sub, row.id, phase.kind, (0, phase_model_1.validateArtifact)(phase.kind, artifact));
    }
    if (example.mechanism)
        await (0, mechanism_store_1.saveMechanism)(pool, sub, row.id, { ...example.mechanism, task: example.mechanism.task ?? (0, mechanism_model_1.taskFromBrief)(example.brief) });
    logger.info({ sub, projectId: row.id, example: example.id, mechanism: !!example.mechanism }, 'Project created from an example');
    return row;
}
/** Create a project from a brief: the chain is the body's, or the proposal from the brief. */
async function createFromBrief(pool, sub, body) {
    const brief = (0, phase_model_1.validateBrief)(body.brief);
    const phases = body.phases === undefined ? (0, phase_model_1.proposePhases)(brief).phases : (0, phase_model_1.validatePhases)(body.phases);
    const row = await (0, project_store_1.createProject)(pool, sub, { name: nameOf(body, brief.what), brief, phases });
    logger.info({ sub, projectId: row.id, phases: phases.map((p) => p.kind) }, 'Project created from a brief');
    return row;
}
/**
 * @description Load the caller and the project a path names; answers 401/400/404 itself and returns null then.
 * @param pool - The pool. @param req - The request. @param res - The response.
 * @returns The caller, the project and the pool, or null once a refusal was answered.
 */
async function withProject(pool, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'unauthenticated' });
        return null;
    }
    const id = String(req.params.id || '');
    if (!PROJECT_ID.test(id)) {
        res.status(400).json({ error: 'bad_project_id', field: 'id' });
        return null;
    }
    const project = await (0, project_store_1.getProject)(pool, sub, id);
    if (!project) {
        res.status(404).json({ error: 'project_not_found', id });
        return null;
    }
    return { pool, sub, project };
}
/** Mount the screen and its assets. */
function registerSurface(router, appPackageDir) {
    const page = (0, surface_files_1.surfaceFile)(appPackageDir, surface_files_1.SURFACE_FILES.page);
    logger.info({ page, appPackageDir }, 'Resolved the design-studio surface');
    router.get('/app', (0, surface_files_1.serveSurfaceFile)(page, 'html'));
    const assets = (0, express_1.Router)();
    for (const file of surface_files_1.SURFACE_FILES.scripts)
        assets.get(`/${file}`, (0, surface_files_1.serveSurfaceFile)((0, surface_files_1.surfaceFile)(appPackageDir, file), 'application/javascript'));
    assets.get(`/${surface_files_1.SURFACE_FILES.style}`, (0, surface_files_1.serveSurfaceFile)((0, surface_files_1.surfaceFile)(appPackageDir, surface_files_1.SURFACE_FILES.style), 'text/css'));
    router.use('/assets', assets);
}
/** The vocabulary and the proposal: no owner, no write. */
function registerVocabulary(router) {
    router.get('/capabilities', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ app: 'design-studio', phases: phase_model_1.PHASE_KINDS, engines: phase_model_1.ENGINES, briefs: phase_model_1.PHASE_BRIEFS, examples: (0, examples_1.listExamples)(), body: { schema: 'design-studio-body/1', route: 'GET /api/design-studio/projects/{id}/body' } });
    });
    router.post('/plan', (req, res) => {
        try {
            const brief = (0, phase_model_1.validateBrief)((req.body ?? {}).brief ?? req.body);
            res.json({ brief, ...(0, phase_model_1.proposePhases)(brief), rule: 'the package\'s rules over the requirement lines; the design partner revises the chain with design-plan-phases' });
        }
        catch (error) {
            refuse(res, error, 'plan');
        }
    });
}
/** Projects: list, create, read, update, delete. */
function registerProjects(router, pool) {
    router.get('/projects', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        try {
            const [projects, closures] = await Promise.all([(0, project_store_1.listProjects)(pool, sub), (0, project_store_1.listOwnerClosures)(pool, sub)]);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ projects: projects.map((p) => ({ ...p, closedPhases: [...new Set(closures.filter((c) => c.project_id === p.id && c.step === null).map((c) => c.phase))].length })) });
        }
        catch (error) {
            refuse(res, error, 'list projects');
        }
    });
    router.post('/projects', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        const body = (req.body ?? {});
        try {
            const row = body.example !== undefined ? await createFromExample(pool, sub, body) : await createFromBrief(pool, sub, body);
            res.status(201).json(await projectView(pool, sub, row));
        }
        catch (error) {
            refuse(res, error, 'create project');
        }
    });
    router.get('/projects/:id', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        try {
            res.setHeader('Cache-Control', 'no-store');
            res.json(await projectView(pool, c.sub, c.project));
        }
        catch (error) {
            refuse(res, error, 'read project');
        }
    });
    router.patch('/projects/:id', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        const body = (req.body ?? {});
        try {
            const next = { ...c.project };
            if (body.name !== undefined)
                next.name = nameOf(body, c.project.name);
            if (body.brief !== undefined)
                next.brief = (0, phase_model_1.validateBrief)(body.brief);
            res.json(await projectView(pool, c.sub, await (0, project_store_1.updateProject)(pool, c.sub, next)));
        }
        catch (error) {
            refuse(res, error, 'update project');
        }
    });
    router.delete('/projects/:id', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        try {
            await (0, project_store_1.deleteProject)(pool, c.sub, c.project.id);
            res.json({ deleted: c.project.id });
        }
        catch (error) {
            refuse(res, error, 'delete project');
        }
    });
}
/** The chain, the bindings and the closures of one project. */
function registerPhases(router, pool) {
    router.put('/projects/:id/phases', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        try {
            const phases = (0, phase_model_1.validatePhases)((req.body ?? {}).phases);
            res.json(await projectView(pool, c.sub, await (0, project_store_1.updateProject)(pool, c.sub, { ...c.project, phases })));
        }
        catch (error) {
            refuse(res, error, 'set phases');
        }
    });
    router.post('/projects/:id/bind', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        const body = (req.body ?? {});
        try {
            const phase = phaseInChain(c.project, body.phase);
            const binding = await (0, project_store_1.bindArtifact)(pool, c.sub, c.project.id, phase.kind, (0, phase_model_1.validateArtifact)(phase.kind, body.artifact));
            logger.info({ sub: c.sub, projectId: c.project.id, phase: phase.kind, revision: binding.revision }, 'Artifact bound');
            res.status(201).json({ binding, ...(await projectView(pool, c.sub, c.project)) });
        }
        catch (error) {
            refuse(res, error, 'bind artifact');
        }
    });
    router.post('/projects/:id/close', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        const body = (req.body ?? {});
        try {
            const phase = phaseInChain(c.project, body.phase);
            const closure = await (0, project_store_1.closePhase)(pool, c.sub, c.project.id, phase.kind, (0, phase_model_1.validateClosure)(phase.kind, body));
            logger.info({ sub: c.sub, projectId: c.project.id, phase: phase.kind, step: closure.step }, 'Phase closed');
            res.status(201).json({ closure, ...(await projectView(pool, c.sub, c.project)) });
        }
        catch (error) {
            refuse(res, error, 'close phase');
        }
    });
}
/** The phase brief per kind and the body contract. */
function registerReads(router, pool) {
    router.get('/projects/:id/phase-brief/:kind', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        try {
            const kind = kindOf(String(req.params.kind));
            const entry = c.project.phases.find((p) => p.kind === kind) ?? null;
            const [bindings, closures] = await Promise.all([(0, project_store_1.listBindings)(pool, c.sub, c.project.id), (0, project_store_1.listClosures)(pool, c.sub, c.project.id)]);
            const binding = (0, project_store_1.latestBindings)(bindings)[kind] ?? null;
            const closed = closures.filter((x) => x.phase === kind);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ project: c.project.id, brief: phase_model_1.PHASE_BRIEFS[kind], inChain: !!entry, phase: entry, binding, closures: closed, productBrief: c.project.brief });
        }
        catch (error) {
            refuse(res, error, 'phase brief');
        }
    });
    router.get('/projects/:id/body', async (req, res) => {
        const c = await withProject(pool, req, res);
        if (!c)
            return;
        try {
            const { body, required } = (0, body_contract_1.buildBodyContract)(c.project, (0, project_store_1.latestBindings)(await (0, project_store_1.listBindings)(pool, c.sub, c.project.id)));
            res.setHeader('Cache-Control', 'no-store');
            if (required.length) {
                res.status(409).json({ error: 'body_incomplete', message: 'the contract needs values no bound artifact read supplies; close the phases on the product page or bind the engine replies with design-bind-artifact', required, body });
                return;
            }
            res.json(body);
        }
        catch (error) {
            refuse(res, error, 'body contract');
        }
    });
}
/**
 * @description Build the `/api/design-studio` router.
 * @param ctx - The per-package AppContext (ADR-085 D10): `pool` and `appPackageDir` are read.
 * @returns The composed router.
 */
function createDesignStudioRoutes(ctx) {
    const router = (0, express_1.Router)();
    registerSurface(router, ctx.appPackageDir);
    registerVocabulary(router);
    registerProjects(router, ctx.pool);
    registerPhases(router, ctx.pool);
    registerReads(router, ctx.pool);
    (0, order_routes_1.registerOrders)(router, { pool: ctx.pool, callerSub, withProject });
    (0, print_set_routes_1.registerPrintSet)(router, { pool: ctx.pool, dataRoot: (0, print_set_store_1.resolveDataRoot)(process.env), withProject });
    (0, mechanism_routes_1.registerMechanism)(router, { pool: ctx.pool, withProject });
    return router;
}
//# sourceMappingURL=design-studio-routes.js.map