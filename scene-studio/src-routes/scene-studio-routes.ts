/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's mounted factory. Serves the
 *                     |                             | bundled surface and its script from this package's tools/
 *                     |                             | (ctx.appPackageDir), publishes `/capabilities` (the engine's
 *                     |                             | versions and the upstream MCP tools with their schemas, or —
 *                     |                             | when the engine is down or stale — the honest reason and the
 *                     |                             | exact install command), owns ONE engine client per api process,
 *                     |                             | and composes the project router under `/api/scene-studio`. The
 *                     |                             | manifest's `auth: oidc` wraps the mount; handlers re-derive the
 *                     |                             | caller.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: this factory is the one place the package registers with
 *                     |                             | the kernel at activation — the `scene` resource adapter of the
 *                     |                             | ADR-149 catalog (scene-authorization.ts) and the director's 22
 *                     |                             | in-process package tools (scene-tools.ts), which share this
 *                     |                             | factory's one engine client (its FIFO and the project locks) with
 *                     |                             | the studio. `/capabilities` and the scene-capabilities tool answer
 *                     |                             | from one cache (scene-capabilities.ts, moved here unchanged).
 *                     |                             | New behaviour lives only in new modules and in this route entry,
 *                     |                             | the module the mounter reloads on a hot update.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Select the admitted native engine and atomic owner file root while preserving legacy sockets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { engineBuildHash } from './engine-build-hash';
import { DEFAULT_ENGINE_ADDR, EngineClient, parseEngineAddr } from './engine-client';
import { resolveDataRoot } from './data-dir';
import { createProjectRoutes } from './project-routes';
import { registerSceneStudioAuthorization } from './scene-authorization';
import { capabilityCache, describeCapabilities } from './scene-capabilities';
import { registerSceneStudioTools } from './scene-tools';

const logger = createChildLogger({ module: 'scene-studio-routes' });
const SURFACE_SCRIPTS = ['scene-studio.js'] as const;
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub). */
export function callerSub(req: Request): string | null {
  const r = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}

function packageFile(appPackageDir: string | undefined, ...rel: string[]): string {
  const candidates = [appPackageDir ? path.join(appPackageDir, ...rel) : '', LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, ...rel) : '', path.resolve(__dirname, '..', ...rel)].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || candidates[candidates.length - 1];
}

function serveFile(filePath: string, contentType: 'html' | 'application/javascript'): RequestHandler {
  return (_req: Request, res: Response): void => {
    try {
      const source = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.type(contentType).send(source);
    } catch (error) {
      logger.error({ err: error, filePath }, 'Bundled surface file is not readable');
      res.status(404).json({ error: 'surface_file_not_found' });
    }
  };
}

/** @description Optional overrides for specs, on top of the framework's per-package context. */
export interface SceneStudioRouteOpts {
  dataRoot?: string;
  env?: Record<string, string | undefined>;
  /** A pre-built engine client (specs hand in one bound to a fake bridge). */
  engine?: EngineClient;
  engineBuild?: string | null;
}

/**
 * @description The install command the surface and /capabilities print when the engine is down.
 * @param env - Environment (OSHAL_API_CONTAINER names the api container when known).
 * @returns The exact command.
 */
export function installHint(env: Record<string, string | undefined>): string {
  const api = (env.OSHAL_API_CONTAINER || env.HOSTNAME || '<api-container>').trim();
  return `docker exec ${api} sh /app/workspace-shared/deployed-apps/scene-studio/engine/install-engine.sh`;
}

function capabilitiesRoute(capabilities: () => Promise<Record<string, unknown>>): RequestHandler {
  return async (_req: Request, res: Response) => {
    try {
      res.json(await capabilities());
    } catch (error) {
      logger.error({ err: error }, 'Scene Studio capabilities failed');
      res.status(500).json({ error: 'capabilities_failed' });
    }
  };
}

type NativeContext = AppContext & {intent?: (name: string, input: unknown) => Promise<unknown>};
function nativeContext(ctx: AppContext): boolean {
  return (ctx.pool as unknown as {storageModel?:string}).storageModel === 'kernel-scoped-documents';
}

/** Keep legacy sockets as-is; a native package has only its admitted fixed service capability. */
function sceneEngine(ctx: AppContext, opts: SceneStudioRouteOpts, env: Record<string,string|undefined>, build: string|null): EngineClient {
  if (opts.engine) return opts.engine;
  const addr = parseEngineAddr(env.SCENE_STUDIO_ENGINE_ADDR || DEFAULT_ENGINE_ADDR);
  if (!nativeContext(ctx)) return new EngineClient({...addr, expectedBuildHash:build, installHint:installHint(env)});
  const native = ctx as NativeContext;
  return new EngineClient({...addr, expectedBuildHash:null, installHint:'Enable the operator-owned native Scene engine.',
    nativeRequest:async (op, fields, timeoutMs) => {
      if (typeof native.intent !== 'function') throw new Error('Native Scene intent capability is unavailable');
      return await native.intent('scene.engine', {op, fields, timeoutMs}) as Awaited<ReturnType<NonNullable<ConstructorParameters<typeof EngineClient>[0]['nativeRequest']>>>;
    }});
}

/**
 * @description Build the `/api/scene-studio` router, and register the package's authorization
 * resource and its 22 package tools with the kernel while the package activates.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool`, `appPackageDir`, and the
 * activation-scoped `authorization` and `tools` ports (absent in an isolated route test).
 * @param opts - Spec overrides; see {@link SceneStudioRouteOpts}.
 * @returns The composed router.
 */
export function createSceneStudioRoutes(ctx: AppContext, opts: SceneStudioRouteOpts = {}): Router {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const dataRoot = opts.dataRoot ?? (nativeContext(ctx) ? '/tmp/scene-store' : resolveDataRoot(env));
  const engineDir = packageFile(ctx.appPackageDir, 'engine');
  const engineBuild = opts.engineBuild !== undefined ? opts.engineBuild : nativeContext(ctx) ? null : engineBuildHash(engineDir);
  const engine = sceneEngine(ctx, opts, env, engineBuild);
  const engineCaps = capabilityCache(engine);
  const capabilities = () => describeCapabilities(engine, engineCaps);
  registerSceneStudioAuthorization(ctx);
  const deps = {pool:ctx.pool, engine, dataRoot, capabilities, callerSub,
    get engineBuild(): string|null { return nativeContext(ctx) ? engine.status().buildHash : engineBuild; }};
  registerSceneStudioTools(ctx, deps);
  const router = Router();

  const surface = packageFile(ctx.appPackageDir, 'tools', 'scene-studio.html');
  logger.info({ surface, dataRoot, engine: engine.status().address, engineBuild }, 'Resolved the scene-studio surface');
  router.get('/app', serveFile(surface, 'html'));
  const assets = Router();
  for (const file of SURFACE_SCRIPTS) assets.get(`/${file}`, serveFile(packageFile(ctx.appPackageDir, 'tools', file), 'application/javascript'));
  router.use('/assets', assets);
  router.get('/capabilities', capabilitiesRoute(capabilities));
  router.use(createProjectRoutes(deps));
  return router;
}
