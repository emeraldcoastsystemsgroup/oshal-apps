/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Serves
 *                     |                             | the bundled surface and its scripts from this package's
 *                     |                             | tools/ (ctx.appPackageDir), publishes `/capabilities` (the
 *                     |                             | feature contract the routes enforce, the engine's status and
 *                     |                             | the exact install command when it is down), owns ONE engine
 *                     |                             | client per api process, and composes the model router under
 *                     |                             | the `/api/cad-studio` mount. The manifest's `auth: oidc` wraps
 *                     |                             | the whole mount; every handler still re-derives the caller.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { describeContract, FEATURE_INPUT_SCHEMA } from './feature-contract';
import { engineBuildHash } from './engine-build-hash';
import { DEFAULT_ENGINE_ADDR, EngineClient, parseEngineAddr } from './engine-client';
import { resolveDataRoot } from './data-dir';
import { createModelRoutes, UPLOAD_LIMITS } from './model-routes';
import { DEFAULT_SETTINGS, EXPORT_VIEWS } from './rebuild-service';

const logger = createChildLogger({ module: 'cad-studio-routes' });
const SURFACE_SCRIPTS = ['cad-studio.js', 'cad-studio-gl.js'] as const;
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
export interface CadStudioRouteOpts {
  dataRoot?: string;
  env?: Record<string, string | undefined>;
  /** A pre-built engine client (specs hand in one bound to a fake bridge). */
  engine?: EngineClient;
  engineBuild?: string | null;
  rebuildTimeoutMs?: number;
}

/**
 * @description The install command the surface and /capabilities print when the engine is down.
 * @param env - Environment (OSHAL_API_CONTAINER names the api container when known).
 * @returns The exact command.
 */
export function installHint(env: Record<string, string | undefined>): string {
  const api = (env.OSHAL_API_CONTAINER || env.HOSTNAME || '<api-container>').trim();
  return `docker exec ${api} sh /app/workspace-shared/deployed-apps/cad-studio/engine/install-engine.sh`;
}

/**
 * @description Build the `/api/cad-studio` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @param opts - Spec overrides; see {@link CadStudioRouteOpts}.
 * @returns The composed router.
 */
export function createCadStudioRoutes(ctx: AppContext, opts: CadStudioRouteOpts = {}): Router {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const dataRoot = opts.dataRoot ?? resolveDataRoot(env);
  const appPackageDir = ctx.appPackageDir;
  const engineDir = packageFile(appPackageDir, 'engine');
  const engineBuild = opts.engineBuild !== undefined ? opts.engineBuild : engineBuildHash(engineDir);
  const hint = installHint(env);
  const addr = parseEngineAddr(env.CAD_STUDIO_ENGINE_ADDR || DEFAULT_ENGINE_ADDR);
  const engine = opts.engine ?? new EngineClient({ host: addr.host, port: addr.port, expectedBuildHash: engineBuild, installHint: hint });
  const router = Router();

  const surface = packageFile(appPackageDir, 'tools', 'cad-studio.html');
  logger.info({ surface, appPackageDir, dataRoot, engine: `${addr.host}:${addr.port}`, engineBuild }, 'Resolved the cad-studio surface');
  router.get('/app', serveFile(surface, 'html'));
  const assets = Router();
  for (const file of SURFACE_SCRIPTS) assets.get(`/${file}`, serveFile(packageFile(appPackageDir, 'tools', file), 'application/javascript'));
  router.use('/assets', assets);

  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json({
      app: 'cad-studio', kernel: 'OCCT via CadQuery (engine container)', contract: describeContract(), featureInputSchema: FEATURE_INPUT_SCHEMA,
      exports: { formats: ['step', 'stl', 'svg', 'report'], views: EXPORT_VIEWS }, defaults: DEFAULT_SETTINGS, upload: UPLOAD_LIMITS,
      engine: engine.status(),
    });
  });

  router.use(createModelRoutes({ pool: ctx.pool, engine, dataRoot, engineBuild, callerSub, timeoutMs: opts.rebuildTimeoutMs }));
  return router;
}
