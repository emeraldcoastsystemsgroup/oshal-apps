/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose private project CRUD, immutable revision history, explicit document export and bounded owner-scoped raster uploads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Mount the personal brand kit routes on this router, before its shared error handler, with the same personal-scope and error guards.
 */
import { Router, json, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import multer from 'multer';
import { AsyncResource } from 'node:async_hooks';
import { resolve } from 'node:path';
import { ProjectError, PROJECT_LIMITS, type ProjectContext, type ProjectOwner } from './create-project-types';
import { projectId, baseRevision, exactFields, projectInput, loadProjectValidator, type ProjectValidator } from './create-project-validation';
import { CreateProjectStore } from './create-project-store';
import { registerCreateProjectAuthorization, requireProjectAccess, projectPermissions, type ProjectAction } from './create-project-authorization';
import { projectAssetRoot, saveProjectImage, readProjectImage, removeProjectImage } from './create-project-assets';
import { registerBrandKitRoutes } from './create-brand-kit-routes';

interface RouteEnvironment { ctx: ProjectContext; store: CreateProjectStore; validator: Promise<ProjectValidator>; dataRoot: string }
type ProjectWork = (req: Request, res: Response, owner: ProjectOwner) => Promise<void>;
const bodyParser = json({ limit: PROJECT_LIMITS.documentBytes + 4096, strict: true });

/** Personal projects never accept a caller-selected shared tenant or owner scope. */
function personalOnly(req: Request): void {
  if (Object.keys(req.query).some(key => /tenant|owner|issuer|subject/i.test(key))
    || req.header('x-oshal-tenant-id') || req.header('x-tenant-id')) throw new ProjectError(400, 'project_personal_scope_only');
}

function sendError(res: Response, error: unknown): void {
  if (res.headersSent) return;
  const typed = error instanceof ProjectError ? error : null;
  res.status(typed?.status ?? 503).json({ error: typed?.code ?? 'project_service_unavailable' });
}

/** Authorize before decoding request bodies or doing any persistence work. */
function admit(env: RouteEnvironment, action: ProjectAction): RequestHandler {
  return (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    Promise.resolve().then(() => { if (typeof env.ctx.pool?.connect !== 'function') throw new ProjectError(503, 'project_store_unavailable'); personalOnly(req); }).then(() => requireProjectAccess(env.ctx, action))
      .then(() => next()).catch(error => sendError(res, error));
  };
}

function handler(env: RouteEnvironment, action: ProjectAction, work: ProjectWork): RequestHandler {
  return (req, res) => {
    requireProjectAccess(env.ctx, action).then(owner => work(req, res, owner)).catch(error => sendError(res, error));
  };
}
function confirm(env: RouteEnvironment, action: ProjectAction, owner: ProjectOwner): () => Promise<void> {
  return async () => { await requireProjectAccess(env.ctx, action, owner); };
}

/** Lists expose metadata only; document and history reads require the current owner's read permission. */
function projectReads(router: Router, env: RouteEnvironment): void {
  router.get('/home-summary', admit(env, 'read'), handler(env, 'read', async (_req, res, owner) => {
    const result = await env.store.summary(owner); await confirm(env, 'read', owner)();
    res.json({ items: result.projects.map(project => ({ text: project.title, detail: `Layered image · updated ${project.updatedAt}`,
      actions: [{ tool: 'create-editor', query: `project=${project.id}` }] })), metrics: [{ label: 'Image projects', value: String(result.count) }] });
  }));
  router.get('/projects', admit(env, 'read'), handler(env, 'read', async (_req, res, owner) => {
    const projects = await env.store.list(owner); await confirm(env, 'read', owner)(); res.json({ projects });
  }));
  router.get('/projects/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const project = await env.store.get(owner, projectId(req.params.id)); await confirm(env, 'read', owner)(); res.json({ project });
  }));
  router.get('/projects/:id/revisions', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const revisions = await env.store.revisions(owner, projectId(req.params.id)); await confirm(env, 'read', owner)(); res.json({ revisions });
  }));
  router.get('/projects/:id/revisions/:revision', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const number = typeof req.params.revision === 'string' && /^\d+$/.test(req.params.revision) ? Number(req.params.revision) : NaN;
    const project = await env.store.get(owner, projectId(req.params.id), baseRevision(number)); await confirm(env, 'read', owner)(); res.json({ project });
  }));
  router.get('/projects/:id/export', admit(env, 'export'), handler(env, 'export', async (req, res, owner) => {
    const project = await env.store.get(owner, projectId(req.params.id)); await confirm(env, 'export', owner)(); res.json({ document: project.document });
  }));
}

