/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Personal brand kit read/save/delete and logo upload behind named brand permissions, validated by the same module the browser runs.
 */
import { json, type Router, type Request, type Response, type RequestHandler } from 'express';
import multer from 'multer';
import { AsyncResource } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectError, PROJECT_LIMITS, type ProjectContext, type ProjectOwner } from './create-project-types';
import { exactFields, projectId } from './create-project-validation';
import { projectOwner } from './create-project-authorization';
import { saveProjectImage } from './create-project-assets';
import type { CreateProjectStore } from './create-project-store';
import { CreateBrandKitStore, BRAND_REVISION_LIMIT, type BrandKitDocument, type BrandKitRecord } from './create-brand-kit-store';

export type BrandAction = 'read' | 'change';
interface BrandModule {
  validateBrandKit(value: unknown): BrandKitDocument;
  logoAssetId(kit: BrandKitDocument): string | null;
  describeBrandKit(kit: BrandKitDocument): { phrase: string; colors: Record<string, string> };
}
/** Shared request guards owned by the project router, reused so both surfaces refuse identically. */
export interface BrandRouteGuards { personalOnly(req: Request): void; sendError(res: Response, error: unknown): void }
interface BrandEnvironment { ctx: ProjectContext; store: CreateBrandKitStore; projects: CreateProjectStore; dataRoot: string; module: Promise<BrandModule>; guards: BrandRouteGuards }
type BrandWork = (req: Request, res: Response, owner: ProjectOwner) => Promise<void>;
const bodyParser = json({ limit: 16384, strict: true });

/** Capture the installed shared ESM brand module once, keyed by its bytes like the project validator. */
export function loadBrandModule(packageDir: string): Promise<BrandModule> {
  const file = resolve(packageDir, 'tools/editor/brand-kit.mjs');
  const url = pathToFileURL(file); url.searchParams.set('revision', createHash('sha256').update(readFileSync(file)).digest('hex'));
  return import(url.href) as Promise<BrandModule>;
}

/** Brand kits are personal records: the same own-scope rule as projects, registered as their own resource. */
export function registerBrandKitAuthorization(ctx: ProjectContext): void {
  if (!ctx.authorization) throw new Error('Create brand kits require application-authorization');
  ctx.authorization.registerResource('brand', { authorize: async ({ actor, operation, grant }) =>
    actor.isActive && !!actor.issuer && !!actor.sub && grant.scope === 'own' && !operation.tenantId });
}

/** Opening Create plus the named brand permission, re-read before work and again before commit. */
export async function requireBrandAccess(ctx: ProjectContext, action: BrandAction, expected?: ProjectOwner): Promise<ProjectOwner> {
  const owner = projectOwner(ctx);
  if (expected && (owner.issuer !== expected.issuer || owner.sub !== expected.sub)) throw new ProjectError(401, 'project_identity_changed');
  for (const permission of ['project.view', `brand.${action}`]) {
    if (!(await ctx.authorization!.authorize({ permission })).allowed) throw new ProjectError(403, 'brand_permission_denied');
  }
  return owner;
}

async function mayChange(ctx: ProjectContext): Promise<boolean> {
  try { await requireBrandAccess(ctx, 'change'); return true; } catch { return false; }
}

/** Accept only the exact integer revision the page read; 0 means "no kit saved yet". */
export function brandRevision(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > BRAND_REVISION_LIMIT) throw new ProjectError(400, 'invalid_brand_revision');
  return Number(value);
}

function admit(env: BrandEnvironment, action: BrandAction): RequestHandler {
  return (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    Promise.resolve().then(() => {
      if (typeof env.ctx.pool?.connect !== 'function') throw new ProjectError(503, 'project_store_unavailable');
      env.guards.personalOnly(req);
    }).then(() => requireBrandAccess(env.ctx, action)).then(() => next()).catch(error => env.guards.sendError(res, error));
  };
}

function handler(env: BrandEnvironment, action: BrandAction, work: BrandWork): RequestHandler {
  return (req, res) => { requireBrandAccess(env.ctx, action).then(owner => work(req, res, owner)).catch(error => env.guards.sendError(res, error)); };
}

function confirm(env: BrandEnvironment, action: BrandAction, owner: ProjectOwner): () => Promise<void> {
  return async () => { await requireBrandAccess(env.ctx, action, owner); };
}

async function body(env: BrandEnvironment, record: BrandKitRecord | null, canChange: boolean): Promise<object> {
  const module = await env.module;
  return { kit: record?.kit ?? null, revision: record?.revision ?? 0, updatedAt: record?.updatedAt ?? null, canChange,
    words: record ? module.describeBrandKit(record.kit) : null };
}

async function validKit(env: BrandEnvironment, value: unknown): Promise<{ kit: BrandKitDocument; logo: { id: string; width: number; height: number } | null }> {
  const module = await env.module;
  let kit: BrandKitDocument;
  try { kit = module.validateBrandKit(value); } catch { throw new ProjectError(400, 'invalid_brand_kit'); }
  const id = module.logoAssetId(kit);
  return { kit, logo: id && kit.logo ? { id: projectId(id), width: kit.logo.width, height: kit.logo.height } : null };
}

function kitRoutes(router: Router, env: BrandEnvironment): void {
  router.get('/brand-kit', admit(env, 'read'), handler(env, 'read', async (_req, res, owner) => {
    const record = await env.store.get(owner), canChange = await mayChange(env.ctx);
    await confirm(env, 'read', owner)(); res.json(await body(env, record, canChange));
  }));
  router.put('/brand-kit', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
    exactFields(req.body, ['baseRevision', 'kit']);
    const expected = brandRevision(req.body.baseRevision), { kit, logo } = await validKit(env, req.body.kit);
    const record = await env.store.save(owner, expected, kit, logo, confirm(env, 'change', owner));
    res.json(await body(env, record, true));
  }));
  router.delete('/brand-kit', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
    exactFields(req.body, ['baseRevision']);
    await env.store.delete(owner, brandRevision(req.body.baseRevision, 1), confirm(env, 'change', owner)); res.status(204).end();
  }));
}

/** A logo is an ordinary owned Create image: same normalization, quota and exact-owner storage. */
function logoRoute(router: Router, env: BrandEnvironment): void {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PROJECT_LIMITS.imageBytes, files: 1, fields: 0, parts: 2 } }).single('image');
  const decodeImage: RequestHandler = (req, res, next) => upload(req, res, AsyncResource.bind(next));
  router.post('/brand-kit/logo', admit(env, 'change'), decodeImage, handler(env, 'change', async (req, res, owner) => {
    if (!req.file) throw new ProjectError(400, 'project_image_required');
    const asset = await saveProjectImage(env.dataRoot, env.projects, owner, req.file.buffer, confirm(env, 'change', owner));
    res.status(201).json({ asset });
  }));
}

/** @description Mount the brand kit on the project router, before its shared error handler.
 * @param router The Create project router.
 * @param options Framework context, the project store, the asset root and the router's guards.
 * @returns void */
export function registerBrandKitRoutes(router: Router, options: { ctx: ProjectContext; projects: CreateProjectStore; dataRoot: string; guards: BrandRouteGuards }): void {
  registerBrandKitAuthorization(options.ctx);
  const env: BrandEnvironment = { ...options, store: new CreateBrandKitStore(options.projects),
    module: loadBrandModule(options.ctx.appPackageDir ?? resolve(__dirname, '..')) };
  kitRoutes(router, env); logoRoute(router, env);
}