/** Save/delete reject stale base revisions while holding the exact project row lock. */
function projectWrites(router: Router, env: RouteEnvironment): void {
  router.post('/projects', admit(env, 'create'), bodyParser, handler(env, 'create', async (req, res, owner) => {
    const input = projectInput(req.body, await env.validator);
    const project = await env.store.create(owner, input, confirm(env, 'create', owner)); res.status(201).json({ project });
  }));
  router.post('/projects/:id/revisions', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
    const input = projectInput(req.body, await env.validator, true);
    const project = await env.store.save(owner, projectId(req.params.id), baseRevision(req.body.baseRevision), input, confirm(env, 'change', owner)); res.status(201).json({ project });
  }));
  router.delete('/projects/:id', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
    exactFields(req.body, ['baseRevision']);
    await env.store.delete(owner, projectId(req.params.id), baseRevision(req.body.baseRevision), confirm(env, 'delete', owner)); res.status(204).end();
  }));
}

function projectAssets(router: Router, env: RouteEnvironment): void {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PROJECT_LIMITS.imageBytes, files: 1, fields: 0, parts: 2 } }).single('image');
  const decodeImage: RequestHandler = (req, res, next) => upload(req, res, AsyncResource.bind(next));
  router.post('/project-assets', admit(env, 'upload'), decodeImage, handler(env, 'upload', async (req, res, owner) => {
    if (!req.file) throw new ProjectError(400, 'project_image_required');
    const asset = await saveProjectImage(env.dataRoot, env.store, owner, req.file.buffer, confirm(env, 'upload', owner)); res.status(201).json({ asset });
  }));
  router.get('/project-assets/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const bytes = await readProjectImage(env.dataRoot, env.store, owner, projectId(req.params.id)); await confirm(env, 'read', owner)();
    res.set('X-Content-Type-Options', 'nosniff').type('image/png').send(bytes);
  }));
  router.post('/project-assets/cleanup', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
    exactFields(req.body ?? {}, []);
    const deleted = await env.store.cleanupAssets(owner, id => removeProjectImage(env.dataRoot, owner, id), confirm(env, 'delete', owner)); res.json({ deleted });
  }));
}

/** Mount separately from the retained Create static routes; initialization performs no database writes. */
export function createCreateProjectRoutes(ctx: ProjectContext, options: { dataRoot?: string } = {}): Router {
  registerCreateProjectAuthorization(ctx);
  const router = Router();
  const env = { ctx, store: new CreateProjectStore(ctx.pool), dataRoot: options.dataRoot ?? projectAssetRoot(),
    validator: loadProjectValidator(ctx.appPackageDir ?? resolve(__dirname, '..')) };
  router.get('/permissions', admit(env, 'view'), handler(env, 'view', async (_req, res) => { res.json({ permissions: await projectPermissions(ctx) }); }));
  projectReads(router, env); projectWrites(router, env); projectAssets(router, env);
  registerBrandKitRoutes(router, { ctx, projects: env.store, dataRoot: env.dataRoot, guards: { personalOnly, sendError } });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) return sendError(res, new ProjectError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'invalid_project_upload'));
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 413)) return sendError(res, new ProjectError(error.status, 'invalid_project_body'));
    sendError(res, error);
  });
  return router;
}

/** Optional composition helper for an existing package router. */
export function registerCreateProjectRoutes(router: Router, ctx: ProjectContext): void { router.use(createCreateProjectRoutes(ctx)); }
